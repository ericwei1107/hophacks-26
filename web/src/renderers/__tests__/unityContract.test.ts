/**
 * The C# side parses frames with JsonUtility, which binds by field name and
 * silently leaves a mismatched field at its default value. A renamed field
 * would not throw — the rocket would just stop rotating, or sit at the origin,
 * with nothing in the console.
 *
 * So the contract is checked structurally: these read the actual C# source and
 * compare its field names against the JSON the web app sends.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { referenceConfig } from "../../domain/config";
import { deriveRocket } from "../../domain/derive";
import { createEngineCatalog } from "../../domain/engines";
import { toRenderFrame, toRocketGeometry } from "../../protocol";
import { defaultEnvironment, runFlight } from "../../sim/ascent/flight";
import { referenceSnapshot } from "../../sim/orbital/weather";
import { createTrajectory } from "../../sim/trajectory";
import { toUnityFrame } from "../UnityLaunchRenderer";

const UNITY_ROOT = join("..", "unity", "RocketRenderer", "Assets");
const SIM_TYPES = readFileSync(join(UNITY_ROOT, "Scripts", "SimTypes.cs"), "utf8");
const SIM_BRIDGE = readFileSync(join(UNITY_ROOT, "Scripts", "SimBridge.cs"), "utf8");
const JSLIB = readFileSync(join(UNITY_ROOT, "Plugins", "WebGL", "RocketBridge.jslib"), "utf8");

/** Public field names declared in a `class <name>` block of a C# file. */
function csharpFields(source: string, className: string): string[] {
  const start = source.indexOf(`class ${className}`);
  expect(start, `class ${className} not found`).toBeGreaterThan(-1);
  const open = source.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = source.slice(open, end);
  const fields: string[] = [];
  const pattern = /public\s+[\w.<>[\]]+\s+@?(\w+)\s*;/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    fields.push(match[1]);
  }
  return fields;
}

const config = referenceConfig();
const geometry = toRocketGeometry(deriveRocket(config, createEngineCatalog()));
const flight = runFlight({
  config,
  environment: defaultEnvironment(referenceSnapshot()),
  seed: 0,
});
const trajectory = createTrajectory(flight.telemetry);
const separation = flight.events.find((e) => e.id === "separation")!;
const frame = toUnityFrame(
  toRenderFrame(trajectory.sampleAt(separation.t + 30), geometry, {
    t: separation.t + 30,
    discontinuity: false,
    playbackSpeed: 1,
    playing: true,
    events: ["separation"],
  }),
);

describe("RenderFrame binds to RenderFrameDto", () => {
  it("declares exactly the fields the web app sends", () => {
    expect(csharpFields(SIM_TYPES, "RenderFrameDto").sort()).toEqual(Object.keys(frame).sort());
  });
});

describe("RocketGeometry binds to RocketGeometryDto", () => {
  it("declares exactly the top-level fields the web app sends", () => {
    expect(csharpFields(SIM_TYPES, "RocketGeometryDto").sort()).toEqual(
      Object.keys(geometry).sort(),
    );
  });

  it("declares the nested section fields", () => {
    expect(csharpFields(SIM_TYPES, "RocketStage1Dto").sort()).toEqual(
      Object.keys(geometry.stage1).sort(),
    );
    expect(csharpFields(SIM_TYPES, "RocketSectionDto").sort()).toEqual(
      Object.keys(geometry.stage2).sort(),
    );
    expect(csharpFields(SIM_TYPES, "RocketFinsDto").sort()).toEqual(
      Object.keys(geometry.fins).sort(),
    );
  });
});

describe("the message surface", () => {
  it("implements every method the web app calls on SimBridge", () => {
    for (const method of [
      "SetRocket",
      "SetFrame",
      "SetCameraMode",
      "OrbitCamera",
      "ZoomCamera",
      "ResetFlight",
    ]) {
      expect(SIM_BRIDGE, `SimBridge.${method}`).toMatch(
        new RegExp(`public\\s+void\\s+${method}\\s*\\(`),
      );
    }
  });

  it("sends nothing back except ready and error", () => {
    expect(JSLIB).toContain("RocketBridge_Ready");
    expect(JSLIB).toContain("RocketBridge_Error");
    expect(JSLIB).toContain("UTF8ToString");
    expect(JSLIB).toContain("window.__rocketHost");
  });

  it("keeps the keyboard available to the HTML controls over the canvas", () => {
    expect(SIM_BRIDGE).toContain("WebGLInput.captureAllKeyboardInput = false");
  });
});

describe("the Unity side runs no physics and owns no clock", () => {
  const sources = ["SimTypes.cs", "SimBridge.cs", "SceneBootstrap.cs", "RocketBuilder.cs", "FlightView.cs", "EarthView.cs", "EffectsController.cs", "CameraDirector.cs"].map(
    (name) => ({ name, text: readFileSync(join(UNITY_ROOT, "Scripts", name), "utf8") }),
  );

  it("declares no Rigidbody and no gravity", () => {
    for (const { name, text } of sources) {
      // Stripped of comments: the ban is on code, and the files explain the ban.
      const code = text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(code, `${name} must not use Rigidbody`).not.toMatch(/\bRigidbody\b/);
      expect(code, `${name} must not use Physics.gravity`).not.toMatch(/Physics\.gravity/);
    }
  });

  it("never advances the flight from Unity's own clock", () => {
    for (const { name, text } of sources) {
      const code = text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      // Time is allowed for frame-local effects (shake decay, a chromatic
      // pulse) but never for Time.time, which would mean Unity keeping its own
      // flight clock.
      expect(code, `${name} must not read Time.time`).not.toMatch(/\bTime\.time\b/);
      expect(code, `${name} must not read Time.deltaTime`).not.toMatch(/\bTime\.deltaTime\b/);
    }
  });
});
