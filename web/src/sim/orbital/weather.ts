/**
 * Space-weather sourcing.
 *
 * A deterministic reference snapshot is bundled with the game, so it is
 * fully playable offline. Live NOAA loading is optional; observations are
 * selected by timestamp and validity (never by array position), requests
 * time out after five seconds, and any failure falls back to the bundled
 * snapshot. One frozen snapshot is used for a flight and all its analyses.
 */

import type { SpaceWeather } from "./types";

export type WeatherSource = "reference" | "noaa";

export interface WeatherSnapshot {
  weather: SpaceWeather;
  source: WeatherSource;
  /** Per-product observation timestamps (ISO), when known. */
  sourceTimestamps: Record<string, string>;
  /** Retrieval time (ISO). */
  retrievedAt: string;
  /** Age of the newest source observation at retrieval, ms; null if unknown. */
  freshnessMs: number | null;
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
  return {
    weather: { ...REFERENCE_WEATHER },
    source: "reference",
    sourceTimestamps: {},
    retrievedAt: new Date(0).toISOString(),
    freshnessMs: null,
  };
}

export function freezeSnapshot(snapshot: WeatherSnapshot): WeatherSnapshot {
  return {
    weather: { ...snapshot.weather },
    source: snapshot.source,
    sourceTimestamps: { ...snapshot.sourceTimestamps },
    retrievedAt: snapshot.retrievedAt,
    freshnessMs: snapshot.freshnessMs,
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
      timeTag: typeof row.time_tag === "string" ? row.time_tag : "",
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

    return {
      weather,
      source: "noaa",
      sourceTimestamps,
      retrievedAt: new Date(now).toISOString(),
      freshnessMs: Number.isFinite(newest) ? now - newest : null,
    };
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

/** Live weather when available, otherwise the bundled reference snapshot. */
export async function loadWeatherSnapshot(): Promise<WeatherSnapshot> {
  try {
    return await fetchNoaaSnapshot();
  } catch {
    return referenceSnapshot();
  }
}
