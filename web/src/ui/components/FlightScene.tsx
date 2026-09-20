/**
 * The three.js launch view, driven entirely by RenderFrames.
 *
 * The scene is the renderer's local frame: the rocket sits at the origin with
 * its center of mass there, and the Earth, the pad and the trail are placed
 * around it from the frame's own vectors. Nothing here samples the recording
 * or advances a clock — `PlaybackController` does that, and this scene draws
 * whatever frame it was last handed. That is what keeps this view and the
 * Unity view showing the same instant.
 *
 * Trail geometry is the one exception: it is static for a whole flight, so it
 * is baked once into the inertial frame and then only moved by a group
 * transform built from `inertialQuat` and `earthCenterLocal`. The launch site
 * is similar: it hangs off the Earth mesh at the pad's spot on the globe.
 */

import { useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";

import type { RenderFrame } from "../../protocol";
import type { RendererCameraMode } from "../../renderers/LaunchRenderer";
import {
  M_TO_SCENE,
  eciToInertialSceneKm,
  rendererMetersToThree,
  rendererQuatToThree,
} from "../../renderers/threeAxes";
import type { SerializableFlightResult } from "../../workers/serialize";
import { deriveRocket } from "../../domain/derive";
import { createEngineCatalog } from "../../domain/engines";
import { Earth } from "./Earth";
import { Exhaust, SeparationFlash } from "./Exhaust";
import { LaunchSite } from "./LaunchSite";
import { Moon } from "./Moon";
import { FairingHalf, RocketMesh } from "./RocketMesh";
import { rocketLayout, type RocketLayout } from "./rocketLayout";
import { SkyDome, StarField } from "./Sky";
import { Trajectory } from "./Trajectory";

/** Mutable camera state the renderer wrapper writes and this scene reads. */
export interface SceneCameraState {
  mode: RendererCameraMode;
  zoom: number;
  /** Additive drag offsets, radians. */
  azimuth: number;
  elevation: number;
}

const MAX_ELEVATION = 1.35;
/** Above this playback speed, shake and other per-frame flourishes stop. */
const MAX_EFFECTS_PLAYBACK_SPEED = 10;

function endLabelFor(flight: SerializableFlightResult): string {
  if (flight.orbitAchieved) {
    return flight.targetOrbitAchieved ? "ORBIT INSERTION" : "ORBIT";
  }
  switch (flight.outcome) {
    case "impact":
      return "IMPACT";
    case "low_perigee":
      return "LOW PERIGEE";
    case "unbound_trajectory":
      return "ESCAPE";
    default:
      return "FLIGHT ENDS";
  }
}

export function FlightScene({
  flight,
  frameRef,
  cameraRef,
  lowEffects,
  reducedMotion = false,
}: {
  flight: SerializableFlightResult;
  frameRef: { current: RenderFrame | null };
  cameraRef: { current: SceneCameraState };
  lowEffects: boolean;
  /** Skips camera shake, for players who asked for reduced motion. */
  reducedMotion?: boolean;
}) {
  const rocket = useMemo(() => deriveRocket(flight.config, createEngineCatalog()), [flight.config]);
  const layout = useMemo(() => rocketLayout(rocket), [rocket]);
  const telemetry = flight.telemetry;

  const eventTimes = useMemo(() => {
    const at = (id: string) => flight.events.find((e) => e.id === id)?.t ?? null;
    return { separation: at("separation"), fairing: at("fairing_jettison"), maxQ: at("max_q") };
  }, [flight.events]);
  const endLabel = useMemo(() => endLabelFor(flight), [flight]);

  const earthRef = useRef<THREE.Group>(null);
  const siteRef = useRef<THREE.Group | null>(null);
  const moonRef = useRef<THREE.Group>(null);
  const inertialRef = useRef<THREE.Group>(null);
  const rocketRef = useRef<THREE.Group>(null);
  const stackRef = useRef<THREE.Group>(null);
  const spentRef = useRef<THREE.Group>(null);
  const maxQRef = useRef<THREE.Mesh>(null);
  const sunRef = useRef<THREE.DirectionalLight>(null);

  /** Max-Q marker, baked into the inertial frame like the rest of the trail. */
  const maxQScene = useMemo(() => {
    const event = flight.events.find((e) => e.id === "max_q");
    if (!event) {
      return null;
    }
    const i = Math.min(telemetry.sampleCount - 1, Math.round(event.t / 0.05));
    return eciToInertialSceneKm(
      telemetry.posX[i],
      telemetry.posY[i],
      telemetry.posZ[i],
      new THREE.Vector3(),
    );
  }, [flight, telemetry]);

  const spentPath = useMemo(() => {
    const n = telemetry.sampleCount;
    const pts: number[] = [];
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      if (Number.isFinite(telemetry.spentX[i])) {
        eciToInertialSceneKm(telemetry.spentX[i], telemetry.spentY[i], telemetry.spentZ[i], v);
        pts.push(v.x, v.y, v.z);
      }
    }
    if (pts.length < 6) {
      return null;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const line = new THREE.Line(
      g,
      new THREE.LineDashedMaterial({
        color: "#ff9b54",
        dashSize: 2,
        gapSize: 2,
        transparent: true,
        opacity: 0.6,
      }),
    );
    line.computeLineDistances();
    return line;
  }, [telemetry]);

  const scratch = useMemo(
    () => ({
      vec: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      camPos: new THREE.Vector3(),
      site: new THREE.Vector3(),
      look: new THREE.Vector3(),
    }),
    [],
  );
  const maxQSeenRef = useRef(false);
  const [stage1Attached, setStage1Attached] = useState(true);
  const [fairingOn, setFairingOn] = useState(true);

  useFrame(({ camera }) => {
    const frame = frameRef.current;
    if (!frame) {
      return;
    }
    const cam = cameraRef.current;
    const altitudeKm = Math.max(0, frame.altitude) / 1000;
    const t = frame.t;

    // --- world placement, all from the frame ------------------------------
    const earthPos = rendererMetersToThree(frame.earthCenterLocal, scratch.vec);
    if (earthRef.current) {
      earthRef.current.position.copy(earthPos);
      earthRef.current.quaternion.copy(rendererQuatToThree(frame.earthQuat, scratch.quat));
      earthRef.current.updateMatrixWorld();
    }
    if (inertialRef.current) {
      inertialRef.current.position.copy(earthPos);
      inertialRef.current.quaternion.copy(rendererQuatToThree(frame.inertialQuat, scratch.quat));
    }
    if (moonRef.current) {
      moonRef.current.position.copy(rendererMetersToThree(frame.moon.posLocal, scratch.vec));
      moonRef.current.quaternion.copy(rendererQuatToThree(frame.moon.quat, scratch.quat));
    }
    if (sunRef.current) {
      sunRef.current.position
        .set(frame.sunDirLocal[0], frame.sunDirLocal[1], -frame.sunDirLocal[2])
        .multiplyScalar(2000);
    }

    // --- the vehicle -------------------------------------------------------
    if (rocketRef.current) {
      rocketRef.current.quaternion.copy(rendererQuatToThree(frame.attitude, scratch.quat));
    }
    if (stackRef.current) {
      // The frame's origin is the center of mass; the mesh's origin is the
      // base of the *full* stack. After separation the attached vehicle
      // starts higher up, which the frame reports as a shorter stack.
      const attachedBase = rocket.totalLengthM - frame.attachedLength;
      stackRef.current.position.set(0, -(attachedBase + frame.comFromBase), 0);
    }
    if (stage1Attached !== (frame.stage === 1)) {
      setStage1Attached(frame.stage === 1);
    }
    const fairingNow = eventTimes.fairing === null || t < eventTimes.fairing;
    if (fairingOn !== fairingNow) {
      setFairingOn(fairingNow);
    }

    if (spentRef.current) {
      const spent = frame.stage1Spent;
      spentRef.current.visible = spent !== null;
      if (spent) {
        rendererMetersToThree(spent.posLocal, spentRef.current.position);
        spentRef.current.quaternion.copy(rendererQuatToThree(spent.attitude, scratch.quat));
      }
    }

    // --- markers -------------------------------------------------------------
    if (frame.discontinuity) {
      maxQSeenRef.current = false;
    }
    if (frame.events.includes("max_q")) {
      maxQSeenRef.current = true;
    }
    if (maxQRef.current && maxQScene) {
      // After a scrub the event list is empty by design, so fall back to time.
      const reached = maxQSeenRef.current || t >= (eventTimes.maxQ ?? Infinity);
      maxQRef.current.visible = reached;
      if (reached) {
        maxQRef.current.scale.setScalar(1 + 0.15 * Math.sin(Math.max(0, t) * 6));
      }
    }

    // --- camera ------------------------------------------------------------
    const rocketLenKm = frame.attachedLength * M_TO_SCENE;
    const padDist = Math.max(rocketLenKm * 2.4, 0.08);
    const distKm = padDist / cam.zoom;
    const planetShot = cam.mode === "orbit" || distKm > 12;
    const heightKm = planetShot ? distKm * 0.6 : rocketLenKm * 0.5 + distKm * 0.2;

    scratch.look.set(0, planetShot ? 0 : rocketLenKm * 0.35, 0);
    switch (cam.mode) {
      case "overhead":
        scratch.camPos.set(distKm, heightKm, distKm * (planetShot ? 0.22 : 0.04));
        applyOrbitOffset(scratch.camPos, cam.azimuth, cam.elevation);
        break;
      case "chase":
        scratch.camPos.set(distKm * 0.7, heightKm * 0.85, distKm * (planetShot ? 0.45 : 0.4));
        applyOrbitOffset(scratch.camPos, cam.azimuth, cam.elevation);
        break;
      case "ground": {
        // A camera on a tripod at the pad perimeter: it stays on the ground
        // and tracks the vehicle as it climbs away.
        if (siteRef.current) {
          siteRef.current.getWorldPosition(scratch.site);
        } else {
          scratch.site.set(0, -(frame.altitude + frame.comFromBase) * M_TO_SCENE, 0);
        }
        scratch.camPos.set(0.19 / cam.zoom, 0.024, 0.11 / cam.zoom);
        applyOrbitOffset(scratch.camPos, cam.azimuth, cam.elevation);
        scratch.camPos.add(scratch.site);
        scratch.look.set(0, rocketLenKm * 0.3, 0);
        break;
      }
      case "orbit":
        scratch.camPos.set(1100, 720, 280);
        applyOrbitOffset(scratch.camPos, cam.azimuth, cam.elevation);
        break;
    }

    // Shake from the vehicle's own loads: throttle sets the base amplitude,
    // dynamic pressure raises it, and it dies away with the air. Events add
    // a short burst. Deterministic in flight time, so it replays.
    if (frame.playing && frame.playbackSpeed <= MAX_EFFECTS_PLAYBACK_SPEED && !reducedMotion && cam.mode !== "orbit") {
      const altitudeFalloff = 1 - Math.min(1, Math.max(0, (altitudeKm - 60) / 30));
      const load = 1 + Math.min(1, frame.q / 40_000) * 1.6;
      let burst = 0;
      for (const at of [eventTimes.separation, eventTimes.maxQ]) {
        if (at !== null && t >= at && t < at + 0.9) {
          burst = Math.max(burst, 1 - (t - at) / 0.9);
        }
      }
      const liftoff = t > -0.6 && t < 6 ? 1.6 : 1;
      const amplitude =
        (frame.throttle * load * altitudeFalloff * liftoff + burst * 2.2) * 0.0045 * scratch.camPos.distanceTo(scratch.look);
      if (amplitude > 1e-7) {
        scratch.camPos.x += amplitude * (Math.sin(t * 57.3) * 0.6 + Math.sin(t * 23.1 + 1) * 0.4);
        scratch.camPos.y += amplitude * (Math.sin(t * 61.7 + 2) * 0.5 + Math.sin(t * 31.9) * 0.5);
        scratch.camPos.z += amplitude * (Math.sin(t * 49.1 + 0.5) * 0.6 + Math.sin(t * 27.7 + 2.5) * 0.4);
      }
    }

    camera.position.copy(scratch.camPos);
    camera.up.set(0, 1, 0);
    camera.lookAt(scratch.look);
  });

  return (
    <group>
      <SkyDome frameRef={frameRef} />
      <StarField frameRef={frameRef} count={lowEffects ? 1500 : 4000} />

      <hemisphereLight args={["#7fa6c4", "#1a2418", 0.35]} />
      <ambientLight intensity={0.12} />
      <directionalLight ref={sunRef} intensity={1.35} color="#fff3dc" />

      <group ref={earthRef}>
        <Earth />
        <LaunchSite
          frameRef={frameRef}
          lowEffects={lowEffects}
          rocketRadius={layout.radius}
          rocketLength={layout.totalLength}
          siteRef={siteRef}
        />
      </group>

      <group ref={moonRef}>
        <Moon />
      </group>

      <group ref={inertialRef}>
        <Trajectory telemetry={telemetry} frameRef={frameRef} lowEffects={lowEffects} endLabel={endLabel} />
        {spentPath && <primitive object={spentPath} />}
        {maxQScene && (
          <mesh ref={maxQRef} position={maxQScene} visible={false}>
            <ringGeometry args={[0.5, 0.6, 32]} />
            <meshBasicMaterial color="#ff9b54" transparent opacity={0.8} side={THREE.DoubleSide} />
          </mesh>
        )}
      </group>

      <group ref={rocketRef}>
        <group scale={M_TO_SCENE}>
          <group ref={stackRef}>
            <RocketMesh rocket={rocket} part={stage1Attached ? "full" : "upper"} fairingOn={fairingOn} />
            <Exhaust layout={layout} frameRef={frameRef} lowEffects={lowEffects} />
            <SeparationFlash layout={layout} frameRef={frameRef} separationT={eventTimes.separation} />
            {eventTimes.fairing !== null && (
              <FairingJettison layout={layout} frameRef={frameRef} jettisonT={eventTimes.fairing} />
            )}
          </group>
        </group>
      </group>

      {/* The spent booster: the real stage-1 geometry, centred on its own position. */}
      <group ref={spentRef} visible={false}>
        <group scale={M_TO_SCENE}>
          <group position={[0, -layout.stage1TopY / 2, 0]}>
            <RocketMesh rocket={rocket} part="booster" />
          </group>
        </group>
      </group>

      {!lowEffects && (
        <EffectComposer multisampling={4}>
          <Bloom luminanceThreshold={1.05} luminanceSmoothing={0.25} mipmapBlur intensity={0.75} radius={0.6} />
        </EffectComposer>
      )}
    </group>
  );
}

/** Rotate a camera offset around the target by drag offsets. */
function applyOrbitOffset(pos: THREE.Vector3, azimuth: number, elevation: number): void {
  if (azimuth === 0 && elevation === 0) {
    return;
  }
  const r = pos.length();
  if (r < 1e-9) {
    return;
  }
  const theta = Math.atan2(pos.z, pos.x) + azimuth;
  const phi = Math.max(
    -MAX_ELEVATION,
    Math.min(MAX_ELEVATION, Math.asin(Math.max(-1, Math.min(1, pos.y / r))) + elevation),
  );
  const cosPhi = Math.cos(phi);
  pos.set(r * cosPhi * Math.cos(theta), r * Math.sin(phi), r * cosPhi * Math.sin(theta));
}

/** The two fairing halves peeling away after jettison, in stack coordinates. */
function FairingJettison({
  layout,
  frameRef,
  jettisonT,
}: {
  layout: RocketLayout;
  frameRef: { current: RenderFrame | null };
  jettisonT: number;
}) {
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);

  useFrame(() => {
    const frame = frameRef.current;
    const a = left.current;
    const b = right.current;
    if (!a || !b) {
      return;
    }
    const age = frame ? frame.t - jettisonT : -1;
    const active = age >= 0 && age < 7;
    a.visible = active;
    b.visible = active;
    if (!active) {
      return;
    }
    const halves: [THREE.Group, number][] = [
      [a, 1],
      [b, -1],
    ];
    for (const [g, side] of halves) {
      g.position.set(side * (0.4 + 9 * age + 2.5 * age * age), layout.fairing.yBottom - 2.2 * age * age, 0);
      g.rotation.set(0, side * age * 0.35, -side * Math.min(1.5, age * 0.75));
    }
  });

  return (
    <group>
      <group ref={left} visible={false}>
        <FairingHalf layout={layout} side={1} />
      </group>
      <group ref={right} visible={false}>
        <FairingHalf layout={layout} side={-1} />
      </group>
    </group>
  );
}
