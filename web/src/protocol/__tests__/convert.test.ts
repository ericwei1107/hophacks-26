/**
 * The conversion into renderer axes is a handedness flip, which is exactly the
 * kind of thing that looks right in a still frame and is mirrored in motion.
 * The property below is the real check: rotating then converting must equal
 * converting then rotating.
 */

import { describe, expect, it } from "vitest";

import { mulberry32 } from "../../sim/prng";
import {
  earthMeshQuat,
  enuQuatToRenderer,
  enuVecToRenderer,
  localBasis,
  quatFromMatrixRows,
  quatFromUnitVectors,
  quatNormalize,
  quatRotate,
  subPointDeg,
  toLocal,
  wrapDegrees,
} from "../convert";
import type { Quat, Vec3 } from "../types";

const rng = mulberry32(20260919);

function randomVec(): Vec3 {
  return [rng() * 4 - 2, rng() * 4 - 2, rng() * 4 - 2];
}

function randomQuat(): Quat {
  return quatNormalize([rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1]);
}

function expectVecClose(actual: Vec3, expected: Vec3, tolerance = 1e-9): void {
  for (let i = 0; i < 3; i++) {
    expect(actual[i]).toBeCloseTo(expected[i], Math.round(-Math.log10(tolerance)));
  }
}

describe("axis conversion", () => {
  it("maps east-north-up onto renderer x, y, z", () => {
    expect(enuVecToRenderer(1, 0, 0)).toEqual([1, 0, 0]); // east  -> +X
    expect(enuVecToRenderer(0, 1, 0)).toEqual([0, 0, 1]); // north -> +Z
    expect(enuVecToRenderer(0, 0, 1)).toEqual([0, 1, 0]); // up    -> +Y
  });

  it("commutes with rotation for random vectors and quaternions", () => {
    for (let i = 0; i < 500; i++) {
      const q = randomQuat();
      const v = randomVec();

      const rotatedThenConverted = enuVecToRenderer(...(quatRotate(q, v) as [number, number, number]));
      const convertedThenRotated = quatRotate(
        enuQuatToRenderer(q),
        enuVecToRenderer(v[0], v[1], v[2]),
      );
      expectVecClose(rotatedThenConverted, convertedThenRotated);
    }
  });

  it("keeps quaternions unit length", () => {
    for (let i = 0; i < 50; i++) {
      const q = enuQuatToRenderer(randomQuat());
      expect(Math.hypot(q[0], q[1], q[2], q[3])).toBeCloseTo(1, 12);
    }
  });
});

describe("quaternion helpers", () => {
  it("rotates the nose axis onto the commanded direction", () => {
    for (let i = 0; i < 200; i++) {
      const v = randomVec();
      const n = Math.hypot(v[0], v[1], v[2]);
      if (n < 1e-6) continue;
      const target: Vec3 = [v[0] / n, v[1] / n, v[2] / n];
      const q = quatFromUnitVectors([0, 1, 0], target);
      expectVecClose(quatRotate(q, [0, 1, 0]), target, 1e-8);
    }
  });

  it("handles the antiparallel case without NaN", () => {
    const q = quatFromUnitVectors([0, 1, 0], [0, -1, 0]);
    expectVecClose(quatRotate(q, [0, 1, 0]), [0, -1, 0], 1e-8);
  });

  it("recovers a quaternion from its matrix rows", () => {
    for (let i = 0; i < 200; i++) {
      const q = randomQuat();
      const rows: [Vec3, Vec3, Vec3] = [
        quatRotate(q, [1, 0, 0]),
        quatRotate(q, [0, 1, 0]),
        quatRotate(q, [0, 0, 1]),
      ];
      // Those are the columns of R; the rows of R are the transpose.
      const transposeRows: [Vec3, Vec3, Vec3] = [
        [rows[0][0], rows[1][0], rows[2][0]],
        [rows[0][1], rows[1][1], rows[2][1]],
        [rows[0][2], rows[1][2], rows[2][2]],
      ];
      const recovered = quatFromMatrixRows(transposeRows);
      // q and −q are the same rotation: compare by action, not by components.
      const v = randomVec();
      expectVecClose(quatRotate(recovered, v), quatRotate(q, v), 1e-8);
    }
  });
});

