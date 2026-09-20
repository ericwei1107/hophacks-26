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
});
