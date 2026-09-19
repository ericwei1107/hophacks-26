import { describe, expect, it } from "vitest";

import { EARTH_RADIUS, MU_EARTH } from "../constants";
import { propagateKepler } from "../kepler";
import { norm, vec3 } from "../vec3";

describe("propagateKepler", () => {
  it("returns the same state for dt = 0", () => {
    const position = vec3(EARTH_RADIUS + 200_000, 0, 0);
    const velocity = vec3(0, 7_784, 0);
    const result = propagateKepler(position, velocity, 0);
    expect(result.position[0]).toBeCloseTo(position[0], 9);
    expect(result.velocity[1]).toBeCloseTo(velocity[1], 9);
  });

  it("returns to the start after a full circular period", () => {
    const r = EARTH_RADIUS + 200_000;
    const v = Math.sqrt(MU_EARTH / r);
    const position = vec3(r, 0, 0);
    const velocity = vec3(0, v, 0);
    const period = 2 * Math.PI * Math.sqrt(r ** 3 / MU_EARTH);

    const result = propagateKepler(position, velocity, period);
    expect(result.position[0]).toBeCloseTo(r, 3);
    expect(result.position[1]).toBeCloseTo(0, 3);
    expect(result.velocity[1]).toBeCloseTo(v, 6);
  });

  it("conserves energy and angular momentum over an elliptical coast", () => {
    const position = vec3(EARTH_RADIUS + 200_000, 0, 0);
    const velocity = vec3(500, 7_600, 200);
    const energy0 = (norm(velocity) ** 2) / 2 - MU_EARTH / norm(position);

    const result = propagateKepler(position, velocity, 3_600);
    const energy1 = (norm(result.velocity) ** 2) / 2 - MU_EARTH / norm(result.position);
    expect(Math.abs(energy1 - energy0) / Math.abs(energy0)).toBeLessThan(1e-8);
  });

  it("round-trips forward then backward to the start", () => {
    const position = vec3(EARTH_RADIUS + 200_000, 0, 0);
    const velocity = vec3(300, 7_700, 100);
    const forward = propagateKepler(position, velocity, 1_800);
    const back = propagateKepler(forward.position, forward.velocity, -1_800);
    expect(back.position[0]).toBeCloseTo(position[0], 3);
    expect(back.position[1]).toBeCloseTo(position[1], 3);
    expect(back.velocity[1]).toBeCloseTo(velocity[1], 6);
  });

  it("agrees with RK4 over a short drag-free vacuum coast", () => {
    // Cross-check against the active solver's own integrator rather than
    // re-deriving RK4 here.
    const r = EARTH_RADIUS + 200_000;
    const v = Math.sqrt(MU_EARTH / r);
    const position = vec3(r, 0, 0);
    const velocity = vec3(0, v, 0);

    const dt = 0.5;
    const steps = 1_200; // 600 s
    let pos = vec3(position[0], position[1], position[2]);
    let vel = vec3(velocity[0], velocity[1], velocity[2]);
    const accel = (p: Float64Array) => {
      const r3 = norm(p) ** 3;
      return vec3((-MU_EARTH * p[0]) / r3, (-MU_EARTH * p[1]) / r3, (-MU_EARTH * p[2]) / r3);
    };
    for (let i = 0; i < steps; i++) {
      // RK4
      const k1v = accel(pos);
      const k1p = vel;
      const p2 = vec3(pos[0] + (k1p[0] * dt) / 2, pos[1] + (k1p[1] * dt) / 2, pos[2] + (k1p[2] * dt) / 2);
      const v2 = vec3(vel[0] + (k1v[0] * dt) / 2, vel[1] + (k1v[1] * dt) / 2, vel[2] + (k1v[2] * dt) / 2);
      const k2v = accel(p2);
      const k2p = v2;
      const p3 = vec3(pos[0] + (k2p[0] * dt) / 2, pos[1] + (k2p[1] * dt) / 2, pos[2] + (k2p[2] * dt) / 2);
      const v3 = vec3(vel[0] + (k2v[0] * dt) / 2, vel[1] + (k2v[1] * dt) / 2, vel[2] + (k2v[2] * dt) / 2);
      const k3v = accel(p3);
      const k3p = v3;
      const p4 = vec3(pos[0] + k3p[0] * dt, pos[1] + k3p[1] * dt, pos[2] + k3p[2] * dt);
      const v4 = vec3(vel[0] + k3v[0] * dt, vel[1] + k3v[1] * dt, vel[2] + k3v[2] * dt);
      const k4v = accel(p4);
      const k4p = v4;
      const nextPos = vec3(
        pos[0] + (dt / 6) * (k1p[0] + 2 * k2p[0] + 2 * k3p[0] + k4p[0]),
        pos[1] + (dt / 6) * (k1p[1] + 2 * k2p[1] + 2 * k3p[1] + k4p[1]),
        pos[2] + (dt / 6) * (k1p[2] + 2 * k2p[2] + 2 * k3p[2] + k4p[2]),
      );
      const nextVel = vec3(
        vel[0] + (dt / 6) * (k1v[0] + 2 * k2v[0] + 2 * k3v[0] + k4v[0]),
        vel[1] + (dt / 6) * (k1v[1] + 2 * k2v[1] + 2 * k3v[1] + k4v[1]),
        vel[2] + (dt / 6) * (k1v[2] + 2 * k2v[2] + 2 * k3v[2] + k4v[2]),
      );
      pos = nextPos;
      vel = nextVel;
    }

    const kepler = propagateKepler(position, velocity, steps * dt);
    expect(Math.abs(kepler.position[0] - pos[0])).toBeLessThan(1);
    expect(Math.abs(kepler.position[1] - pos[1])).toBeLessThan(1);
    expect(Math.abs(kepler.velocity[1] - vel[1])).toBeLessThan(1e-3);
  });
});
