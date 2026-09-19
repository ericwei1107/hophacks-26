/**
 * Patched-conic trans-lunar transfer evaluation (LUNAR_MISSION_PLAN.md §4.3).
 *
 * Pure functions, no solver state. Two independent questions are answered
 * here: how much delta-v a Hohmann-style transfer from a given circular
 * parking orbit to the lunar distance requires (§2.2 derives the formula),
 * and — given a burn that actually happened — what apogee, time of flight,
 * and lunar-encounter geometry result.
 *
 * The Moon is treated as circular and coplanar (see moon.ts); this module
 * does not model lunar eccentricity, inclination, or solar perturbation.
 */

import { MU_EARTH } from "../physics/constants";
import { norm, sub, type Vec3, vec3 } from "../physics/vec3";
import { MOON_ORBIT_RADIUS_M, MOON_RADIUS_M, MOON_SOI_RADIUS_M, MU_MOON } from "./moon";

export type LunarArrival =
  | "lunar_arrival"
  | "lunar_impact"
  | "lunar_miss"
  | "tli_shortfall"
  | "earth_escape";

export interface TransferRequirement {
  /** Delta-v to raise a circular parking orbit's apogee to the lunar distance, m/s. */
  deltaVRequiredMs: number;
  /** Time of flight for that minimum-energy (Hohmann) transfer, seconds. */
  timeOfFlightS: number;
}

/**
 * Delta-v and transfer time for a minimum-energy (Hohmann-style) transfer
 * from a circular orbit of radius `parkingRadiusM` to an apogee at the
 * lunar distance. This is the number LUNAR_MISSION_PLAN.md §2.2 derives by
 * hand (≈3,132 m/s from 200 km) — kept here as a function of parking radius
 * so a build's actual achieved orbit is used, not the nominal 200 km.
 */
export function transferRequirement(
  parkingRadiusM: number,
  targetApogeeM: number = MOON_ORBIT_RADIUS_M,
): TransferRequirement {
  const vCircular = Math.sqrt(MU_EARTH / parkingRadiusM);
  const transferSemiMajorM = (parkingRadiusM + targetApogeeM) / 2;
  const vPerigeeTransfer = Math.sqrt(MU_EARTH * (2 / parkingRadiusM - 1 / transferSemiMajorM));
  const deltaVRequiredMs = vPerigeeTransfer - vCircular;
  const timeOfFlightS = Math.PI * Math.sqrt(transferSemiMajorM ** 3 / MU_EARTH);
  return { deltaVRequiredMs, timeOfFlightS };
}

export interface TransferResult {
  deltaVAvailableMs: number;
  deltaVRequiredMs: number;
  /** Apogee actually reached by the achieved (possibly off-nominal) burn, km altitude above Earth's center distance in meters. */
  achievedApogeeM: number;
  timeOfFlightS: number | null;
  /** Closest approach to the Moon's center, meters — null if the trajectory never enters the SOI. */
  periseleneRadiusM: number | null;
  classification: LunarArrival;
}

/**
 * Aim corridor for a clean arrival, periselene altitude in meters (game
 * rule, LUNAR_MISSION_PLAN.md §2.3). The upper bound is calibrated against
 * the reference build's own TLI burn, not chosen a priori: a burn that
 * spends exactly its required delta-v still overshoots the target apogee
 * by roughly 7% because the burn takes real time (tens of seconds) rather
 * than being truly impulsive — the vehicle's radius rises measurably while
 * still thrusting, which vis-viva's energy term is sensitive to. That
 * overshoot is real, simplified-physics behavior worth keeping, not a
 * solver bug to chase away, so the corridor absorbs it instead.
 */
export const PERISELENE_AIM_MIN_ALT_M = 100_000;
export const PERISELENE_AIM_MAX_ALT_M = 20_000_000;

/**
 * Evaluate the outcome of a completed (or attempted) TLI burn.
 *
 * `apogeeAfterBurnM` is the apogee radius (from Earth's center) the vehicle
 * actually reached given the delta-v it actually spent — the caller derives
 * this from vis-viva using the post-burn velocity, not from this function.
 * This function only classifies the result and, when the trajectory reaches
 * the Moon's neighborhood, estimates periselene from patched-conic energy
 * and angular-momentum matching at SOI entry.
 */
