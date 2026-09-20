/**
 * Engine plumes and the staging flash, driven by RenderFrames.
 *
 * The plumes live in the stack's own coordinates (meters, base of the full
 * stack at y = 0), so each one starts at its bell's exit plane from
 * `rocketLayout`. That is what keeps the fire under the engines after
 * separation: the booster's plumes switch off and the upper stage's plume
 * switches on at the upper stage's nozzle, not at the old base of the stack.
 *
 * Nothing here advances a clock. Flicker and the flash are functions of the
 * frame's own time, so scrubbing and pausing look right.
 */

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import type { RenderFrame } from "../../protocol";
import type { EngineSlot, RocketLayout } from "./rocketLayout";

/** Atmospheric scale height for the ambient-pressure ratio that widens the plume. */
const SCALE_HEIGHT_M = 7200;

function flameProfile(): THREE.Vector2[] {
  const n = 18;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const r = i === n ? 0 : (0.62 + 0.55 * t) * Math.pow(1 - t, 0.42);
    pts.push(new THREE.Vector2(Math.max(r, 0.001), -t));
  }
  return pts;
}

interface PlumeLook {
  core: THREE.Color;
  mid: THREE.Color;
  outer: THREE.Color;
  midOpacity: number;
  outerOpacity: number;
}

/** Sea-level booster plume: bright, orange and tight. */
const SEA_LEVEL: PlumeLook = {
  core: new THREE.Color("#fff6da").multiplyScalar(2.8),
  mid: new THREE.Color("#ffb347").multiplyScalar(1.7),
  outer: new THREE.Color("#ff6a1a").multiplyScalar(0.9),
  midOpacity: 0.62,
  outerOpacity: 0.34,
};

/** Vacuum plume: pale, translucent and much wider. */
const VACUUM: PlumeLook = {
  core: new THREE.Color("#f2f9ff").multiplyScalar(2.4),
  mid: new THREE.Color("#a9cdff").multiplyScalar(1.3),
  outer: new THREE.Color("#6f9fff").multiplyScalar(0.7),
  midOpacity: 0.4,
  outerOpacity: 0.2,
};

function plumeMaterials(look: PlumeLook) {
  const make = (color: THREE.Color, opacity: number) =>
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
  return { core: make(look.core, 0.95), mid: make(look.mid, look.midOpacity), outer: make(look.outer, look.outerOpacity) };
}

interface Engine {
  slot: EngineSlot;
  stage: 1 | 2;
  exitY: number;
  nozzleRadius: number;
}

