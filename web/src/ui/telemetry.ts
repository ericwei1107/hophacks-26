/**
 * Playback sampling lives in the sim (see sim/trajectory.ts) so both launch
 * renderers read the same recording. This module keeps the UI-facing names.
 */

export { createTrajectory, sampleTelemetry } from "../sim/trajectory";
export type { FlightSample, Trajectory } from "../sim/trajectory";

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
