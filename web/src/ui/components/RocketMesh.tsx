/**
 * Procedural rocket mesh generated from the same DerivedRocket dimensions
 * the physics uses. Y-up: base at y=0, nose at y=totalLength.
 */

import { memo, useMemo } from "react";
import * as THREE from "three";

import type { DerivedRocket } from "../../domain/derive";

const BODY_COLOR = "#e8e4da";
const TANK1_COLOR = "#d8d4ca";
const TANK2_COLOR = "#c8d4da";
const ENGINE_COLOR = "#3a3f4a";
const FIN_COLOR = "#ff9b54";
const INTERSTAGE_COLOR = "#8a8f9a";

export const RocketMesh = memo(function RocketMesh({
  rocket,
  showMarkers = false,
  thrusting = false,
  throttle = 0,
  stage1Attached = true,
}: {
  rocket: DerivedRocket;
  showMarkers?: boolean;
  thrusting?: boolean;
  throttle?: number;
  /** False after separation: the booster, its fins and the interstage are gone. */
  stage1Attached?: boolean;
}) {
  const d = rocket.diameterM;
  const r = d / 2;
  const total = rocket.totalLengthM;

  // y of a component center: nose (x=0) maps to y=total.
  const yOf = (xStart: number, length: number) => total - (xStart + length / 2);

  const parts = useMemo(() => {
    return rocket.components.filter(
      (c) =>
        c.kind !== "payload" &&
        (stage1Attached ||
          (c.kind !== "stage1-tank" &&
            c.kind !== "stage1-engine" &&
            c.kind !== "interstage" &&
            c.kind !== "fins")),
    );
  }, [rocket, stage1Attached]);

  const finGeoms = useMemo(() => {
    if (rocket.fins.spanM <= 0) {
      return null;
    }
    const { spanM, rootChordM, tipChordM, sweepM } = rocket.fins;
    // Trapezoidal fin: shape plane is (axial down, radial out).
    const shape = new THREE.Shape();
    shape.moveTo(0, 0); // root leading edge (top)
    shape.lineTo(rootChordM, 0); // root trailing edge (bottom)
    shape.lineTo(sweepM + tipChordM, spanM); // tip trailing edge
    shape.lineTo(sweepM, spanM); // tip leading edge
    shape.closePath();
    const geom = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false });
    // Map shape (x=axial down, y=radial out) onto the rocket: shape +x -> world
    // -Y (down), shape +y -> world +X (radial). Rotate -90 deg about Z.
    geom.rotateZ(-Math.PI / 2);
    return geom;
  }, [rocket.fins]);

  return (
    <group>
      {parts.map((c) => {
        const y = yOf(c.xStartM, c.lengthM);
        if (c.kind === "fairing") {
          const coneLen = Math.min(c.lengthM * 0.35, 1.2 * r);
          const cylLen = c.lengthM - coneLen;
          return (
            <group key={c.kind} position={[0, y, 0]}>
              <mesh position={[0, -(c.lengthM / 2) + cylLen / 2, 0]}>
                <cylinderGeometry args={[r, r, cylLen, 24]} />
                <meshStandardMaterial color={BODY_COLOR} roughness={0.6} metalness={0.1} />
              </mesh>
              <mesh position={[0, -(c.lengthM / 2) + cylLen + coneLen / 2, 0]}>
                <coneGeometry args={[r, coneLen, 24]} />
                <meshStandardMaterial color={BODY_COLOR} roughness={0.6} metalness={0.1} />
              </mesh>
            </group>
          );
        }
        const color =
          c.kind === "stage1-tank"
            ? TANK1_COLOR
            : c.kind === "stage2-tank"
              ? TANK2_COLOR
              : c.kind === "interstage"
                ? INTERSTAGE_COLOR
                : ENGINE_COLOR;
        const radius = c.kind.includes("engine") ? r * 0.85 : r;
        return (
          <mesh key={c.kind} position={[0, y, 0]}>
            <cylinderGeometry args={[radius, radius, c.lengthM, 24]} />
            <meshStandardMaterial color={color} roughness={0.5} metalness={0.3} />
          </mesh>
        );
      })}

      {/* Engine nozzles at the base */}
      {stage1Attached && Array.from({ length: rocket.stage1.engineCount }).map((_, i) => {
        const angle = (i / rocket.stage1.engineCount) * Math.PI * 2;
        const nozzleR = rocket.stage1.engine.nozzleDiameterM / 2;
        const ringR = rocket.stage1.engineCount === 1 ? 0 : Math.max(0, r - nozzleR);
        return (
          <mesh
            key={`nozzle-${i}`}
            position={[Math.cos(angle) * ringR, -0.4, Math.sin(angle) * ringR]}
          >
            <coneGeometry args={[nozzleR, 0.8, 16, 1, true]} />
            <meshStandardMaterial color={ENGINE_COLOR} roughness={0.4} metalness={0.6} side={THREE.DoubleSide} />
          </mesh>
        );
      })}

      {/* Fins: four, in a cross at the base */}
      {stage1Attached &&
        finGeoms &&
        [0, 1, 2, 3].map((i) => (
          <group key={`fin-${i}`} rotation={[0, (i * Math.PI) / 2, 0]}>
            <mesh
              geometry={finGeoms}
              position={[r - 0.02, total - rocket.fins.leadingEdgeM, 0]}
            >
              <meshStandardMaterial color={FIN_COLOR} roughness={0.6} metalness={0.2} />
            </mesh>
          </group>
        ))}

      {/* Exhaust glow */}
      {thrusting && throttle > 0 && (
        <mesh position={[0, -1.2 * throttle - 0.5, 0]}>
          <coneGeometry args={[r * 0.7, 2.5 * throttle + 0.5, 16, 1, true]} />
          <meshBasicMaterial color="#ffb066" transparent opacity={0.7} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* CM / CP markers */}
      {showMarkers && (
        <>
          <mesh position={[r + 0.6, total - rocket.centerOfMassM, 0]}>
            <sphereGeometry args={[0.15, 12, 12]} />
            <meshBasicMaterial color="#63ddeb" />
          </mesh>
          <mesh position={[-(r + 0.6), total - rocket.centerOfPressureM, 0]}>
            <sphereGeometry args={[0.15, 12, 12]} />
            <meshBasicMaterial color="#ff9b54" />
          </mesh>
        </>
      )}
    </group>
  );
});
