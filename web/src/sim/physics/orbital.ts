/**
 * Two-body orbital elements from position and velocity (ECI, meters).
 * Handles circular, radial, unbound, and ground-intersecting trajectories
 * without NaNs or fabricated apogee values.
 */

import { EARTH_RADIUS, MU_EARTH, OMEGA_EARTH } from "./constants";
import { cross, norm, type Vec3, vec3 } from "./vec3";

export interface OrbitalElements {
  /** Specific orbital energy, m^2/s^2. */
  specificEnergy: number;
  /** Specific angular momentum magnitude, m^2/s. */
  angularMomentum: number;
  eccentricity: number;
  /** Semi-major axis, m (negative for unbound trajectories). */
  semiMajorAxisM: number;
  /** Perigee altitude, km. */
  perigeeAltitudeKm: number;
  /** Apogee altitude, km; null when the trajectory is unbound. */
  apogeeAltitudeKm: number | null;
  inclinationDeg: number;
  bound: boolean;
  /** True when the perigee is below the surface. */
  intersectsGround: boolean;
}

const RADIAL_H_THRESHOLD = 1e-3; // m^2/s — effectively zero angular momentum
const _h = vec3();
const _vxh = vec3();
const _eVec = vec3();

export function orbitalElements(position: Vec3, velocity: Vec3): OrbitalElements {
  const r = norm(position);
  const v = norm(velocity);
  const energy = (v * v) / 2 - MU_EARTH / r;

  const h = _h;
  cross(h, position, velocity);
  const hMag = norm(h);

  const inclinationDeg =
    hMag > RADIAL_H_THRESHOLD
      ? (Math.acos(Math.min(1, Math.max(-1, h[2] / hMag))) * 180) / Math.PI
      : 0;

  if (hMag <= RADIAL_H_THRESHOLD) {
    // Radial trajectory: no angular momentum, the path is a degenerate
    // ellipse. It falls toward the center, so it always intersects ground.
    const semiMajor = energy < 0 ? -MU_EARTH / (2 * energy) : Number.POSITIVE_INFINITY;
    const apogeeM = energy < 0 ? 2 * semiMajor - 0 : null;
    return {
      specificEnergy: energy,
      angularMomentum: hMag,
      eccentricity: 1,
      semiMajorAxisM: semiMajor,
      perigeeAltitudeKm: -EARTH_RADIUS / 1000,
      apogeeAltitudeKm: apogeeM === null ? null : (apogeeM - EARTH_RADIUS) / 1000,
      inclinationDeg,
      bound: energy < 0,
      intersectsGround: true,
    };
  }

  // Eccentricity vector: e = (v × h)/μ − r̂
  const vxh = _vxh;
  cross(vxh, velocity, h);
  const eVec = _eVec;
  for (let i = 0; i < 3; i++) {
    eVec[i] = vxh[i] / MU_EARTH - position[i] / r;
  }
  const e = norm(eVec);

  const semiMajor = -MU_EARTH / (2 * energy);
  const bound = energy < 0 && e < 1;

  // Perigee/apogee radii from the semi-latus rectum, valid for any e ≠ 1.
  const p = (hMag * hMag) / MU_EARTH;
  const perigeeR = p / (1 + e);
  const apogeeR = e < 1 ? p / (1 - e) : null;

  return {
    specificEnergy: energy,
    angularMomentum: hMag,
    eccentricity: e,
    semiMajorAxisM: semiMajor,
    perigeeAltitudeKm: (perigeeR - EARTH_RADIUS) / 1000,
    apogeeAltitudeKm: apogeeR === null ? null : (apogeeR - EARTH_RADIUS) / 1000,
    inclinationDeg,
    bound,
    intersectsGround: perigeeR < EARTH_RADIUS,
  };
}

/** Velocity of the co-rotating atmosphere at a position: ω × r. */
export function atmosphereVelocity(out: Vec3, position: Vec3): Vec3 {
  out[0] = -OMEGA_EARTH * position[1];
  out[1] = OMEGA_EARTH * position[0];
  out[2] = 0;
  return out;
}
