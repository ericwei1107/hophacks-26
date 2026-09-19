import { describe, expect, it } from "vitest";

import { runMonteCarlo, runOverallMonteCarlo, runParameterSensitivity } from "../monteCarlo";
import { REFERENCE_WEATHER } from "../weather";
import type { SpacecraftMission } from "../types";

const mission: SpacecraftMission = {
  mass: 750,
  fuel: 200,
  lifespan: 5,
  target_altitude: 500,
  target_inclination: 51.6,
  cross_section_area: 10,
  drag_coefficient: 2.2,
  isp: 325,
};

describe("orbital Monte Carlo", () => {
  it("is deterministic for a given seed", () => {
    const a = runOverallMonteCarlo(mission, REFERENCE_WEATHER, 200, 42);
    const b = runOverallMonteCarlo(mission, REFERENCE_WEATHER, 200, 42);
    expect(a.passes).toBe(b.passes);
    expect(a.failures).toBe(b.failures);
    expect(a.failureModes).toEqual(b.failureModes);
  });

  it("counts add up and failure modes overlap-aware", () => {
    const { passes, failures, failureModes } = runOverallMonteCarlo(mission, REFERENCE_WEATHER, 500, 7);
    expect(passes + failures).toBe(500);
    for (const count of Object.values(failureModes)) {
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThanOrEqual(500);
    }
  });

  it("requires positive run counts", () => {
    expect(() => runOverallMonteCarlo(mission, REFERENCE_WEATHER, 0)).toThrow();
    expect(() => runParameterSensitivity(mission, REFERENCE_WEATHER, 0)).toThrow();
    expect(() => runMonteCarlo(mission, REFERENCE_WEATHER, 0, 10)).toThrow();
    expect(() => runMonteCarlo(mission, REFERENCE_WEATHER, 10, 0)).toThrow();
  });

  it("covers sixteen sensitivity parameters", () => {
    const results = runParameterSensitivity(mission, REFERENCE_WEATHER, 20, 1);
    expect(results.length).toBe(16);
    const parameters = results.map((r) => r.parameter);
    expect(parameters).toContain("mass");
    expect(parameters).toContain("kp");
    expect(parameters).toContain("debris_environment");
  });

  it("stops early when the chunk callback cancels", () => {
    const { passes, failures } = runOverallMonteCarlo(mission, REFERENCE_WEATHER, 1000, 3, undefined, () => false);
    expect(passes + failures).toBeLessThan(1000);
  });
});
