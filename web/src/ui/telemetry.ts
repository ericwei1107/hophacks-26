/**
 * Interpolated sampling of recorded flight telemetry for playback. The
 * integrator is never reversed; we scrub the recording.
 */

import type { Telemetry } from "../sim/ascent/flight";

export interface FlightSample {
  tS: number;
  /** ECI position, meters. */
  positionEciM: [number, number, number];
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
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function sampleTelemetry(telemetry: Telemetry, timeS: number): FlightSample {
  const n = telemetry.sampleCount;
  if (n === 0) {
    throw new Error("empty telemetry");
  }
  const times = telemetry.tS;
  // Binary search for the bracketing samples.
  let lo = 0;
  let hi = n - 1;
  if (timeS <= times[0]) {
    hi = 0;
  } else if (timeS >= times[n - 1]) {
    lo = hi = n - 1;
  } else {
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= timeS) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
  }
  const t0 = times[lo];
  const t1 = times[hi];
  const f = hi > lo && t1 > t0 ? (timeS - t0) / (t1 - t0) : 0;

  const at = (arr: Float64Array) => lerp(arr[lo], arr[hi], f);
  return {
    tS: timeS,
    positionEciM: [at(telemetry.posX), at(telemetry.posY), at(telemetry.posZ)],
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
  };
}

export const PHASE_NAMES = [
  "PAD",
  "ASCENT 1",
  "BURNOUT",
  "SEPARATION",
  "IGNITION",
  "ASCENT 2",
  "COAST",
  "CIRCULARIZE",
  "COMPLETE",
  "FAILED",
];
