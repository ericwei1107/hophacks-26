/**
 * Coordinate conversion between the simulation's frames and the renderer's.
 *
 * The sim works in an Earth-centered, right-handed frame with +z toward the
 * north pole. Renderers are handed a *local* frame instead: origin at the
 * rocket, +Y radially outward, +X east, +Z north — and left-handed, because
 * that is what Unity uses.
 *
 * The bridge between them is the local east-north-up frame. Going from
 * east-north-up (E, N, U) to renderer axes is the swap (x, y, z) = (E, U, N).
 * That swap is a reflection: it flips handedness. A rotation therefore cannot
 * simply be relabelled — conjugating by a reflection negates the rotation
 * angle, which is why the quaternion conversion flips the sign of the vector
 * part as well as swapping its last two components.
 *
 * Every conversion lives here. C# only applies the values it is given.
 */

import { OMEGA_EARTH } from "../sim/physics/constants";
import type { Quat, Vec3 } from "./types";

/** East-north-up to renderer axes: (E, N, U) → (E, U, N). */
export function enuVecToRenderer(e: number, n: number, u: number): Vec3 {
  return [e, u, n];
}

/**
 * The same axis swap applied to a rotation. Conjugating a rotation by the
 * reflection (x, y, z) → (x, z, y) maps its axis the same way and negates its
 * angle, so (qx, qy, qz, qw) → (−qx, −qz, −qy, qw).
 */
export function enuQuatToRenderer(q: Quat): Quat {
  return [-q[0], -q[2], -q[1], q[3]];
}

// ---------------------------------------------------------------------------
// Small quaternion helpers (no three.js here — this module stays pure).
// ---------------------------------------------------------------------------

export function quatIdentity(): Quat {
  return [0, 0, 0, 1];
}

