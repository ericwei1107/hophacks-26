/**
 * Trajectory rendering: the flown trail, the dashed path still to come, the
 * surface ground track, and labels at the points that matter.
 *
 * The flown trail reveals up to the current playback time via the instanced
 * segment count. The future path is the same recording drawn *backwards*
 * from the end, so revealing it from its start hides exactly the part the
 * rocket has already flown: one geometry, one instance count, no rebuild.
 *
 * Everything is baked once into the scene's inertial frame; the enclosing
 * group is what moves each frame, so no Earth-scale coordinate is recomputed
 * here.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

import { EARTH_RADIUS } from "../../sim/physics/constants";
import type { Telemetry } from "../../sim/ascent/flight";
import type { RenderFrame } from "../../protocol";
import { eciToInertialSceneKm } from "../../renderers/threeAxes";

const EARTH_RADIUS_KM = EARTH_RADIUS / 1000;

/** True when an object projects inside the camera's frame. */
function inView(object: THREE.Object3D, camera: THREE.Camera, scratch: THREE.Vector3): boolean {
  object.getWorldPosition(scratch);
  scratch.project(camera);
  return scratch.z < 1 && Math.abs(scratch.x) < 1.05 && Math.abs(scratch.y) < 1.05;
}

function showLabel(el: HTMLDivElement | null, visible: boolean, opacity = "1"): void {
  if (!el) {
    return;
  }
  el.style.visibility = visible ? "visible" : "hidden";
  el.style.opacity = opacity;
}

export interface TrajectoryMarker {
  position: THREE.Vector3;
  label: string;
  detail?: string;
  /** Playback time at which the marker appears; always shown when omitted. */
  showAfterT?: number;
}

