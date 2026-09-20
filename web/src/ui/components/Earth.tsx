/**
 * Procedural Earth rendered from LYGIA simplex noise. The surface, moving
 * cloud veil and atmosphere are separate layers so they retain depth and
 * lighting from ground level through the orbit camera.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import type { RenderFrame } from "../../protocol";
// No `?raw`: that returns the file verbatim and leaves the LYGIA
// `#include "/lygia/..."` line for WebGL to choke on. Importing the shader
// normally lets vite-plugin-glsl resolve it. Three.js chunk includes written
// as `#include <common>` are passed through untouched and resolved by three.
import planetVertex from "../shaders/planet.vert";
import earthFragment from "../shaders/earth.frag";
import cloudFragment from "../shaders/clouds.frag";
import atmosphereFragment from "../shaders/atmosphere.frag";

const EARTH_RADIUS_KM = 6371;

interface PlanetUniforms {
  uSunDirection: { value: THREE.Vector3 };
  uTime?: { value: number };
}

export function Earth({
  frameRef,
  lowEffects,
}: {
  frameRef: { current: RenderFrame | null };
  lowEffects: boolean;
}) {
  const atmosphereRef = useRef<THREE.Mesh>(null);
  const cloudsRef = useRef<THREE.Mesh>(null);

  const surfaceMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: planetVertex,
        fragmentShader: earthFragment,
        uniforms: { uSunDirection: { value: new THREE.Vector3(1, 0, 0) } },
      }),
    [],
  );
  const cloudMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: planetVertex,
        fragmentShader: cloudFragment,
        uniforms: {
          uSunDirection: { value: new THREE.Vector3(1, 0, 0) },
          uTime: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
      }),
    [],
  );
  const atmosphereMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: planetVertex,
        fragmentShader: atmosphereFragment,
        uniforms: { uSunDirection: { value: new THREE.Vector3(1, 0, 0) } },
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    [],
  );

  useEffect(() => {
    return () => {
      surfaceMaterial.dispose();
      cloudMaterial.dispose();
      atmosphereMaterial.dispose();
    };
  }, [atmosphereMaterial, cloudMaterial, surfaceMaterial]);

  useFrame(({ camera }) => {
    const frame = frameRef.current;
    if (frame) {
      const [x, y, z] = frame.sunDirLocal;
      const applySun = (material: THREE.ShaderMaterial) => {
        const uniforms = material.uniforms as unknown as PlanetUniforms;
        uniforms.uSunDirection.value.set(x, y, -z).normalize();
      };
      applySun(surfaceMaterial);
      applySun(cloudMaterial);
      applySun(atmosphereMaterial);
      (cloudMaterial.uniforms as unknown as PlanetUniforms).uTime!.value = Math.max(0, frame.t);
      if (cloudsRef.current) {
        cloudsRef.current.rotation.y = Math.max(0, frame.t) * 0.00035;
      }
    }

    const atmosphere = atmosphereRef.current;
    if (!atmosphere) {
      return;
    }
    const globeShot = camera.position.length() > 10;
    atmosphere.visible = globeShot;
    if (cloudsRef.current) {
      cloudsRef.current.visible = globeShot;
    }
  });

  const widthSegments = lowEffects ? 64 : 128;
  const heightSegments = lowEffects ? 48 : 96;

  return (
    <group>
      <mesh material={surfaceMaterial} name="earth-surface">
        <sphereGeometry args={[EARTH_RADIUS_KM, widthSegments, heightSegments]} />
      </mesh>
      <mesh ref={cloudsRef} material={cloudMaterial} name="earth-clouds" scale={1.004} renderOrder={2}>
        <sphereGeometry args={[EARTH_RADIUS_KM, widthSegments, heightSegments]} />
      </mesh>
      <mesh ref={atmosphereRef} material={atmosphereMaterial} name="earth-atmosphere" scale={1.025} renderOrder={3}>
        <sphereGeometry args={[EARTH_RADIUS_KM, lowEffects ? 48 : 96, lowEffects ? 32 : 64]} />
      </mesh>
    </group>
  );
}
