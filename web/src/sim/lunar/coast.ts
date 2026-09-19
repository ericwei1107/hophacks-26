/**
 * Patched-conic Earth-to-Moon coast search (LUNAR_MISSION_PLAN.md §4.1, §4.3).
 *
 * Outside the Moon's sphere of influence the vehicle is propagated as an
 * Earth-only two-body conic (`propagateKepler`); lunar gravity during that
 * leg is not modelled, which is the approximation this project commits to
 * documenting rather than hiding. The search finds the first instant the
 * vehicle's distance from the Moon drops to the SOI radius, coarse-stepping
 * then bisecting to refine — cheap enough to run once per flight, unlike
 * stepping the full RK4 solver across a multi-day coast.
 */

import { propagateKepler } from "../physics/kepler";
import { norm, sub, type Vec3, vec3 } from "../physics/vec3";
import { moonPositionEci, moonVelocityEci, MOON_ANGULAR_RATE_RAD_S, MOON_SOI_RADIUS_M } from "./moon";

export interface SoiEncounter {
  tSinceIgnitionS: number;
  vehiclePositionEci: Vec3;
  vehicleVelocityEci: Vec3;
  moonPositionEci: Vec3;
  moonVelocityEci: Vec3;
  /** Vehicle state relative to the Moon at SOI entry. */
  relativePosition: Vec3;
  relativeVelocity: Vec3;
}

const COARSE_STEP_S = 1_800; // 30 minutes
const MAX_SEARCH_S = 10 * 86_400; // 10 days — well past any plausible transfer

function distanceToMoon(vehiclePos: Vec3, tSinceIgnitionS: number, ignitionAbsoluteTimeS: number, epochPhaseRad: number): number {
  const moonPos = moonPositionEci(vec3(), ignitionAbsoluteTimeS + tSinceIgnitionS, epochPhaseRad);
  return norm(sub(vec3(), vehiclePos, moonPos));
}

/**
 * Search forward from TLI burnout for the first crossing of the Moon's SOI.
 * Returns null if the vehicle never enters the SOI within `MAX_SEARCH_S`
 * (badly aimed or under-energized transfers, or an Earth-escape trajectory
 * that passes nowhere near the Moon).
 */
export function findSoiEncounter(
  vehiclePositionEci: Vec3,
  vehicleVelocityEci: Vec3,
  ignitionAbsoluteTimeS: number,
  moonEpochPhaseRad: number,
): SoiEncounter | null {
  let tPrev = 0;
  let distPrev = distanceToMoon(vehiclePositionEci, tPrev, ignitionAbsoluteTimeS, moonEpochPhaseRad);

  let t = COARSE_STEP_S;
  while (t <= MAX_SEARCH_S) {
    const { position } = propagateKepler(vehiclePositionEci, vehicleVelocityEci, t);
    const dist = distanceToMoon(position, t, ignitionAbsoluteTimeS, moonEpochPhaseRad);

    if (dist <= MOON_SOI_RADIUS_M) {
      return bisectSoiCrossing(vehiclePositionEci, vehicleVelocityEci, tPrev, t, ignitionAbsoluteTimeS, moonEpochPhaseRad);
    }

    // Diverging monotonically away from the Moon past its orbital radius
    // with no crossing yet: no encounter is coming.
    if (dist > distPrev && dist > MOON_SOI_RADIUS_M * 4 && t > COARSE_STEP_S * 4) {
      return null;
    }

    tPrev = t;
    distPrev = dist;
    t += COARSE_STEP_S;
  }

  return null;
}

function bisectSoiCrossing(
  vehiclePositionEci: Vec3,
  vehicleVelocityEci: Vec3,
  tLo: number,
  tHi: number,
  ignitionAbsoluteTimeS: number,
  moonEpochPhaseRad: number,
): SoiEncounter {
  let lo = tLo;
  let hi = tHi;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const { position } = propagateKepler(vehiclePositionEci, vehicleVelocityEci, mid);
    const dist = distanceToMoon(position, mid, ignitionAbsoluteTimeS, moonEpochPhaseRad);
    if (dist > MOON_SOI_RADIUS_M) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const tSoi = hi;
  const { position, velocity } = propagateKepler(vehiclePositionEci, vehicleVelocityEci, tSoi);
  const moonPos = moonPositionEci(vec3(), ignitionAbsoluteTimeS + tSoi, moonEpochPhaseRad);
  const moonVel = moonVelocityEci(vec3(), ignitionAbsoluteTimeS + tSoi, moonEpochPhaseRad);
  return {
    tSinceIgnitionS: tSoi,
    vehiclePositionEci: position,
    vehicleVelocityEci: velocity,
    moonPositionEci: moonPos,
    moonVelocityEci: moonVel,
    relativePosition: sub(vec3(), position, moonPos),
    relativeVelocity: sub(vec3(), velocity, moonVel),
  };
}

/**
 * Choose a Moon epoch phase so that, at the nominal (minimum-energy)
 * transfer's time of flight from `ignitionPositionEci`, the Moon sits along
 * the transfer orbit's apogee direction — diametrically opposite the
 * injection point, per Hohmann-transfer geometry. This is the "autopilot
 * chooses the TLI epoch that phases correctly" simplification
 * (LUNAR_MISSION_PLAN.md §2.3): a build with the intended delta-v and burn
 * geometry gets a genuine encounter; only real deviations in achieved
 * energy or direction produce a miss or impact.
 */
export function phasedMoonEpoch(
  ignitionPositionEci: Vec3,
  ignitionAbsoluteTimeS: number,
  nominalTimeOfFlightS: number,
): number {
  const apogeeDirectionAngle = Math.atan2(-ignitionPositionEci[1], -ignitionPositionEci[0]);
  const tArrival = ignitionAbsoluteTimeS + nominalTimeOfFlightS;
  let epoch = apogeeDirectionAngle - MOON_ANGULAR_RATE_RAD_S * tArrival;
  epoch = ((epoch % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return epoch;
}
