/**
 * toRenderFrame: one recorded sample plus the playback state, converted into
 * the frame a renderer draws.
 *
 * Everything Earth-scale is collapsed here. The rocket sits at the origin, the
 * Earth's center is straight down at exactly (0, −r, 0), and the Earth's own
 * orientation arrives as a quaternion — so no coordinate larger than an orbit
 * radius, and no coordinate that needs more than 32-bit precision to be right
 * at the metre level, ever reaches a renderer.
 */

import { speedOfSoundMs } from "../sim/physics/atmosphere";
import { EARTH_RADIUS, OMEGA_EARTH } from "../sim/physics/constants";
import type { FlightSample } from "../sim/trajectory";
import {
  earthMeshQuat,
  inertialFrameQuat,
  localBasis,
  quatFromAxisAngle,
  quatFromUnitVectors,
  quatMultiply,
  subPointDeg,
  toLocal,
} from "./convert";
import type { PlaybackState, Quat, RenderFrame, RocketGeometry, Vec3 } from "./types";

/**
 * Sun direction in the sim's Earth-centered frame, held fixed for the length
 * of a flight — a few minutes of orbital motion moves the sun by well under a
 * degree.
 *
 * Deliberately low in the sky over the launch site (about 35 degrees of
 * elevation, a mid-morning sun). A sun near the zenith lights the pad but
 * leaves the vehicle's own cylindrical sides almost edge-on to it, so the
 * rocket reads as a dark silhouette on the way up.
 */
const SUN_DIRECTION_ECI: Vec3 = (() => {
  const v: Vec3 = [0.58, 0.62, 0.53];
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
})();

/** The spent booster tumbles at a fixed rate; purely cosmetic. */
const SPENT_TUMBLE_RATE_RAD_S = 0.55;
const SPENT_TUMBLE_AXIS: Vec3 = [0.36, 0.86, 0.36];

/** Body nose axis in the renderer's local frame. */
const BODY_UP: Vec3 = [0, 1, 0];

/** Velocity of the co-rotating atmosphere at a position: ω × r. */
function airVelocity(position: ArrayLike<number>): Vec3 {
  return [-OMEGA_EARTH * position[1], OMEGA_EARTH * position[0], 0];
}

export function toRenderFrame(
  sample: FlightSample,
  geometry: RocketGeometry,
  playback: PlaybackState,
): RenderFrame {
  const basis = localBasis(sample.positionEciM);
  const altitude = basis.radius - EARTH_RADIUS;
  const altitudeKm = altitude / 1000;

  // Air-relative velocity: what the vehicle sees, and what the plume, vapor
  // cone and chase camera should follow. Inertial velocity on the pad is the
  // Earth's own 465 m/s, which would aim the camera sideways at liftoff.
  const air = airVelocity(sample.positionEciM);
  const relative: Vec3 = [
    sample.velocityEciMs[0] - air[0],
    sample.velocityEciMs[1] - air[1],
    sample.velocityEciMs[2] - air[2],
  ];
  const velLocal = toLocal(basis, relative);
  const speedAir = Math.hypot(velLocal[0], velLocal[1], velLocal[2]);

  const { latDeg, lonDeg } = subPointDeg(sample.positionEciM, Math.max(0, sample.tS));

  const attitudeLocal = toLocal(basis, sample.attitudeEci);
  const attitudeNorm = Math.hypot(attitudeLocal[0], attitudeLocal[1], attitudeLocal[2]);
  const attitudeUnit: Vec3 =
    attitudeNorm > 1e-9
      ? [attitudeLocal[0] / attitudeNorm, attitudeLocal[1] / attitudeNorm, attitudeLocal[2] / attitudeNorm]
      : [0, 1, 0];
  const attitude: Quat = quatFromUnitVectors(BODY_UP, attitudeUnit);

  const stage: 1 | 2 = sample.phase <= 3 ? 1 : 2;
  // The local origin is the center of mass, but the sim tracks the base of
  // the stack, so everything referred to the ground is offset by that much.
  // Keeping the offset here is what lets a renderer stand the vehicle on the
  // ground disc at altitude 0 without knowing anything about mass.
  const attachedLength = sample.attachedLengthM > 0 ? sample.attachedLengthM : geometry.totalLength;
  const comFromBase = attachedLength - sample.centerOfMassFromNoseM;
  const throttle =
    playback.throttleOverride != null ? playback.throttleOverride : sample.throttle;

  const spent = sample.spentPositionEciM;
  let stage1Spent: RenderFrame["stage1Spent"] = null;
  if (spent) {
    const delta: Vec3 = [
      spent[0] - sample.positionEciM[0],
      spent[1] - sample.positionEciM[1],
      spent[2] - sample.positionEciM[2],
    ];
    const tumble = quatFromAxisAngle(SPENT_TUMBLE_AXIS, SPENT_TUMBLE_RATE_RAD_S * Math.max(0, sample.tS));
    const local = toLocal(basis, delta);
    stage1Spent = {
      posLocal: [local[0], local[1] - comFromBase, local[2]],
      attitude: quatMultiply(attitude, tumble),
    };
  }

  return {
    t: playback.t,
    discontinuity: playback.discontinuity,
    playbackSpeed: playback.playbackSpeed,
    playing: playback.playing,
    stage,
    throttle,
    altitude,
    latDeg,
    lonDeg,
    speedAir,
    mach: speedAir / speedOfSoundMs(altitudeKm),
    q: sample.dynamicPressurePa,
    g: sample.properAccelG,
    aoaDeg: Number.isFinite(sample.aoaDeg) ? sample.aoaDeg : 0,
    comFromBase,
    attachedLength,
    attitude,
    velLocal,
    earthCenterLocal: [0, -(basis.radius + comFromBase), 0],
    earthQuat: earthMeshQuat(latDeg, lonDeg),
    inertialQuat: inertialFrameQuat(basis),
    sunDirLocal: toLocal(basis, SUN_DIRECTION_ECI),
    stage1Spent,
    events: playback.events,
  };
}

export { SUN_DIRECTION_ECI };
