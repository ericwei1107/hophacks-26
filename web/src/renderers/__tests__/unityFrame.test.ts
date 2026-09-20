/**
 * Unity parses frames with JsonUtility, which cannot handle a null object, a
 * top-level array or a nullable field. The flattening has to hold that line.
 */

import { describe, expect, it } from "vitest";

import { referenceConfig } from "../../domain/config";
import { deriveRocket } from "../../domain/derive";
import { createEngineCatalog } from "../../domain/engines";
import { toRenderFrame, toRocketGeometry } from "../../protocol";
import { defaultEnvironment, runFlight } from "../../sim/ascent/flight";
import { referenceSnapshot } from "../../sim/orbital/weather";
import { createTrajectory } from "../../sim/trajectory";
import { toUnityFrame } from "../UnityLaunchRenderer";

const config = referenceConfig();
const geometry = toRocketGeometry(deriveRocket(config, createEngineCatalog()));
const flight = runFlight({
  config,
  environment: defaultEnvironment(referenceSnapshot()),
  seed: 0,
});
const trajectory = createTrajectory(flight.telemetry);

function unityFrameAt(t: number) {
  return toUnityFrame(
    toRenderFrame(trajectory.sampleAt(t), geometry, {
      t,
      discontinuity: false,
      playbackSpeed: 1,
      playing: true,
      events: [],
      seed: flight.seed,
    }),
  );
}

describe("toUnityFrame", () => {
  it("names vector components so JsonUtility can bind them", () => {
    const frame = unityFrameAt(60);
    expect(Object.keys(frame.attitude).sort()).toEqual(["w", "x", "y", "z"]);
    expect(Object.keys(frame.velLocal).sort()).toEqual(["x", "y", "z"]);
  });

  it("replaces the nullable spent booster with a presence flag", () => {
    const early = unityFrameAt(10);
    expect(early.stage1SpentPresent).toBe(false);
    expect(early.stage1SpentPos).toEqual({ x: 0, y: 0, z: 0 });
    expect(early.stage1SpentAttitude).toEqual({ x: 0, y: 0, z: 0, w: 1 });

    const separation = flight.events.find((e) => e.id === "separation")!;
    const late = unityFrameAt(separation.t + 30);
    expect(late.stage1SpentPresent).toBe(true);
    expect(late.stage1SpentPos.y).toBeLessThan(0);
  });

  it("serializes to JSON with no null anywhere", () => {
    const json = JSON.stringify(unityFrameAt(120));
    expect(json).not.toContain("null");
    expect(JSON.parse(json).events).toEqual([]);
  });

  it("keeps every number finite across the whole flight", () => {
    for (let t = 0; t <= trajectory.durationS; t += 1.7) {
      const parsed = JSON.parse(JSON.stringify(unityFrameAt(t))) as Record<string, unknown>;
      const walk = (value: unknown, path: string): void => {
        if (typeof value === "number") {
          expect(Number.isFinite(value), `${path} = ${value}`).toBe(true);
        } else if (value && typeof value === "object") {
          for (const [key, child] of Object.entries(value)) {
            walk(child, `${path}.${key}`);
          }
        }
      };
      walk(parsed, `frame@${t}`);
    }
  });
});
