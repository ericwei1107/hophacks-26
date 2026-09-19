import { describe, expect, it } from "vitest";

import { mulberry32, Rng } from "../prng";

describe("mulberry32", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  it("differs across seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it("stays in [0, 1)", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 10_000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("Rng.gauss", () => {
  it("has approximately the requested mean and spread", () => {
    const rng = new Rng(123);
    const samples = Array.from({ length: 20_000 }, () => rng.gauss(5, 2));
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
    expect(mean).toBeCloseTo(5, 0);
    expect(Math.sqrt(variance)).toBeCloseTo(2, 0);
  });

  it("is deterministic for a given seed", () => {
    const a = new Rng(9);
    const b = new Rng(9);
    for (let i = 0; i < 100; i++) {
      expect(a.gauss()).toBe(b.gauss());
    }
  });
});
