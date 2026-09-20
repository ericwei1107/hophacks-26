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
 * transform built from `inertialQuat` and `earthCenterLocal`.
 */

import { useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
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
import { deriveRocket, type DerivedRocket } from "../../domain/derive";
import { createEngineCatalog } from "../../domain/engines";
import { Earth } from "./Earth";
import { Moon } from "./Moon";
import { Trajectory } from "./Trajectory";
import { RocketMesh } from "./RocketMesh";

/** Mutable camera state the renderer wrapper writes and this scene reads. */
export interface SceneCameraState {
  mode: RendererCameraMode;
  zoom: number;
  /** Additive drag offsets, radians. */
  azimuth: number;
  elevation: number;
}

const MAX_ELEVATION = 1.35;

/** Launch range rings + a pad marker, drawn flat on the ground under the rocket. */
function RangeRings() {
  const rings = useMemo(() => {
    const lines: THREE.Line[] = [];
    for (const radiusKm of [0.05, 0.1, 0.2]) {
      const pts: number[] = [];
      const segments = 48;
      for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        pts.push(Math.cos(a) * radiusKm, 0, Math.sin(a) * radiusKm);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      lines.push(
        new THREE.Line(
          g,
          new THREE.LineBasicMaterial({ color: "#5ad4e8", transparent: true, opacity: 0.7 }),
        ),
      );
    }
    return lines;
  }, []);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.004, 0]}>
        <circleGeometry args={[0.22, 48]} />
        <meshStandardMaterial color="#1574a8" roughness={0.9} metalness={0} />
      </mesh>
      {rings.map((line, i) => (
        <primitive key={i} object={line} />
      ))}
      {/* Launch tower, set behind the pad so it never hides the vehicle:
          every camera mode looks in from +X and +Z. */}
      <mesh position={[-0.022, 0.019, -0.014]}>
        <boxGeometry args={[0.004, 0.038, 0.004]} />
        <meshStandardMaterial
          color="#2c4a58"
          emissive="#1b5e6b"
          emissiveIntensity={0.5}
          roughness={0.8}
        />
      </mesh>
    </group>
  );
}