export function Exhaust({
  layout,
  frameRef,
  lowEffects,
}: {
  layout: RocketLayout;
  frameRef: { current: RenderFrame | null };
  lowEffects: boolean;
}) {
  const root = useRef<THREE.Group>(null);
  const light = useRef<THREE.PointLight>(null);
  const profile = useMemo(() => flameProfile(), []);
  const seaLevel = useMemo(() => plumeMaterials(SEA_LEVEL), []);
  const vacuum = useMemo(() => plumeMaterials(VACUUM), []);

  const engines = useMemo<Engine[]>(() => {
    const list: Engine[] = layout.stage1.slots.map((slot) => ({
      slot,
      stage: 1,
      exitY: layout.stage1.exitY,
      nozzleRadius: layout.stage1.nozzleRadius,
    }));
    list.push({ slot: layout.stage2.slot, stage: 2, exitY: layout.stage2.exitY, nozzleRadius: layout.stage2.nozzleRadius });
    return list;
  }, [layout]);

  useFrame(() => {
    const group = root.current;
    const frame = frameRef.current;
    if (!group || !frame) {
      return;
    }
    const throttle = frame.throttle;
    const firing = throttle > 0.02;
    const altitude = Math.max(0, frame.altitude);
    const pressureRatio = Math.exp(-altitude / SCALE_HEIGHT_M);
    const t = Math.max(0, frame.t);
    const flicker = 1 + 0.06 * Math.sin(t * 41) + 0.04 * Math.sin(t * 73 + 1.3);
    const widthFlicker = 1 + 0.05 * Math.sin(t * 57 + 0.7);

    for (let i = 0; i < engines.length; i++) {
      const engine = engines[i];
      const g = group.children[i] as THREE.Group | undefined;
      if (!g) {
        continue;
      }
      const active = firing && frame.stage === engine.stage;
      g.visible = active;
      if (!active) {
        continue;
      }
      g.position.set(engine.slot.x, engine.exitY, engine.slot.z);
      const nozzleD = engine.nozzleRadius * 2;
      const expand = 1 + 2.4 * (1 - pressureRatio);
      const length =
        nozzleD * (engine.stage === 1 ? 11 : 7.5) * (0.3 + 0.7 * throttle) * (1 + 1.4 * (1 - pressureRatio)) * flicker;
      const r = engine.nozzleRadius;
      const core = g.children[0] as THREE.Mesh;
      const mid = g.children[1] as THREE.Mesh;
      const outer = g.children[2] as THREE.Mesh;
      const coreW = r * 0.85 * widthFlicker;
      const midW = r * 1.3 * Math.pow(expand, 0.6);
      const outerW = r * 2.0 * expand;
      core.scale.set(coreW, length * 0.82, coreW);
      mid.scale.set(midW, length, midW);
      outer.scale.set(outerW, length * 1.18, outerW);
    }

    if (light.current) {
      const proximity = 1 - Math.min(1, altitude / 6000);
      light.current.visible = firing;
      const exitY = frame.stage === 1 ? layout.stage1.exitY : layout.stage2.exitY;
      light.current.position.set(0, exitY - 6, 0);
      light.current.intensity = firing ? throttle * (0.004 + 0.03 * proximity) : 0;
    }
  });

  return (
    <group ref={root}>
      {engines.map((engine, i) => {
        const m = engine.stage === 1 ? seaLevel : vacuum;
        return (
          <group key={i} visible={false}>
            <mesh material={m.core} frustumCulled={false}>
              <latheGeometry args={[profile, 20]} />
            </mesh>
            <mesh material={m.mid} frustumCulled={false}>
              <latheGeometry args={[profile, 20]} />
            </mesh>
            <mesh material={m.outer} frustumCulled={false}>
              <latheGeometry args={[profile, 20]} />
            </mesh>
          </group>
        );
      })}
      {!lowEffects && (
        <pointLight ref={light} color="#ffb066" intensity={0} distance={0.5} decay={2} visible={false} />
      )}
    </group>
  );
}

/**
 * A short bright burst at the separation plane. Deterministic in flight time,
 * so it replays correctly after a scrub.
 */
export function SeparationFlash({
  layout,
  frameRef,
  separationT,
}: {
  layout: RocketLayout;
  frameRef: { current: RenderFrame | null };
  separationT: number | null;
}) {
  const sphere = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const sphereMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color("#ffd9a8").multiplyScalar(2),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  const ringMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color("#ffb066").multiplyScalar(1.6),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    [],
  );

  useFrame(() => {
    const frame = frameRef.current;
    const s = sphere.current;
    const r = ring.current;
    if (!s || !r) {
      return;
    }
    if (!frame || separationT === null) {
      s.visible = false;
      r.visible = false;
      return;
    }
    const age = frame.t - separationT;
    const duration = 1.4;
    const active = age >= 0 && age < duration;
    s.visible = active;
    r.visible = active;
    if (!active) {
      return;
    }
    const k = age / duration;
    const fade = (1 - k) * (1 - k);
    const d = layout.diameter;
    s.scale.setScalar(d * (0.6 + 6 * k));
    sphereMat.opacity = 0.85 * fade;
    r.scale.setScalar(d * (0.8 + 14 * k));
    ringMat.opacity = 0.6 * fade;
  });

  return (
    <group position={[0, layout.stage2BaseY, 0]}>
      <mesh ref={sphere} material={sphereMat} visible={false}>
        <sphereGeometry args={[1, 16, 12]} />
      </mesh>
      <mesh ref={ring} material={ringMat} rotation={[Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.85, 1, 40]} />
      </mesh>
    </group>
  );
}
