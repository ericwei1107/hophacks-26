/**
 * The launch site: coastal terrain, the pad, its tower and tank farm, and
 * the steam that rolls out of the flame trench at liftoff.
 *
 * It is fixed to the Earth, not to the rocket. The group is a child of the
 * Earth mesh at the launch site's spot on the globe (longitude 0, latitude 0
 * on the mesh's own convention: +X), so as the vehicle climbs and drifts
 * downrange the pad stays where it was — three.js composes the transforms in
 * 64-bit on the CPU, so the site sits under the rocket to the centimetre
 * even though it hangs off a 6371 km parent.
 *
 * Site frame: x east, y up, z south — the same as the three scene at the pad.
 * Everything inside is in metres; the outer group scales to scene km.
 */

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { EARTH_RADIUS } from "../../sim/physics/constants";
import type { RenderFrame } from "../../protocol";
import { M_TO_SCENE } from "../../renderers/threeAxes";
import { fadeEdges, noiseTile, overlayNoise, seededRandom } from "./procedural";

const EARTH_RADIUS_KM = EARTH_RADIUS / 1000;

/** Radius of the far terrain disc, m. Beyond it the globe texture takes over. */
const TERRAIN_RADIUS_M = 40_000;
/** Radius of the detailed pad-area disc, m. */
const NEAR_RADIUS_M = 640;
/** The coastline runs north-south this far east of the pad, m. */
const COAST_EAST_M = 8_000;

const SCRUB = "#5e6b42";
const SAND = "#b7a97c";
const OCEAN_SHALLOW = "#1f6f98";
const OCEAN_DEEP = "#0f4a78";
const CONCRETE = "#8d8f90";
const ASPHALT = "#4c4f52";

/**
 * Orientation of the site frame on the Earth mesh: east is mesh −Z, up is
 * mesh +X and south is mesh −Y at the (lon 0, lat 0) point.
 */
const SITE_QUAT = (() => {
  const m = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, -1, 0),
  );
  return new THREE.Quaternion().setFromRotationMatrix(m);
})();

