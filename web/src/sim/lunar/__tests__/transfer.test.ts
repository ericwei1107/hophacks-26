import { describe, expect, it } from "vitest";

import { EARTH_RADIUS } from "../../physics/constants";
import { MOON_RADIUS_M } from "../moon";
import { estimatePeriselene, evaluateTransfer, transferRequirement } from "../transfer";
import { vec3 } from "../../physics/vec3";

describe("transferRequirement", () => {
  it("matches the hand-derived LUNAR_MISSION_PLAN.md §2.2 arithmetic from 200 km", () => {
    const result = transferRequirement(EARTH_RADIUS + 200_000);
    expect(result.deltaVRequiredMs).toBeCloseTo(3_132, -1); // within 10 m/s of 3,132
    expect(result.timeOfFlightS / 86_400).toBeCloseTo(5.0, 1); // ~5.0 days
  });

  it("requires less delta-v from a higher parking orbit", () => {
    const low = transferRequirement(EARTH_RADIUS + 180_000);
    const high = transferRequirement(EARTH_RADIUS + 220_000);
    expect(high.deltaVRequiredMs).toBeLessThan(low.deltaVRequiredMs);
  });
});

describe("evaluateTransfer", () => {
  const parkingRadiusM = EARTH_RADIUS + 200_000;
  const requirement = transferRequirement(parkingRadiusM);

  it("classifies a meaningful delta-v shortfall as tli_shortfall", () => {
    const result = evaluateTransfer({
      parkingRadiusM,
      deltaVAvailableMs: requirement.deltaVRequiredMs * 0.8,
      deltaVRequiredMs: requirement.deltaVRequiredMs,
      apogeeAfterBurnM: parkingRadiusM * 1.5,
      soiEntryRelativePosition: null,
      soiEntryRelativeVelocity: null,
    });
    expect(result.classification).toBe("tli_shortfall");
    expect(result.periseleneRadiusM).toBeNull();
  });

  it("classifies wildly excess energy as earth_escape", () => {
    const result = evaluateTransfer({
      parkingRadiusM,
      deltaVAvailableMs: requirement.deltaVRequiredMs * 3,
      deltaVRequiredMs: requirement.deltaVRequiredMs,
      apogeeAfterBurnM: parkingRadiusM * 1000,
      soiEntryRelativePosition: null,
      soiEntryRelativeVelocity: null,
    });
    expect(result.classification).toBe("earth_escape");
  });

  it("classifies a correct burn with no SOI encounter as lunar_miss", () => {
    const result = evaluateTransfer({
      parkingRadiusM,
      deltaVAvailableMs: requirement.deltaVRequiredMs,
      deltaVRequiredMs: requirement.deltaVRequiredMs,
      apogeeAfterBurnM: 384_400_000,
      soiEntryRelativePosition: null,
      soiEntryRelativeVelocity: null,
    });
    expect(result.classification).toBe("lunar_miss");
    expect(result.timeOfFlightS).not.toBeNull();
  });

  it("classifies a low SOI-entry periselene as lunar_impact", () => {
    // Aimed nearly dead-center at the Moon at a realistic ~300 m/s hyperbolic
    // excess speed (Apollo-class arrivals were in this range) -> periselene
    // well inside the Moon's radius.
    const result = evaluateTransfer({
      parkingRadiusM,
      deltaVAvailableMs: requirement.deltaVRequiredMs,
      deltaVRequiredMs: requirement.deltaVRequiredMs,
      apogeeAfterBurnM: 384_400_000,
      soiEntryRelativePosition: vec3(66_100_000, 500_000, 0),
      soiEntryRelativeVelocity: vec3(-300, 0, 0),
    });
    expect(result.classification).toBe("lunar_impact");
    expect(result.periseleneRadiusM!).toBeLessThan(MOON_RADIUS_M);
  });

  it("classifies a well-aimed SOI entry as lunar_arrival", () => {
    const result = evaluateTransfer({
      parkingRadiusM,
      deltaVAvailableMs: requirement.deltaVRequiredMs,
      deltaVRequiredMs: requirement.deltaVRequiredMs,
      apogeeAfterBurnM: 384_400_000,
      soiEntryRelativePosition: vec3(66_100_000, 20_000_000, 0),
      soiEntryRelativeVelocity: vec3(-300, 0, 0),
    });
    expect(result.classification).toBe("lunar_arrival");
    expect(result.periseleneRadiusM!).toBeGreaterThan(MOON_RADIUS_M);
  });
});

describe("estimatePeriselene", () => {
  it("returns a periselene above the Moon's radius for a wide-offset approach", () => {
    const periselene = estimatePeriselene(vec3(66_100_000, 20_000_000, 0), vec3(-300, 0, 0));
    expect(periselene).toBeGreaterThan(MOON_RADIUS_M);
  });

  it("returns a periselene below the Moon's radius for a near head-on approach", () => {
    const periselene = estimatePeriselene(vec3(66_100_000, 1_000, 0), vec3(-300, 0, 0));
    expect(periselene).toBeLessThan(MOON_RADIUS_M);
  });
});
