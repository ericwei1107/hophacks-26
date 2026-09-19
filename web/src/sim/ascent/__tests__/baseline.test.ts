/**
 * Phase 0 baseline snapshot (hybrid-renderer refactor).
 *
 * Locks the reference build's flight outcome so every later refactor phase
 * can prove it changed only rendering, never physics. If one of these numbers
 * moves, the simulation changed — that is a regression unless it was the
 * deliberate point of the change.
 */

import { describe, expect, it } from "vitest";

import { referenceConfig } from "../../../domain/config";
import { referenceSnapshot } from "../../orbital/weather";
import { defaultEnvironment, runFlight } from "../flight";

function eventTime(events: { t: number; id: string }[], id: string): number | null {
  const found = events.find((e) => e.id === id);
  return found ? found.t : null;
}

describe("reference build baseline", () => {
  const result = runFlight({
    config: referenceConfig(),
    environment: defaultEnvironment(referenceSnapshot()),
    seed: 0,
  });

  it("reaches the documented outcome", () => {
    // The reference build clears the lunar delta-v requirement
    // (LUNAR_MISSION_PLAN.md §1), so the mission continues past the
    // parking orbit through trans-lunar injection to a lunar arrival.
    // orbitAchieved/targetOrbitAchieved still describe that parking
    // orbit — it was confirmed sustained and on-target before TLI ever
    // began.
    expect(result.outcome).toBe("lunar_arrival");
    expect(result.orbitAchieved).toBe(true);
    expect(result.targetOrbitAchieved).toBe(true);
    expect(result.failureCode).toBeNull();
    expect(result.lunarTransfer).not.toBeNull();
  });

  it("keeps the recorded orbit, loads and staging time", () => {
    expect(result.finalElements).not.toBeNull();
    const snapshot = {
      perigeeKm: Number(result.finalElements!.perigeeAltitudeKm.toFixed(3)),
      apogeeKm: Number(result.finalElements!.apogeeAltitudeKm!.toFixed(3)),
      inclinationDeg: Number(result.finalElements!.inclinationDeg.toFixed(3)),
      maxQPa: Number(result.maxQPa.toFixed(3)),
      maxG: Number(result.maxG.toFixed(4)),
      stage2PropellantRemainingKg: Number(result.stage2PropellantRemainingKg.toFixed(3)),
      totalTimeS: Number(result.finalState.t.toFixed(3)),
      sampleCount: result.telemetry.sampleCount,
      liftoffT: eventTime(result.events, "liftoff"),
      stage1BurnoutT: eventTime(result.events, "stage1_burnout"),
      separationT: eventTime(result.events, "separation"),
      stage2IgnitionT: eventTime(result.events, "stage2_ignition"),
      maxQT: eventTime(result.events, "max_q"),
      orbitAchievedT: eventTime(result.events, "orbit_achieved"),
      eventIds: result.events.map((e) => e.id),
    };
    expect(snapshot).toMatchSnapshot();
  });
});
