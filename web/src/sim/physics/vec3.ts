/**
 * Minimal double-precision 3-vector helpers over Float64Array.
 * Authoritative simulation state uses these; nothing is ever rounded for
 * rendering here.
 */

export type Vec3 = Float64Array;

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return new Float64Array([x, y, z]);
}

export function clone(a: Vec3): Vec3 {
  return new Float64Array(a);
}

export function set(out: Vec3, x: number, y: number, z: number): Vec3 {
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

export function copy(out: Vec3, a: Vec3): Vec3 {
  out[0] = a[0];
  out[1] = a[1];
  out[2] = a[2];
  return out;
}

export function add(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  out[0] = a[0] + b[0];
  out[1] = a[1] + b[1];
  out[2] = a[2] + b[2];
  return out;
}

export function sub(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  out[0] = a[0] - b[0];
  out[1] = a[1] - b[1];
  out[2] = a[2] - b[2];
  return out;
}

export function scale(out: Vec3, a: Vec3, s: number): Vec3 {
  out[0] = a[0] * s;
  out[1] = a[1] * s;
  out[2] = a[2] * s;
  return out;
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  const x = a[1] * b[2] - a[2] * b[1];
  const y = a[2] * b[0] - a[0] * b[2];
  const z = a[0] * b[1] - a[1] * b[0];
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

export function norm(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(out: Vec3, a: Vec3): Vec3 {
  const n = norm(a);
  if (n < 1e-12) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    return out;
  }
  out[0] = a[0] / n;
  out[1] = a[1] / n;
  out[2] = a[2] / n;
  return out;
}

/** Angle between two vectors in radians, robust near 0 and π. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const na = norm(a);
  const nb = norm(b);
  if (na < 1e-12 || nb < 1e-12) {
    return 0;
  }
  const cos = Math.min(1, Math.max(-1, dot(a, b) / (na * nb)));
  return Math.acos(cos);
}

/**
 * Rotate `a` toward `b` by at most `maxAngle` radians, returning the result
 * in `out`. Both must be unit vectors; the result is a unit vector.
 */
export function rotateToward(out: Vec3, a: Vec3, b: Vec3, maxAngle: number): Vec3 {
  if (norm(b) < 1e-9) {
    // No meaningful target: keep the current direction.
    return copy(out, a);
  }
  const angle = angleBetween(a, b);
  if (angle < 1e-9) {
    return copy(out, b);
  }
  const t = Math.min(1, maxAngle / angle);
  // slerp
  const sinAngle = Math.sin(angle);
  const wa = Math.sin((1 - t) * angle) / sinAngle;
  const wb = Math.sin(t * angle) / sinAngle;
  out[0] = wa * a[0] + wb * b[0];
  out[1] = wa * a[1] + wb * b[1];
  out[2] = wa * a[2] + wb * b[2];
  return normalize(out, out);
}
