/**
 * Analytic two-body (Keplerian) propagation via the universal-variable
 * formulation (Curtis, "Orbital Mechanics for Engineering Students" §3.5).
 * Exact for an unperturbed two-body coast — used for the parking-orbit coast
 * in LUNAR_MISSION_PLAN.md §4.1, where stepping the full RK4 solver would
 * cost tens of thousands of timesteps for a single coast phase.
 *
 * Handles elliptical, parabolic, and hyperbolic trajectories through one
 * formulation (the universal anomaly generalizes eccentric/hyperbolic
 * anomaly), so no separate case-per-orbit-type branch is needed.
 */

import { MU_EARTH } from "./constants";
import { norm, type Vec3, vec3 } from "./vec3";

function stumpffC(z: number): number {
  if (z > 1e-8) {
    const sz = Math.sqrt(z);
    return (1 - Math.cos(sz)) / z;
  }
  if (z < -1e-8) {
    const sz = Math.sqrt(-z);
    return (Math.cosh(sz) - 1) / -z;
  }
  return 0.5;
}

function stumpffS(z: number): number {
  if (z > 1e-8) {
    const sz = Math.sqrt(z);
    return (sz - Math.sin(sz)) / sz ** 3;
  }
  if (z < -1e-8) {
    const sz = Math.sqrt(-z);
    return (Math.sinh(sz) - sz) / sz ** 3;
  }
  return 1 / 6;
}

export interface KeplerState {
  position: Vec3;
  velocity: Vec3;
}

/**
 * Propagate a two-body state forward (or backward, with negative dt) by
 * dtS seconds. Exact for an unperturbed conic; degrades gracefully only in
 * the sense that Newton's method may need more iterations near a parabolic
 * trajectory (alpha ≈ 0), which the guard iteration count accommodates.
 */
export function propagateKepler(position: Vec3, velocity: Vec3, dtS: number, mu = MU_EARTH): KeplerState {
  if (dtS === 0) {
    return { position: new Float64Array(position) as Vec3, velocity: new Float64Array(velocity) as Vec3 };
  }

  const r0 = norm(position);
  const v0 = norm(velocity);
  const vr0 = (position[0] * velocity[0] + position[1] * velocity[1] + position[2] * velocity[2]) / r0;
  const alpha = 2 / r0 - (v0 * v0) / mu;
  const sqrtMu = Math.sqrt(mu);

  // Initial universal-anomaly estimate (Curtis eq. 3.66/3.67 style).
  let chi = sqrtMu * Math.abs(alpha) * dtS;
  if (Math.abs(alpha) < 1e-12) {
    // Near-parabolic: fall back to a simple estimate from angular momentum.
    const hVec = vec3();
    hVec[0] = position[1] * velocity[2] - position[2] * velocity[1];
    hVec[1] = position[2] * velocity[0] - position[0] * velocity[2];
    hVec[2] = position[0] * velocity[1] - position[1] * velocity[0];
    const h = norm(hVec);
    const p = (h * h) / mu;
    chi = (Math.sqrt(p) * dtS) / r0;
  }

  let ratio = 1;
  let iterations = 0;
  while (Math.abs(ratio) > 1e-8 && iterations < 100) {
    const z = alpha * chi * chi;
    const C = stumpffC(z);
    const S = stumpffS(z);
    const F = (r0 * vr0) / sqrtMu * chi * chi * C + (1 - alpha * r0) * chi ** 3 * S + r0 * chi - sqrtMu * dtS;
    const dF =
      (r0 * vr0) / sqrtMu * chi * (1 - alpha * chi * chi * S) + (1 - alpha * r0) * chi * chi * C + r0;
    ratio = F / dF;
    chi -= ratio;
    iterations += 1;
  }

  const z = alpha * chi * chi;
  const C = stumpffC(z);
  const S = stumpffS(z);

  const f = 1 - (chi * chi / r0) * C;
  const g = dtS - (chi ** 3 / sqrtMu) * S;

  const newPosition = vec3();
  for (let i = 0; i < 3; i++) {
    newPosition[i] = f * position[i] + g * velocity[i];
  }
  const r = norm(newPosition);

  const fDot = (sqrtMu / (r * r0)) * (alpha * chi ** 3 * S - chi);
  const gDot = 1 - (chi * chi / r) * C;

  const newVelocity = vec3();
  for (let i = 0; i < 3; i++) {
    newVelocity[i] = fDot * position[i] + gDot * velocity[i];
  }

  return { position: newPosition, velocity: newVelocity };
}