export function Trajectory({
  telemetry,
  frameRef,
  lowEffects,
  endLabel,
}: {
  telemetry: Telemetry;
  frameRef: { current: RenderFrame | null };
  lowEffects: boolean;
  /** Label for the end of the recording, e.g. "ORBIT INSERTION". */
  endLabel: string;
}) {
  const size = useThree((s) => s.size);
  const scratch = useMemo(() => new THREE.Vector3(), []);
  const endRing = useRef<THREE.Mesh>(null);
  const endHtml = useRef<HTMLDivElement>(null);
  const apogeeRing = useRef<THREE.Mesh>(null);
  const apogeeHtml = useRef<HTMLDivElement>(null);

  const { trail, future, groundTrack, maxSegments, stride, endPos, apogee } = useMemo(() => {
    const n = telemetry.sampleCount;
    // Decimate rendering to a bounded point budget (GPU stays fast even for
    // long flights); playback maps time to the nearest rendered point.
    const stride = Math.max(1, Math.ceil(n / 800));
    const positions: number[] = [];
    const colors: number[] = [];
    const ground: number[] = [];
    const v = new THREE.Vector3();

    const newest = new THREE.Color("#63ddeb");
    const oldest = new THREE.Color("#1a3a4a");
    const c = new THREE.Color();

    let apogeeIndex = 0;
    let apogeeKm = -Infinity;
    for (let i = 0; i < n; i += stride) {
      eciToInertialSceneKm(telemetry.posX[i], telemetry.posY[i], telemetry.posZ[i], v);
      positions.push(v.x, v.y, v.z);
      const age = i / (n - 1);
      c.copy(oldest).lerp(newest, age * age);
      colors.push(c.r, c.g, c.b);

      const r = Math.hypot(telemetry.posX[i], telemetry.posY[i], telemetry.posZ[i]);
      if (r > 0) {
        const scale = (EARTH_RADIUS_KM * 1.002) / r;
        ground.push(v.x * scale, v.y * scale, v.z * scale);
      }
      if (telemetry.altitudeKm[i] > apogeeKm) {
        apogeeKm = telemetry.altitudeKm[i];
        apogeeIndex = i;
      }
    }

    const trailGeom = new LineGeometry();
    trailGeom.setPositions(positions);
    trailGeom.setColors(colors);
    const trailMat = new LineMaterial({
      linewidth: 2.5,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      dashed: false,
    });
    const trailLine = new Line2(trailGeom, trailMat);

    // The path still to fly, reversed so its instance count reveals from the end.
    const reversed: number[] = [];
    for (let i = positions.length - 3; i >= 0; i -= 3) {
      reversed.push(positions[i], positions[i + 1], positions[i + 2]);
    }
    const futureGeom = new LineGeometry();
    futureGeom.setPositions(reversed);
    const futureMat = new LineMaterial({
      color: new THREE.Color("#ffb26b"),
      linewidth: 1.7,
      transparent: true,
      opacity: 0.8,
      dashed: true,
      dashSize: 1,
      gapSize: 0.7,
      dashScale: 1,
    });
    const futureLine = new Line2(futureGeom, futureMat);
    futureLine.computeLineDistances();

    const groundGeom = new THREE.BufferGeometry();
    groundGeom.setAttribute("position", new THREE.Float32BufferAttribute(ground, 3));
    const groundLine = new THREE.Line(
      groundGeom,
      new THREE.LineDashedMaterial({ color: "#3a7a8c", dashSize: 4, gapSize: 4, transparent: true, opacity: 0.6 }),
    );
    groundLine.computeLineDistances();

    const pointCount = positions.length / 3;
    const endPos = new THREE.Vector3(
      positions[positions.length - 3],
      positions[positions.length - 2],
      positions[positions.length - 1],
    );
    const apogee =
      apogeeKm > 80 && apogeeIndex < n - 1 - stride * 4
        ? {
            position: eciToInertialSceneKm(
              telemetry.posX[apogeeIndex],
              telemetry.posY[apogeeIndex],
              telemetry.posZ[apogeeIndex],
              new THREE.Vector3(),
            ),
            km: apogeeKm,
            t: telemetry.tS[apogeeIndex],
          }
        : null;
    return {
      trail: trailLine,
      future: futureLine,
      groundTrack: groundLine,
      maxSegments: pointCount - 1,
      stride,
      endPos,
      apogee,
    };
  }, [telemetry]);

  // Dispose replaced geometries and materials so repeated launches don't
  // accumulate GPU resources.
  useEffect(() => {
    return () => {
      trail.geometry.dispose();
      (trail.material as LineMaterial).dispose();
      future.geometry.dispose();
      (future.material as LineMaterial).dispose();
      groundTrack.geometry.dispose();
      (groundTrack.material as THREE.Material).dispose();
    };
  }, [trail, future, groundTrack]);

  useFrame(({ camera }) => {
    const trailMat = trail.material as LineMaterial;
    const futureMat = future.material as LineMaterial;
    trailMat.resolution.set(size.width, size.height);
    futureMat.resolution.set(size.width, size.height);

    // Reveal the trail up to the position of the frame being drawn.
    const t = frameRef.current?.t ?? 0;
    const index = Math.min(maxSegments, Math.max(0, Math.floor(t / (0.05 * stride))));
    trail.geometry.instanceCount = lowEffects ? maxSegments : index;
    future.geometry.instanceCount = Math.max(0, maxSegments - index);
    future.visible = index < maxSegments;
    const groundGeom = groundTrack.geometry as THREE.BufferGeometry;
    groundGeom.setDrawRange(0, lowEffects ? maxSegments + 1 : index + 1);

    // Dashes scale with how far out the camera is, so they read at the pad
    // and from orbit alike. The camera orbits the rocket at the scene origin.
    const camDist = camera.position.length();
    const dashWorldKm = Math.min(60, Math.max(0.02, camDist * 0.02));
    futureMat.dashScale = 1 / dashWorldKm;

    // Labels only where they can be seen: in front of the camera and inside
    // the frame. A point behind the camera projects to nonsense.
    const markerScale = Math.max(0.003, camDist * 0.012);
    if (endRing.current) {
      endRing.current.scale.setScalar(markerScale);
      endRing.current.quaternion.copy(camera.quaternion);
      showLabel(endHtml.current, inView(endRing.current, camera, scratch));
    }
    if (apogeeRing.current && apogee) {
      const reached = t >= apogee.t;
      apogeeRing.current.scale.setScalar(markerScale * 0.7);
      apogeeRing.current.quaternion.copy(camera.quaternion);
      showLabel(apogeeHtml.current, inView(apogeeRing.current, camera, scratch), reached ? "1" : "0.55");
    }
  });

  return (
    <group>
      <primitive object={trail} />
      <primitive object={future} />
      <primitive object={groundTrack} />

      <group position={endPos}>
        <mesh ref={endRing} renderOrder={5}>
          <ringGeometry args={[0.7, 1, 32]} />
          <meshBasicMaterial color="#ffb26b" transparent opacity={0.9} side={THREE.DoubleSide} depthTest={false} />
        </mesh>
        <Html center zIndexRange={[4, 1]} style={{ pointerEvents: "none" }} wrapperClass="traj-html">
          <div ref={endHtml} className="traj-label">
            <span className="traj-label-title">{endLabel}</span>
          </div>
        </Html>
      </group>

      {apogee && (
        <group position={apogee.position}>
          <mesh ref={apogeeRing} renderOrder={5}>
            <ringGeometry args={[0.7, 1, 32]} />
            <meshBasicMaterial color="#63ddeb" transparent opacity={0.9} side={THREE.DoubleSide} depthTest={false} />
          </mesh>
          <Html center zIndexRange={[4, 1]} style={{ pointerEvents: "none" }} wrapperClass="traj-html">
            <div ref={apogeeHtml} className="traj-label cool">
              <span className="traj-label-title">APOGEE</span>
              <span className="traj-label-detail">{apogee.km.toFixed(0)} km</span>
            </div>
          </Html>
        </group>
      )}
    </group>
  );
}