/** Draws a wavy coastline: land west of it, ocean east, on a square canvas. */
function paintCoast(ctx: CanvasRenderingContext2D, size: number, pxPerM: number, rand: () => number): void {
  const cx = size / 2;
  const coastX = cx + COAST_EAST_M * pxPerM;
  const ocean = ctx.createLinearGradient(coastX, 0, size, 0);
  ocean.addColorStop(0, OCEAN_SHALLOW);
  ocean.addColorStop(0.35, OCEAN_DEEP);
  ocean.addColorStop(1, OCEAN_DEEP);

  const edge = (y: number) =>
    coastX +
    Math.sin(y * 0.0045 + 1.2) * 0.012 * size +
    Math.sin(y * 0.0173 + 0.4) * 0.004 * size +
    Math.sin(y * 0.041) * 0.0015 * size;

  const path = () => {
    ctx.beginPath();
    ctx.moveTo(size, 0);
    for (let y = 0; y <= size; y += 4) {
      ctx.lineTo(edge(y), y);
    }
    ctx.lineTo(size, size);
    ctx.closePath();
  };

  // Beach, then water slightly inset so a sand strip shows.
  ctx.fillStyle = SAND;
  ctx.save();
  ctx.translate(-Math.max(2, 180 * pxPerM), 0);
  path();
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = ocean;
  path();
  ctx.fill();

  // Wet sand / surf line.
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = Math.max(1, 25 * pxPerM);
  ctx.beginPath();
  for (let y = 0; y <= size; y += 4) {
    const x = edge(y);
    if (y === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // A few sandbars offshore.
  for (let i = 0; i < 6; i++) {
    const y = rand() * size;
    const x = edge(y) + (600 + rand() * 1800) * pxPerM;
    ctx.fillStyle = "rgba(180,190,150,0.35)";
    ctx.beginPath();
    ctx.ellipse(x, y, (90 + rand() * 300) * pxPerM, (18 + rand() * 40) * pxPerM, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function buildTerrainTexture(): THREE.CanvasTexture {
  const size = 2048;
  const pxPerM = size / (2 * TERRAIN_RADIUS_M);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rand = seededRandom(4242);

  ctx.fillStyle = SCRUB;
  ctx.fillRect(0, 0, size, size);

  // Vegetation and clearings.
  for (let i = 0; i < 420; i++) {
    const dark = rand() > 0.5;
    ctx.fillStyle = dark ? `rgba(58,72,40,${0.25 + rand() * 0.4})` : `rgba(140,138,96,${0.15 + rand() * 0.3})`;
    ctx.beginPath();
    ctx.ellipse(rand() * size, rand() * size, 8 + rand() * 60, 6 + rand() * 40, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // Wetlands near the coast.
  for (let i = 0; i < 90; i++) {
    const x = size / 2 + (COAST_EAST_M - 1500 - rand() * 9000) * pxPerM;
    ctx.fillStyle = `rgba(40,70,60,${0.2 + rand() * 0.35})`;
    ctx.beginPath();
    ctx.ellipse(x, rand() * size, 10 + rand() * 50, 6 + rand() * 30, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  const tile = noiseTile(256, 17, 4);
  overlayNoise(ctx, size, size, tile, 0.5, "overlay", 1);
  overlayNoise(ctx, size, size, tile, 0.25, "multiply", 3);

  paintCoast(ctx, size, pxPerM, rand);

  // Roads: a crawlerway west from the pad, a north-south highway, a runway.
  const cx = size / 2;
  ctx.strokeStyle = ASPHALT;
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(2, 40 * pxPerM);
  ctx.beginPath();
  ctx.moveTo(cx, cx);
  ctx.lineTo(cx - 6500 * pxPerM, cx + 400 * pxPerM);
  ctx.lineTo(cx - 14000 * pxPerM, cx - 2500 * pxPerM);
  ctx.stroke();
  ctx.lineWidth = Math.max(2, 22 * pxPerM);
  ctx.beginPath();
  ctx.moveTo(cx - 3200 * pxPerM, 0);
  ctx.lineTo(cx - 3400 * pxPerM, size);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 3300 * pxPerM, cx + 3000 * pxPerM);
  ctx.lineTo(cx + 5500 * pxPerM, cx + 4200 * pxPerM);
  ctx.stroke();
  ctx.fillStyle = "#6c6e70";
  ctx.fillRect(cx - 12000 * pxPerM, cx + 5600 * pxPerM, 3200 * pxPerM, Math.max(2, 60 * pxPerM));

  // Industrial area footprints.
  for (let i = 0; i < 26; i++) {
    const x = cx - (4000 + rand() * 9000) * pxPerM;
    const y = cx + (rand() - 0.5) * 12000 * pxPerM;
    ctx.fillStyle = `rgba(150,150,150,${0.5 + rand() * 0.4})`;
    ctx.fillRect(x, y, (60 + rand() * 200) * pxPerM, (40 + rand() * 120) * pxPerM);
  }

  fadeEdges(ctx, size, 0.62);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function buildNearTexture(): THREE.CanvasTexture {
  const size = 1024;
  const pxPerM = size / (2 * NEAR_RADIUS_M);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rand = seededRandom(99);
  const c = size / 2;

  ctx.fillStyle = SCRUB;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 700; i++) {
    ctx.fillStyle = rand() > 0.5 ? `rgba(58,72,40,${0.2 + rand() * 0.4})` : `rgba(150,140,100,${0.1 + rand() * 0.25})`;
    ctx.beginPath();
    ctx.ellipse(rand() * size, rand() * size, 3 + rand() * 18, 2 + rand() * 10, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  const tile = noiseTile(256, 31, 4);
  overlayNoise(ctx, size, size, tile, 0.5, "overlay", 0.5);
  overlayNoise(ctx, size, size, tile, 0.3, "multiply", 2);

  // Cleared sand around the complex.
  ctx.fillStyle = SAND;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.ellipse(c, c, 380 * pxPerM, 330 * pxPerM, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  overlayNoise(ctx, size, size, tile, 0.2, "multiply", 1);

  // Perimeter road and the crawlerway heading west.
  ctx.strokeStyle = ASPHALT;
  ctx.lineWidth = 14 * pxPerM;
  ctx.beginPath();
  ctx.arc(c, c, 260 * pxPerM, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "#a89b78";
  ctx.lineWidth = 42 * pxPerM;
  ctx.beginPath();
  ctx.moveTo(c, c);
  ctx.lineTo(0, c + 60 * pxPerM);
  ctx.stroke();
  ctx.strokeStyle = ASPHALT;
  ctx.lineWidth = 8 * pxPerM;
  ctx.beginPath();
  ctx.moveTo(c + 260 * pxPerM, c);
  ctx.lineTo(size, c - 120 * pxPerM);
  ctx.stroke();

  // Concrete apron with painted markings.
  ctx.fillStyle = CONCRETE;
  ctx.beginPath();
  ctx.arc(c, c, 130 * pxPerM, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#7f8183";
  ctx.beginPath();
  ctx.arc(c, c, 62 * pxPerM, 0, Math.PI * 2);
  ctx.fill();
  overlayNoise(ctx, size, size, tile, 0.18, "multiply", 0.5);
  ctx.strokeStyle = "rgba(255,196,80,0.9)";
  ctx.lineWidth = 1.2 * pxPerM;
  for (const r of [70, 100, 124]) {
    ctx.beginPath();
    ctx.arc(c, c, r * pxPerM, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(c - 130 * pxPerM, c);
  ctx.lineTo(c + 130 * pxPerM, c);
  ctx.moveTo(c, c - 130 * pxPerM);
  ctx.lineTo(c, c + 130 * pxPerM);
  ctx.stroke();
  // Scorch marks either side of the trench.
  ctx.fillStyle = "rgba(20,18,16,0.55)";
  ctx.beginPath();
  ctx.ellipse(c, c - 70 * pxPerM, 18 * pxPerM, 60 * pxPerM, 0, 0, Math.PI * 2);
  ctx.ellipse(c, c + 70 * pxPerM, 18 * pxPerM, 60 * pxPerM, 0, 0, Math.PI * 2);
  ctx.fill();

  // Building pads.
  ctx.fillStyle = "rgba(150,150,150,0.8)";
  ctx.fillRect(c - 640 * pxPerM, c + 170 * pxPerM, 110 * pxPerM, 70 * pxPerM);
  ctx.fillRect(c - 450 * pxPerM, c - 190 * pxPerM, 60 * pxPerM, 50 * pxPerM);
  ctx.fillRect(c + 180 * pxPerM, c - 210 * pxPerM, 40 * pxPerM, 40 * pxPerM);

  fadeEdges(ctx, size, 0.66);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * The site looks the same on every flight, so its textures are painted once
 * per page and kept: a second launch, or a renderer rebuilt for a settings
 * change, must not spend a second repainting 2048-pixel canvases.
 */
const textureCache = new Map<string, THREE.CanvasTexture>();

function cachedTexture(key: string, build: () => THREE.CanvasTexture): THREE.CanvasTexture {
  let tex = textureCache.get(key);
  if (!tex) {
    tex = build();
    textureCache.set(key, tex);
  }
  return tex;
}

function softDisc(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(0.4, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface Puff {
  angle: number;
  speed: number;
  t0: number;
  life: number;
  size: number;
}

/** Steam rolling out of the flame trench, deterministic in flight time. */
function PadSteam({ frameRef }: { frameRef: { current: RenderFrame | null } }) {
  const group = useRef<THREE.Group>(null);
  const texture = useMemo(() => softDisc(), []);
  const puffs = useMemo<Puff[]>(() => {
    const rand = seededRandom(2024);
    const out: Puff[] = [];
    for (let i = 0; i < 36; i++) {
      out.push({
        angle: (i % 2 === 0 ? Math.PI / 2 : -Math.PI / 2) + (rand() - 0.5) * 1.3,
        speed: 16 + rand() * 22,
        t0: -3 + rand() * 11,
        life: 6.5 + rand() * 3,
        size: 8 + rand() * 12,
      });
    }
    return out;
  }, []);
  const materials = useMemo(
    () =>
      puffs.map(
        () =>
          new THREE.SpriteMaterial({
            map: texture,
            color: "#f3f1ec",
            transparent: true,
            opacity: 0,
            depthWrite: false,
          }),
      ),
    [puffs, texture],
  );

  useFrame(() => {
    const frame = frameRef.current;
    const g = group.current;
    if (!g) {
      return;
    }
    if (!frame || frame.altitude > 2500 || frame.t > 22) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const t = frame.t;
    for (let i = 0; i < puffs.length; i++) {
      const p = puffs[i];
      const sprite = g.children[i] as THREE.Sprite;
      const age = t - p.t0;
      const active = age >= 0 && age < p.life && frame.throttle > 0.05;
      sprite.visible = active;
      if (!active) {
        continue;
      }
      const k = age / p.life;
      const spread = p.speed * age * (1 - 0.35 * k);
      sprite.position.set(
        Math.cos(p.angle) * spread,
        3 + 9 * Math.pow(age, 0.6),
        Math.sin(p.angle) * spread,
      );
      const s = p.size + 26 * age;
      sprite.scale.set(s, s * 0.8, 1);
      materials[i].opacity = 0.55 * (1 - k) * (1 - k) * Math.min(1, age * 2);
    }
  });

  return (
    <group ref={group} visible={false}>
      {puffs.map((_, i) => (
        <sprite key={i} material={materials[i]} visible={false} />
      ))}
    </group>
  );
}

function Tower({ height }: { height: number }) {
  const bays = Math.max(4, Math.round(height / 9));
  const grey = "#3b4148";
  const red = "#c0392b";
  return (
    <group position={[-34, 0, -22]}>
      {[
        [-3.5, -3.5],
        [3.5, -3.5],
        [-3.5, 3.5],
        [3.5, 3.5],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, height / 2, z]}>
          <boxGeometry args={[0.7, height, 0.7]} />
          <meshStandardMaterial color={grey} roughness={0.7} metalness={0.5} />
        </mesh>
      ))}
      {Array.from({ length: bays }).map((_, i) => {
        const y = ((i + 1) / bays) * height - 1;
        return (
          <group key={i} position={[0, y, 0]}>
            <mesh>
              <boxGeometry args={[7.6, 0.5, 0.5]} />
              <meshStandardMaterial color={i % 4 === 3 ? red : grey} roughness={0.7} metalness={0.5} />
            </mesh>
            <mesh rotation={[0, Math.PI / 2, 0]}>
              <boxGeometry args={[7.6, 0.5, 0.5]} />
              <meshStandardMaterial color={i % 4 === 3 ? red : grey} roughness={0.7} metalness={0.5} />
            </mesh>
            <mesh>
              <boxGeometry args={[7.2, 0.15, 7.2]} />
              <meshStandardMaterial color="#5a616a" roughness={0.8} metalness={0.3} />
            </mesh>
          </group>
        );
      })}
      {/* Lightning mast and crane on top. */}
      <mesh position={[0, height + 14, 0]}>
        <cylinderGeometry args={[0.15, 0.3, 28, 8]} />
        <meshStandardMaterial color="#d0d3d6" roughness={0.5} metalness={0.6} />
      </mesh>
      <mesh position={[0, height + 28.2, 0]}>
        <sphereGeometry args={[0.5, 8, 8]} />
        <meshStandardMaterial color="#ff3b30" emissive="#ff3b30" emissiveIntensity={2} toneMapped={false} />
      </mesh>
      <mesh position={[9, height + 1.5, 0]}>
        <boxGeometry args={[18, 0.6, 0.6]} />
        <meshStandardMaterial color={red} roughness={0.7} metalness={0.4} />
      </mesh>
    </group>
  );
}

function SwingArm({ height, length, angle }: { height: number; length: number; angle: number }) {
  return (
    <group position={[-34, height, -22]} rotation={[0, angle, 0]}>
      <mesh position={[length / 2, 0, 0]}>
        <boxGeometry args={[length, 1.1, 1.4]} />
        <meshStandardMaterial color="#4a5058" roughness={0.7} metalness={0.5} />
      </mesh>
      <mesh position={[length / 2, -0.9, 0]}>
        <boxGeometry args={[length * 0.9, 0.3, 0.3]} />
        <meshStandardMaterial color="#c0392b" roughness={0.7} metalness={0.4} />
      </mesh>
    </group>
  );
}

function LightningMast({ x, z, height }: { x: number; z: number; height: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[0.4, 1.1, height, 8]} />
        <meshStandardMaterial color="#c9ccd0" roughness={0.6} metalness={0.5} />
      </mesh>
      <mesh position={[0, height + 0.6, 0]}>
        <sphereGeometry args={[0.6, 8, 8]} />
        <meshStandardMaterial color="#ff3b30" emissive="#ff3b30" emissiveIntensity={2} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Structures({ rocketRadius, rocketLength }: { rocketRadius: number; rocketLength: number }) {
  const towerHeight = Math.max(60, rocketLength * 1.15);
  const armAngle = Math.atan2(22, 34); // from the tower toward the pad centre
  const armLength = Math.hypot(34, 22) - rocketRadius - 4.5;
  const mountR = rocketRadius + 1.4;
  const concrete = <meshStandardMaterial color="#9a9c9e" roughness={0.9} metalness={0} />;
  const dark = <meshStandardMaterial color="#2f3134" roughness={0.9} metalness={0.05} />;
  return (
    <group>
      {/* Pad deck with the trench opening under the vehicle. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <ringGeometry args={[rocketRadius * 2.2 + 3, 46, 64, 1]} />
        {concrete}
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -7.5, 0]}>
        <planeGeometry args={[2 * (rocketRadius * 2.2 + 3), 80]} />
        {dark}
      </mesh>
      {[1, -1].map((s) => (
        <mesh key={s} position={[s * (rocketRadius * 2.2 + 3 + 0.6), -3.75, 0]}>
          <boxGeometry args={[1.2, 7.5, 80]} />
          {dark}
        </mesh>
      ))}
      {/* Flame deflector wedge. */}
      <mesh position={[0, -6.2, 0]} rotation={[0, 0, Math.PI / 4]}>
        <boxGeometry args={[4.2, 4.2, 40]} />
        <meshStandardMaterial color="#4a4c50" roughness={0.8} metalness={0.2} />
      </mesh>
      {/* Hold-down mount. */}
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        return (
          <mesh key={i} position={[Math.cos(a) * mountR, 1.2, Math.sin(a) * mountR]}>
            <boxGeometry args={[1.4, 2.4, 1.4]} />
            <meshStandardMaterial color="#5f6368" roughness={0.6} metalness={0.5} />
          </mesh>
        );
      })}
      <mesh position={[0, 0.35, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[mountR, 0.55, 8, 40]} />
        <meshStandardMaterial color="#5f6368" roughness={0.6} metalness={0.5} />
      </mesh>

      <Tower height={towerHeight} />
      <SwingArm height={towerHeight * 0.42} length={armLength} angle={-armAngle} />
      <SwingArm height={towerHeight * 0.82} length={armLength} angle={-armAngle} />
      {[
        [130, 130],
        [-130, 130],
        [130, -130],
        [-130, -130],
      ].map(([x, z], i) => (
        <LightningMast key={i} x={x} z={z} height={towerHeight * 1.25} />
      ))}

      {/* Water tower. */}
      <group position={[118, 0, 70]}>
        <mesh position={[0, 24, 0]}>
          <cylinderGeometry args={[3.2, 3.6, 48, 12]} />
          <meshStandardMaterial color="#e6e6e2" roughness={0.6} metalness={0.2} />
        </mesh>
        <mesh position={[0, 54, 0]}>
          <sphereGeometry args={[9.5, 20, 14]} />
          <meshStandardMaterial color="#f1f1ee" roughness={0.5} metalness={0.2} />
        </mesh>
      </group>
      {/* Tank farm. */}
      <mesh position={[-150, 12.5, -70]}>
        <sphereGeometry args={[12.5, 24, 16]} />
        <meshStandardMaterial color="#f3f3f0" roughness={0.45} metalness={0.3} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[-130 + i * 14, 4, 45]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[3.5, 3.5, 30, 12]} />
          <meshStandardMaterial color="#e9e9e5" roughness={0.5} metalness={0.3} />
        </mesh>
      ))}
      {/* Buildings. */}
      <mesh position={[-585, 11, 205]}>
        <boxGeometry args={[110, 22, 70]} />
        <meshStandardMaterial color="#c7c9cb" roughness={0.8} metalness={0.1} />
      </mesh>
      <mesh position={[-420, 5, -165]}>
        <boxGeometry args={[60, 10, 50]} />
        <meshStandardMaterial color="#b9bbbe" roughness={0.8} metalness={0.1} />
      </mesh>
      <mesh position={[200, 3, -190]}>
        <boxGeometry args={[40, 6, 40]} />
        <meshStandardMaterial color="#b0b2b5" roughness={0.8} metalness={0.1} />
      </mesh>
      {/* Pad floodlights. */}
      {[
        [80, 40],
        [-60, 75],
        [50, -80],
      ].map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 15, 0]}>
            <cylinderGeometry args={[0.35, 0.5, 30, 6]} />
            <meshStandardMaterial color="#9da2a8" roughness={0.6} metalness={0.5} />
          </mesh>
          <mesh position={[0, 30.5, 0]}>
            <boxGeometry args={[3, 1.2, 1.2]} />
            <meshStandardMaterial color="#fff2cc" emissive="#ffd27a" emissiveIntensity={1.5} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export function LaunchSite({
  frameRef,
  lowEffects,
  rocketRadius,
  rocketLength,
  siteRef,
}: {
  frameRef: { current: RenderFrame | null };
  lowEffects: boolean;
  rocketRadius: number;
  rocketLength: number;
  /** Set to the site's origin group, so cameras can find the pad. */
  siteRef: React.RefObject<THREE.Group | null>;
}) {
  const terrain = useMemo(() => cachedTexture("terrain", buildTerrainTexture), []);
  const near = useMemo(() => cachedTexture("near", buildNearTexture), []);
  // The ground is transparent (its rim fades into the globe), so it is drawn
  // before every other transparent object: plumes, steam and labels must
  // paint over it, not under it. The hole in the middle is the flame trench.
  const trenchR = rocketRadius * 2.2 + 3;
  return (
    <group position={[EARTH_RADIUS_KM, 0, 0]} quaternion={SITE_QUAT}>
      <group ref={siteRef} scale={M_TO_SCENE}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.6, 0]} renderOrder={-2}>
          <ringGeometry args={[trenchR, TERRAIN_RADIUS_M, 96, 1]} />
          <meshStandardMaterial map={terrain} transparent roughness={1} metalness={0} depthWrite={false} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.25, 0]} renderOrder={-1}>
          <ringGeometry args={[trenchR, NEAR_RADIUS_M, 64, 1]} />
          <meshStandardMaterial map={near} transparent roughness={1} metalness={0} depthWrite={false} />
        </mesh>
        <Structures rocketRadius={rocketRadius} rocketLength={rocketLength} />
        {!lowEffects && <PadSteam frameRef={frameRef} />}
      </group>
    </group>
  );
}
