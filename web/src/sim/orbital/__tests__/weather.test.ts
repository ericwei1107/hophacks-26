import { describe, expect, it } from "vitest";

import {
  fetchNoaaSnapshot,
  loadWeatherSnapshot,
  referenceSnapshot,
  selectLatestValid,
  validateWeather,
} from "../weather";

describe("selectLatestValid", () => {
  it("picks the newest valid entry by timestamp, not array position", () => {
    const entries = [
      { timeTag: "2026-09-19T12:00:00Z", value: 5.0 },
      { timeTag: "2026-09-19T09:00:00Z", value: 3.0 }, // older but listed later
      { timeTag: "2026-09-19T13:00:00Z", value: Number.NaN }, // invalid value
      { timeTag: "not-a-date", value: 9.0 }, // invalid timestamp
    ];
    expect(selectLatestValid(entries)?.value).toBe(5.0);
  });

  it("returns null when nothing is usable", () => {
    expect(selectLatestValid([{ timeTag: "", value: Number.NaN }])).toBeNull();
    expect(selectLatestValid([])).toBeNull();
  });
});

describe("reference snapshot", () => {
  it("matches the documented deterministic values", () => {
    const snapshot = referenceSnapshot();
    expect(snapshot.source).toBe("reference");
    expect(snapshot.weather).toEqual({
      kp: 3.0,
      f107: 150.0,
      solar_wind_speed: 400.0,
      solar_wind_density: 5.0,
      solar_wind_temperature: 100_000.0,
    });
    expect(validateWeather(snapshot.weather)).toBe(true);
  });
});

describe("fetchNoaaSnapshot", () => {
  function mockFetch(bodies: unknown[]): typeof fetch {
    return (async () => ({
      ok: true,
      json: async () => bodies.shift(),
    })) as unknown as typeof fetch;
  }

  it("parses products and selects by timestamp", async () => {
    const fetchImpl = mockFetch([
      [
        { time_tag: "2026-09-19T10:00:00Z", Kp: 2.0 },
        { time_tag: "2026-09-19T13:00:00Z", Kp: 4.33 },
        { time_tag: "2026-09-19T12:00:00Z", Kp: 3.0 },
      ],
      [{ time_tag: "2026-09-19T11:00:00Z", flux: 178.5 }],
      [
        { time_tag: "2026-09-19T12:00:00Z", proton_speed: 455, proton_density: 6.1, proton_temperature: 152_000 },
        { time_tag: "2026-09-19T12:01:00Z", proton_speed: 460, proton_density: 6.2, proton_temperature: 153_000 },
      ],
    ]);
    const snapshot = await fetchNoaaSnapshot(fetchImpl);
    expect(snapshot.source).toBe("noaa");
    expect(snapshot.weather.kp).toBe(4.33);
    expect(snapshot.weather.f107).toBe(178.5);
    expect(snapshot.weather.solar_wind_speed).toBe(460);
    expect(snapshot.weather.solar_wind_density).toBe(6.2);
    expect(snapshot.weather.solar_wind_temperature).toBe(153_000);
    expect(snapshot.sourceTimestamps["kp"]).toBe("2026-09-19T13:00:00Z");
    expect(snapshot.freshnessMs).not.toBeNull();
  });

  it("throws on HTTP failure so callers fall back", async () => {
    const fetchImpl = (async () => ({ ok: false, status: 503 })) as unknown as typeof fetch;
    await expect(fetchNoaaSnapshot(fetchImpl)).rejects.toThrow("503");
  });

  it("throws when every observation is invalid", async () => {
    const fetchImpl = mockFetch([
      [{ time_tag: "bad", Kp: Number.NaN }],
      [{ time_tag: "2026-09-19T11:00:00Z", flux: 150 }],
      [{ time_tag: "2026-09-19T12:00:00Z", proton_speed: 400, proton_density: 5, proton_temperature: 100_000 }],
    ]);
    await expect(fetchNoaaSnapshot(fetchImpl)).rejects.toThrow("incomplete");
  });
});

describe("loadWeatherSnapshot fallback", () => {
  it("falls back to the reference snapshot when NOAA is unreachable", async () => {
    // Default fetch in the test environment has no network; must not throw.
    const snapshot = await loadWeatherSnapshot();
    expect(validateWeather(snapshot.weather)).toBe(true);
  });
});
