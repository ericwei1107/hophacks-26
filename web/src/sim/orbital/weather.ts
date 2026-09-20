/**
 * Space-weather sourcing.
 *
 * A deterministic reference snapshot is bundled with the game, so it is
 * fully playable offline. The Python backend is tried first (same NOAA
 * products, server-side). If that is down, the browser fetches NOAA itself.
 * Any failure falls back to the bundled snapshot. One frozen snapshot is
 * used for a flight and all its analyses.
 */

import type { SpaceWeather } from "./types";
import { estimateAtmosphericDensity } from "./simulate";

export type WeatherSource = "reference" | "noaa" | "python";
export type WeatherSeverity = "quiet" | "elevated" | "storm";

export interface WeatherCause {
  id: string;
  title: string;
  severity: WeatherSeverity;
  explanation: string;
  evidence: string;
}

export interface SpaceWeatherEffects {
  scaleHeightKm: number;
  weatherFactor: number;
  referenceWeatherFactor: number;
  densityAt150Km: number;
  densityAt400Km: number;
  referenceDensityAt150Km: number;
  densityRatioVsReference: number;
  overallSeverity: WeatherSeverity;
  causes: WeatherCause[];
  computedBy: "python" | "typescript";
}

export interface WeatherSnapshot {
  weather: SpaceWeather;
  source: WeatherSource;
  /** Per-product observation timestamps (ISO), when known. */
  sourceTimestamps: Record<string, string>;
  /** Retrieval time (ISO). */
  retrievedAt: string;
  /** Age of the newest source observation at retrieval, ms; null if unknown. */
  freshnessMs: number | null;
  /** Thermosphere impact vs the quiet reference. Python fills this when it can. */
  effects?: SpaceWeatherEffects;
}

/** Deterministic reference snapshot: Kp 3, F10.7 150, wind 400 km/s, 5/cm³, 100,000 K. */
export const REFERENCE_WEATHER: SpaceWeather = {
  kp: 3.0,
  f107: 150.0,
  solar_wind_speed: 400.0,
  solar_wind_density: 5.0,
  solar_wind_temperature: 100_000.0,
};

export function referenceSnapshot(): WeatherSnapshot {
  const weather = { ...REFERENCE_WEATHER };
  return {
    weather,
    source: "reference",
    sourceTimestamps: {},
    retrievedAt: new Date(0).toISOString(),
    freshnessMs: null,
    effects: assessSpaceWeatherEffects(weather, "typescript"),
  };
}

export function freezeSnapshot(snapshot: WeatherSnapshot): WeatherSnapshot {
  return {
    weather: { ...snapshot.weather },
    source: snapshot.source,
    sourceTimestamps: { ...snapshot.sourceTimestamps },
    retrievedAt: snapshot.retrievedAt,
    freshnessMs: snapshot.freshnessMs,
    ...(snapshot.effects ? { effects: cloneEffects(snapshot.effects) } : {}),
  };
}

const NOAA_BASE_URL = "https://services.swpc.noaa.gov";
const REQUEST_TIMEOUT_MS = 5_000;

interface TimedValue {
  timeTag: string;
  value: number;
}

/** Newest entry with a parseable timestamp and a finite value. */
export function selectLatestValid(entries: TimedValue[]): TimedValue | null {
  let best: TimedValue | null = null;
  let bestTime = Number.NEGATIVE_INFINITY;
  for (const entry of entries) {
    const time = Date.parse(entry.timeTag);
    if (!Number.isFinite(time) || !Number.isFinite(entry.value)) {
      continue;
    }
    if (time > bestTime) {
      bestTime = time;
      best = entry;
    }
  }
  return best;
}

function toTimedValues(data: unknown, valueKey: string): TimedValue[] {
  if (!Array.isArray(data)) {
    return [];
  }
  return data
    .filter((row): row is Record<string, unknown> => row !== null && typeof row === "object")
    .map((row) => ({
      timeTag: typeof row["time_tag"] === "string" ? row["time_tag"] : "",
      value: Number(row[valueKey]),
    }));
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetchImpl(url, { signal });
  if (!response.ok) {
    throw new Error(`NOAA request failed: ${response.status}`);
  }
  return response.json();
}

