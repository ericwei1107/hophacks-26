import { describe, expect, it } from "vitest";

import { norm, sub, vec3 } from "../../physics/vec3";
import {
  MOON_ANGULAR_RATE_RAD_S,
  MOON_ORBIT_RADIUS_M,
  moonEpochPhaseRad,
  moonPositionEci,
  moonState,
  moonVelocityEci,
} from "../moon";

describe("moon ephemeris", () => {
  it("stays at the fixed orbital radius over time", () => {
    for (const t of [0, 3_600, 86_400, 10 * 86_400]) {
      const pos = moonPositionEci(vec3(), t, 1.234);
      expect(norm(pos)).toBeCloseTo(MOON_ORBIT_RADIUS_M, 0);
    }
  });

  it("advances angular position at the mean angular rate", () => {
    const epoch = 0.5;
    const p0 = moonPositionEci(vec3(), 0, epoch);
    const p1 = moonPositionEci(vec3(), 1_000, epoch);
    const angle0 = Math.atan2(p0[1], p0[0]);
    const angle1 = Math.atan2(p1[1], p1[0]);
    let delta = angle1 - angle0;
    if (delta < 0) delta += 2 * Math.PI;
    expect(delta).toBeCloseTo(MOON_ANGULAR_RATE_RAD_S * 1_000, 6);
  });

  it("keeps velocity consistent with position via finite difference", () => {
    const epoch = 2.1;
    const t = 50_000;
    const dt = 1;
    const pBefore = moonPositionEci(vec3(), t - dt / 2, epoch);
    const pAfter = moonPositionEci(vec3(), t + dt / 2, epoch);
    const numericVelocity = sub(vec3(), pAfter, pBefore);
    for (let i = 0; i < 3; i++) numericVelocity[i] /= dt;
    const analyticVelocity = moonVelocityEci(vec3(), t, epoch);
    for (let i = 0; i < 3; i++) {
      expect(analyticVelocity[i]).toBeCloseTo(numericVelocity[i], 2);
    }
  });

  it("is deterministic for a given seed and produces a stable phase in [0, 2π)", () => {
    const a = moonEpochPhaseRad(42);
    const b = moonEpochPhaseRad(42);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(2 * Math.PI);
  });

  it("gives different seeds different phases (well-distributed, not a coincidence check)", () => {
    const values = new Set([1, 2, 3, 4, 5].map((s) => moonEpochPhaseRad(s).toFixed(6)));
    expect(values.size).toBe(5);
  });

  it("moonState matches the individual position/velocity functions", () => {
    const { position, velocity } = moonState(12_345, 0.7);
    expect(position).toEqual(moonPositionEci(vec3(), 12_345, 0.7));
    expect(velocity).toEqual(moonVelocityEci(vec3(), 12_345, 0.7));
  });
});
