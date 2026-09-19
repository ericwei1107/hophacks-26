/**
 * Textured Earth with a limb atmosphere that only draws when the camera is
 * outside the shell. Interior views use the globe albedo (oceans/land) so the
 * pad isn't a featureless navy plane against a matching sky.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const EARTH_RADIUS_KM = 6371;

function ellipse(
  ctx: CanvasRenderingContext2D,
  lon: number,
  lat: number,
  wDeg: number,
  hDeg: number,
  w: number,
  h: number,
) {
  const x = ((lon + 180) / 360) * w;
  const y = ((90 - lat) / 180) * h;
  ctx.beginPath();
  ctx.ellipse(x, y, (wDeg / 360) * w, (hDeg / 180) * h, 0, 0, Math.PI * 2);
  ctx.fill();
  // Wrap near the dateline so Eurasia/Alaska don't clip.
  if (x < w * 0.08 || x > w * 0.92) {
    ctx.beginPath();
    ctx.ellipse(x + (x < w * 0.5 ? w : -w), y, (wDeg / 360) * w, (hDeg / 180) * h, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function buildAlbedo(): THREE.CanvasTexture {
  const w = 1024;
  const h = 512;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const ocean = ctx.createLinearGradient(0, 0, 0, h);
  ocean.addColorStop(0, "#8ec4e0");
  ocean.addColorStop(0.15, "#1a72a8");
  ocean.addColorStop(0.5, "#0f5a8c");
  ocean.addColorStop(0.85, "#1a72a8");
  ocean.addColorStop(1, "#c5dce8");
  ctx.fillStyle = ocean;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "#2f9a4a";
  ellipse(ctx, -100, 45, 50, 26, w, h); // N America
  ellipse(ctx, -58, -12, 20, 28, w, h); // S America
  ellipse(ctx, 22, 8, 24, 32, w, h); // Africa
  ellipse(ctx, 75, 50, 72, 26, w, h); // Eurasia
  ellipse(ctx, 135, -25, 20, 12, w, h); // Australia
  ctx.fillStyle = "#c2a36b";
  ellipse(ctx, 25, 22, 16, 9, w, h); // Sahara
  ellipse(ctx, -108, 38, 16, 7, w, h); // W US

  // The reference pad launches from 0, 0 — the Gulf of Guinea. Longitude 0 is
  // fixed at mesh +X by the Earth mesh convention, so that patch of the map is
  // directly under the rocket and has to be water, not the edge of Africa.
  ctx.fillStyle = "#0f5a8c";
  ellipse(ctx, -4, -4, 16, 16, w, h);
  ctx.fillStyle = "#e8eef4";
  ctx.fillRect(0, 0, w, h * 0.08);
  ctx.fillRect(0, h * 0.92, w, h * 0.08);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.wrapS = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

function buildClouds(): THREE.CanvasTexture {
  const w = 1024;
  const h = 512;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * w;
    const y = (0.15 + Math.random() * 0.7) * h;
    const rw = 20 + Math.random() * 70;
    const rh = 8 + Math.random() * 18;
    ctx.fillStyle = `rgba(255,255,255,${0.15 + Math.random() * 0.28})`;
    ctx.beginPath();
    ctx.ellipse(x, y, rw, rh, 0, 0, Math.PI * 2);
    ctx.fill();
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

export function Earth() {
  const atmosphereRef = useRef<THREE.Mesh>(null);
  const cloudsRef = useRef<THREE.Mesh>(null);
  const earthWorld = useMemo(() => new THREE.Vector3(), []);

  const albedo = useMemo(() => buildAlbedo(), []);
  const clouds = useMemo(() => buildClouds(), []);

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
      albedo.dispose();
      clouds.dispose();
      atmosphereMaterial.dispose();
    };
  }, [albedo, clouds, atmosphereMaterial]);

  useFrame(({ camera }) => {
    const mesh = atmosphereRef.current;
    if (!mesh) {
      return;
    }
    mesh.getWorldPosition(earthWorld);
    const camLen = camera.position.length();
    const globeShot = camLen > 10;
    // Limb / cloud shells are globe-only. Close rocket tracking sits on the
    // horizon; additive atmosphere + lit clouds wash the frame to white.
    mesh.visible = globeShot;
    if (cloudsRef.current) {
      cloudsRef.current.visible = globeShot;
    }
  });

  return (
    <group>
      <mesh>
        <sphereGeometry args={[EARTH_RADIUS_KM, 96, 64]} />
        <meshBasicMaterial map={albedo} />
      </mesh>
      <mesh ref={cloudsRef}>
        <sphereGeometry args={[EARTH_RADIUS_KM * 1.003, 48, 32]} />
        <meshBasicMaterial map={clouds} transparent opacity={0.28} depthWrite={false} />
      </mesh>
      <mesh ref={atmosphereRef} material={atmosphereMaterial} scale={1.025}>
        <sphereGeometry args={[EARTH_RADIUS_KM, 32, 32]} />
      </mesh>
    </group>
  );
}
