/**
 * Sky dome and stars.
 *
 * The dome is a gradient from horizon haze to a deep zenith, with a warm
 * glow around the sun, that thins to black as the vehicle leaves the
 * atmosphere. The stars are the reverse: invisible at the pad, full by
 * about 80 km. Neither tests or writes depth: the dome is drawn first and
 * everything else paints over it, so the Earth, the Moon and the pad all
 * occlude it without a depth buffer that spans 10 cm to 100 000 km.
 */

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import type { RenderFrame } from "../../protocol";
import { seededRandom } from "./procedural";

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFragment = /* glsl */ `
  uniform float uAltKm;
  uniform vec3 uSun;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float elev = d.y;
    float atm = 1.0 - smoothstep(8.0, 70.0, uAltKm);
    vec3 zenith = vec3(0.12, 0.31, 0.66);
    vec3 horizon = vec3(0.64, 0.77, 0.90);
    vec3 below = vec3(0.50, 0.60, 0.70);
    float h = clamp(elev, 0.0, 1.0);
    vec3 sky = mix(horizon, zenith, pow(h, 0.55));
    sky = mix(below, sky, smoothstep(-0.10, 0.02, elev));
    float s = max(dot(d, normalize(uSun)), 0.0);
    sky += vec3(1.0, 0.86, 0.62) * (pow(s, 220.0) * 1.4 + pow(s, 7.0) * 0.14);
    // Higher up the sky darkens from the zenith first, the way it really does.
    float zenithDark = smoothstep(3.0, 32.0, uAltKm) * 0.6 * h;
    vec3 color = sky * atm * (1.0 - zenithDark);
    gl_FragColor = vec4(color, 1.0);
  }
`;

export function SkyDome({ frameRef }: { frameRef: { current: RenderFrame | null } }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uAltKm: { value: 0 }, uSun: { value: new THREE.Vector3(0, 1, 0) } },
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
      }),
    [],
  );

  useFrame(() => {
    const frame = frameRef.current;
    if (!frame) {
      return;
    }
    material.uniforms["uAltKm"]!.value = Math.max(0, frame.altitude) / 1000;
    (material.uniforms["uSun"]!.value as THREE.Vector3).set(frame.sunDirLocal[0], frame.sunDirLocal[1], -frame.sunDirLocal[2]);
  });

  return (
    <mesh material={material} renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[2500, 32, 16]} />
    </mesh>
  );
}

export function StarField({
  frameRef,
  count,
}: {
  frameRef: { current: RenderFrame | null };
  count: number;
}) {
  const material = useMemo(
    () =>
      new THREE.PointsMaterial({
        size: 1.7,
        sizeAttenuation: false,
        vertexColors: true,
        transparent: false,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    [],
  );
  const geometry = useMemo(() => {
    const rand = seededRandom(31337);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Uniform on the sphere.
      const u = rand() * 2 - 1;
      const phi = rand() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const r = 3000;
      positions[i * 3] = r * s * Math.cos(phi);
      positions[i * 3 + 1] = r * u;
      positions[i * 3 + 2] = r * s * Math.sin(phi);
      const brightness = 0.25 + Math.pow(rand(), 3) * 0.75;
      const warm = rand();
      colors[i * 3] = brightness * (0.85 + 0.15 * warm);
      colors[i * 3 + 1] = brightness * (0.88 + 0.08 * warm);
      colors[i * 3 + 2] = brightness * (1.0 - 0.15 * warm);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return g;
  }, [count]);
  const points = useRef<THREE.Points>(null);

  useFrame(() => {
    const frame = frameRef.current;
    if (!frame || !points.current) {
      return;
    }
    const altKm = Math.max(0, frame.altitude) / 1000;
    const k = Math.min(1, Math.max(0, (altKm - 18) / 60));
    material.opacity = k * k;
    points.current.visible = k > 0.001;
  });

  return <points ref={points} geometry={geometry} material={material} renderOrder={-5} frustumCulled={false} />;
}
