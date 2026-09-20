/**
 * The Earth: a procedurally painted globe, lit by the scene's sun so it has
 * a day side and a terminator, a drifting cloud layer, and a limb
 * atmosphere that only draws when the camera is far enough out to see it.
 *
 * The albedo is drawn once on a canvas. Continents are ellipses with jittered
 * edges, textured with tileable noise. The launch site sits at longitude 0,
 * latitude 0 on the mesh's own convention, and the map is painted so that
 * point is on a coast: land to the west and north, ocean to the east, which
 * is where an eastbound launch goes.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { noiseTile, overlayNoise, seededRandom } from "./procedural";

const EARTH_RADIUS_KM = 6371;

function ellipse(
  ctx: CanvasRenderingContext2D,
  lon: number,
  lat: number,
  wDeg: number,
  hDeg: number,
  w: number,
  h: number,
  rotation = 0,
) {
  const x = ((lon + 180) / 360) * w;
  const y = ((90 - lat) / 180) * h;
  const rx = (wDeg / 360) * w;
  const ry = (hDeg / 180) * h;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
  ctx.fill();
  // Wrap near the dateline so Eurasia/Alaska don't clip.
  if (x - rx < 0 || x + rx > w) {
    ctx.beginPath();
    ctx.ellipse(x + (x < w * 0.5 ? w : -w), y, rx, ry, rotation, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** An ellipse with an organic edge: the main body plus jittered lobes around its rim. */
function landmass(
  ctx: CanvasRenderingContext2D,
  lon: number,
  lat: number,
  wDeg: number,
  hDeg: number,
  w: number,
  h: number,
  rand: () => number,
) {
  ellipse(ctx, lon, lat, wDeg, hDeg, w, h);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + rand() * 0.3;
    const lobeLon = lon + Math.cos(a) * wDeg * (0.85 + rand() * 0.25);
    const lobeLat = lat + Math.sin(a) * hDeg * (0.85 + rand() * 0.25);
    ellipse(ctx, lobeLon, lobeLat, wDeg * (0.12 + rand() * 0.2), hDeg * (0.12 + rand() * 0.2), w, h, rand() * Math.PI);
  }
}

