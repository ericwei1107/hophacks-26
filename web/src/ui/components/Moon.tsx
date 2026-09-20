/**
 * Textured Moon: a plain sphere with a procedural albedo (maria + crater
 * speckle), no atmosphere shell and no clouds — unlike Earth, the Moon has
 * neither. Always present in the scene at a range-compressed distance (see
 * LUNAR_MISSION_PLAN.md §6.1); this component only draws the mesh, it does
 * not decide where to place it — the caller positions the enclosing group
 * from `RenderFrame.moon` every frame.
 */

import { useEffect, useMemo } from "react";
import * as THREE from "three";

export const MOON_RADIUS_KM = 1737.4;

function buildAlbedo(): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  // Base regolith gray.
  ctx.fillStyle = "#b8b4ad";
  ctx.fillRect(0, 0, w, h);

  // Maria: darker basaltic plains, roughly where the near-side ones sit.
  ctx.fillStyle = "#6f6a63";
  const maria: [number, number, number, number][] = [
    [-20, 20, 40, 22], // Oceanus Procellarum / Imbrium region, approximate
    [10, 30, 24, 16], // Serenitatis/Tranquillitatis
    [30, 5, 18, 14],
    [-45, -10, 20, 12],
    [55, -25, 16, 10],
  ];
  for (const [lon, lat, wDeg, hDeg] of maria) {
    const x = ((lon + 180) / 360) * w;
    const y = ((90 - lat) / 180) * h;
    ctx.beginPath();
    ctx.ellipse(x, y, (wDeg / 360) * w, (hDeg / 180) * h, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Crater speckle: small circles of varying size and a faint rim highlight.
  let seed = 1337;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 220; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = 1 + rand() * 5;
    ctx.fillStyle = `rgba(60,58,54,${0.25 + rand() * 0.3})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(210,206,198,${0.15 + rand() * 0.2})`;
    ctx.lineWidth = Math.max(0.5, r * 0.3);
    ctx.beginPath();
    ctx.arc(x, y, r * 1.15, 0, Math.PI * 2);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export function Moon() {
  const albedo = useMemo(() => buildAlbedo(), []);

  useEffect(() => {
    return () => {
      albedo.dispose();
    };
  }, [albedo]);

  return (
    <mesh>
      <sphereGeometry args={[MOON_RADIUS_KM, 48, 32]} />
      <meshBasicMaterial map={albedo} />
    </mesh>
  );
}
