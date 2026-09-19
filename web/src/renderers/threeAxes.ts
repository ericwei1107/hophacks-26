/**
 * Bridging the renderer's local frame into a three.js scene.
 *
 * The frames a renderer is handed are left-handed, because Unity is. three.js
 * is right-handed. Dropping those coordinates straight into a three scene
 * would draw a mirror image — legible, but with the continents flipped and
 * east on the wrong side of the screen.
 *
 * The fix is one more axis map: (x, y, z) → (x, y, −z), so the three scene is
 * east / up / south. Composed with the east-north-up swap the frames already
 * went through, the round trip from east-north-up to three is a *proper*
 * rotation, which is why an ordinary Earth texture lines up with no mirroring.
 *
 * Scene units are kilometres, matching the existing flight scene; the frames
 * are metres.
 */

import * as THREE from "three";

import type { Quat, Vec3 } from "../protocol";

/** Metres in a renderer frame to kilometres in the three scene. */
export const M_TO_SCENE = 0.001;

export function rendererVecToThree(v: Vec3, out: THREE.Vector3): THREE.Vector3 {
  return out.set(v[0], v[1], -v[2]);
}

/** The same in scene units. */
export function rendererMetersToThree(v: Vec3, out: THREE.Vector3): THREE.Vector3 {
  return out.set(v[0] * M_TO_SCENE, v[1] * M_TO_SCENE, -v[2] * M_TO_SCENE);
}

/**
 * The rotation carried by a renderer quaternion, in three's frame. The map
 * above is a reflection, so conjugating by it negates the rotation angle:
 * (x, y, z, w) → (−x, −y, z, w).
 */
export function rendererQuatToThree(q: Quat, out: THREE.Quaternion): THREE.Quaternion {
  return out.set(-q[0], -q[1], q[2], q[3]);
}

/**
 * Bake an Earth-centered position into the scene's inertial-geometry frame,
 * in scene units. Static geometry (trails, ground tracks, markers) is
 * converted once this way and afterwards only moved by a group transform
 * built from `RenderFrame.inertialQuat` and `earthCenterLocal`.
 */
export function eciToInertialSceneKm(
  x: number,
  y: number,
  z: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  // enuVecToRenderer's swap, then the three axis map, then metres to km.
  return out.set(x * M_TO_SCENE, z * M_TO_SCENE, -y * M_TO_SCENE);
}
