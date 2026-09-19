/**
 * Fixed calibration/gameplay scenario suite (IMPLEMENT.MD §4). The reference
 * build and nearby viable variants all fly with the identical autopilot;
 * underpowered or unsuitable builds fail for understandable reasons.
 */

import { describe, expect, it } from "vitest";

import { referenceConfig, type RocketConfig } from "../../../domain/config";
import { referenceSnapshot } from "../../orbital/weather";
import { defaultEnvironment, runFlight, type FlightResult } from "../flight";

function fly(overrides: Partial<RocketConfig> = {}): FlightResult {
  return runFlight({
    config: { ...referenceConfig(), ...overrides },
    environment: defaultEnvironment(referenceSnapshot()),
  });
}

describe("reference build", () => {
  it("reaches the target corridor", () => {
    const result = fly();
    expect(result.outcome).toBe("target_orbit");
    expect(result.orbitAchieved).toBe(true);
    expect(result.targetOrbitAchieved).toBe(true);
    const el = result.finalElements!;
    expect(el.perigeeAltitudeKm).toBeGreaterThanOrEqual(180);
    expect(el.perigeeAltitudeKm).toBeLessThanOrEqual(220);
    expect(el.apogeeAltitudeKm).toBeGreaterThanOrEqual(180);
    expect(el.apogeeAltitudeKm!).toBeLessThanOrEqual(250);
    // Equatorial launch due east -> near-equatorial inclination.
    expect(el.inclinationDeg).toBeLessThan(1);
  });

  it("approximately reproduces the documented calibration figures", () => {
    const result = fly();
    const s1Burnout = result.events.find((e) => e.id === "stage1_burnout")!;
    // Documented: stage-1 burnout T+146, max-Q ~30 kPa at T+66, peak g 4.5.
    expect(s1Burnout.t).toBeGreaterThan(130);
    expect(s1Burnout.t).toBeLessThan(170);
    expect(result.maxQPa).toBeGreaterThan(20_000);
    expect(result.maxQPa).toBeLessThan(45_000);
    expect(result.maxG).toBeLessThanOrEqual(5.0);
    expect(result.maxG).toBeGreaterThan(4.0);
    for (const id of ["liftoff", "stage1_burnout", "separation", "stage2_ignition"]) {
      expect(result.events.some((e) => e.id === id)).toBe(true);
    }
  });

  it("is deterministic", () => {
    const a = fly();
    const b = fly();
    expect(a.outcome).toBe(b.outcome);
    expect(a.telemetry.sampleCount).toBe(b.telemetry.sampleCount);
    expect(a.finalElements!.perigeeAltitudeKm).toBe(b.finalElements!.perigeeAltitudeKm);
  });
});

describe("nearby viable builds (same autopilot)", () => {
  it.each([
    { payloadWetMassKg: 2_000 },
    { payloadWetMassKg: 10_000, stage1PropellantKg: 260_000, stage1EngineCount: 5 },
    { stage2PropellantKg: 80_000, stage1PropellantKg: 240_000, stage1EngineCount: 5 },
    { diameterM: 4.2, finSpanM: 2.6 },
  ])("reaches orbit with %o", (overrides) => {
    const result = fly(overrides);
    expect(result.orbitAchieved).toBe(true);
  });
});

describe("failure scenarios", () => {
  it("insufficient liftoff thrust stays on the pad", () => {
    const result = fly({ stage1Engine: "sustainer", stage1EngineCount: 1, stage1PropellantKg: 400_000 });
    expect(result.outcome).toBe("insufficient_liftoff_thrust");
    expect(result.orbitAchieved).toBe(false);
    // Never leaves the pad and never falls through Earth.
    expect(Math.max(...result.telemetry.altitudeKm.slice(0, result.telemetry.sampleCount))).toBeLessThanOrEqual(0.001);
  });

  it("adequate liftoff thrust but insufficient orbital energy", () => {
    // Heavy payload, big first stage, undersized upper stage: stages fine,
    // but the upper stage cannot circularize and the vehicle reenters.
    const result = fly({ payloadWetMassKg: 20_000, stage1PropellantKg: 240_000, stage2PropellantKg: 15_000 });
    expect(result.outcome).toBe("insufficient_orbital_energy");
    expect(result.orbitAchieved).toBe(false);
  });

  it("excessive slenderness fails structurally at liftoff", () => {
    const result = fly({
      diameterM: 1.2,
      stage1Engine: "sustainer",
      stage1EngineCount: 1,
      stage1PropellantKg: 20_000,
      stage2PropellantKg: 5_000,
      stage2Engine: "sustainer",
      payloadWetMassKg: 500,
    });
    expect(result.outcome).toBe("slenderness_limit");
  });

  it("insufficient fin stability fails in the atmosphere", () => {
    const result = fly({ finSpanM: 0 });
    expect(result.outcome).toBe("aerodynamic_instability");
  });

  it("structural max-Q failure", () => {
    // Overpowered first stage accelerates too hard low in the atmosphere.
    const result = fly({ stage1EngineCount: 5 });
    expect(result.outcome).toBe("dynamic_pressure_limit");
    expect(result.maxQPa).toBeGreaterThan(45_000);
  });

  it("vacuum engine igniting too low fails", () => {
    // Big slow first stage stages below 60 km.
    const result = fly({ stage1PropellantKg: 280_000 });
    expect(result.outcome).toBe("vacuum_engine_low_ignition");
  });

  it("acceleration above the limit despite minimum throttle", () => {
    // Tiny upper stack with a sea-level engine: even min throttle > 5 g.
    const result = fly({
      stage1PropellantKg: 280_000,
      stage1EngineCount: 5,
      stage2PropellantKg: 5_000,
      stage2Engine: "sustainer",
      payloadWetMassKg: 500,
    });
    expect(result.outcome).toBe("acceleration_limit");
    expect(result.maxG).toBeGreaterThan(5.0);
  });
});

describe("test-only 28.5° launch site", () => {
  it("produces ~28.5° inclination", () => {
    const env = { ...defaultEnvironment(referenceSnapshot()), launchLatitudeDeg: 28.5 };
    const result = runFlight({ config: referenceConfig(), environment: env });
    expect(result.orbitAchieved).toBe(true);
    expect(result.finalElements!.inclinationDeg).toBeGreaterThan(26);
    expect(result.finalElements!.inclinationDeg).toBeLessThan(31);
  });
});
