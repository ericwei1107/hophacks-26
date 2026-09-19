/**
 * The fixed autopilot. There are no player-facing guidance or throttle
 * controls; every build flies with these same versioned coefficients.
 *
 * Schedule:
 * 1. Vertical until the airspeed-based gravity-turn kick begins.
 * 2. Pitch-from-vertical follows an airspeed schedule, never commanding more
 *    than the angle-of-attack limit away from the airflow while dynamic
 *    pressure is meaningful.
 * 3. Above the dense atmosphere, orbital-state feedback targets the apogee.
 * 4. The upper stage coasts and restarts once to circularize; the burn
 *    begins before apogee (finite-burn estimate) and uses radial-position
 *    and radial-velocity feedback, cutting off inside the target corridor.
 *
 * Throttle: full until predicted proper acceleration reaches the cap, then
 * reduced within the engine's permitted range.
 */

import { G0, MU_EARTH } from "../physics/constants";
import type { OrbitalElements } from "../physics/orbital";
import {
  angleBetween,
  cross,
  dot,
  norm,
  normalize,
  rotateToward,
  scale,
  sub,
  vec3,
  type Vec3,
} from "../physics/vec3";
import { GUIDANCE_VERSION } from "../../domain/version";

export interface GuidanceCoefficients {
  version: string;
  /** Airspeed at which the pitch kick begins, m/s. */
  kickStartAirspeedMs: number;
  /** Pitch-kick angle from vertical, degrees (airspeed-triggered). */
  pitchKickDeg: number;
  /**
   * Cap on pitch-from-vertical while following the airflow, degrees per m/s
   * above the kick start. Keeps the gravity turn from running away
   * horizontally at low altitude for off-nominal builds.
   */
  pitchCapGainDegPerMs: number;
  /** Angle-of-attack limit while dynamic pressure is meaningful, degrees. */
  aoaLimitDeg: number;
  /** Dynamic pressure above which the AoA limit applies, Pa. */
  aeroQLimitPa: number;
  /** Below this dynamic pressure, use orbital-state feedback, Pa. */
  orbitalFeedbackQPa: number;
  /** Target apogee for the ascent, km. */
  targetApogeeKm: number;
  /** Pitch bias per km of apogee error, degrees. */
  apogeePitchGainDegPerKm: number;
  /** Clamp on the apogee pitch bias, degrees. */
  apogeePitchBiasMaxDeg: number;
  /**
   * Ascent-burn apogee cap, km. If the apogee reaches this while perigee is
   * still short, cut and coast, then circularize at apogee. Direct insertion
   * (perigee reaches target) is preferred when the burn is efficient.
   */
  ascentApogeeCapKm: number;
  /** Target perigee for circularization, km. */
  targetPerigeeKm: number;
  /** Extra lead beyond half the estimated burn before apogee, s. */
  circularizeLeadS: number;
  /** Radial-velocity feedback gain during circularization, deg per (m/s). */
  radialVelocityGainDegPerMs: number;
  /** Clamp on radial-feedback pitch bias, degrees. */
  radialBiasMaxDeg: number;
  /** Proper-acceleration throttle cap, g. */
  maxProperAccelG: number;
  /** Attitude rate limit, deg/s. */
  attitudeRateLimitDegS: number;
}

export function defaultGuidanceCoefficients(): GuidanceCoefficients {
  return {
    version: GUIDANCE_VERSION,
    kickStartAirspeedMs: 140,
    pitchKickDeg: 4.5,
    pitchCapGainDegPerMs: 0.4,
    aoaLimitDeg: 4,
    aeroQLimitPa: 500,
    orbitalFeedbackQPa: 100,
    targetApogeeKm: 200,
    apogeePitchGainDegPerKm: 0.25,
    apogeePitchBiasMaxDeg: 30,
    ascentApogeeCapKm: 202,
    targetPerigeeKm: 200,
    circularizeLeadS: 5,
    radialVelocityGainDegPerMs: 0.12,
    radialBiasMaxDeg: 20,
    maxProperAccelG: 4.5,
    attitudeRateLimitDegS: 8,
  };
}

