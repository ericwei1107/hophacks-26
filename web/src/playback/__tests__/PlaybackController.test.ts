/**
 * The controller is the only thing that owns time, so the behaviour that
 * matters is what it tells a renderer: exactly one discontinuity per seek,
 * every event reported exactly once, and nothing at all when a frame would
 * carry a NaN.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { referenceConfig } from "../../domain/config";
import type { RenderFrame, RocketGeometry } from "../../protocol";
import type { LaunchRenderer, RendererCameraMode } from "../../renderers/LaunchRenderer";
import { defaultEnvironment, runFlight } from "../../sim/ascent/flight";
import { referenceSnapshot } from "../../sim/orbital/weather";
import { serializeFlightResult } from "../../workers/serialize";
import { IGNITION_HOLD_S, PlaybackController } from "../PlaybackController";

class RecordingRenderer implements LaunchRenderer {
  frames: RenderFrame[] = [];
  geometry: RocketGeometry | null = null;
  mode: RendererCameraMode | null = null;

  async mount(): Promise<void> {}
  setRocket(geometry: RocketGeometry): void {
    this.geometry = geometry;
  }
  setFrame(frame: RenderFrame): void {
    this.frames.push(frame);
  }
  setCameraMode(mode: RendererCameraMode): void {
    this.mode = mode;
  }
  orbitCamera(): void {}
  zoomCamera(): void {}
  resize(): void {}
  dispose(): void {}
}

const flight = serializeFlightResult(
  runFlight({
    config: referenceConfig(),
    environment: defaultEnvironment(referenceSnapshot()),
    seed: 0,
  }),
);

function attached(): { controller: PlaybackController; renderer: RecordingRenderer } {
  const controller = new PlaybackController(flight);
  const renderer = new RecordingRenderer();
  controller.setRenderer(renderer);
  renderer.frames.length = 0; // drop the frame the attach itself produced
  return { controller, renderer };
}

describe("PlaybackController", () => {
  it("starts held on the pad before T+0", () => {
    const controller = new PlaybackController(flight);
    expect(controller.timeS).toBeCloseTo(-IGNITION_HOLD_S, 9);
  });

  it("hands the renderer the rocket geometry on attach", () => {
    const controller = new PlaybackController(flight);
    const renderer = new RecordingRenderer();
    controller.setRenderer(renderer);
    expect(renderer.geometry?.stage1.engineCount).toBe(referenceConfig().stage1EngineCount);
    // The renderer has no history, so the first frame is a discontinuity.
    expect(renderer.frames[0].discontinuity).toBe(true);
  });

  it("spools the engines up during the hold, before the recording starts", () => {
    const { controller, renderer } = attached();
    expect(renderer.frames).toHaveLength(0);
    controller.advance(0); // still at the very start of the hold: no flame yet
    expect(renderer.frames.at(-1)!.throttle).toBe(0);
    controller.advance(IGNITION_HOLD_S / 2);
    const spooling = renderer.frames.at(-1)!;
    expect(spooling.t).toBeLessThan(0);
    expect(spooling.throttle).toBeGreaterThan(0);
    expect(spooling.throttle).toBeLessThan(1);
  });

  it("advances at the playback speed and stops at the end", () => {
    const { controller } = attached();
    const speed = 20;
    controller.setSpeed(speed);
    // Enough real-time seconds at this speed to comfortably clear the
    // flight's full duration (now including the trans-lunar phases), plus
    // margin — the assertion is that it stops exactly at the end, not that
    // any particular number of ticks gets there.
    const ticks = Math.ceil(flight.totalTimeS / speed) + 10;
    for (let i = 0; i < ticks; i++) {
      controller.advance(1);
    }
    expect(controller.timeS).toBeCloseTo(flight.totalTimeS, 6);
  });

  it("notifies completion once when active playback crosses the end", () => {
    const { controller } = attached();
    const completed = vi.fn();
    controller.subscribeComplete(completed);
    controller.seek(flight.totalTimeS - 0.1);
    controller.advance(0.2);
    controller.advance(1);
    expect(completed).toHaveBeenCalledTimes(1);
    expect(controller.playing).toBe(false);
  });

  it("does not treat scrubbing to the end as playback completion", () => {
    const { controller } = attached();
    const completed = vi.fn();
    controller.subscribeComplete(completed);
    controller.seek(flight.totalTimeS);
    expect(completed).not.toHaveBeenCalled();
  });

  it("does not move while paused", () => {
    const { controller } = attached();
    controller.seek(60);
    controller.setPlaying(false);
    controller.advance(5);
    expect(controller.timeS).toBeCloseTo(60, 9);
  });

  it("flags exactly one discontinuity per seek", () => {
    const { controller, renderer } = attached();
    controller.seek(120);
    controller.advance(0.016);
    controller.advance(0.016);
    const flags = renderer.frames.map((f) => f.discontinuity);
    expect(flags).toEqual([true, false, false]);
  });

  it("reports each event once, as it is crossed", () => {
    const { controller, renderer } = attached();
    controller.setSpeed(1);
    // Step past max-Q in small increments.
    const maxQ = flight.events.find((e) => e.id === "max_q")!;
    controller.seek(maxQ.t - 1);
    for (let i = 0; i < 40; i++) {
      controller.advance(0.05);
    }
    const seen = renderer.frames.flatMap((f) => f.events);
    expect(seen.filter((id) => id === "max_q")).toHaveLength(1);
  });

  it("reports no events for a seek, so scrubbing does not replay the flight", () => {
    const { controller, renderer } = attached();
    controller.seek(flight.totalTimeS);
    expect(renderer.frames.at(-1)!.events).toEqual([]);
  });

  it("clamps a seek to the recorded range", () => {
    const { controller } = attached();
    controller.seek(99_999);
    expect(controller.timeS).toBeCloseTo(flight.totalTimeS, 9);
    controller.seek(-99_999);
    expect(controller.timeS).toBeCloseTo(-IGNITION_HOLD_S, 9);
  });

  it("restarts back into the pre-launch hold", () => {
    const { controller, renderer } = attached();
    controller.seek(200);
    controller.restart();
    expect(controller.timeS).toBeCloseTo(-IGNITION_HOLD_S, 9);
    expect(renderer.frames.at(-1)!.discontinuity).toBe(true);
  });

  it("stops sending to a detached renderer", () => {
    const { controller, renderer } = attached();
    controller.setRenderer(null);
    const before = renderer.frames.length;
    controller.advance(0.1);
    expect(renderer.frames.length).toBe(before);
  });

  it("notifies subscribers with the same instant the renderer got", () => {
    const { controller, renderer } = attached();
    const seen: number[] = [];
    controller.subscribe((sample, frame) => {
      seen.push(frame.t);
      expect(sample.tS).toBeCloseTo(Math.max(0, frame.t), 9);
    });
    controller.seek(75);
    expect(seen).toEqual([renderer.frames.at(-1)!.t]);
  });

  describe("non-finite frames", () => {
    beforeEach(() => {
      vi.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("holds the previous frame and logs once", () => {
      const { controller, renderer } = attached();
      controller.seek(50);
      const held = renderer.frames.length;
      // Poison the recording the way a bad integration step would.
      const poisoned = { ...flight, telemetry: { ...flight.telemetry } };
      poisoned.telemetry.posX = flight.telemetry.posX.slice();
      poisoned.telemetry.posX.fill(Number.NaN);
      const broken = new PlaybackController(poisoned);
      const brokenRenderer = new RecordingRenderer();
      broken.setRenderer(brokenRenderer);
      broken.advance(0.1);
      broken.advance(0.1);
      expect(brokenRenderer.frames).toHaveLength(0);
      expect(console.error).toHaveBeenCalledTimes(1);
      expect(renderer.frames.length).toBe(held);
    });
  });
});