/**
 * Load live space weather from NOAA SWPC. Throws on any failure; callers
 * should catch and fall back to the reference snapshot.
 */
export async function fetchNoaaSnapshot(
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<WeatherSnapshot> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const [kpJson, f107Json, windJson] = await Promise.all([
      fetchJson(fetchImpl, `${NOAA_BASE_URL}/products/noaa-planetary-k-index.json`, controller.signal),
      fetchJson(fetchImpl, `${NOAA_BASE_URL}/json/f107_cm_flux.json`, controller.signal),
      fetchJson(fetchImpl, `${NOAA_BASE_URL}/json/rtsw/rtsw_wind_1m.json`, controller.signal),
    ]);

    const kp = selectLatestValid(toTimedValues(kpJson, "Kp"));
    const f107 = selectLatestValid(toTimedValues(f107Json, "flux"));
    const speed = selectLatestValid(toTimedValues(windJson, "proton_speed"));
    const density = selectLatestValid(toTimedValues(windJson, "proton_density"));
    const temperature = selectLatestValid(toTimedValues(windJson, "proton_temperature"));

    if (!kp || !f107 || !speed || !density || !temperature) {
      throw new Error("NOAA returned incomplete space-weather data.");
    }

    const weather: SpaceWeather = {
      kp: kp.value,
      f107: f107.value,
      solar_wind_speed: speed.value,
      solar_wind_density: density.value,
      solar_wind_temperature: temperature.value,
    };
    if (!validateWeather(weather)) {
      throw new Error("NOAA returned invalid space-weather data.");
    }

    const sourceTimestamps: Record<string, string> = {
      kp: kp.timeTag,
      f107: f107.timeTag,
      solar_wind_speed: speed.timeTag,
      solar_wind_density: density.timeTag,
      solar_wind_temperature: temperature.timeTag,
    };
    const now = Date.now();
    const newest = Math.max(...Object.values(sourceTimestamps).map((t) => Date.parse(t)));

    return ensureWeatherEffects({
      weather,
      source: "noaa",
      sourceTimestamps,
      retrievedAt: new Date(now).toISOString(),
      freshnessMs: Number.isFinite(newest) ? now - newest : null,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function validateWeather(weather: SpaceWeather): boolean {
  return [
    weather.kp,
    weather.f107,
    weather.solar_wind_speed,
    weather.solar_wind_density,
    weather.solar_wind_temperature,
  ].every((value) => value !== null && Number.isFinite(value) && value >= 0);
}

function finiteOr(value: number | null, fallback: number): number {
  if (value === null || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

function thermosphereProfile(weather: SpaceWeather, inclinationDeg = 0): { scaleHeightKm: number; weatherFactor: number } {
  const f107 = Math.max(finiteOr(weather.f107, 70.0), 60.0);
  const kp = Math.max(finiteOr(weather.kp, 0.0), 0.0);
  const speed = finiteOr(weather.solar_wind_speed, 400.0);
  const swDensity = finiteOr(weather.solar_wind_density, 5.0);
  const swTemp = finiteOr(weather.solar_wind_temperature, 1.0e5);
  const scaleHeightKm = 42.0 + 0.07 * (f107 - 70.0) + 1.4 * kp;
  const solarFactor = (f107 / 150.0) ** 1.2;
  const geomagneticFactor = 1.0 + 0.05 * kp + 0.12 * Math.max(0.0, kp - 4.5) ** 1.3;
  const windFactor =
    1.0 + 0.0004 * (speed - 400.0) + 0.008 * (swDensity - 5.0) + 0.04 * (swTemp / 1.0e5 - 1.0);
  const polarFactor =
    1.0 +
    (0.08 * Math.abs(Math.sin((inclinationDeg * Math.PI) / 180)) * Math.max(0.0, kp - 2.0)) / 4.0;
  const weatherFactor =
    solarFactor * Math.max(0.25, geomagneticFactor) * Math.max(0.4, windFactor) * Math.max(1.0, polarFactor);
  return { scaleHeightKm, weatherFactor };
}

function rankSeverity(severity: WeatherSeverity): number {
  if (severity === "storm") {
    return 2;
  }
  if (severity === "elevated") {
    return 1;
  }
  return 0;
}

function cloneEffects(effects: SpaceWeatherEffects): SpaceWeatherEffects {
  return {
    ...effects,
    causes: effects.causes.map((cause) => ({ ...cause })),
  };
}

function parseEffects(raw: unknown): SpaceWeatherEffects | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }
  const body = raw as Partial<SpaceWeatherEffects>;
  if (!Array.isArray(body.causes) || body.causes.length === 0) {
    return null;
  }
  const ratio = Number(body.densityRatioVsReference);
  if (!Number.isFinite(ratio)) {
    return null;
  }
  return {
    scaleHeightKm: Number(body.scaleHeightKm),
    weatherFactor: Number(body.weatherFactor),
    referenceWeatherFactor: Number(body.referenceWeatherFactor),
    densityAt150Km: Number(body.densityAt150Km),
    densityAt400Km: Number(body.densityAt400Km),
    referenceDensityAt150Km: Number(body.referenceDensityAt150Km),
    densityRatioVsReference: ratio,
    overallSeverity:
      body.overallSeverity === "storm" || body.overallSeverity === "elevated" ? body.overallSeverity : "quiet",
    causes: body.causes.map((cause) => ({
      id: String(cause.id),
      title: String(cause.title),
      severity: cause.severity === "storm" || cause.severity === "elevated" ? cause.severity : "quiet",
      explanation: String(cause.explanation),
      evidence: String(cause.evidence),
    })),
    computedBy: body.computedBy === "python" ? "python" : "typescript",
  };
}

/** Local copy of the Python thermosphere assessment, used when /api/weather did not send effects. */
export function assessSpaceWeatherEffects(
  weather: SpaceWeather,
  computedBy: SpaceWeatherEffects["computedBy"] = "typescript",
  inclinationDeg = 0,
): SpaceWeatherEffects {
  const { scaleHeightKm, weatherFactor } = thermosphereProfile(weather, inclinationDeg);
  const reference = thermosphereProfile(REFERENCE_WEATHER, inclinationDeg);
  const densityAt150Km = estimateAtmosphericDensity(150, weather, inclinationDeg);
  const densityAt400Km = estimateAtmosphericDensity(400, weather, inclinationDeg);
  const referenceDensityAt150Km = estimateAtmosphericDensity(150, REFERENCE_WEATHER, inclinationDeg);
  const densityRatioVsReference = referenceDensityAt150Km > 0 ? densityAt150Km / referenceDensityAt150Km : 1;
  const kp = Math.max(finiteOr(weather.kp, 0), 0);
  const f107 = Math.max(finiteOr(weather.f107, 70), 60);
  const speed = finiteOr(weather.solar_wind_speed, 400);
  const swDensity = finiteOr(weather.solar_wind_density, 5);

  const geomagnetic =
    kp >= 5
      ? { severity: "storm" as const, title: "Geomagnetic storm", explanation: "Kp at storm levels heats and inflates the thermosphere, raising high-altitude drag during the vacuum portion of ascent and later stationkeeping." }
      : kp >= 4
        ? { severity: "elevated" as const, title: "Geomagnetic activity", explanation: "Active geomagnetic conditions expand the upper atmosphere. This is an environmental cause, not a vehicle control." }
        : { severity: "quiet" as const, title: "Quiet geomagnetic field", explanation: "Kp is quiet, so geomagnetic heating is not adding extra thermospheric drag." };
  const solar =
    f107 >= 200
      ? { severity: "storm" as const, title: "High solar EUV", explanation: "F10.7 is at high solar-cycle levels, so the thermosphere is expanded and high-altitude density is up." }
      : f107 >= 180
        ? { severity: "elevated" as const, title: "Elevated solar EUV", explanation: "F10.7 is high enough to inflate the thermosphere versus the reference snapshot." }
        : { severity: "quiet" as const, title: "Moderate solar EUV", explanation: "F10.7 is near or below the reference 150 sfu used for the quiet thermosphere." };
  const wind =
    speed >= 700 || swDensity >= 20
      ? { severity: "storm" as const, title: "Disturbed solar wind", explanation: "Fast or dense solar wind couples into geomagnetic heating and raises the weather factor on thermospheric density." }
      : speed >= 500 || swDensity >= 10
        ? { severity: "elevated" as const, title: "Enhanced solar wind", explanation: "Solar-wind speed or density is above the quiet reference and contributes to upper-atmosphere drag." }
        : { severity: "quiet" as const, title: "Nominal solar wind", explanation: "Solar-wind speed and density are near the quiet reference (400 km/s, 5 /cm³)." };
  const drag =
    densityRatioVsReference >= 1.5
      ? { severity: "storm" as const, title: "Thermosphere well above reference", explanation: "High-altitude density is at least 1.5× the quiet reference. Drag above 150 km is an environmental cause of extra Δv, not a build slider." }
      : densityRatioVsReference >= 1.15
        ? { severity: "elevated" as const, title: "Thermosphere above reference", explanation: "High-altitude density is elevated versus the quiet reference snapshot. Ascent still uses this weather freeze." }
        : { severity: "quiet" as const, title: "Thermosphere near reference", explanation: "High-altitude density is within about 15% of the quiet reference. Weather is still a launch input, just not a storm driver." };

  const causes: WeatherCause[] = [
    { id: "geomagnetic", ...geomagnetic, evidence: `Kp ${kp.toFixed(2)} (quiet < 4, storm ≥ 5).` },
    { id: "solar_euv", ...solar, evidence: `F10.7 ${f107.toFixed(0)} sfu (reference 150).` },
    { id: "solar_wind", ...wind, evidence: `Solar wind ${speed.toFixed(0)} km/s, ${swDensity.toFixed(1)} /cm³.` },
    { id: "thermosphere_drag", ...drag, evidence: `Density at 150 km is ${densityRatioVsReference.toFixed(2)}× the quiet reference.` },
  ];
  let overallSeverity: WeatherSeverity = "quiet";
  for (const cause of causes) {
    if (rankSeverity(cause.severity) > rankSeverity(overallSeverity)) {
      overallSeverity = cause.severity;
    }
  }
  return {
    scaleHeightKm,
    weatherFactor,
    referenceWeatherFactor: reference.weatherFactor,
    densityAt150Km,
    densityAt400Km,
    referenceDensityAt150Km,
    densityRatioVsReference,
    overallSeverity,
    causes,
    computedBy,
  };
}

/** Prefer Python-precomputed effects; otherwise compute the same assessment locally. */
export function ensureWeatherEffects(snapshot: WeatherSnapshot): WeatherSnapshot {
  if (snapshot.effects && snapshot.effects.causes.length > 0) {
    return snapshot;
  }
  return {
    ...snapshot,
    effects: assessSpaceWeatherEffects(snapshot.weather, snapshot.source === "python" ? "python" : "typescript"),
  };
}

async function fetchPythonWeatherSnapshot(
  fetchImpl: typeof fetch = fetch,
): Promise<WeatherSnapshot> {
  const response = await fetchImpl("/api/weather", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Python weather failed: ${response.status}`);
  }
  const body = (await response.json()) as WeatherSnapshot & { effects?: unknown };
  if (!body?.weather || !validateWeather(body.weather)) {
    throw new Error("Python weather payload was invalid.");
  }
  const parsed = parseEffects(body.effects);
  return ensureWeatherEffects({
    weather: { ...body.weather },
    source: "python",
    sourceTimestamps: body.sourceTimestamps ?? {},
    retrievedAt: body.retrievedAt ?? new Date().toISOString(),
    freshnessMs: body.freshnessMs ?? null,
    ...(parsed ? { effects: { ...parsed, computedBy: "python" } } : {}),
  });
}

/** Python NOAA when the backend is up, else browser NOAA, else the reference snapshot. */
export async function loadWeatherSnapshot(
  fetchImpl: typeof fetch = fetch,
): Promise<WeatherSnapshot> {
  try {
    return await fetchPythonWeatherSnapshot(fetchImpl);
  } catch {
    try {
      return await fetchNoaaSnapshot(fetchImpl);
    } catch {
      return referenceSnapshot();
    }
  }
}
