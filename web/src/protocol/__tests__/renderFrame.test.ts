/**
 * toRenderFrame against a real reference flight. The t = 0 case is the one
 * that catches sign errors: the rocket must stand upright on the launch site,
 * at zero altitude, with the Earth's center straight down.
 */

import { describe, expect, it } from "vitest";

import { referenceConfig } from "../../domain/config";
import { deriveRocket } from "../../domain/derive";
import { createEngineCatalog } from "../../domain/engines";
import { defaultEnvironment, runFlight } from "../../sim/ascent/flight";
import { EARTH_RADIUS } from "../../sim/physics/constants";
import { referenceSnapshot } from "../../sim/orbital/weather";
import { createTrajectory } from "../../sim/trajectory";
import { enuVecToRenderer, quatRotate } from "../convert";
import { toRocketGeometry } from "../geometry";
import { toRenderFrame } from "../renderFrame";
import { nonFiniteFields, type PlaybackState } from "../types";

const config = referenceConfig();
const rocket = deriveRocket(config, createEngineCatalog());
const geometry = toRocketGeometry(rocket);
const flight = runFlight({
  config,
  environment: defaultEnvironment(referenceSnapshot()),
  seed: 0,
});
const trajectory = createTrajectory(flight.telemetry);

function playback(t: number, patch: Partial<PlaybackState> = {}): PlaybackState {
  return {
    t,
    discontinuity: false,
    playbackSpeed: 1,
    playing: true,
    events: [],
    ...patch,
  };
}

function frameAt(t: number, patch: Partial<PlaybackState> = {}) {
  return toRenderFrame(trajectory.sampleAt(t), geometry, playback(t, patch));
}

describe("rocket geometry", () => {
  it("stacks the three sections into the full length", () => {
    expect(geometry.stage1.length + geometry.stage2.length + geometry.payload.length).toBeCloseTo(
      rocket.totalLengthM,
      9,
    );
    expect(geometry.stage2.base).toBeCloseTo(geometry.stage1.length, 9);
    expect(geometry.payload.base).toBeCloseTo(geometry.stage2.base + geometry.stage2.length, 9);
  });

  it("measures the center of pressure from the base", () => {
    expect(geometry.cpFromBase).toBeCloseTo(rocket.totalLengthM - rocket.centerOfPressureM, 9);
    expect(geometry.cpFromBase).toBeGreaterThan(0);
    expect(geometry.cpFromBase).toBeLessThan(geometry.totalLength);
  });

  it("carries the built engine count and diameter", () => {
    expect(geometry.stage1.engineCount).toBe(config.stage1EngineCount);
    expect(geometry.diameter).toBeCloseTo(config.diameterM, 9);
    expect(geometry.fins.span).toBeCloseTo(config.finSpanM, 9);
  });
});

describe("toRenderFrame at t = 0", () => {
  const frame = frameAt(0);

  it("sits on the pad at the launch site", () => {
    expect(frame.altitude).toBeCloseTo(0, 3);
    expect(frame.latDeg).toBeCloseTo(0, 9); // reference environment launches from 0, 0
    expect(frame.lonDeg).toBeCloseTo(0, 9);
  });

  it("stands upright: the nose axis points straight up", () => {
    const nose = quatRotate(frame.attitude, [0, 1, 0]);
    expect(nose[0]).toBeCloseTo(0, 6);
    expect(nose[1]).toBeCloseTo(1, 6);
    expect(nose[2]).toBeCloseTo(0, 6);
  });

  it("is at rest relative to the air", () => {
    expect(frame.speedAir).toBeLessThan(1e-6);
    expect(frame.mach).toBeLessThan(1e-6);
  });

  it("puts the Earth's center straight down, one Earth radius below the base", () => {
    // The origin is the center of mass, so the ground sits comFromBase lower
    // than the origin — which is what stands the vehicle on the pad.
    expect(frame.earthCenterLocal[0]).toBe(0);
    expect(frame.earthCenterLocal[2]).toBe(0);
    expect(frame.earthCenterLocal[1]).toBeCloseTo(-(EARTH_RADIUS + frame.comFromBase), 1);
    expect(frame.comFromBase).toBeGreaterThan(1);
  });

  it("points the Earth mesh so the launch site is under the rocket", () => {
    // Mesh +X is longitude 0 on the equator, which is the launch site here.
    const site = quatRotate(frame.earthQuat, [1, 0, 0]);
    expect(site[0]).toBeCloseTo(0, 8);
    expect(site[1]).toBeCloseTo(1, 8);
    expect(site[2]).toBeCloseTo(0, 8);
  });

  it("has a plausible, unit-length sun direction above the horizon", () => {
    const [x, y, z] = frame.sunDirLocal;
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 9);
    expect(y).toBeGreaterThan(0); // the pad is in daylight
  });

  it("reports stage 1 with no spent booster yet", () => {
    expect(frame.stage).toBe(1);
    expect(frame.stage1Spent).toBeNull();
  });

  it("places the center of mass inside the stack", () => {
    expect(frame.comFromBase).toBeGreaterThan(0);
    expect(frame.comFromBase).toBeLessThan(geometry.totalLength);
    expect(frame.attachedLength).toBeCloseTo(geometry.totalLength, 6);
  });
});