function buildAlbedo(): THREE.CanvasTexture {
  const w = 2048;
  const h = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const rand = seededRandom(1969);

  const ocean = ctx.createLinearGradient(0, 0, 0, h);
  ocean.addColorStop(0, "#5d8fb3");
  ocean.addColorStop(0.15, "#175f92");
  ocean.addColorStop(0.5, "#0d4a7c");
  ocean.addColorStop(0.85, "#175f92");
  ocean.addColorStop(1, "#7fa6c2");
  ctx.fillStyle = ocean;
  ctx.fillRect(0, 0, w, h);

  // Continental shelves: lighter water hugging the coasts, drawn first.
  ctx.fillStyle = "#1f7aa8";
  const shelves: [number, number, number, number][] = [
    [-100, 45, 56, 30],
    [-58, -12, 25, 32],
    [22, 8, 29, 36],
    [75, 50, 78, 30],
    [135, -25, 25, 16],
  ];
  for (const [lon, lat, wd, hd] of shelves) {
    landmass(ctx, lon, lat, wd, hd, w, h, rand);
  }

  const land = "#4f7a3a";
  ctx.fillStyle = land;
  landmass(ctx, -100, 45, 50, 26, w, h, rand); // N America
  landmass(ctx, -58, -12, 20, 28, w, h, rand); // S America
  landmass(ctx, 22, 8, 24, 32, w, h, rand); // Africa
  landmass(ctx, 75, 50, 72, 26, w, h, rand); // Eurasia
  landmass(ctx, 135, -25, 20, 12, w, h, rand); // Australia
  landmass(ctx, -42, 72, 12, 8, w, h, rand); // Greenland
  landmass(ctx, 140, 36, 4, 8, w, h, rand); // Japan-ish arc

  // Deserts and highlands.
  ctx.fillStyle = "#c2a36b";
  landmass(ctx, 25, 22, 16, 9, w, h, rand); // Sahara
  landmass(ctx, -108, 38, 12, 6, w, h, rand); // W US
  landmass(ctx, 45, 24, 10, 6, w, h, rand); // Arabia
  landmass(ctx, 132, -26, 12, 7, w, h, rand); // Outback
  ctx.fillStyle = "#6f6a52";
  landmass(ctx, 88, 32, 16, 5, w, h, rand); // Himalaya-Tibet
  landmass(ctx, -70, -20, 4, 14, w, h, rand); // Andes
  ctx.fillStyle = "#2f5a2a";
  landmass(ctx, -62, -5, 14, 8, w, h, rand); // Amazon
  landmass(ctx, 20, 0, 12, 7, w, h, rand); // Congo
  landmass(ctx, 100, 60, 60, 10, w, h, rand); // Taiga

  // The launch coast: keep the pad (lon 0, lat 0) on land with the sea to
  // the east and south-east, so the vehicle climbs out over water.
  ctx.fillStyle = "#4f7a3a";
  ellipse(ctx, -6, 3, 9, 8, w, h);
  ctx.fillStyle = "#0f4d80";
  ellipse(ctx, 8.4, -3, 9, 8, w, h);
  ctx.fillStyle = "#1f7aa8";
  ellipse(ctx, 6, -2.5, 6, 5, w, h);

  // Ice caps with ragged edges.
  ctx.fillStyle = "#e9eff3";
  ctx.fillRect(0, 0, w, h * 0.07);
  ctx.fillRect(0, h * 0.93, w, h * 0.07);
  for (let i = 0; i < 60; i++) {
    const lon = rand() * 360 - 180;
    ellipse(ctx, lon, 78 + rand() * 6, 6 + rand() * 10, 2 + rand() * 3, w, h);
    ellipse(ctx, lon, -(78 + rand() * 6), 6 + rand() * 10, 2 + rand() * 3, w, h);
  }

  const tile = noiseTile(256, 5, 4);
  overlayNoise(ctx, w, h, tile, 0.42, "overlay", 1);
  overlayNoise(ctx, w, h, tile, 0.22, "multiply", 4);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

function buildClouds(): THREE.CanvasTexture {
  const w = 2048;
  const h = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const rand = seededRandom(77);
  ctx.clearRect(0, 0, w, h);
  for (let i = 0; i < 260; i++) {
    const x = rand() * w;
    const y = (0.1 + rand() * 0.8) * h;
    const rw = 30 + rand() * 140;
    const rh = 10 + rand() * 30;
    ctx.fillStyle = `rgba(255,255,255,${0.12 + rand() * 0.3})`;
    ctx.beginPath();
    ctx.ellipse(x, y, rw, rh, (rand() - 0.5) * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  // Storm swirls.
  for (let i = 0; i < 14; i++) {
    const x = rand() * w;
    const y = (0.2 + rand() * 0.6) * h;
    for (let k = 0; k < 10; k++) {
      const a = k * 0.7;
      ctx.fillStyle = `rgba(255,255,255,${0.1 + rand() * 0.2})`;
      ctx.beginPath();
      ctx.ellipse(x + Math.cos(a) * k * 9, y + Math.sin(a) * k * 5, 26 + k * 4, 9 + k, a, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

const atmosphereVertex = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const atmosphereFragment = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  void main() {
    #include <logdepthbuf_fragment>
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float facing = max(dot(viewDir, normalize(vNormal)), 0.0);
    float rim = pow(1.0 - facing, 2.8);
    gl_FragColor = vec4(vec3(0.35, 0.72, 1.0) * rim, rim * 0.95);
  }
`;

/**
 * Tileable noise repeated hundreds of times around the globe, multiplied into
 * the albedo in the shader. A 2048-pixel map has nothing to say at the scale
 * of a launch (one texel is 20 km); this is what keeps the ground from
 * turning into a flat sheet of colour as the vehicle climbs.
 */
function buildDetail(): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(noiseTile(256, 11, 4));
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function surfaceMaterial(albedo: THREE.Texture, detail: THREE.Texture): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ map: albedo });
  material.onBeforeCompile = (shader) => {
    shader.uniforms["detailMap"] = { value: detail };
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <map_pars_fragment>", "#include <map_pars_fragment>\nuniform sampler2D detailMap;")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        float detailFine = texture2D(detailMap, vMapUv * vec2(720.0, 360.0)).r;
        float detailCoarse = texture2D(detailMap, vMapUv * vec2(96.0, 48.0)).r;
        diffuseColor.rgb *= mix(0.78, 1.18, detailFine) * mix(0.82, 1.16, detailCoarse);`,
      );
  };
  material.customProgramCacheKey = () => "earth-surface-detail";
  return material;
}

// Painted once per page and kept: the globe is identical on every flight, and
// repainting it for each launch costs a visible pause.
let cachedAlbedo: THREE.CanvasTexture | null = null;
let cachedClouds: THREE.CanvasTexture | null = null;
let cachedDetail: THREE.CanvasTexture | null = null;

export function Earth() {
  const atmosphereRef = useRef<THREE.Mesh>(null);
  const cloudsRef = useRef<THREE.Mesh>(null);

  const albedo = useMemo(() => (cachedAlbedo ??= buildAlbedo()), []);
  const clouds = useMemo(() => (cachedClouds ??= buildClouds()), []);
  const detail = useMemo(() => (cachedDetail ??= buildDetail()), []);
  const surface = useMemo(() => surfaceMaterial(albedo, detail), [albedo, detail]);

  const atmosphereMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: atmosphereVertex,
        fragmentShader: atmosphereFragment,
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    [],
  );

  useEffect(() => {
    return () => {
      surface.dispose();
      atmosphereMaterial.dispose();
    };
  }, [surface, atmosphereMaterial]);

  useFrame(({ camera }) => {
    const mesh = atmosphereRef.current;
    if (!mesh) {
      return;
    }
    const globeShot = camera.position.length() > 10;
    // Limb / cloud shells are globe-only. Close rocket tracking sits on the
    // horizon; additive atmosphere + lit clouds wash the frame to white.
    mesh.visible = globeShot;
    if (cloudsRef.current) {
      cloudsRef.current.visible = globeShot;
    }
  });

  return (
    <group>
      <mesh name="earth-surface" material={surface}>
        <sphereGeometry args={[EARTH_RADIUS_KM, 128, 96]} />
      </mesh>
      <mesh ref={cloudsRef}>
        <sphereGeometry args={[EARTH_RADIUS_KM * 1.003, 64, 48]} />
        <meshLambertMaterial map={clouds} transparent opacity={0.42} depthWrite={false} />
      </mesh>
      <mesh ref={atmosphereRef} material={atmosphereMaterial} scale={1.025}>
        <sphereGeometry args={[EARTH_RADIUS_KM, 48, 32]} />
      </mesh>
    </group>
  );
}
