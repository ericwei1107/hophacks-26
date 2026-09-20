/**
 * Trans-lunar phase integration (LUNAR_MISSION_PLAN.md Step L4).
 */

import { describe, expect, it } from "vitest";

import { referenceConfig, type RocketConfig } from "../../../domain/config";
import { referenceSnapshot } from "../../orbital/weather";
import { defaultEnvironment, runFlight } from "../flight";

function fly(overrides: Partial<RocketConfig> = {}, recordTelemetry = true) {
  return runFlight({
    config: { ...referenceConfig(), ...overrides },
    environment: defaultEnvironment(referenceSnapshot()),
    recordTelemetry,
  });
}

describe("trans-lunar phases", () => {
  it("reaches lunar_arrival deterministically for the reference build", () => {
    const a = fly();
    const b = fly();
    expect(a.outcome).toBe("lunar_arrival");
    expect(b.outcome).toBe("lunar_arrival");
    expect(a.lunarTransfer).not.toBeNull();
    expect(a.lunarTransfer!.classification).toBe("lunar_arrival");
    expect(a.lunarTransfer!.periseleneRadiusM).toBeCloseTo(b.lunarTransfer!.periseleneRadiusM!, 6);
  });

  it("passes through the parking, TLI, and trans-lunar events in order", () => {
    const result = fly();
    const ids = result.events.map((e) => e.id);
    const orbitIdx = ids.indexOf("orbit_achieved");
    const ignitionIdx = ids.indexOf("tli_ignition");
    const cutoffIdx = ids.indexOf("tli_cutoff");
    const arrivalIdx = ids.indexOf("lunar_arrival");
    expect(orbitIdx).toBeGreaterThanOrEqual(0);
    expect(ignitionIdx).toBeGreaterThan(orbitIdx);
    expect(cutoffIdx).toBeGreaterThan(ignitionIdx);
    expect(arrivalIdx).toBeGreaterThan(cutoffIdx);
  });

  it("produces identical evidence with recordTelemetry true and false", () => {
    const withTelemetry = fly({}, true);
    const withoutTelemetry = fly({}, false);
    expect(withoutTelemetry.outcome).toBe(withTelemetry.outcome);
    expect(withoutTelemetry.lunarTransfer).toEqual(withTelemetry.lunarTransfer);
    expect(withoutTelemetry.finalState.t).toBeCloseTo(withTelemetry.finalState.t, 9);
    expect(withoutTelemetry.orbitAchieved).toBe(withTelemetry.orbitAchieved);
    expect(withoutTelemetry.targetOrbitAchieved).toBe(withTelemetry.targetOrbitAchieved);
  });

  it("reaches tli_shortfall with the old, lower-Isp vacuum upper stage", () => {
    // The `vacuum` engine (345 s) cannot carry the lunar delta-v requirement
    // on this airframe (LUNAR_MISSION_PLAN.md §1) — it should still reach a
    // sustained parking orbit but fall short on the trans-lunar burn.
    const result = fly({ stage2Engine: "vacuum" });
    expect(result.orbitAchieved).toBe(true);
    expect(result.outcome).toBe("tli_shortfall");
    expect(result.lunarTransfer).not.toBeNull();
    expect(result.lunarTransfer!.classification).toBe("tli_shortfall");
    expect(result.lunarTransfer!.deltaVAvailableMs).toBeLessThan(result.lunarTransfer!.deltaVRequiredMs);
  });

  it("never lets stage-2 propellant go negative through the TLI burn", () => {
    const result = fly();
    expect(result.finalState.stage2PropellantKg).toBeGreaterThanOrEqual(0);
  });

  it("keeps the parking orbit's elements distinct from the post-TLI trajectory", () => {
    const result = fly();
    const parking = result.finalState.parkingElements!;
    const final = result.finalElements!;
    expect(parking.apogeeAltitudeKm).toBeLessThan(1000);
    expect(final.apogeeAltitudeKm!).toBeGreaterThan(100_000);
  });

  it("does not attempt TLI for a low_perigee (non-sustained) orbit", () => {
    // A build that closes a bound orbit below the sustained-perigee floor
    // should terminate at low_perigee without ever entering the lunar phases.
    const result = fly({ stage2PropellantKg: 5_000, payloadWetMassKg: 15_000 });
    expect(["low_perigee", "insufficient_orbital_energy", "vacuum_engine_low_ignition"]).toContain(result.outcome);
    if (result.outcome === "low_perigee") {
      expect(result.finalState.parkingElements).toBeNull();
      expect(result.lunarTransfer).toBeNull();
    }
  });

  it("reaches lunar_miss just below the tli_shortfall boundary (Step L7 calibration fixture)", () => {
    // A slightly heavier payload trims delta-v just enough (~1.25% short of
    // required) to fall under evaluateTransfer's 2% shortfall tolerance —
    // the burn is classified as "adequate", but the resulting transfer
    // doesn't carry enough energy to actually reach the Moon's SOI. This is
    // the natural, continuous boundary between tli_shortfall and lunar_miss;
    // a slightly heavier payload still (5,900 kg) crosses into tli_shortfall.
    const result = fly({ payloadWetMassKg: 5_800 });
    expect(result.orbitAchieved).toBe(true);
    expect(result.outcome).toBe("lunar_miss");
    expect(result.lunarTransfer).not.toBeNull();
    expect(result.lunarTransfer!.classification).toBe("lunar_miss");
    expect(result.lunarTransfer!.periseleneRadiusM).toBeNull();
  });
});
