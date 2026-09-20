import { describe, expect, it } from "vitest";

import { referenceConfig } from "../../../domain/config";
import { deriveRocket } from "../../../domain/derive";
import { createEngineCatalog } from "../../../domain/engines";
import { evaluateFlightOutcome } from "../evaluate";

const rocket = deriveRocket(referenceConfig(), createEngineCatalog());
const evidence = { maxQPa: 30_000, maxG: 4.5, terminalTimeS: 100, perigeeKm: null, source: "observed" as const };

describe("evaluateFlightOutcome", () => {
  it("keeps a raw result authoritative while adding five deterministic metric assessments", () => {
    const assessment = evaluateFlightOutcome(rocket, "insufficient_liftoff_thrust", evidence);
    expect(assessment.rawOutcome).toBe("insufficient_liftoff_thrust");
    expect(assessment.metrics).toHaveLength(5);
    expect(assessment.primaryDiagnosis?.id).toBe("underpowered");
    expect(assessment.primaryDiagnosis?.recommendedExperiment.control).toBe("stage1EngineCount");
    expect(assessment.environmentalCauses).toEqual([]);
  });

  it("labels the existing static-margin termination as a simplified rule", () => {
    const assessment = evaluateFlightOutcome(rocket, "aerodynamic_instability", evidence);
    expect(assessment.primaryDiagnosis?.id).toBe("static_stability_limit");
    expect(assessment.primaryDiagnosis?.explanation).toContain("simplified game stability rule");
  });

  it("does not fabricate a diagnosis for a successful target flight", () => {
    const assessment = evaluateFlightOutcome(rocket, "target_orbit", evidence);
    expect(assessment.primaryDiagnosis).toBeNull();
  });

  it("does not fabricate a diagnosis for a successful lunar arrival", () => {
    const assessment = evaluateFlightOutcome(rocket, "lunar_arrival", evidence);
    expect(assessment.primaryDiagnosis).toBeNull();
  });

  it("does not fabricate a build-lever diagnosis for an aim miss (unmodelled dispersion)", () => {
    expect(evaluateFlightOutcome(rocket, "lunar_impact", evidence).primaryDiagnosis).toBeNull();
    expect(evaluateFlightOutcome(rocket, "lunar_miss", evidence).primaryDiagnosis).toBeNull();
  });

  it("diagnoses a delta-v shortfall on the trans-lunar burn as a weak upper stage", () => {
    const assessment = evaluateFlightOutcome(rocket, "tli_shortfall", evidence);
    expect(assessment.primaryDiagnosis?.id).toBe("weak_upper_stage");
    expect(assessment.primaryDiagnosis?.recommendedExperiment.control).toBe("stage2Engine");
  });

  it("diagnoses excess trans-lunar energy as an overshoot", () => {
    const assessment = evaluateFlightOutcome(rocket, "earth_escape", evidence);
    expect(assessment.primaryDiagnosis?.id).toBe("overshoot");
    expect(assessment.primaryDiagnosis?.recommendedExperiment.control).toBe("stage2PropellantKg");
  });

  it("retargets the ideal delta-v metric to the lunar requirement", () => {
    const assessment = evaluateFlightOutcome(rocket, "target_orbit", evidence);
    const deltaV = assessment.metrics.find((m) => m.id === "ideal_delta_v")!;
    expect(deltaV.threshold).toContain("12.40 km/s");
    // The reference build (12,501 m/s) clears the lunar floor but sits
    // below the warn line — see LUNAR_MISSION_PLAN.md §1's calibration box.
    expect(deltaV.band).toBe("marginal");
  });

  it("records space weather as an environmental cause, not a build diagnosis", () => {
    const assessment = evaluateFlightOutcome(rocket, "target_orbit", evidence, {
      weather: { kp: 7, f107: 220, solar_wind_speed: 800, solar_wind_density: 25, solar_wind_temperature: 300_000 },
      source: "python",
      sourceTimestamps: {},
      retrievedAt: "2026-09-20T00:00:00Z",
      freshnessMs: 0,
    });
    expect(assessment.primaryDiagnosis).toBeNull();
    expect(assessment.environmentalCauses.some((cause) => cause.severity === "storm")).toBe(true);
    expect(assessment.environmentalCauses.some((cause) => cause.id === "geomagnetic")).toBe(true);
  });
});
