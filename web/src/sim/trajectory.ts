/**
 * Sampling of a recorded flight for playback. The integrator is never run
 * backwards — scrubbing re-reads the recording.
 *
 * Position uses cubic Hermite interpolation against the logged velocity, so
 * the path between two 50 ms samples curves the way the vehicle actually flew
 * instead of cutting the corner, and the sampled velocity stays consistent
 * with it. Attitude is a unit direction and is interpolated spherically, so a
 * pitching vehicle sweeps at constant angular rate instead of shrinking
 * through the chord.
 */

import type { Telemetry } from "./ascent/flight";

export interface FlightSample {
  tS: number;
  /** Earth-centered position, m. */
  positionEciM: [number, number, number];
  /** Earth-centered velocity, m/s. */
  velocityEciMs: [number, number, number];
  /** Body nose direction in the Earth-centered frame, unit vector. */
  attitudeEci: [number, number, number];
  altitudeKm: number;
  speedMs: number;
  airspeedMs: number;
  dynamicPressurePa: number;
  properAccelG: number;
  propellantKg: number;
  massKg: number;
  throttle: number;
  aoaDeg: number;
  apogeeKm: number;
  perigeeKm: number;
  phase: number;
  /** Center of mass of the attached stack, m from the nose. */
  centerOfMassFromNoseM: number;
  /** Height of the attached stack, m. */
  attachedLengthM: number;
  /** Spent stage-1 position, m, or null before separation. */
  spentPositionEciM: [number, number, number] | null;
}

interface Bracket {
  lo: number;
  hi: number;
  /** Fraction between lo and hi, 0..1. */
  f: number;
  /** Seconds between lo and hi (0 when clamped to an endpoint). */
  dt: number;
}

function bracket(times: Float64Array, n: number, timeS: number): Bracket {
  if (timeS <= times[0]) {
    return { lo: 0, hi: 0, f: 0, dt: 0 };
  }
  if (timeS >= times[n - 1]) {
    return { lo: n - 1, hi: n - 1, f: 0, dt: 0 };
  }
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= timeS) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const dt = times[hi] - times[lo];
  return { lo, hi, f: dt > 0 ? (timeS - times[lo]) / dt : 0, dt };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Cubic Hermite on one axis, with velocity tangents. */
function hermite(p0: number, v0: number, p1: number, v1: number, s: number, dt: number): number {
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  return h00 * p0 + h10 * dt * v0 + h01 * p1 + h11 * dt * v1;
}

/** Spherical interpolation of two unit directions. */
function slerpDirection(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  dot = Math.max(-1, Math.min(1, dot));
  if (dot > 1 - 1e-9) {
    return [a[0], a[1], a[2]];
  }
  const angle = Math.acos(dot);
  const sin = Math.sin(angle);
  if (sin < 1e-9) {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  }
  const wa = Math.sin((1 - t) * angle) / sin;
  const wb = Math.sin(t * angle) / sin;
  const out: [number, number, number] = [
    wa * a[0] + wb * b[0],
    wa * a[1] + wb * b[1],
    wa * a[2] + wb * b[2],
  ];
  const n = Math.hypot(out[0], out[1], out[2]);
  return n > 1e-12 ? [out[0] / n, out[1] / n, out[2] / n] : out;
}

export function sampleTelemetry(telemetry: Telemetry, timeS: number): FlightSample {
  const n = telemetry.sampleCount;
  if (n === 0) {
    throw new Error("empty telemetry");
  }
  const { lo, hi, f, dt } = bracket(telemetry.tS, n, timeS);
  const at = (arr: Float64Array) => lerp(arr[lo], arr[hi], f);
  const pos = (p: Float64Array, v: Float64Array): number =>
    dt > 0 ? hermite(p[lo], v[lo], p[hi], v[hi], f, dt) : p[lo];

  const spentAvailable = Number.isFinite(telemetry.spentX[lo]) && Number.isFinite(telemetry.spentX[hi]);

  return {
    tS: timeS,
    positionEciM: [
      pos(telemetry.posX, telemetry.velX),
      pos(telemetry.posY, telemetry.velY),
      pos(telemetry.posZ, telemetry.velZ),
    ],
    velocityEciMs: [at(telemetry.velX), at(telemetry.velY), at(telemetry.velZ)],
    attitudeEci: slerpDirection(
      [telemetry.attX[lo], telemetry.attY[lo], telemetry.attZ[lo]],
      [telemetry.attX[hi], telemetry.attY[hi], telemetry.attZ[hi]],
      f,
    ),
    altitudeKm: at(telemetry.altitudeKm),
    speedMs: at(telemetry.speedMs),
    airspeedMs: at(telemetry.airspeedMs),
    dynamicPressurePa: at(telemetry.dynamicPressurePa),
    properAccelG: at(telemetry.properAccelG),
    propellantKg: at(telemetry.propellantKg),
    massKg: at(telemetry.massKg),
    throttle: at(telemetry.throttle),
    aoaDeg: at(telemetry.aoaDeg),
    apogeeKm: at(telemetry.apogeeKm),
    perigeeKm: at(telemetry.perigeeKm),
    phase: f < 0.5 ? telemetry.phase[lo] : telemetry.phase[hi],
    centerOfMassFromNoseM: at(telemetry.comFromNoseM),
    attachedLengthM: at(telemetry.attachedLengthM),
    spentPositionEciM: spentAvailable
      ? [at(telemetry.spentX), at(telemetry.spentY), at(telemetry.spentZ)]
      : Number.isFinite(telemetry.spentX[lo])
        ? [telemetry.spentX[lo], telemetry.spentY[lo], telemetry.spentZ[lo]]
        : null,
  };
}

/** A recorded flight with the one operation playback needs. */
export interface Trajectory {
  readonly durationS: number;
  sampleAt(timeS: number): FlightSample;
}

export function createTrajectory(telemetry: Telemetry): Trajectory {
  const durationS = telemetry.sampleCount > 0 ? telemetry.tS[telemetry.sampleCount - 1] : 0;
  return {
    durationS,
    sampleAt: (timeS: number) => sampleTelemetry(telemetry, timeS),
  };
}
