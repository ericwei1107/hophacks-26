/**
 * Mission-control Earth: navy oceans (lit by the scene sun for the day/night
 * terminator), procedural cyan graticule, and a thin atmosphere rim. All
 * procedural — no textures, so the bundle stays self-contained. The custom
 * atmosphere shader includes the logarithmic-depth chunks so it composes
 * correctly with the renderer's logarithmic depth buffer.
 */

import { useMemo } from "react";
import * as THREE from "three";

const EARTH_RADIUS_KM = 6371;

/** Graticule as line segments: latitude circles + longitude meridians. */
function buildGraticule(radiusKm: number): THREE.BufferGeometry {
  const points: number[] = [];
  const push = (a: THREE.Vector3, b: THREE.Vector3) => {
    points.push(a.x, a.y, a.z, b.x, b.y, b.z);
  };
  const onSphere = (latDeg: number, lonDeg: number) => {
    const lat = (latDeg * Math.PI) / 180;
    const lon = (lonDeg * Math.PI) / 180;
    return new THREE.Vector3(
      radiusKm * Math.cos(lat) * Math.cos(lon),
      radiusKm * Math.sin(lat),
      radiusKm * Math.cos(lat) * Math.sin(lon),
    );
  };
  const step = 6;
  for (let lat = -75; lat <= 75; lat += 15) {
    for (let lon = 0; lon < 360; lon += step) {
      push(onSphere(lat, lon), onSphere(lat, lon + step));
    }
  }
  for (let lon = 0; lon < 360; lon += 15) {
    for (let lat = -84; lat < 84; lat += step) {
      push(onSphere(lat, lon), onSphere(lat + step, lon));
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  return geom;
}

const atmosphereVertex = /* glsl */ `
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
  #include <logdepthbuf_pars_fragment>
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  void main() {
    #include <logdepthbuf_fragment>
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float rim = pow(1.0 - abs(dot(viewDir, normalize(vNormal))), 3.5);
    gl_FragColor = vec4(vec3(0.24, 0.68, 0.78) * rim, rim * 0.9);
  }
`;

export function Earth() {
  const graticule = useMemo(() => buildGraticule(EARTH_RADIUS_KM * 1.001), []);
  const graticuleLines = useMemo(
    () =>
      new THREE.LineSegments(
        graticule,
        new THREE.LineBasicMaterial({ color: "#2a5a70", transparent: true, opacity: 0.5 }),
      ),
    [graticule],
  );

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

  return (
    <group>
      {/* Ocean sphere: lit by the scene sun, giving the day/night terminator. */}
      <mesh>
        <sphereGeometry args={[EARTH_RADIUS_KM, 48, 48]} />
        <meshStandardMaterial color="#0d2438" roughness={0.95} metalness={0.05} />
      </mesh>
      <primitive object={graticuleLines} />
      <mesh material={atmosphereMaterial} scale={1.025}>
        <sphereGeometry args={[EARTH_RADIUS_KM, 32, 32]} />
      </mesh>
    </group>
  );
}
