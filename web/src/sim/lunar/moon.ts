/**
 * Lunar constants and ephemeris.
 *
 * The Moon is modelled on a circular, equatorial orbit — a deliberate
 * simplification stated in LUNAR_MISSION_PLAN.md §3. Real lunar eccentricity
 * (~0.055) and inclination (~5.1° to the ecliptic, itself inclined ~23.4° to
 * Earth's equator) are not simulated. The epoch phase angle is derived from
 * the flight's seed so a given seed always sees the Moon in the same place,
 * matching this project's determinism guarantee.
 */

import { SECONDS_PER_DAY } from "../physics/constants";
import { vec3, type Vec3 } from "../physics/vec3";

/** Moon gravitational parameter, m^3/s^2. */
export const MU_MOON = 4.9028695e12;
/** Moon mean radius, m. */
export const MOON_RADIUS_M = 1_737_400;
/** Moon orbital radius (circularized), m. */
export const MOON_ORBIT_RADIUS_M = 384_400_000;
/** Sphere of influence radius, m — patched-conic handoff boundary. */
export const MOON_SOI_RADIUS_M = 66_100_000;
/** Sidereal period, days. */
export const MOON_SIDEREAL_PERIOD_DAYS = 27.321661;

const MOON_SIDEREAL_PERIOD_S = MOON_SIDEREAL_PERIOD_DAYS * SECONDS_PER_DAY;
/** Moon mean angular rate about Earth, rad/s. */
export const MOON_ANGULAR_RATE_RAD_S = (2 * Math.PI) / MOON_SIDEREAL_PERIOD_S;
const MOON_ORBIT_SPEED_MS = (2 * Math.PI * MOON_ORBIT_RADIUS_M) / MOON_SIDEREAL_PERIOD_S;

/**
 * A deterministic epoch phase angle in [0, 2π) derived from the flight seed.
 * Not cryptographic — just a stable, well-distributed hash.
 */
export function moonEpochPhaseRad(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43_758.5453;
  const frac = x - Math.floor(x);
  return frac * 2 * Math.PI;
}

/** Moon position in the sim's Earth-centered inertial frame, meters. */
export function moonPositionEci(out: Vec3, tSinceLiftoffS: number, epochPhaseRad: number): Vec3 {
  const theta = epochPhaseRad + MOON_ANGULAR_RATE_RAD_S * tSinceLiftoffS;
  out[0] = MOON_ORBIT_RADIUS_M * Math.cos(theta);
  out[1] = MOON_ORBIT_RADIUS_M * Math.sin(theta);
  out[2] = 0;
  return out;
}

/** Moon velocity in the sim's Earth-centered inertial frame, m/s. */
export function moonVelocityEci(out: Vec3, tSinceLiftoffS: number, epochPhaseRad: number): Vec3 {
  const theta = epochPhaseRad + MOON_ANGULAR_RATE_RAD_S * tSinceLiftoffS;
  out[0] = -MOON_ORBIT_SPEED_MS * Math.sin(theta);
  out[1] = MOON_ORBIT_SPEED_MS * Math.cos(theta);
  out[2] = 0;
  return out;
}

export function moonState(tSinceLiftoffS: number, epochPhaseRad: number): { position: Vec3; velocity: Vec3 } {
  return {
    position: moonPositionEci(vec3(), tSinceLiftoffS, epochPhaseRad),
    velocity: moonVelocityEci(vec3(), tSinceLiftoffS, epochPhaseRad),
  };
}
