/**
 * Owns playback time for a recorded flight and feeds the active renderer.
 *
 * JavaScript owns the clock — that is the whole point of the hybrid setup.
 * Play, pause, scrub, speed and replay all happen here; a renderer only ever
 * receives the resulting frames. The HUD and the telemetry chart subscribe
 * here too, so every surface on screen is showing the same instant.
 *
 * Time can be negative: the flight screen holds on the pad for a moment
 * before T+0 so the engines visibly spool up. The recording has nothing to say
 * about that, so the controller supplies the throttle for it.
 */

import type { LaunchRenderer } from "../renderers/LaunchRenderer";
import {
  nonFiniteFields,
  toRenderFrame,
  toRocketGeometry,
  type RenderFrame,
  type RocketGeometry,
} from "../protocol";
import { deriveRocket } from "../domain/derive";
import { createEngineCatalog } from "../domain/engines";
import type { FlightEvent } from "../sim/ascent/flight";
import { createTrajectory, type FlightSample, type Trajectory } from "../sim/trajectory";
import type { SerializableFlightResult } from "../workers/protocol";

/**
 * Visual-only hold on the pad, so the engines spool up before the recording
 * leaves T+0. The sim knows nothing about it: playback simply starts here.
 */
export const IGNITION_HOLD_S = 3.5;

export type PlaybackListener = (sample: FlightSample, frame: RenderFrame) => void;

/** Visual spool-up during the pre-launch hold: 0 at the start, 1 by T−0.35 s. */
function ignitionThrottle(t: number): number {
  const s = (t - -IGNITION_HOLD_S) / (-0.35 - -IGNITION_HOLD_S);
  const c = Math.max(0, Math.min(1, s));
  return c * c * (3 - 2 * c);
}

export class PlaybackController {
  readonly geometry: RocketGeometry;
  readonly trajectory: Trajectory;
  readonly durationS: number;
  private readonly seed: number;

  private renderer: LaunchRenderer | null = null;
  private readonly events: FlightEvent[];
  private readonly listeners = new Set<PlaybackListener>();

  private time = -IGNITION_HOLD_S;
  private speed = 1;
  private isPlaying = true;
  /** Set by a seek or a restart; consumed by the next frame. */
  private pendingDiscontinuity = true;
  /** Playback position the last emitted frame was built at. */
  private lastEmittedTime = Number.NaN;
  private raf = 0;
  private lastFrameTime = 0;
  private nanReported = false;

  constructor(flight: SerializableFlightResult) {
    this.geometry = toRocketGeometry(deriveRocket(flight.config, createEngineCatalog()));
    this.trajectory = createTrajectory(flight.telemetry);
    this.durationS = flight.totalTimeS;
    this.seed = flight.seed;
    this.events = [...flight.events].sort((a, b) => a.t - b.t);
  }

  get timeS(): number {
    return this.time;
  }

  get playing(): boolean {
    return this.isPlaying;
  }

  get playbackSpeed(): number {
    return this.speed;
  }

  setRenderer(renderer: LaunchRenderer | null): void {
    this.renderer = renderer;
    if (renderer) {
      renderer.setRocket(this.geometry);
      // A renderer that joins mid-flight has no history: treat it as a seek.
      this.pendingDiscontinuity = true;
      this.lastEmittedTime = Number.NaN;
      this.emit();
    }
  }

  setPlaying(playing: boolean): void {
    this.isPlaying = playing;
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  /** Jump to a time. Produces exactly one frame flagged as a discontinuity. */
  seek(timeS: number): void {
    this.time = Math.max(-IGNITION_HOLD_S, Math.min(this.durationS, timeS));
    this.pendingDiscontinuity = true;
    this.emit();
  }

  /** Back to the pre-launch hold, as if the flight had just loaded. */
  restart(): void {
    this.seek(-IGNITION_HOLD_S);
  }

  subscribe(listener: PlaybackListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Start the animation loop. Safe to call twice. */
  start(): void {
    if (this.raf !== 0) {
      return;
    }
    this.lastFrameTime = performance.now();
    const tick = (now: number) => {
      const dt = (now - this.lastFrameTime) / 1000;
      this.lastFrameTime = now;
      this.advance(dt);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.raf !== 0) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  dispose(): void {
    this.stop();
    this.listeners.clear();
    this.renderer = null;
  }

  /** Advance by a wall-clock delta. Exposed for tests; the loop calls it. */
  advance(deltaS: number): void {
    if (this.isPlaying && Number.isFinite(deltaS)) {
      const next = this.time + deltaS * this.speed;
      this.time = Math.min(this.durationS, next);
    }
    this.emit();
  }

  /**
   * Event ids whose time was crossed between two playback positions. A seek
   * reports none: replaying a burst of already-past events as the scrubber
   * flies across the timeline is worse than showing nothing.
   */
  private crossedEvents(fromS: number, toS: number): string[] {
    if (!Number.isFinite(fromS) || toS <= fromS) {
      return [];
    }
    const crossed: string[] = [];
    for (const event of this.events) {
      if (event.t > fromS && event.t <= toS) {
        crossed.push(event.id);
      } else if (event.t > toS) {
        break;
      }
    }
    return crossed;
  }

  private emit(): void {
    const t = this.time;
    const discontinuity = this.pendingDiscontinuity;
    const events = discontinuity ? [] : this.crossedEvents(this.lastEmittedTime, t);
    this.pendingDiscontinuity = false;
    this.lastEmittedTime = t;

    const sample = this.trajectory.sampleAt(Math.max(0, t));
    const frame = toRenderFrame(sample, this.geometry, {
      t,
      discontinuity,
      playbackSpeed: this.speed,
      playing: this.isPlaying,
      events,
      seed: this.seed,
      throttleOverride: t < 0 ? ignitionThrottle(t) : null,
    });

    const bad = nonFiniteFields(frame);
    if (bad.length > 0) {
      // A single NaN reaching a renderer poisons its transforms for the rest
      // of the flight. Hold the previous frame instead and say so once.
      if (!this.nanReported) {
        this.nanReported = true;
        console.error(
          `PlaybackController: non-finite RenderFrame at t=${t.toFixed(3)}s (${bad.join(", ")}); holding the previous frame.`,
        );
      }
      return;
    }

    this.renderer?.setFrame(frame);
    for (const listener of this.listeners) {
      listener(sample, frame);
    }
  }
}
