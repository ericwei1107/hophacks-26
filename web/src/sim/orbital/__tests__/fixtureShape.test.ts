/**
 * Cheap drift detector: fails if a fixture's mission/weather/result/ops
 * object has keys that don't match the TS interface exactly. This catches
 * an added, removed, or renamed Python field immediately, instead of
 * relying on a parity test noticing a value mismatch (which it won't, for
 * a field TS never reads at all).
 */
import { describe, expect, it } from "vitest";

import {
  OPERATIONAL_DRAW_KEYS,
  SIMULATION_RESULT_KEYS,
  SPACECRAFT_MISSION_KEYS,
  SPACE_WEATHER_KEYS,
} from "../types";
import { missionsJson, perturbedJson, weatherJson } from "./fixtures";

function expectKeys(actual: object, expected: readonly string[], label: string) {
  expect(Object.keys(actual).sort(), label).toEqual([...expected].sort());
}

describe("fixture shape matches TS interfaces", () => {
  it("SpacecraftMission", () => {
    for (const testCase of missionsJson.payload.cases) {
      expectKeys(testCase.mission, SPACECRAFT_MISSION_KEYS, testCase.name);
    }
  });

  it("SpaceWeather", () => {
    expectKeys(missionsJson.payload.weather, SPACE_WEATHER_KEYS, "missions weather");
    expectKeys(weatherJson.payload.weather, SPACE_WEATHER_KEYS, "reference weather");
  });

  it("SimulationResult", () => {
    for (const testCase of missionsJson.payload.cases) {
      expectKeys(testCase.expected, SIMULATION_RESULT_KEYS, testCase.name);
    }
  });

  it("OperationalDraw", () => {
    const sample = perturbedJson.payload.cases[0];
    expectKeys(sample.ops, OPERATIONAL_DRAW_KEYS, "perturbed case 0 ops");
  });
});
