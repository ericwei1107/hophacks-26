/**
 * High-frequency playback position lives outside React state: the flight
 * scene reads and advances it every frame, and scrubbing writes to it
 * directly. React re-renders never drive the clock.
 */
export const playbackClock = {
  /** Current playback position, seconds into the recorded telemetry. */
  timeS: 0,
  /** Total recorded duration, seconds (set when a flight loads). */
  durationS: 0,
};

export function resetPlaybackClock(durationS: number): void {
  playbackClock.timeS = 0;
  playbackClock.durationS = durationS;
}
