/**
 * Trajectory rendering: a thick fading airborne trail (Line2) plus a
 * surface-projected ground track. The trail reveals up to the current
 * playback time via the instanced segment count; geometries are rebuilt only
 * when the flight changes.
 */

import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

import { EARTH_RADIUS } from "../../sim/physics/constants";
import type { Telemetry } from "../../sim/ascent/flight";
import { playbackClock } from "../playbackClock";

const EARTH_RADIUS_KM = EARTH_RADIUS / 1000;

/** ECI (x,y,z) meters -> scene (x, z, -y) kilometers. */
function toScene(out: [number, number, number], x: number, y: number, z: number): void {
  out[0] = x / 1000;
  out[1] = z / 1000;
  out[2] = -y / 1000;
}

export function Trajectory({ telemetry, lowEffects }: { telemetry: Telemetry; lowEffects: boolean }) {
  const size = useThree((s) => s.size);

  const { trail, groundTrack, maxSegments, stride } = useMemo(() => {
    const n = telemetry.sampleCount;
    // Decimate rendering to a bounded point budget (GPU stays fast even for
    // long flights); playback maps time to the nearest rendered point.
    const stride = Math.max(1, Math.ceil(n / 800));
    const positions: number[] = [];
    const colors: number[] = [];
    const ground: number[] = [];
    const v: [number, number, number] = [0, 0, 0];

    const newest = new THREE.Color("#63ddeb");
    const oldest = new THREE.Color("#1a3a4a");
    const c = new THREE.Color();

    for (let i = 0; i < n; i += stride) {
      toScene(v, telemetry.posX[i], telemetry.posY[i], telemetry.posZ[i]);
      positions.push(v[0], v[1], v[2]);
      const age = i / (n - 1);
      c.copy(oldest).lerp(newest, age * age);
      colors.push(c.r, c.g, c.b);

      const r = Math.hypot(telemetry.posX[i], telemetry.posY[i], telemetry.posZ[i]);
      if (r > 0) {
        const scale = (EARTH_RADIUS_KM * 1.002) / r;
        ground.push(v[0] * scale, v[1] * scale, v[2] * scale);
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

    const groundGeom = new THREE.BufferGeometry();
    groundGeom.setAttribute("position", new THREE.Float32BufferAttribute(ground, 3));
    const groundLine = new THREE.Line(
      groundGeom,
      new THREE.LineDashedMaterial({ color: "#3a7a8c", dashSize: 4, gapSize: 4, transparent: true, opacity: 0.6 }),
    );
    groundLine.computeLineDistances();

    const pointCount = positions.length / 3;
    return { trail: trailLine, groundTrack: groundLine, maxSegments: pointCount - 1, stride };
  }, [telemetry]);

  // Dispose replaced geometries and materials so repeated launches don't
  // accumulate GPU resources.
  useEffect(() => {
    return () => {
      trail.geometry.dispose();
      (trail.material as LineMaterial).dispose();
      groundTrack.geometry.dispose();
      (groundTrack.material as THREE.Material).dispose();
    };
  }, [trail, groundTrack]);

  // Keep line resolution in sync with the canvas.
  useFrame(() => {
    const mat = trail.material as LineMaterial;
    mat.resolution.set(size.width, size.height);

    // Reveal the trail up to the playback position (in decimated points).
    const index = Math.min(
      maxSegments,
      Math.max(0, Math.floor(playbackClock.timeS / (0.05 * stride))),
    );
    trail.geometry.instanceCount = lowEffects ? maxSegments : index;
    const groundGeom = groundTrack.geometry as THREE.BufferGeometry;
    groundGeom.setDrawRange(0, lowEffects ? maxSegments + 1 : index + 1);
  });

  return (
    <group>
      <primitive object={trail} />
      <primitive object={groundTrack} />
    </group>
  );
}