export function quatNormalize(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  if (n < 1e-12) {
    return quatIdentity();
  }
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** Rotate a vector by a quaternion (right-handed convention). */
export function quatRotate(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  // t = 2 * (q_vec × v); result = v + w * t + q_vec × t
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

export function quatMultiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const n = Math.hypot(axis[0], axis[1], axis[2]);
  if (n < 1e-12) {
    return quatIdentity();
  }
  const s = Math.sin(angle / 2) / n;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

/**
 * Shortest rotation taking unit vector `from` onto unit vector `to`. Used to
 * turn the sim's attitude *direction* into the renderer's attitude quaternion:
 * the body's nose axis is +Y, and the sim says where that axis points.
 */
export function quatFromUnitVectors(from: Vec3, to: Vec3): Quat {
  const dot = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
  if (dot > 1 - 1e-9) {
    return quatIdentity();
  }
  if (dot < -1 + 1e-9) {
    // Antiparallel: any perpendicular axis gives a valid half turn. Pick the
    // one furthest from `from` so the cross product is well conditioned.
    const axis: Vec3 =
      Math.abs(from[0]) < Math.abs(from[2]) ? [0, from[2], -from[1]] : [from[1], -from[0], 0];
    return quatFromAxisAngle(axis, Math.PI);
  }
  const axis: Vec3 = [
    from[1] * to[2] - from[2] * to[1],
    from[2] * to[0] - from[0] * to[2],
    from[0] * to[1] - from[1] * to[0],
  ];
  return quatNormalize([axis[0], axis[1], axis[2], 1 + dot]);
}

/**
 * Quaternion of a rotation given by its matrix rows. `rows[i]` is the i-th row
 * of a proper orthogonal 3×3 matrix. Shepperd's method: pick the largest
 * diagonal term so the divisor never approaches zero.
 */
export function quatFromMatrixRows(rows: [Vec3, Vec3, Vec3]): Quat {
  const [[m00, m01, m02], [m10, m11, m12], [m20, m21, m22]] = rows;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return quatNormalize([(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4]);
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return quatNormalize([s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]);
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return quatNormalize([(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s]);
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return quatNormalize([(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s]);
}

// ---------------------------------------------------------------------------
// Local frame construction
// ---------------------------------------------------------------------------

/**
 * The east-north-up basis at a point, with each basis vector expressed in the
 * sim's Earth-centered frame. Degenerate exactly at the poles, where east is
 * undefined; there we fall back to the prime meridian so nothing turns NaN.
 */
export interface LocalBasis {
  east: Vec3;
  north: Vec3;
  up: Vec3;
  /** Distance from the Earth's center, m. */
  radius: number;
}

export function localBasis(position: ArrayLike<number>): LocalBasis {
  const [x, y, z] = [position[0], position[1], position[2]];
  const radius = Math.hypot(x, y, z);
  if (radius < 1e-6) {
    return { east: [0, 1, 0], north: [0, 0, 1], up: [1, 0, 0], radius: 0 };
  }
  const up: Vec3 = [x / radius, y / radius, z / radius];
  // east = ẑ × up, normalized; ẑ = (0, 0, 1).
  let ex = -up[1];
  let ey = up[0];
  const eLen = Math.hypot(ex, ey);
  let east: Vec3;
  if (eLen < 1e-9) {
    east = [0, 1, 0]; // at a pole: choose the meridian through longitude 0
  } else {
    ex /= eLen;
    ey /= eLen;
    east = [ex, ey, 0];
  }
  const north: Vec3 = [
    up[1] * east[2] - up[2] * east[1],
    up[2] * east[0] - up[0] * east[2],
    up[0] * east[1] - up[1] * east[0],
  ];
  return { east, north, up, radius };
}

/** Express an Earth-centered vector in renderer axes at the given basis. */
export function toLocal(basis: LocalBasis, v: ArrayLike<number>): Vec3 {
  const e = basis.east[0] * v[0] + basis.east[1] * v[1] + basis.east[2] * v[2];
  const n = basis.north[0] * v[0] + basis.north[1] * v[1] + basis.north[2] * v[2];
  const u = basis.up[0] * v[0] + basis.up[1] * v[1] + basis.up[2] * v[2];
  return enuVecToRenderer(e, n, u);
}

// ---------------------------------------------------------------------------
// Sub-point
// ---------------------------------------------------------------------------

/**
 * Latitude and longitude beneath a position, in degrees. The sim's frame is
 * inertial and coincides with the Earth-fixed frame at t = 0, so longitude is
 * the inertial longitude minus the Earth's rotation since liftoff. At t = 0
 * this returns the launch site exactly.
 */
export function subPointDeg(position: ArrayLike<number>, tSinceLiftoffS: number): {
  latDeg: number;
  lonDeg: number;
} {
  const [x, y, z] = [position[0], position[1], position[2]];
  const radius = Math.hypot(x, y, z);
  if (radius < 1e-6) {
    return { latDeg: 0, lonDeg: 0 };
  }
  const latDeg = (Math.asin(Math.max(-1, Math.min(1, z / radius))) * 180) / Math.PI;
  const inertialLon = Math.atan2(y, x);
  const lon = inertialLon - OMEGA_EARTH * tSinceLiftoffS;
  return { latDeg, lonDeg: wrapDegrees((lon * 180) / Math.PI) };
}

/** Wrap to (−180, 180]. */
export function wrapDegrees(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/**
 * Orientation of the Earth mesh in the rocket's local renderer frame.
 *
 * The mesh convention is fixed and explicit: mesh +Y is the north pole, and
 * longitude 0 on the equator lies on mesh +X. In the Earth-fixed frame that is
 * the same east-north-up-style axis swap used everywhere else, so the Earth's
 * rotation into the local frame is the transpose of the local basis (expressed
 * Earth-fixed), conjugated by that swap.
 */
export function earthMeshQuat(latDeg: number, lonDeg: number): Quat {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const cl = Math.cos(lat);
  const sl = Math.sin(lat);
  const co = Math.cos(lon);
  const so = Math.sin(lon);
  // Basis vectors at the sub-point, expressed Earth-fixed.
  const east: Vec3 = [-so, co, 0];
  const north: Vec3 = [-sl * co, -sl * so, cl];
  const up: Vec3 = [cl * co, cl * so, sl];
  // Rows of B^T are the basis vectors: it maps Earth-fixed into east-north-up.
  const q = quatFromMatrixRows([east, north, up]);
  return enuQuatToRenderer(q);
}

/**
 * Orientation of the sim's inertial frame in the local renderer frame: the
 * rotation that takes an Earth-centered direction to renderer axes.
 */
export function inertialFrameQuat(basis: LocalBasis): Quat {
  return enuQuatToRenderer(quatFromMatrixRows([basis.east, basis.north, basis.up]));
}