export interface GuidanceContext {
  position: Vec3;
  velocity: Vec3;
  /** Atmosphere-relative velocity (wind removed), ECI frame. */
  vRel: Vec3;
  airspeedMs: number;
  altitudeKm: number;
  dynamicPressurePa: number;
  massKg: number;
  /** Active-stage total thrust at full throttle and current ambient pressure, N. */
  fullThrustN: number;
  /** Active-stage total mass flow at full throttle, kg/s. */
  massFlowKgS: number;
  /** Minimum throttle fraction of the active engine. */
  minThrottle: number;
  elements: OrbitalElements;
  /** Estimated time to apogee, s; null when not applicable. */
  timeToApogeeS: number | null;
  /** Local up unit vector (position direction). */
  up: Vec3;
  /** Launch east unit vector. */
  east: Vec3;
  burning: boolean;
}

export interface GuidanceCommand {
  /** Unit thrust direction, ECI. */
  direction: Vec3;
  /** Throttle fraction after the acceleration cap. */
  throttle: number;
  /** Autopilot requests engine cutoff (ascent burn done / orbit met). */
  cutoff: boolean;
}

const DEG = Math.PI / 180;

/** Time from now to apogee along a two-body trajectory; null when unbound. */
export function timeToApogee(position: Vec3, velocity: Vec3, elements: OrbitalElements): number | null {
  if (!elements.bound || elements.eccentricity >= 1 || elements.eccentricity < 1e-6) {
    return null;
  }
  const r = norm(position);
  const a = elements.semiMajorAxisM;
  const e = elements.eccentricity;
  // True anomaly from the eccentricity vector.
  const h = cross(vec3(), position, velocity);
  const eVec = vec3();
  const vxh = cross(vec3(), velocity, h);
  for (let i = 0; i < 3; i++) {
    eVec[i] = vxh[i] / MU_EARTH - position[i] / r;
  }
  const cosNu = dot(eVec, position) / (e * r);
  const radialVelocity = dot(velocity, position) / r;
  let nu = Math.acos(Math.min(1, Math.max(-1, cosNu)));
  if (radialVelocity < 0) {
    nu = 2 * Math.PI - nu;
  }
  const meanMotion = Math.sqrt(MU_EARTH / a ** 3);
  const eccentricAnomaly = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2));
  const meanAnomaly = eccentricAnomaly - e * Math.sin(eccentricAnomaly);
  let deltaM = Math.PI - meanAnomaly;
  if (deltaM < 0) {
    deltaM += 2 * Math.PI;
  }
  return deltaM / meanMotion;
}

/** Estimated burn duration for a delta-v at current mass and throttle. */
export function estimateBurnDurationS(
  deltaVMs: number,
  massKg: number,
  massFlowKgS: number,
  vacuumIspS: number,
): number {
  if (massFlowKgS <= 0 || deltaVMs <= 0) {
    return 0;
  }
  const propellant = massKg * (1 - Math.exp(-deltaVMs / (vacuumIspS * G0)));
  return propellant / massFlowKgS;
}

function horizontalPrograde(ctx: GuidanceContext): Vec3 {
  const horizontal = vec3();
  const vH = sub(horizontal, ctx.vRel, scale(vec3(), ctx.up, dot(ctx.vRel, ctx.up)));
  if (norm(vH) < 1e-6) {
    return normalize(vec3(), ctx.east);
  }
  return normalize(vH, vH);
}

/** Pitch `up` toward the horizontal by theta degrees. */
function pitchFromVertical(up: Vec3, horizontal: Vec3, thetaDeg: number): Vec3 {
  const theta = thetaDeg * DEG;
  const out = vec3();
  for (let i = 0; i < 3; i++) {
    out[i] = Math.cos(theta) * up[i] + Math.sin(theta) * horizontal[i];
  }
  return normalize(out, out);
}

/** Rotate prograde up (positive) or down by beta degrees, in the orbit plane. */
function biasFromPrograde(ctx: GuidanceContext, prograde: Vec3, betaDeg: number): Vec3 {
  const beta = betaDeg * DEG;
  // Radial-out direction perpendicular to prograde.
  const radial = vec3();
  const along = scale(vec3(), prograde, dot(ctx.up, prograde));
  sub(radial, ctx.up, along);
  if (norm(radial) < 1e-9) {
    return normalize(vec3(), prograde);
  }
  normalize(radial, radial);
  const out = vec3();
  for (let i = 0; i < 3; i++) {
    out[i] = Math.cos(beta) * prograde[i] + Math.sin(beta) * radial[i];
  }
  return normalize(out, out);
}

/** Throttle capped so predicted proper acceleration stays at the limit. */
export function cappedThrottle(ctx: GuidanceContext, coeffs: GuidanceCoefficients): number {
  const fullAccel = ctx.fullThrustN / ctx.massKg / G0;
  if (fullAccel <= coeffs.maxProperAccelG) {
    return 1;
  }
  return Math.max(ctx.minThrottle, coeffs.maxProperAccelG / fullAccel);
}