describe("local basis", () => {
  it("is orthonormal and right-handed in the sim frame", () => {
    for (let i = 0; i < 200; i++) {
      const p = randomVec().map((x) => x * 1e6) as Vec3;
      if (Math.hypot(p[0], p[1], p[2]) < 1) continue;
      const b = localBasis(p);
      const dot = (a: Vec3, c: Vec3) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
      expect(dot(b.east, b.east)).toBeCloseTo(1, 9);
      expect(dot(b.north, b.north)).toBeCloseTo(1, 9);
      expect(dot(b.up, b.up)).toBeCloseTo(1, 9);
      expect(dot(b.east, b.north)).toBeCloseTo(0, 9);
      expect(dot(b.east, b.up)).toBeCloseTo(0, 9);
      expect(dot(b.north, b.up)).toBeCloseTo(0, 9);
    }
  });

  it("does not produce NaN at the poles", () => {
    const b = localBasis([0, 0, 6_371_000]);
    for (const v of [b.east, b.north, b.up]) {
      for (const c of v) expect(Number.isFinite(c)).toBe(true);
    }
  });

  it("puts the position itself straight up in renderer axes", () => {
    const p: Vec3 = [4_000_000, 3_000_000, 2_500_000];
    const b = localBasis(p);
    const local = toLocal(b, p);
    expect(local[0]).toBeCloseTo(0, 6);
    expect(local[2]).toBeCloseTo(0, 6);
    expect(local[1]).toBeCloseTo(b.radius, 6);
  });
});

describe("sub-point", () => {
  it("returns the launch site at t = 0", () => {
    const R = 6_371_000;
    const { latDeg, lonDeg } = subPointDeg([R, 0, 0], 0);
    expect(latDeg).toBeCloseTo(0, 9);
    expect(lonDeg).toBeCloseTo(0, 9);
  });

  it("tracks a site that stays fixed to the ground", () => {
    // A point co-rotating with the Earth keeps its longitude.
    const R = 6_371_000;
    const omega = 7.2921159e-5;
    const t = 600;
    const theta = omega * t;
    const p: Vec3 = [R * Math.cos(theta), R * Math.sin(theta), 0];
    const { latDeg, lonDeg } = subPointDeg(p, t);
    expect(latDeg).toBeCloseTo(0, 9);
    expect(lonDeg).toBeCloseTo(0, 9);
  });

  it("wraps longitude into (−180, 180]", () => {
    expect(wrapDegrees(190)).toBeCloseTo(-170, 9);
    expect(wrapDegrees(-190)).toBeCloseTo(170, 9);
    expect(wrapDegrees(180)).toBeCloseTo(180, 9);
  });
});

describe("earth mesh orientation", () => {
  /**
   * Mesh convention: +Y is the north pole and longitude 0 on the equator lies
   * on +X. Applying earthQuat to a mesh point must land it where the renderer
   * expects it — the point under the rocket must come out straight up.
   */
  function meshPoint(latDeg: number, lonDeg: number): Vec3 {
    const lat = (latDeg * Math.PI) / 180;
    const lon = (lonDeg * Math.PI) / 180;
    // Earth-fixed (x east-at-lon0, y, z north) swapped into mesh axes.
    const ef: Vec3 = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
    return [ef[0], ef[2], ef[1]];
  }

  it("puts the sub-point directly above the Earth's center", () => {
    for (const [lat, lon] of [[0, 0], [28.6, -80.6], [-33.9, 151.2], [64, 20], [0, 179]]) {
      const q = earthMeshQuat(lat, lon);
      const rotated = quatRotate(q, meshPoint(lat, lon));
      expectVecClose(rotated, [0, 1, 0], 1e-8);
    }
  });

  it("keeps the north pole in the local north-up plane", () => {
    const q = earthMeshQuat(0, 0);
    const pole = quatRotate(q, [0, 1, 0]); // mesh +Y is the north pole
    expect(pole[0]).toBeCloseTo(0, 9); // nothing to the east
    expect(pole[2]).toBeCloseTo(1, 9); // due north from an equatorial site
  });
});
