import { describe, expect, it } from "vitest";

import { SYNTHETIC_SATCAT, camScaleFromCounts, shellCensus } from "../debris";

describe("SATCAT shell census", () => {
  it("counts a crowded 545 km shell above the 400 km reference", () => {
    const crowded = shellCensus(SYNTHETIC_SATCAT, 545);
    const quiet = shellCensus(SYNTHETIC_SATCAT, 400);
    expect(crowded.counts.total).toBeGreaterThan(quiet.counts.total);
    expect(crowded.counts.debris).toBeGreaterThan(0);
    expect(crowded.cam_scale).toBeGreaterThanOrEqual(quiet.cam_scale);
  });

  it("clips cam_scale", () => {
    expect(camScaleFromCounts(200, 100)).toBe(2.0);
    expect(camScaleFromCounts(10, 100)).toBe(0.4);
  });

  it("applies a small seeded wobble without rewriting the catalog", () => {
    const exact = shellCensus(SYNTHETIC_SATCAT, 400);
    const a = shellCensus(SYNTHETIC_SATCAT, 400, 30, 400, "synthetic fallback", 7);
    const b = shellCensus(SYNTHETIC_SATCAT, 400, 30, 400, "synthetic fallback", 7);
    const other = shellCensus(SYNTHETIC_SATCAT, 400, 30, 400, "synthetic fallback", 99);
    expect(a.cam_scale).toBe(b.cam_scale);
    expect(a.catalog_sigma).toBe(0.0015);
    expect(exact.catalog_sigma).toBe(0);
    expect(Math.abs(a.cam_scale - exact.cam_scale) / exact.cam_scale).toBeLessThan(0.02);
    expect(a.cam_scale).not.toBe(other.cam_scale);
  });
});
