import { describe, expect, it } from "vitest";

import { referenceConfig } from "../../../domain/config";
import { referenceSnapshot } from "../../orbital/weather";
import { defaultEnvironment } from "../flight";
import {
  ASCENT_SENSITIVITY_PARAMETERS,
  runAscentAnalysis,
  runAscentSensitivity,
  wilsonInterval,
} from "../robustness";

describe("wilsonInterval", () => {
  it("bounds a proportion", () => {
    const [lo, hi] = wilsonInterval(62, 100);
    expect(lo).toBeGreaterThan(0.5);
    expect(hi).toBeLessThan(0.75);
    expect(lo).toBeLessThan(0.62);
    expect(hi).toBeGreaterThan(0.62);
  });

  it("handles edge cases", () => {
    expect(wilsonInterval(0, 0)).toEqual([0, 0]);
    const [lo, hi] = wilsonInterval(100, 100);
    expect(lo).toBeGreaterThan(0.9);
    expect(hi).toBeGreaterThan(0.99);
    expect(hi).toBeLessThanOrEqual(1);
  });
});

describe("ascent robustness", () => {
  it("is deterministic for a given seed", () => {
    const env = () => defaultEnvironment(referenceSnapshot());
    const a = runAscentAnalysis({ config: referenceConfig(), environment: env(), runs: 12, seed: 5 });
    const b = runAscentAnalysis({ config: referenceConfig(), environment: env(), runs: 12, seed: 5 });
    expect(a.orbitAchievedCount).toBe(b.orbitAchievedCount);
    expect(a.outcomeCounts).toEqual(b.outcomeCounts);
  });

  it("the reference build is robust under bounded perturbations", () => {
    const result = runAscentAnalysis({
      config: referenceConfig(),
      environment: defaultEnvironment(referenceSnapshot()),
      runs: 30,
      seed: 11,
    });
    // Bounded +/-3% thrust etc. should not flip the reference build.
    expect(result.orbitProbability).toBeGreaterThan(0.8);
    expect(result.completedRuns).toBe(30);
    expect(result.orbitProbability95[0]).toBeLessThanOrEqual(result.orbitProbability);
    expect(result.orbitProbability95[1]).toBeGreaterThanOrEqual(result.orbitProbability);
  });

  it("an unstable build fails robustly", () => {
    const result = runAscentAnalysis({
      config: { ...referenceConfig(), finSpanM: 0 },
      environment: defaultEnvironment(referenceSnapshot()),
      runs: 20,
      seed: 2,
    });
    expect(result.orbitAchievedCount).toBe(0);
    expect(result.outcomeCounts["aerodynamic_instability"]).toBe(20);
  });

  it("stops early on cancellation", () => {
    const result = runAscentAnalysis({
      config: referenceConfig(),
      environment: defaultEnvironment(referenceSnapshot()),
      runs: 200,
      seed: 1,
      onChunk: () => false,
    });
    expect(result.completedRuns).toBeLessThan(200);
  });
});

describe("ascent sensitivity", () => {
  it("covers all six uncertainty parameters", () => {
    const result = runAscentSensitivity(
      referenceConfig(),
      defaultEnvironment(referenceSnapshot()),
      6,
      4,
    );
    expect(result.entries.length).toBe(ASCENT_SENSITIVITY_PARAMETERS.length);
    for (const entry of result.entries) {
      expect(entry.runs).toBe(6);
      expect(entry.orbitProbability).toBeGreaterThanOrEqual(0);
      expect(entry.orbitProbability).toBeLessThanOrEqual(1);
    }
  });
});
