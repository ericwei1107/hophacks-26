export type SatcatObjectType = "PAY" | "R/B" | "DEB" | "UNK";

export interface SatcatRecord {
  APOGEE?: number | string | null;
  PERIGEE?: number | string | null;
  OBJECT_TYPE?: SatcatObjectType | string | null;
  ORBIT_CENTER?: string | null;
  OBJECT_NAME?: string | null;
  NORAD_CAT_ID?: number | string | null;
  INCLINATION?: number | string | null;
}

export interface ShellCounts {
  payload: number;
  rocket_body: number;
  debris: number;
  unknown: number;
  total: number;
}

export interface SatcatCensus {
  altitude: number;
  shell_low: number;
  shell_high: number;
  counts: ShellCounts;
  reference_counts: ShellCounts;
  cam_scale: number;
  obstacle: "quiet" | "nominal" | "crowded" | "severe";
  source: string;
  note: string;
}

export const SATCAT_URL =
  "https://celestrak.org/satcat/records.php?FORMAT=JSON&ONORBIT=1";

export const SYNTHETIC_SATCAT: SatcatRecord[] = [
  ...Array.from({ length: 18 }, () => ({ APOGEE: 545, PERIGEE: 545, OBJECT_TYPE: "PAY" })),
  ...Array.from({ length: 14 }, () => ({ APOGEE: 540, PERIGEE: 540, OBJECT_TYPE: "DEB" })),
  ...Array.from({ length: 5 }, () => ({ APOGEE: 400, PERIGEE: 400, OBJECT_TYPE: "R/B" })),
  ...Array.from({ length: 3 }, () => ({ APOGEE: 400, PERIGEE: 400, OBJECT_TYPE: "PAY" })),
];

const CACHE_KEY = "apogee.satcat.onorbit";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export function camScaleFromCounts(shellTotal: number, referenceTotal: number): number {
  return Math.max(0.4, Math.min(2.5, shellTotal / Math.max(referenceTotal, 1)));
}

function numeric(value: number | string | null | undefined): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function meanAltitude(row: SatcatRecord): number | null {
  const apogee = numeric(row.APOGEE);
  const perigee = numeric(row.PERIGEE);
  if (apogee === null || perigee === null || Math.min(apogee, perigee) < 80 || Math.max(apogee, perigee) > 2000) return null;
  return (apogee + perigee) / 2;
}

function counts(rows: SatcatRecord[], altitude: number, halfWidth: number): ShellCounts {
  const result: ShellCounts = { payload: 0, rocket_body: 0, debris: 0, unknown: 0, total: 0 };
  for (const row of rows) {
    if (row.ORBIT_CENTER && row.ORBIT_CENTER !== "EA") continue;
    const mean = meanAltitude(row);
    if (mean === null || Math.abs(mean - altitude) > halfWidth) continue;
    const key = row.OBJECT_TYPE === "PAY" ? "payload" : row.OBJECT_TYPE === "R/B" ? "rocket_body" : row.OBJECT_TYPE === "DEB" ? "debris" : "unknown";
    result[key] += 1;
    result.total += 1;
  }
  return result;
}

export function shellCensus(rows: SatcatRecord[], altitude: number, halfWidth = 30, referenceAltitude = 400, source = "synthetic fallback"): SatcatCensus {
  const shell = counts(rows, altitude, halfWidth);
  const reference = counts(rows, referenceAltitude, halfWidth);
  const camScale = camScaleFromCounts(shell.total, reference.total);
  const obstacle = camScale < 0.85 ? "quiet" : camScale <= 1.25 ? "nominal" : camScale <= 1.8 ? "crowded" : "severe";
  return {
    altitude,
    shell_low: altitude - halfWidth,
    shell_high: altitude + halfWidth,
    counts: shell,
    reference_counts: reference,
    cam_scale: camScale,
    obstacle,
    source,
    note: "Screening shell count; not collision probability (Pc). Close approaches use a 5 km screening volume, not NASA-grade Pc.",
  };
}

export async function loadSatcat(forceRefresh = false): Promise<SatcatRecord[]> {
  try {
    if (!forceRefresh) {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as { saved: number; rows: SatcatRecord[] };
        if (Date.now() - parsed.saved < CACHE_TTL_MS) return parsed.rows;
      }
    }
    const response = await fetch(SATCAT_URL);
    if (!response.ok) throw new Error(`SATCAT HTTP ${response.status}`);
    const rows = (await response.json()) as SatcatRecord[];
    if (!Array.isArray(rows)) throw new Error("SATCAT response was not an array");
    localStorage.setItem(CACHE_KEY, JSON.stringify({ saved: Date.now(), rows }));
    return rows;
  } catch {
    return SYNTHETIC_SATCAT.map((row) => ({ ...row }));
  }
}
