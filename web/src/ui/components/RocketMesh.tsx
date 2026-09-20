/**
 * Procedural rocket mesh generated from the same DerivedRocket dimensions
 * the physics uses. Y-up: base at y=0, nose at y=totalLength.
 *
 * Everything here is built from the dimensions in `rocketLayout`, so the
 * vehicle on screen is the vehicle that flew: an ogive fairing, panelled
 * tanks with weld seams and a raceway, a truss interstage with the upper
 * stage's bell hanging inside it, a checkered engine skirt and one bell per
 * engine. `part` picks what to draw: the whole stack, the upper stack that
 * stays attached after separation, or the booster that falls away.
 */

import { memo, useEffect, useMemo } from "react";
import * as THREE from "three";

import type { DerivedRocket } from "../../domain/derive";
import { rocketLayout, type RocketLayout } from "./rocketLayout";

export type RocketPart = "full" | "upper" | "booster";

const RADIAL = 48;
/** Size of one tile of the panel texture on the tank surface, m. */
const PANEL_TILE_M = 1.9;

// ---------------------------------------------------------------------------
// Shared textures and materials. Created once per page; a handful of KB.
// ---------------------------------------------------------------------------

let panelTex: THREE.CanvasTexture | null = null;

function panelTexture(): THREE.CanvasTexture {
  if (panelTex) {
    return panelTex;
  }
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);

  // Faint speckle so flat panels are not perfectly uniform.
  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.02 + rand() * 0.05})`;
    ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 2, 1 + rand() * 2);
  }
  // Light vertical grime streaks.
  for (let i = 0; i < 36; i++) {
    const x = rand() * size;
    ctx.fillStyle = `rgba(0,0,0,${0.015 + rand() * 0.03})`;
    ctx.fillRect(x, 0, 4 + rand() * 18, size);
  }
  // Vertical panel joints and horizontal weld seams.
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  for (const x of [0, size / 4, size / 2, (3 * size) / 4]) {
    ctx.fillRect(x, 0, 2, size);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(x + 2, 0, 1, size);
    ctx.fillStyle = "rgba(0,0,0,0.12)";
  }
  for (const y of [0, size / 2]) {
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    ctx.fillRect(0, y, size, 3);
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fillRect(0, y + 3, size, 1);
    // Rivets along the seam.
    ctx.fillStyle = "rgba(0,0,0,0.10)";
    for (let x = 8; x < size; x += 16) {
      ctx.beginPath();
      ctx.arc(x, y + 9, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  panelTex = tex;
  return tex;
}

interface Materials {
  body: THREE.MeshStandardMaterial;
  bodyDouble: THREE.MeshStandardMaterial;
  tank1: THREE.MeshStandardMaterial;
  tank2: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  bell: THREE.MeshStandardMaterial;
  truss: THREE.MeshStandardMaterial;
  fin: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  checkerDark: THREE.MeshStandardMaterial;
  checkerLight: THREE.MeshStandardMaterial;
  gold: THREE.MeshStandardMaterial;
  panel: THREE.MeshStandardMaterial;
  cm: THREE.MeshBasicMaterial;
  cp: THREE.MeshBasicMaterial;
}

let mats: Materials | null = null;

function materials(): Materials {
  if (mats) {
    return mats;
  }
  const map = panelTexture();
  const painted = (color: string, roughness = 0.5, metalness = 0.12) =>
    new THREE.MeshStandardMaterial({ color, map, roughness, metalness });
  mats = {
    body: painted("#ece8df"),
    bodyDouble: new THREE.MeshStandardMaterial({
      color: "#ece8df",
      map,
      roughness: 0.5,
      metalness: 0.12,
      side: THREE.DoubleSide,
    }),
    tank1: painted("#e2ddd2"),
    tank2: painted("#dfe5ea"),
    dark: new THREE.MeshStandardMaterial({ color: "#23272e", roughness: 0.6, metalness: 0.4 }),
    bell: new THREE.MeshStandardMaterial({
      color: "#8a8e96",
      roughness: 0.32,
      metalness: 0.92,
      side: THREE.DoubleSide,
    }),
    truss: new THREE.MeshStandardMaterial({ color: "#3d424b", roughness: 0.55, metalness: 0.6 }),
    fin: new THREE.MeshStandardMaterial({ color: "#ff8a45", roughness: 0.55, metalness: 0.2 }),
    accent: new THREE.MeshStandardMaterial({ color: "#ff9b54", roughness: 0.5, metalness: 0.2 }),
    checkerDark: new THREE.MeshStandardMaterial({ color: "#14171c", roughness: 0.6, metalness: 0.3 }),
    checkerLight: new THREE.MeshStandardMaterial({ color: "#e9e5dc", roughness: 0.55, metalness: 0.15 }),
    gold: new THREE.MeshStandardMaterial({ color: "#c9a24d", roughness: 0.3, metalness: 0.8 }),
    panel: new THREE.MeshStandardMaterial({ color: "#1b2a4a", roughness: 0.25, metalness: 0.6 }),
    cm: new THREE.MeshBasicMaterial({ color: "#63ddeb" }),
    cp: new THREE.MeshBasicMaterial({ color: "#ff9b54" }),
  };
  return mats;
}

// ---------------------------------------------------------------------------
// Small parts
// ---------------------------------------------------------------------------

/** A cylinder section with the panel texture tiled to real-world size. */
function Tube({
  yBottom,
  length,
  radius,
  radiusTop,
  material,
  tiled = true,
}: {
  yBottom: number;
  length: number;
  radius: number;
  radiusTop?: number;
  material: THREE.Material;
  tiled?: boolean;
}) {
  const geometry = useMemo(() => {
    const g = new THREE.CylinderGeometry(radiusTop ?? radius, radius, length, RADIAL, 1, false);
    if (tiled) {
      const repeatX = Math.max(1, Math.round((2 * Math.PI * radius) / PANEL_TILE_M));
      const repeatY = Math.max(0.25, length / PANEL_TILE_M);
      const uv = g.attributes["uv"] as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, uv.getX(i) * repeatX, uv.getY(i) * repeatY);
      }
      uv.needsUpdate = true;
    }
    return g;
  }, [radius, radiusTop, length, tiled]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} material={material} position={[0, yBottom + length / 2, 0]} />;
}

function Ring({
  y,
  radius,
  tube,
  material,
}: {
  y: number;
  radius: number;
  tube: number;
  material: THREE.Material;
}) {
  return (
    <mesh position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} material={material}>
      <torusGeometry args={[radius, tube, 8, RADIAL]} />
    </mesh>
  );
}

function bellProfile(throatRadius: number, exitRadius: number, length: number): THREE.Vector2[] {
  const n = 16;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const r = throatRadius + (exitRadius - throatRadius) * (1 - Math.pow(1 - t, 1.9));
    pts.push(new THREE.Vector2(r, -t * length));
  }
  return pts;
}

/** An engine bell: a parabolic nozzle hanging from its throat, with a turbopump block above. */
function Bell({
  x,
  z,
  throatY,
  length,
  throatRadius,
  exitRadius,
}: {
  x: number;
  z: number;
  throatY: number;
  length: number;
  throatRadius: number;
  exitRadius: number;
}) {
  const m = materials();
  const points = useMemo(() => bellProfile(throatRadius, exitRadius, length), [throatRadius, exitRadius, length]);
  return (
    <group position={[x, throatY, z]}>
      <mesh material={m.bell}>
        <latheGeometry args={[points, 32]} />
      </mesh>
      <mesh position={[0, 0.18, 0]} material={m.dark}>
        <cylinderGeometry args={[throatRadius * 1.7, throatRadius * 1.15, 0.36, 16]} />
      </mesh>
      {/* Throat ring: hides the open top of the lathe. */}
      <mesh position={[0, 0.0, 0]} rotation={[Math.PI / 2, 0, 0]} material={m.dark}>
        <torusGeometry args={[throatRadius, throatRadius * 0.28, 6, 24]} />
      </mesh>
    </group>
  );
}

function ogiveProfile(radius: number, length: number): THREE.Vector2[] {
  const n = 26;
  const rho = (radius * radius + length * length) / (2 * radius);
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= n; i++) {
    const h = (i / n) * length;
    const x = Math.max(0, Math.sqrt(Math.max(0, rho * rho - h * h)) + radius - rho);
    pts.push(new THREE.Vector2(i === n ? 0 : x, h));
  }
  return pts;
}

/** Tangent-ogive nose cone standing on y = yBase. */
function Ogive({
  yBase,
  radius,
  length,
  material,
  phiStart = 0,
  phiLength = Math.PI * 2,
}: {
  yBase: number;
  radius: number;
  length: number;
  material: THREE.Material;
  phiStart?: number;
  phiLength?: number;
}) {
  const points = useMemo(() => ogiveProfile(radius, length), [radius, length]);
  return (
    <mesh position={[0, yBase, 0]} material={material}>
      <latheGeometry args={[points, 40, phiStart, phiLength]} />
    </mesh>
  );
}

/** Open truss interstage: the upper stage's bell shows through it. */
function Truss({ yBottom, length, radius }: { yBottom: number; length: number; radius: number }) {
  const m = materials();
  const struts = useMemo(() => {
    const n = 12;
    const out: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      out.push([Math.cos(a) * radius * 0.965, Math.sin(a) * radius * 0.965]);
    }
    return out;
  }, [radius]);
  const strutR = Math.max(0.03, radius * 0.022);
  return (
    <group>
      <Ring y={yBottom + strutR} radius={radius * 0.975} tube={strutR * 1.4} material={m.truss} />
      <Ring y={yBottom + length - strutR} radius={radius * 0.975} tube={strutR * 1.4} material={m.truss} />
      {struts.map(([x, z], i) => (
        <mesh key={i} position={[x, yBottom + length / 2, z]} material={m.truss}>
          <cylinderGeometry args={[strutR, strutR, length, 6]} />
        </mesh>
      ))}
    </group>
  );
}

/** Black-and-white quartered engine skirt with a heat shield underneath. */
function Skirt({ yBottom, length, radius }: { yBottom: number; length: number; radius: number }) {
  const m = materials();
  return (
    <group>
      {[0, 1, 2, 3].map((i) => (
        <mesh
          key={i}
          position={[0, yBottom + length / 2, 0]}
          material={i % 2 === 0 ? m.checkerDark : m.checkerLight}
        >
          <cylinderGeometry args={[radius, radius, length, 12, 1, true, (i * Math.PI) / 2, Math.PI / 2]} />
        </mesh>
      ))}
      {/* Heat shield across the base. */}
      <mesh position={[0, yBottom + 0.02, 0]} rotation={[Math.PI / 2, 0, 0]} material={m.dark}>
        <circleGeometry args={[radius, RADIAL]} />
      </mesh>
      <mesh position={[0, yBottom + length - 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} material={m.dark}>
        <circleGeometry args={[radius, RADIAL]} />
      </mesh>
    </group>
  );
}

/** A cable raceway running up the outside of a tank. */
function Raceway({ yBottom, length, radius, angle }: { yBottom: number; length: number; radius: number; angle: number }) {
  const m = materials();
  return (
    <mesh
      position={[Math.cos(angle) * (radius + 0.03), yBottom + length / 2, Math.sin(angle) * (radius + 0.03)]}
      rotation={[0, -angle, 0]}
      material={m.dark}
    >
      <boxGeometry args={[0.09, length, Math.max(0.12, radius * 0.08)]} />
    </mesh>
  );
}

function Fins({ rocket, radius }: { rocket: DerivedRocket; radius: number }) {
  const m = materials();
  const total = rocket.totalLengthM;
  const geometry = useMemo(() => {
    if (rocket.fins.spanM <= 0) {
      return null;
    }
    const { spanM, rootChordM, tipChordM, sweepM } = rocket.fins;
    // Trapezoidal fin: shape plane is (axial down, radial out).
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(rootChordM, 0);
    shape.lineTo(sweepM + tipChordM, spanM);
    shape.lineTo(sweepM, spanM);
    shape.closePath();
    const geom = new THREE.ExtrudeGeometry(shape, {
      depth: 0.08,
      bevelEnabled: true,
      bevelThickness: 0.025,
      bevelSize: 0.03,
      bevelSegments: 2,
    });
    // shape +x -> world -Y (down), shape +y -> world +X (radial).
    geom.rotateZ(-Math.PI / 2);
    geom.translate(0, 0, -0.04);
    return geom;
  }, [rocket.fins]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) {
    return null;
  }
  return (
    <group>
      {[0, 1, 2, 3].map((i) => (
        <group key={i} rotation={[0, (i * Math.PI) / 2, 0]}>
          <mesh geometry={geometry} material={m.fin} position={[radius - 0.05, total - rocket.fins.leadingEdgeM, 0]} />
        </group>
      ))}
    </group>
  );
}

/** The spacecraft inside the fairing: a bus with folded solar arrays. */
function Payload({ layout }: { layout: RocketLayout }) {
  const m = materials();
  const r = layout.radius;
  const busW = r * 0.95;
  const busH = Math.min(layout.fairing.length * 0.42, r * 1.6);
  const y = layout.fairing.yBottom + 0.25;
  return (
    <group position={[0, y, 0]}>
      <mesh position={[0, busH / 2, 0]} material={m.gold}>
        <boxGeometry args={[busW, busH, busW]} />
      </mesh>
      {[1, -1].map((s) => (
        <mesh key={s} position={[s * (busW / 2 + 0.06), busH / 2, 0]} material={m.panel}>
          <boxGeometry args={[0.05, busH * 0.9, busW * 0.85]} />
        </mesh>
      ))}
      <mesh position={[0, busH + 0.12, 0]} material={m.dark}>
        <cylinderGeometry args={[busW * 0.25, busW * 0.32, 0.24, 16]} />
      </mesh>
      <mesh position={[0, -0.02, 0]} material={m.dark}>
        <cylinderGeometry args={[r * 0.6, r * 0.7, 0.2, 24]} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function UpperStack({ layout, fairingOn }: { layout: RocketLayout; fairingOn: boolean }) {
  const m = materials();
  const r = layout.radius;
  const { fairing, stage2Tank, stage2Bay, stage2 } = layout;
  return (
    <group>
      {fairingOn ? (
        <group>
          <Tube yBottom={fairing.yBottom} length={fairing.barrelLength} radius={r} material={m.body} />
          <Ogive yBase={fairing.yBottom + fairing.barrelLength} radius={r} length={fairing.coneLength} material={m.body} />
          {/* Fairing split line. */}
          {[0, Math.PI].map((a) => (
            <mesh
              key={a}
              position={[Math.cos(a) * (r + 0.005), fairing.yBottom + fairing.barrelLength / 2, Math.sin(a) * (r + 0.005)]}
              rotation={[0, -a, 0]}
              material={m.dark}
            >
              <boxGeometry args={[0.02, fairing.barrelLength, 0.05]} />
            </mesh>
          ))}
        </group>
      ) : (
        <Payload layout={layout} />
      )}
      {/* Fairing base ring and the accent band that marks the payload adapter. */}
      <Ring y={fairing.yBottom} radius={r} tube={0.03} material={m.dark} />
      <Tube yBottom={fairing.yBottom - 0.16} length={0.16} radius={r * 1.004} material={m.accent} tiled={false} />

      <Tube yBottom={stage2Tank.yBottom} length={stage2Tank.length} radius={r} material={m.tank2} />
      <Ring y={stage2Tank.yBottom} radius={r} tube={0.025} material={m.dark} />
      <Raceway yBottom={stage2Tank.yBottom} length={stage2Tank.length} radius={r} angle={0.7} />

      <Tube yBottom={stage2Bay.yBottom} length={stage2Bay.length} radius={r * 0.97} material={m.dark} tiled={false} />
      <mesh position={[0, stage2Bay.yBottom + 0.01, 0]} rotation={[Math.PI / 2, 0, 0]} material={m.dark}>
        <circleGeometry args={[r * 0.97, RADIAL]} />
      </mesh>
      <Bell
        x={stage2.slot.x}
        z={stage2.slot.z}
        throatY={stage2.throatY}
        length={stage2.bellLength}
        throatRadius={stage2.throatRadius}
        exitRadius={stage2.nozzleRadius}
      />
    </group>
  );
}

function Booster({ layout, rocket }: { layout: RocketLayout; rocket: DerivedRocket }) {
  const m = materials();
  const r = layout.radius;
  const { interstage, stage1Tank, stage1Bay, stage1 } = layout;
  return (
    <group>
      <Truss yBottom={interstage.yBottom} length={interstage.length} radius={r} />
      <Ring y={interstage.yTop - 0.02} radius={r * 1.002} tube={0.04} material={m.accent} />

      <Tube yBottom={stage1Tank.yBottom} length={stage1Tank.length} radius={r} material={m.tank1} />
      <Ring y={stage1Tank.yTop} radius={r} tube={0.025} material={m.dark} />
      <Ring y={stage1Tank.yBottom} radius={r} tube={0.03} material={m.dark} />
      <Ring y={stage1Tank.yBottom + stage1Tank.length * 0.46} radius={r} tube={0.02} material={m.dark} />
      <Raceway yBottom={stage1Tank.yBottom} length={stage1Tank.length} radius={r} angle={0.7} />
      <Raceway yBottom={stage1Tank.yBottom} length={stage1Tank.length * 0.7} radius={r} angle={Math.PI + 0.9} />

      <Skirt yBottom={stage1Bay.yBottom} length={stage1Bay.length} radius={r * 0.985} />
      {stage1.slots.map((slot, i) => (
        <Bell
          key={i}
          x={slot.x}
          z={slot.z}
          throatY={stage1.throatY}
          length={stage1.bellLength}
          throatRadius={stage1.throatRadius}
          exitRadius={stage1.nozzleRadius}
        />
      ))}
      <Fins rocket={rocket} radius={r} />
    </group>
  );
}

/** One half of the fairing, for the jettison animation. Base at y = 0. */
export function FairingHalf({ layout, side }: { layout: RocketLayout; side: 1 | -1 }) {
  const m = materials();
  const r = layout.radius;
  const start = side === 1 ? 0 : Math.PI;
  return (
    <group>
      <mesh position={[0, layout.fairing.barrelLength / 2, 0]} material={m.bodyDouble}>
        <cylinderGeometry args={[r, r, layout.fairing.barrelLength, 24, 1, true, start, Math.PI]} />
      </mesh>
      <Ogive
        yBase={layout.fairing.barrelLength}
        radius={r}
        length={layout.fairing.coneLength}
        material={m.bodyDouble}
        phiStart={start}
        phiLength={Math.PI}
      />
    </group>
  );
}

// ---------------------------------------------------------------------------

export const RocketMesh = memo(function RocketMesh({
  rocket,
  showMarkers = false,
  stage1Attached = true,
  part,
  fairingOn = true,
}: {
  rocket: DerivedRocket;
  showMarkers?: boolean;
  /** False after separation: the booster, its fins and the interstage are gone. */
  stage1Attached?: boolean;
  /** Which portion of the stack to draw; overrides `stage1Attached`. */
  part?: RocketPart;
  /** False once the fairing has been jettisoned: the payload is exposed. */
  fairingOn?: boolean;
}) {
  const layout = useMemo(() => rocketLayout(rocket), [rocket]);
  const m = materials();
  const which: RocketPart = part ?? (stage1Attached ? "full" : "upper");
  const r = layout.radius;
  const total = layout.totalLength;

  return (
    <group>
      {(which === "full" || which === "upper") && <UpperStack layout={layout} fairingOn={fairingOn} />}
      {(which === "full" || which === "booster") && <Booster layout={layout} rocket={rocket} />}

      {showMarkers && (
        <group>
          <mesh position={[0, total - rocket.centerOfMassM, 0]} rotation={[Math.PI / 2, 0, 0]} material={m.cm}>
            <torusGeometry args={[r + 0.28, 0.035, 6, 48]} />
          </mesh>
          <mesh position={[r + 0.28, total - rocket.centerOfMassM, 0]} material={m.cm}>
            <sphereGeometry args={[0.17, 12, 12]} />
          </mesh>
          <mesh position={[0, total - rocket.centerOfPressureM, 0]} rotation={[Math.PI / 2, 0, 0]} material={m.cp}>
            <torusGeometry args={[r + 0.28, 0.035, 6, 48]} />
          </mesh>
          <mesh position={[-(r + 0.28), total - rocket.centerOfPressureM, 0]} material={m.cp}>
            <sphereGeometry args={[0.17, 12, 12]} />
          </mesh>
        </group>
      )}
    </group>
  );
});
