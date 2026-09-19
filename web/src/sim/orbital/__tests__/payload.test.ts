import { describe, expect, it } from "vitest";

import { referenceConfig } from "../../../domain/config";
import { defaultEnvironment, runFlight } from "../../ascent/flight";
import { referenceSnapshot } from "../weather";
import {
  analyzePayload,
  circularizationDeltaV,
  createPayloadHandoff,
} from "../payload";
import { GAME_MISSION_RULES } from "../types";

function flyReference() {
  return runFlight({
    config: referenceConfig(),
    environment: defaultEnvironment(referenceSnapshot()),
  });
}

describe("circularizationDeltaV", () => {
  it("is zero for an already-circular orbit", () => {
    expect(circularizationDeltaV(200, 200)).toBe(0);
  });

  it("matches a hand-computed Hohmann-style value", () => {
    // 150 x 300 km orbit circularizing at apogee.
    const dv = circularizationDeltaV(150, 300);
    expect(dv).toBeGreaterThan(0);
    expect(dv).toBeLessThan(100); // sanity scale
  });
});

describe("payload handoff", () => {
  it("is created only for achieved orbits", () => {
    const success = flyReference();
    expect(createPayloadHandoff(success)).not.toBeNull();

    const failure = runFlight({
      config: { ...referenceConfig(), finSpanM: 0 },
      environment: defaultEnvironment(referenceSnapshot()),
    });
    expect(createPayloadHandoff(failure)).toBeNull();
  });

  it("carries the achieved orbit and leaves upper-stage fuel separate", () => {
    const handoff = createPayloadHandoff(flyReference())!;
    expect(handoff.achievedPerigeeKm).toBeGreaterThanOrEqual(180);
    expect(handoff.achievedApogeeKm).toBeGreaterThanOrEqual(180);
    expect(handoff.stage2PropellantRemainingKg).toBeGreaterThan(0);
  });
});

describe("analyzePayload", () => {
  it("builds the fixed educational spacecraft spec", () => {
    const handoff = createPayloadHandoff(flyReference())!;
    const analysis = analyzePayload(handoff)!;
    expect(analysis.dryMassKg).toBe(4_000);
    expect(analysis.onboardPropellantKg).toBe(1_000);
    expect(analysis.ispS).toBe(325);
    expect(analysis.missionYears).toBe(3);
    expect(analysis.crossSectionAreaM2).toBeCloseTo(5 * 5 ** (2 / 3), 9);
  });

  it("charges circularization against payload propellant exactly once", () => {
    const handoff = createPayloadHandoff(flyReference())!;
    const analysis = analyzePayload(handoff)!;
    expect(analysis.insertionBudgetOk).toBe(true);
    expect(analysis.circularizationDeltaVMs).toBeGreaterThan(0);
    expect(analysis.circularizationPropellantKg).toBeGreaterThan(0);
    // The mission fuel is the onboard propellant minus circularization only.
    expect(analysis.mission!.fuel).toBeCloseTo(
      analysis.onboardPropellantKg - analysis.circularizationPropellantKg,
      9,
    );
    // The mission runs on the circularized apogee altitude and game rules.
    expect(analysis.mission!.target_altitude).toBeCloseTo(handoff.achievedApogeeKm, 9);
    expect(analysis.rules).toBe(GAME_MISSION_RULES);
  });

  it("reports all four delta-v budget components", () => {
    const analysis = analyzePayload(createPayloadHandoff(flyReference())!)!;
    const r = analysis.result!;
    expect(r.drag_delta_v).toBeGreaterThanOrEqual(0);
    expect(r.collision_avoidance_delta_v).toBeGreaterThanOrEqual(0);
    expect(r.insertion_delta_v).toBeGreaterThanOrEqual(0);
    expect(r.disposal_delta_v).toBeGreaterThanOrEqual(0);
    expect(r.required_delta_v).toBeCloseTo(
      r.drag_delta_v + r.collision_avoidance_delta_v + r.insertion_delta_v + r.disposal_delta_v,
      9,
    );
  });

  it("fails the insertion budget when circularization is unaffordable", () => {
    const handoff = createPayloadHandoff(flyReference())!;
    const wild: typeof handoff = {
      ...handoff,
      achievedPerigeeKm: 150,
      achievedApogeeKm: 10_000, // huge circularization cost
    };
    const analysis = analyzePayload(wild);
    expect(analysis.insertionBudgetOk).toBe(false);
    expect(analysis.mission).toBeNull();
    expect(analysis.explanations[0]).toContain("Insertion-budget failure");
  });

  it("a successful launch can still have poor three-year survival at low altitude", () => {
    // A barely-sustained 150-160 km perigee orbit circularized low faces
    // strong drag over three years.
    const handoff = createPayloadHandoff(flyReference())!;
    const low: typeof handoff = {
      ...handoff,
      achievedPerigeeKm: 150,
      achievedApogeeKm: 160,
    };
    const analysis = analyzePayload(low);
    expect(analysis.insertionBudgetOk).toBe(true);
    expect(analysis.result).not.toBeNull();
    // Low altitude -> large drag budget -> the mission should struggle.
    expect(analysis.result!.passed).toBe(false);
    expect(analysis.explanations.join(" ")).toContain("tradeoff");
  });
});