export function FlightScene({
  flight,
  frameRef,
  cameraRef,
  lowEffects,
}: {
  flight: SerializableFlightResult;
  frameRef: { current: RenderFrame | null };
  cameraRef: { current: SceneCameraState };
  lowEffects: boolean;
}) {
  const rocket = useMemo(() => deriveRocket(flight.config, createEngineCatalog()), [flight.config]);
  const telemetry = flight.telemetry;

  const earthRef = useRef<THREE.Group>(null);
  const moonRef = useRef<THREE.Group>(null);
  const inertialRef = useRef<THREE.Group>(null);
  const groundRef = useRef<THREE.Group>(null);
  const rocketRef = useRef<THREE.Group>(null);
  const stackRef = useRef<THREE.Group>(null);
  const spentRef = useRef<THREE.Mesh>(null);
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
      sky: new THREE.Color(),
    }),
    [],
  );
  const throttleRef = useRef(0);
  const engineCountRef = useRef(rocket.stage1.engineCount);
  const maxQSeenRef = useRef(false);
  const [stage1Attached, setStage1Attached] = useState(true);

  useFrame(({ camera, scene }) => {
    const frame = frameRef.current;
    if (!frame) {
      return;
    }
    const cam = cameraRef.current;
    const altitudeKm = Math.max(0, frame.altitude) / 1000;

    // --- world placement, all from the frame ------------------------------
    const earthPos = rendererMetersToThree(frame.earthCenterLocal, scratch.vec);
    if (earthRef.current) {
      earthRef.current.position.copy(earthPos);
      earthRef.current.quaternion.copy(rendererQuatToThree(frame.earthQuat, scratch.quat));
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
    throttleRef.current = frame.throttle;
    engineCountRef.current =
      frame.throttle > 0.02 ? (frame.stage === 1 ? rocket.stage1.engineCount : 1) : 0;

    if (spentRef.current) {
      const spent = frame.stage1Spent;
      spentRef.current.visible = spent !== null;
      if (spent) {
        rendererMetersToThree(spent.posLocal, spentRef.current.position);
        spentRef.current.quaternion.copy(rendererQuatToThree(spent.attitude, scratch.quat));
      }
    }

    // --- pad and markers ---------------------------------------------------
    if (groundRef.current) {
      // The ground is flat under the rocket: a 6371 km sphere is far too
      // coarse to stand a 60 m vehicle on.
      groundRef.current.position.set(0, -(frame.altitude + frame.comFromBase) * M_TO_SCENE, 0);
    }

    if (frame.discontinuity) {
      maxQSeenRef.current = false;
    }
    if (frame.events.includes("max_q")) {
      maxQSeenRef.current = true;
    }
    if (maxQRef.current && maxQScene) {
      // After a scrub the event list is empty by design, so fall back to time.
      const reached = maxQSeenRef.current || frame.t >= (flight.events.find((e) => e.id === "max_q")?.t ?? Infinity);
      maxQRef.current.visible = reached;
      if (reached) {
        maxQRef.current.scale.setScalar(1 + 0.15 * Math.sin(Math.max(0, frame.t) * 6));
      }
    }

    // --- camera ------------------------------------------------------------
    const rocketLenKm = frame.attachedLength * M_TO_SCENE;
    const padDist = Math.max(rocketLenKm * 2.4, 0.08);
    const distKm = padDist / cam.zoom;
    const planetShot = cam.mode === "orbit" || distKm > 12;
    const heightKm = planetShot ? distKm * 0.6 : rocketLenKm * 0.5 + distKm * 0.2;

    if (groundRef.current) {
      groundRef.current.visible = !planetShot && altitudeKm < 35;
    }

    switch (cam.mode) {
      case "overhead":
        scratch.camPos.set(distKm, heightKm, distKm * (planetShot ? 0.22 : 0.04));
        break;
      case "chase":
        scratch.camPos.set(distKm * 0.7, heightKm * 0.85, distKm * (planetShot ? 0.45 : 0.4));
        break;
      case "ground":
        scratch.camPos.set(0.18, 0.028, 0.08);
        break;
      case "orbit":
        scratch.camPos.set(1100, 720, 280);
        break;
    }
    applyOrbitOffset(scratch.camPos, cam.azimuth, cam.elevation);
    camera.position.copy(scratch.camPos);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, planetShot ? 0 : rocketLenKm * 0.35, 0);

    // The sky fades out as the atmosphere thins.
    const skyMix = 1 - Math.min(1, altitudeKm / 70);
    scratch.sky.setRGB(0.22 * skyMix, 0.38 * skyMix, 0.58 * skyMix);
    scene.background = scratch.sky;
  });

  return (
    <group>
      <hemisphereLight args={["#6a98b8", "#0a1520", 0.28]} />
      <ambientLight intensity={0.16} />
      <directionalLight ref={sunRef} intensity={1.15} color="#fff6e4" />
      <Stars
        radius={500}
        depth={80}
        count={lowEffects ? 1200 : 3500}
        factor={3}
        saturation={0}
        fade
        speed={0}
      />

      <group ref={earthRef}>
        <Earth />
      </group>

      <group ref={moonRef}>
        <Moon />
      </group>

      <group ref={inertialRef}>
        <Trajectory telemetry={telemetry} frameRef={frameRef} lowEffects={lowEffects} />
        {spentPath && <primitive object={spentPath} />}
        {maxQScene && (
          <mesh ref={maxQRef} position={maxQScene} visible={false}>
            <ringGeometry args={[0.5, 0.6, 32]} />
            <meshBasicMaterial color="#ff9b54" transparent opacity={0.8} side={THREE.DoubleSide} />
          </mesh>
        )}
      </group>

      <group ref={groundRef}>
        <RangeRings />
      </group>

      <group ref={rocketRef}>
        <group scale={M_TO_SCENE}>
          <group ref={stackRef}>
            <RocketMesh rocket={rocket} stage1Attached={stage1Attached} />
            <LiveExhaust
              rocket={rocket}
              throttleRef={throttleRef}
              engineCountRef={engineCountRef}
            />
          </group>
        </group>
      </group>

      <mesh ref={spentRef} visible={false}>
        <boxGeometry args={[0.01, 0.02, 0.01]} />
        <meshStandardMaterial color="#8a8f9a" />
      </mesh>
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

/** Reads per-frame throttle refs so the plume updates without a React render. */
function LiveExhaust({
  rocket,
  throttleRef,
  engineCountRef,
}: {
  rocket: DerivedRocket;
  throttleRef: { current: number };
  engineCountRef: { current: number };
}) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const root = group.current;
    if (!root) {
      return;
    }
    const throttle = throttleRef.current;
    const engineCount = engineCountRef.current;
    root.visible = throttle > 0.02 && engineCount > 0;
    if (!root.visible) {
      return;
    }
    const r = rocket.diameterM / 2;
    const nozzleR = rocket.stage1.engine.nozzleDiameterM / 2;
    const ringR = engineCount <= 1 ? 0 : Math.max(0, r - nozzleR);
    const len = 5.5 + 10 * throttle;
    const coreLen = 2.4 + 4.5 * throttle;
    for (let i = 0; i < root.children.length; i++) {
      const g = root.children[i];
      if (!(g instanceof THREE.Group)) {
        continue;
      }
      const active = i < engineCount;
      g.visible = active;
      if (!active) {
        continue;
      }
      const angle = (i / Math.max(engineCount, 1)) * Math.PI * 2;
      g.position.set(Math.cos(angle) * ringR, 0, Math.sin(angle) * ringR);
      const core = g.children[0] as THREE.Mesh;
      const outer = g.children[1] as THREE.Mesh;
      core.position.y = -coreLen / 2 - 0.55;
      core.scale.set(1, coreLen / 4, 1);
      outer.position.y = -len / 2 - 0.45;
      outer.scale.set(1, len / 8, 1);
    }
  });

  const maxEngines = Math.max(rocket.stage1.engineCount, 1);
  return (
    <group ref={group}>
      {Array.from({ length: maxEngines }).map((_, i) => (
        <group key={i}>
          <mesh rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[rocket.stage1.engine.nozzleDiameterM * 0.16, 4, 8, 1, true]} />
            <meshBasicMaterial
              color="#fff6c8"
              transparent
              opacity={0.82}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          <mesh rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[rocket.stage1.engine.nozzleDiameterM * 0.42, 8, 10, 1, true]} />
            <meshBasicMaterial
              color="#ff6a20"
              transparent
              opacity={0.48}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        </group>
      ))}
      <pointLight color="#ffb066" intensity={0.35} distance={12} position={[0, -1.2, 0]} />
    </group>
  );
}
