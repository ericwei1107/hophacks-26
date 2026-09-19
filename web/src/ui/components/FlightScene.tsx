/**
 * 3D flight scene. Floating origin: the rocket stays near the scene origin
 * and the world (Earth, pad, trails) is rebased around it each frame. Scene
 * units are kilometers; authoritative positions are double-precision ECI and
 * are rebased in double precision before touching GPU buffers.
 *
 * Scene mapping: ECI (x, y, z) -> scene (x, z, -y), so scene +Y is ECI +Z
 * (north pole up) and the equatorial launch site starts along +X.
 */

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { EARTH_RADIUS } from "../../sim/physics/constants";
import { playbackClock } from "../playbackClock";
import { sampleTelemetry } from "../telemetry";
import type { CameraMode } from "../store";
import type { SerializableFlightResult } from "../../workers/serialize";
import { deriveRocket } from "../../domain/derive";
import { createEngineCatalog } from "../../domain/engines";
import { Earth } from "./Earth";
import { Trajectory } from "./Trajectory";
import { RocketMesh } from "./RocketMesh";

const UP = new THREE.Vector3(0, 1, 0);

function eciKmToScene(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(x / 1000, z / 1000, -y / 1000);
}

/** Launch range rings + a pad marker, in a local scene around the pad. */
function RangeRings() {
  const rings = useMemo(() => {
    const geoms: THREE.BufferGeometry[] = [];
    for (const radiusKm of [0.05, 0.1, 0.2]) {
      const pts: number[] = [];
      const segments = 48;
      for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        pts.push(Math.cos(a) * radiusKm, 0, Math.sin(a) * radiusKm);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      geoms.push(g);
    }
    return geoms;
  }, []);
  return (
    <group>
      {rings.map((g, i) => (
        <primitive key={i} object={new THREE.Line(g, new THREE.LineBasicMaterial({ color: "#1d4a5c", transparent: true, opacity: 0.5 }))} />
      ))}
      <mesh>
        <boxGeometry args={[0.02, 0.05, 0.02]} />
        <meshStandardMaterial color="#63ddeb" emissive="#2a6a78" />
      </mesh>
    </group>
  );
}

