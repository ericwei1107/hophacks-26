/**
 * 3D flight scene. Floating origin: the rocket stays near the scene origin
 * and the world (Earth, pad, trail) is rebased around it each frame. Scene
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
import { RocketMesh } from "./RocketMesh";
import { deriveRocket } from "../../domain/derive";
import { createEngineCatalog } from "../../domain/engines";

const EARTH_RADIUS_KM = EARTH_RADIUS / 1000;
const UP = new THREE.Vector3(0, 1, 0);

function eciKmToScene(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(x / 1000, z / 1000, -y / 1000);
}

export function FlightScene({ flight, cameraMode }: { flight: SerializableFlightResult; cameraMode: CameraMode }) {
  const rocket = useMemo(() => deriveRocket(flight.config, createEngineCatalog()), [flight.config]);
  const telemetry = flight.telemetry;

  // Full trajectory as a fixed ECI-km line; the group is rebased each frame.
  const trailLine = useMemo(() => {
    const n = telemetry.sampleCount;
    const positions = new Float32Array(n * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      eciKmToScene(telemetry.posX[i], telemetry.posY[i], telemetry.posZ[i], v);
      positions[i * 3] = v.x;
      positions[i * 3 + 1] = v.y;
      positions[i * 3 + 2] = v.z;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({ color: "#63ddeb", transparent: true, opacity: 0.7 });
    return new THREE.Line(geom, mat);
  }, [telemetry]);

  const earthRef = useRef<THREE.Mesh>(null);
  const trailRef = useRef<THREE.Group>(null);
  const padRef = useRef<THREE.Group>(null);
  const rocketRef = useRef<THREE.Group>(null);
  const exhaustRef = useRef<THREE.Mesh>(null);

  const padEciM = useMemo(() => new THREE.Vector3(EARTH_RADIUS, 0, 0), []);

  // Scratch objects reused every frame (no per-frame allocation). A ref holds
  // these mutable buffers; they never trigger or depend on React renders.
  const scratchRef = useRef<{
    rocketScene: THREE.Vector3;
    earthCenter: THREE.Vector3;
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
      earthCenter: new THREE.Vector3(),
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

    // Rebase the world around the rocket.
    earthRef.current?.position.copy(scratch.earthCenter.copy(rocketScene).negate());
    trailRef.current?.position.copy(rocketScene).negate();
    if (padRef.current) {
      eciKmToScene(padEciM.x, padEciM.y, padEciM.z, scratch.padScene).sub(rocketScene);
      padRef.current.position.copy(scratch.padScene);
    }

    // Orientation: along velocity (prograde), or radially outward when slow.
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

    // Exhaust follows the actual throttle and burning phases (1, 5, 7).
    // The exhaust lives inside the rocket group, so units are meters.
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
      <ambientLight intensity={0.4} />
      <directionalLight position={[1, 0.5, 0.5]} intensity={1.4} />

      <mesh ref={earthRef}>
        <sphereGeometry args={[EARTH_RADIUS_KM, 48, 48]} />
        <meshStandardMaterial color="#0a2136" roughness={1} metalness={0} />
      </mesh>

      <group ref={padRef}>
        <mesh>
          <boxGeometry args={[0.03, 0.06, 0.03]} />
          <meshStandardMaterial color="#63ddeb" emissive="#1a4a55" />
        </mesh>
      </group>

      <group ref={trailRef}>
        <primitive object={trailLine} />
      </group>

      <group ref={rocketRef} scale={0.001}>
        <RocketMesh rocket={rocket} />
        <mesh ref={exhaustRef} visible={false} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[rocket.diameterM * 0.35, 2.5, 16, 1, true]} />
          <meshBasicMaterial color="#ffb066" transparent opacity={0.75} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </>
  );
}