export function guidanceCommand(
  ctx: GuidanceContext,
  coeffs: GuidanceCoefficients,
): GuidanceCommand {
  if (!ctx.burning) {
    // Coasting or on the pad: hold a safe direction (up), no thrust.
    return { direction: normalize(vec3(), ctx.up), throttle: 0, cutoff: false };
  }

  const progradeAir = norm(ctx.vRel) > 1e-6 ? normalize(vec3(), ctx.vRel) : normalize(vec3(), ctx.up);
  const useOrbitalFeedback = ctx.dynamicPressurePa < coeffs.orbitalFeedbackQPa;

  let direction: Vec3;
  const cutoff = false;

  if (!useOrbitalFeedback) {
    // Atmospheric ascent: airspeed-triggered pitch kick, then a gravity turn
    // following the airflow. The AoA limit bounds how far the command may
    // sit from the airflow while dynamic pressure is meaningful.
    if (ctx.airspeedMs < coeffs.kickStartAirspeedMs) {
      direction = normalize(vec3(), ctx.up);
    } else {
      const progradePitch = angleBetween(ctx.up, progradeAir) / DEG;
      // Airspeed-scheduled cap on pitch-from-vertical.
      const pitchCap = (ctx.airspeedMs - coeffs.kickStartAirspeedMs) * coeffs.pitchCapGainDegPerMs;
      if (progradePitch >= coeffs.pitchKickDeg) {
        // Turn established: follow the airflow, capped so the turn stays
        // gradual while the air is thick.
        if (progradePitch <= pitchCap) {
          direction = progradeAir;
        } else {
          direction = pitchFromVertical(ctx.up, horizontalPrograde(ctx), Math.max(0, pitchCap));
        }
      } else {
        // Kick: hold the kick angle, AoA-limited while q is significant.
        const aoaCap =
          ctx.dynamicPressurePa > coeffs.aeroQLimitPa
            ? progradePitch + coeffs.aoaLimitDeg
            : coeffs.pitchKickDeg;
        const theta = Math.max(0, Math.min(coeffs.pitchKickDeg, aoaCap));
        direction = pitchFromVertical(ctx.up, horizontalPrograde(ctx), theta);
      }
    }
  } else {
    // Vacuum: burn inertial prograde to build horizontal orbital speed; the
    // apogee rises as energy grows. Pitching up toward a low apogee would
    // only make the trajectory more radial. Cutoff timing is handled by the
    // solver's event horizon (perigee insertion / apogee cap).
    direction = norm(ctx.velocity) > 1e-6 ? normalize(vec3(), ctx.velocity) : progradeAir;
  }

  return { direction, throttle: cappedThrottle(ctx, coeffs), cutoff };
}

/**
 * Circularization burn: prograde with radial-velocity feedback, cutting off
 * when the perigee reaches the target corridor.
 */
export function circularizationCommand(
  ctx: GuidanceContext,
  coeffs: GuidanceCoefficients,
): GuidanceCommand {
  // Burn inertial prograde with radial-velocity feedback: pitch up while
  // still falling short, down while rising past the target, so the burn
  // stays centered on apogee and raises perigee efficiently.
  const prograde = norm(ctx.velocity) > 1e-6 ? normalize(vec3(), ctx.velocity) : normalize(vec3(), ctx.up);
  const r = norm(ctx.position);
  const radialVelocity = dot(ctx.velocity, ctx.position) / r;
  const betaRaw = -radialVelocity * coeffs.radialVelocityGainDegPerMs;
  const beta = Math.max(-coeffs.radialBiasMaxDeg, Math.min(coeffs.radialBiasMaxDeg, betaRaw));
  const direction = biasFromPrograde(ctx, prograde, beta);
  const perigee = ctx.elements.perigeeAltitudeKm;
  const apogee = ctx.elements.apogeeAltitudeKm;
  // Cut at the target perigee; also stop once a sustained orbit is secure and
  // the apogee is already well past target, rather than wasting propellant
  // chasing a perfect circle.
  const cutoff =
    perigee >= coeffs.targetPerigeeKm ||
    (perigee >= 150 && apogee !== null && apogee >= coeffs.targetApogeeKm + 60);
  return { direction, throttle: cappedThrottle(ctx, coeffs), cutoff };
}

export { rotateToward };