export function FlightScene({
  flight,
  cameraMode,
  lowEffects,
}: {
  flight: SerializableFlightResult;
  cameraMode: CameraMode;
  lowEffects: boolean;
}) {
  const rocket = useMemo(() => deriveRocket(flight.config, createEngineCatalog()), [flight.config]);
  const telemetry = flight.telemetry;

  const earthRef = useRef<THREE.Group>(null);
  const worldRef = useRef<THREE.Group>(null);
  const padRef = useRef<THREE.Group>(null);
  const rocketRef = useRef<THREE.Group>(null);
  const exhaustRef = useRef<THREE.Mesh>(null);
  const spentRef = useRef<THREE.Mesh>(null);
  const maxQRef = useRef<THREE.Mesh>(null);

  const padEciM = useMemo(() => new THREE.Vector3(EARTH_RADIUS, 0, 0), []);
  // The pad sits at a fixed absolute scene position (inside worldRef).
  const padScenePos = useMemo(() => eciKmToScene(EARTH_RADIUS, 0, 0, new THREE.Vector3()), []);

  // Max-Q event position (scene km, fixed for the flight).
  const maxQScene = useMemo(() => {
    const event = flight.events.find((e) => e.id === "max_q");
    if (!event) {
      return null;
    }
    const i = Math.min(telemetry.sampleCount - 1, Math.round(event.t / 0.05));
    const v = new THREE.Vector3();
    return eciKmToScene(telemetry.posX[i], telemetry.posY[i], telemetry.posZ[i], v);
  }, [flight, telemetry]);

  // Spent stage recorded path (dashed), fixed for the flight.
  const spentPath = useMemo(() => {
    const n = telemetry.sampleCount;
    const pts: number[] = [];
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      if (Number.isFinite(telemetry.spentX[i])) {
        eciKmToScene(telemetry.spentX[i], telemetry.spentY[i], telemetry.spentZ[i], v);
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
      new THREE.LineDashedMaterial({ color: "#ff9b54", dashSize: 2, gapSize: 2, transparent: true, opacity: 0.6 }),
    );
    line.computeLineDistances();
    return line;
  }, [telemetry]);

  const scratchRef = useRef<{
    rocketScene: THREE.Vector3;
    padScene: THREE.Vector3;
    camPos: THREE.Vector3;
    up: THREE.Vector3;
    side: THREE.Vector3;
    vScene: THREE.Vector3;
    quat: THREE.Quaternion;
  } | null>(null);
  if (scratchRef.current === null) {
    scratchRef.current = {
      rocketScene: new THREE.Vector3(),
      padScene: new THREE.Vector3(),
      camPos: new THREE.Vector3(),
      up: new THREE.Vector3(),
      side: new THREE.Vector3(),
      vScene: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
    };
  }
  const scratch = scratchRef.current;

  useFrame(({ camera }) => {
    const sample = sampleTelemetry(telemetry, playbackClock.timeS);
    const [rx, ry, rz] = sample.positionEciM;
    const rocketScene = eciKmToScene(rx, ry, rz, scratch.rocketScene);

    // Rebase the world around the rocket (floating origin).
    if (worldRef.current) {
      worldRef.current.position.copy(rocketScene).negate();
    }

    // Rocket orientation: prograde, or radially outward when slow.
    if (rocketRef.current) {
      rocketRef.current.position.set(0, 0, 0);
      const i0 = Math.min(telemetry.sampleCount - 1, Math.floor(playbackClock.timeS / 0.05));
      const i1 = Math.min(telemetry.sampleCount - 1, i0 + 1);
      scratch.vScene.set(
        telemetry.posX[i1] - telemetry.posX[i0],
        telemetry.posZ[i1] - telemetry.posZ[i0],
        -(telemetry.posY[i1] - telemetry.posY[i0]),
      );
      if (scratch.vScene.lengthSq() > 100 && sample.altitudeKm > 0.01) {
        scratch.quat.setFromUnitVectors(UP, scratch.vScene.normalize());
      } else {
        scratch.up.copy(rocketScene).normalize();
        scratch.quat.setFromUnitVectors(UP, scratch.up);
      }
      rocketRef.current.quaternion.copy(scratch.quat);
    }

    // Exhaust follows the real throttle and burning phases (1, 5, 7).
    if (exhaustRef.current) {
      const burningPhase = sample.phase === 1 || sample.phase === 5 || sample.phase === 7;
      const throttle = burningPhase ? sample.throttle : 0;
      exhaustRef.current.visible = throttle > 0.01;
      if (throttle > 0.01) {
        const len = 2.5 * throttle + 0.5;
        exhaustRef.current.scale.set(1, len / 2.5, 1);
        exhaustRef.current.position.y = -len / 2 - 0.4;
      }
    }

    // Spent stage marker at its recorded position (rebased: outside worldRef).
    if (spentRef.current) {
      const i = Math.min(telemetry.sampleCount - 1, Math.floor(playbackClock.timeS / 0.05));
      if (Number.isFinite(telemetry.spentX[i])) {
        spentRef.current.visible = true;
        eciKmToScene(telemetry.spentX[i], telemetry.spentY[i], telemetry.spentZ[i], scratch.side);
        spentRef.current.position.copy(scratch.side.sub(rocketScene));
      } else {
        spentRef.current.visible = false;
      }
    }

    // Max-Q ring pulses at the event location once reached. It lives inside
    // worldRef, so its position is the absolute scene coordinate.
    if (maxQRef.current && maxQScene) {
      const reached = flight.events.some((e) => e.id === "max_q" && playbackClock.timeS >= e.t);
      maxQRef.current.visible = reached;
      if (reached) {
        maxQRef.current.position.copy(maxQScene);
        const pulse = 1 + 0.15 * Math.sin(playbackClock.timeS * 6);
        maxQRef.current.scale.setScalar(pulse);
      }
    }

    // Cameras track the rocket (scene origin).
    const altitudeKm = Math.max(0, sample.altitudeKm);
    const distKm = Math.max(rocket.totalLengthM * 3, 100 + altitudeKm * 800) / 1000;
    switch (cameraMode) {
      case "overhead": {
        scratch.up.copy(rocketScene).normalize();
        scratch.side.set(1, 0, 0);
        scratch.camPos
          .copy(scratch.side.multiplyScalar(distKm * 0.5))
          .add(scratch.up.multiplyScalar(distKm * 0.87));
        break;
      }
      case "chase":
        scratch.camPos.set(distKm * 0.7, distKm * 0.4, distKm * 0.7);
        break;
      case "ground":
        eciKmToScene(padEciM.x, padEciM.y, padEciM.z, scratch.camPos).sub(rocketScene);
        scratch.camPos.y += 0.02;
        scratch.camPos.x += 0.05;
        break;
      case "orbit":
        scratch.camPos.set(distKm * 2.2, distKm * 1.1, distKm * 2.2);
        break;
    }
    camera.position.copy(scratch.camPos);
    camera.lookAt(0, 0, 0);
  });

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[1, 0.5, 0.5]} intensity={1.2} />

      {/* World group rebased around the rocket each frame. */}
      <group ref={worldRef}>
        <group ref={earthRef}>
          <Earth />
        </group>
        <group ref={padRef} position={padScenePos} rotation={[0, 0, -Math.PI / 2]}>
          <RangeRings />
        </group>
        <Trajectory telemetry={telemetry} lowEffects={lowEffects} />
        {spentPath && <primitive object={spentPath} />}
        {maxQScene && (
          <mesh ref={maxQRef} visible={false}>
            <ringGeometry args={[0.5, 0.6, 32]} />
            <meshBasicMaterial color="#ff9b54" transparent opacity={0.8} side={THREE.DoubleSide} />
          </mesh>
        )}
      </group>

      {/* The vehicle stays at the scene origin. */}
      <group ref={rocketRef} scale={0.001}>
        <RocketMesh rocket={rocket} />
        <mesh ref={exhaustRef} visible={false} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[rocket.diameterM * 0.35, 2.5, 16, 1, true]} />
          <meshBasicMaterial color="#ffb066" transparent opacity={0.75} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* Spent stage marker (rebased). */}
      <mesh ref={spentRef} visible={false}>
        <boxGeometry args={[0.01, 0.02, 0.01]} />
        <meshStandardMaterial color="#8a8f9a" />
      </mesh>
    </>
  );
}
