/**
 * Numerical verification for the ascent solver (IMPLEMENT.MD §4).
 */

import { describe, expect, it } from "vitest";

import { referenceConfig } from "../../../domain/config";
import { EARTH_RADIUS, MU_EARTH } from "../../physics/constants";
import { orbitalElements } from "../../physics/orbital";
import { clone, norm, vec3 } from "../../physics/vec3";
import { referenceSnapshot } from "../../orbital/weather";
import {
  createFlight,
  defaultEnvironment,
  runFlight,
  stepFlight,
  type FlightState,
} from "../flight";

function referenceState(): FlightState {
  return createFlight(referenceConfig(), defaultEnvironment(referenceSnapshot()));
}

describe("orbit propagation", () => {
  it("conserves energy and angular momentum with no thrust and no drag", () => {
    const state = referenceState();
    // Place in a circular 2000 km equatorial orbit where density ~1e-16.
    const r = EARTH_RADIUS + 2_000_000;
    const v = Math.sqrt(MU_EARTH / r);
    state.position = vec3(r, 0, 0);
    state.velocity = vec3(0, v, 0);
    state.phase = "COAST";
    state.liftoffT = 0;
    state.maxAltitudeKm = 2000;
    state.stage2PropellantKg = 1000; // prevent finalization

    const e0 = orbitalElements(state.position, state.velocity);
    for (let i = 0; i < 20_000; i++) {
      stepFlight(state, 0.05);
    }
    const e1 = orbitalElements(state.position, state.velocity);

    expect(Math.abs(e1.specificEnergy - e0.specificEnergy) / Math.abs(e0.specificEnergy)).toBeLessThan(1e-6);
    expect(Math.abs(e1.angularMomentum - e0.angularMomentum) / e0.angularMomentum).toBeLessThan(1e-6);
  });
});

describe("timestep convergence", () => {
  it("0.025 s agrees with 0.05 s within tolerances", () => {
    const environment = () => defaultEnvironment(referenceSnapshot());
    const coarse = runFlight({ config: referenceConfig(), environment: environment(), timestepS: 0.05 });
    const fine = runFlight({ config: referenceConfig(), environment: environment(), timestepS: 0.025 });

    expect(coarse.outcome).toBe(fine.outcome);
    expect(Math.abs(coarse.maxQPa - fine.maxQPa) / fine.maxQPa).toBeLessThan(0.01);
    expect(Math.abs(coarse.maxG - fine.maxG) / fine.maxG).toBeLessThan(0.01);
    expect(
      Math.abs(coarse.finalElements!.perigeeAltitudeKm - fine.finalElements!.perigeeAltitudeKm),
    ).toBeLessThan(1);
    expect(
      Math.abs(coarse.finalElements!.apogeeAltitudeKm! - fine.finalElements!.apogeeAltitudeKm!),
    ).toBeLessThan(1);
  });
});

describe("propellant accounting", () => {
  it("burnout consumes exactly the available fuel", () => {
    const result = runFlight({ config: referenceConfig(), environment: defaultEnvironment(referenceSnapshot()) });
    expect(result.finalState.stage1PropellantKg).toBe(0);
    // Stage 2 remainder is whatever the cutoff left — never negative.
    expect(result.finalState.stage2PropellantKg).toBeGreaterThanOrEqual(0);
  });

  it("never creates fuel or impulse across cutoff and restart", () => {
    const result = runFlight({ config: referenceConfig(), environment: defaultEnvironment(referenceSnapshot()) });
    const t = result.telemetry;
    for (let i = 1; i < t.sampleCount; i++) {
      expect(t.propellantKg[i]).toBeLessThanOrEqual(t.propellantKg[i - 1] + 1e-9);
    }
  });
});

describe("staging", () => {
  it("conserves momentum and removes only the detached mass", () => {
    const state = referenceState();
    let preVelocity: ReturnType<typeof clone> | null = null;
    let steps = 0;
    while (state.detachedStages.length === 0 && steps < 100_000) {
      preVelocity = clone(state.velocity);
      stepFlight(state, 0.05);
      steps++;
    }
    expect(state.detachedStages.length).toBe(1);
    const spent = state.detachedStages[0];

    // Relative velocity approximately 1 m/s along the stack axis.
    const rel = vec3();
    for (let i = 0; i < 3; i++) {
      rel[i] = state.velocity[i] - spent.velocity[i];
    }
    expect(norm(rel)).toBeGreaterThan(0.9);
    expect(norm(rel)).toBeLessThan(1.1);

    // Momentum balance: m_upper*v_upper + m_spent*v_spent = m_total*v_pre
    // (gravity over the sub-step contributes a small, bounded discrepancy).
    // Compare as vectors: equatorial eastward flight has a near-zero Z
    // component, so per-component ratios are unstable.
    const massUpper =
      state.rocket.config.payloadWetMassKg +
      state.rocket.stage2.dryMassKg +
      state.stage2PropellantKg +
      (state.fairingJettisoned ? 0 : 800);
    const afterVec = vec3();
    const beforeVec = vec3();
    for (let i = 0; i < 3; i++) {
      afterVec[i] = massUpper * state.velocity[i] + spent.massKg * spent.velocity[i];
      beforeVec[i] = (massUpper + spent.massKg) * preVelocity![i];
    }
    const diff = vec3();
    for (let i = 0; i < 3; i++) {
      diff[i] = afterVec[i] - beforeVec[i];
    }
    expect(norm(diff) / norm(beforeVec)).toBeLessThan(1e-3);
  });
});

describe("boundaries", () => {
  it("ground impact terminates at the surface, never below", () => {
    const result = runFlight({
      config: { ...referenceConfig(), payloadWetMassKg: 20_000, stage1PropellantKg: 240_000, stage2PropellantKg: 15_000 },
      environment: defaultEnvironment(referenceSnapshot()),
    });
    expect(result.outcome).toBe("insufficient_orbital_energy");
    const t = result.telemetry;
    for (let i = 0; i < t.sampleCount; i++) {
      expect(t.altitudeKm[i]).toBeGreaterThan(-0.01);
    }
  });

  it("inclination follows launch geometry", () => {
    const equatorial = runFlight({ config: referenceConfig(), environment: defaultEnvironment(referenceSnapshot()) });
    expect(equatorial.finalElements!.inclinationDeg).toBeLessThan(1);

    const env = { ...defaultEnvironment(referenceSnapshot()), launchLatitudeDeg: 28.5 };
    const ksc = runFlight({ config: referenceConfig(), environment: env });
    expect(Math.abs(ksc.finalElements!.inclinationDeg - 28.5)).toBeLessThan(2.5);
  });
});