export function evaluateTransfer(input: {
  /** Vehicle's orbital radius at TLI ignition, m from Earth's center. */
  parkingRadiusM: number;
  deltaVAvailableMs: number;
  deltaVRequiredMs: number;
  apogeeAfterBurnM: number;
  /** Position and velocity of the vehicle at SOI entry relative to the Moon, if it reaches the SOI. */
  soiEntryRelativePosition: Vec3 | null;
  soiEntryRelativeVelocity: Vec3 | null;
}): TransferResult {
  const { deltaVAvailableMs, deltaVRequiredMs, apogeeAfterBurnM } = input;

  if (deltaVAvailableMs < deltaVRequiredMs * 0.98) {
    // A meaningful shortfall: apogee will not reach lunar distance at all.
    return {
      deltaVAvailableMs,
      deltaVRequiredMs,
      achievedApogeeM: apogeeAfterBurnM,
      timeOfFlightS: null,
      periseleneRadiusM: null,
      classification: "tli_shortfall",
    };
  }

  if (apogeeAfterBurnM > MOON_ORBIT_RADIUS_M + MOON_SOI_RADIUS_M * 3) {
    // Excess energy well past the lunar distance: unbound relative to a
    // sensible lunar encounter geometry.
    return {
      deltaVAvailableMs,
      deltaVRequiredMs,
      achievedApogeeM: apogeeAfterBurnM,
      timeOfFlightS: null,
      periseleneRadiusM: null,
      classification: "earth_escape",
    };
  }

  const transferSemiMajorM = (input.parkingRadiusM + apogeeAfterBurnM) / 2;
  const timeOfFlightS = Math.PI * Math.sqrt(transferSemiMajorM ** 3 / MU_EARTH);

  if (!input.soiEntryRelativePosition || !input.soiEntryRelativeVelocity) {
    return {
      deltaVAvailableMs,
      deltaVRequiredMs,
      achievedApogeeM: apogeeAfterBurnM,
      timeOfFlightS,
      periseleneRadiusM: null,
      classification: "lunar_miss",
    };
  }

  const periselene = estimatePeriselene(input.soiEntryRelativePosition, input.soiEntryRelativeVelocity);

  let classification: LunarArrival;
  if (periselene < MOON_RADIUS_M) {
    classification = "lunar_impact";
  } else if (
    periselene - MOON_RADIUS_M >= PERISELENE_AIM_MIN_ALT_M &&
    periselene - MOON_RADIUS_M <= PERISELENE_AIM_MAX_ALT_M
  ) {
    classification = "lunar_arrival";
  } else {
    classification = "lunar_miss";
  }

  return {
    deltaVAvailableMs,
    deltaVRequiredMs,
    achievedApogeeM: apogeeAfterBurnM,
    timeOfFlightS,
    periseleneRadiusM: periselene,
    classification,
  };
}

/**
 * Periselene (closest approach to the Moon's center) from position and
 * velocity relative to the Moon at SOI entry, via the Moon-centered
 * two-body orbital elements of the incoming hyperbola.
 */
export function estimatePeriselene(relativePosition: Vec3, relativeVelocity: Vec3): number {
  const r = norm(relativePosition);
  const v = norm(relativeVelocity);
  const energy = (v * v) / 2 - MU_MOON / r;

  const h = vec3();
  h[0] = relativePosition[1] * relativeVelocity[2] - relativePosition[2] * relativeVelocity[1];
  h[1] = relativePosition[2] * relativeVelocity[0] - relativePosition[0] * relativeVelocity[2];
  h[2] = relativePosition[0] * relativeVelocity[1] - relativePosition[1] * relativeVelocity[0];
  const hMag = norm(h);

  const p = (hMag * hMag) / MU_MOON;
  // e from energy and angular momentum: e^2 = 1 + 2*E*h^2/mu^2
  const eSq = 1 + (2 * energy * hMag * hMag) / MU_MOON ** 2;
  const e = Math.sqrt(Math.max(0, eSq));
  return p / (1 + e);
}

export function relativeToMoon(out: Vec3, absolutePosition: Vec3, moonPosition: Vec3): Vec3 {
  return sub(out, absolutePosition, moonPosition);
}