describe("toRenderFrame through the flight", () => {
  it("never produces a non-finite field", () => {
    for (let t = 0; t <= trajectory.durationS; t += 0.37) {
      const frame = frameAt(t);
      expect(nonFiniteFields(frame)).toEqual([]);
    }
  });

  it("climbs, goes supersonic and reaches orbital altitude", () => {
    const maxQEvent = flight.events.find((e) => e.id === "max_q")!;
    const atMaxQ = frameAt(maxQEvent.t);
    expect(atMaxQ.altitude).toBeGreaterThan(5_000);
    expect(atMaxQ.mach).toBeGreaterThan(1);
    // Sampled between two 50 ms records, so within a fraction of a percent.
    expect(atMaxQ.q / flight.maxQPa).toBeCloseTo(1, 2);

    const atEnd = frameAt(trajectory.durationS);
    expect(atEnd.altitude).toBeGreaterThan(150_000);
    expect(atEnd.stage).toBe(2);
  });

  it("switches to stage 2 and produces a spent booster after separation", () => {
    const separation = flight.events.find((e) => e.id === "separation")!;
    const before = frameAt(separation.t - 5);
    const after = frameAt(separation.t + 30);
    expect(before.stage).toBe(1);
    expect(before.stage1Spent).toBeNull();
    expect(after.stage).toBe(2);
    expect(after.stage1Spent).not.toBeNull();
    // The booster falls away: it ends up below and behind the rocket.
    const spent = after.stage1Spent!.posLocal;
    expect(Math.hypot(spent[0], spent[1], spent[2])).toBeGreaterThan(10);
    expect(spent[1]).toBeLessThan(0);
  });

  it("shortens the drawn stack at staging", () => {
    const separation = flight.events.find((e) => e.id === "separation")!;
    expect(frameAt(separation.t + 30).attachedLength).toBeLessThan(
      frameAt(separation.t - 5).attachedLength,
    );
  });

  it("tracks the sub-point eastward as the vehicle flies downrange", () => {
    const early = frameAt(30);
    const late = frameAt(200);
    expect(late.lonDeg).toBeGreaterThan(early.lonDeg);
    expect(Math.abs(late.latDeg)).toBeLessThan(1); // equatorial launch, no plane change
  });

  it("passes playback state straight through", () => {
    const frame = frameAt(50, {
      discontinuity: true,
      playbackSpeed: 20,
      playing: false,
      events: ["max_q"],
    });
    expect(frame.discontinuity).toBe(true);
    expect(frame.playbackSpeed).toBe(20);
    expect(frame.playing).toBe(false);
    expect(frame.events).toEqual(["max_q"]);
  });

  it("honours the ignition-hold throttle override", () => {
    const frame = toRenderFrame(
      trajectory.sampleAt(0),
      geometry,
      playback(-1.5, { throttleOverride: 0.42 }),
    );
    expect(frame.t).toBeCloseTo(-1.5, 9);
    expect(frame.throttle).toBeCloseTo(0.42, 9);
  });
});

describe("nonFiniteFields", () => {
  it("names every poisoned field", () => {
    const frame = frameAt(20);
    frame.altitude = Number.NaN;
    frame.velLocal[2] = Number.POSITIVE_INFINITY;
    frame.attitude[0] = Number.NaN;
    expect(nonFiniteFields(frame).sort()).toEqual(["altitude", "attitude[0]", "velLocal[2]"]);
  });
});

describe("inertial frame orientation", () => {
  it("maps the rocket's own position straight up", () => {
    for (const t of [0, 40, 150, 300]) {
      const sample = trajectory.sampleAt(t);
      const frame = frameAt(t);
      // Inertial geometry is converted into renderer axes first, the same
      // way the Earth mesh is; inertialQuat then only orients it.
      const p = sample.positionEciM;
      const local = quatRotate(frame.inertialQuat, enuVecToRenderer(p[0], p[1], p[2]));
      const r = Math.hypot(...sample.positionEciM);
      expect(local[0] / r).toBeCloseTo(0, 6);
      expect(local[2] / r).toBeCloseTo(0, 6);
      expect(local[1] / r).toBeCloseTo(1, 6);
      // Translating by earthCenterLocal lands the vehicle's base under the
      // origin, exactly comFromBase below it.
      expect(local[1] + frame.earthCenterLocal[1]).toBeCloseTo(-frame.comFromBase, 2);
    }
  });

  it("agrees with the attitude sent for the rocket", () => {
    const sample = trajectory.sampleAt(90);
    const frame = frameAt(90);
    const a = sample.attitudeEci;
    const noseFromInertial = quatRotate(frame.inertialQuat, enuVecToRenderer(a[0], a[1], a[2]));
    const noseFromAttitude = quatRotate(frame.attitude, [0, 1, 0]);
    for (let i = 0; i < 3; i++) {
      expect(noseFromInertial[i]).toBeCloseTo(noseFromAttitude[i], 6);
    }
  });
});
