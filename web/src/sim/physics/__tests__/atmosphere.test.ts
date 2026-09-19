import { describe, expect, it } from "vitest";

import { estimateAtmosphericDensity } from "../../orbital/simulate";
import { REFERENCE_WEATHER } from "../../orbital/weather";
import { Atmosphere } from "../atmosphere";

const atmosphere = new Atmosphere(REFERENCE_WEATHER);

describe("standard-atmosphere layer (0–85 km)", () => {
  it("matches sea-level standard values", () => {
    expect(atmosphere.density(0)).toBeCloseTo(1.225, 6);
    expect(atmosphere.pressure(0)).toBeCloseTo(101_325, 0);
  });

  it("matches table values at known altitudes", () => {
    expect(atmosphere.density(11)).toBeCloseTo(0.3648, 5);
    expect(atmosphere.pressure(20)).toBeCloseTo(5529.3, 0);
    expect(atmosphere.density(50)).toBeCloseTo(0.000845, 7);
  });

  it("interpolates between table rows", () => {
    const h = 5.5;
    const expected = Math.exp((Math.log(0.73643) + Math.log(0.66011)) / 2);
    expect(atmosphere.density(h)).toBeCloseTo(expected, 8);
  });

  it("decreases monotonically through the table", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let h = 0; h <= 85; h += 0.5) {
      const density = atmosphere.density(h);
      expect(density).toBeLessThan(previous);
      previous = density;
    }
  });
});

describe("transition layer (85–150 km)", () => {
  it("is continuous at both boundaries", () => {
    const eps = 1e-9;
    expect(atmosphere.density(85 - eps)).toBeCloseTo(atmosphere.density(85 + eps), 12);
    expect(atmosphere.density(150 - eps)).toBeCloseTo(atmosphere.density(150 + eps), 18);
    expect(atmosphere.pressure(85 - eps)).toBeCloseTo(atmosphere.pressure(85 + eps), 6);
  });

  it("decreases monotonically through the transition", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let h = 85; h <= 150; h += 1) {
      const density = atmosphere.density(h);
      expect(density).toBeLessThan(previous);
      previous = density;
    }
  });
});

describe("thermospheric layer (≥150 km)", () => {
  it("matches the preserved weather-sensitive function", () => {
    for (const h of [150, 200, 400, 600]) {
      expect(atmosphere.density(h)).toBe(estimateAtmosphericDensity(h, REFERENCE_WEATHER, 0));
    }
  });
});

describe("robustness", () => {
  it("handles invalid altitudes without NaN", () => {
    expect(atmosphere.density(Number.NaN)).toBe(0);
    expect(atmosphere.pressure(Number.NaN)).toBe(0);
    expect(atmosphere.density(-5)).toBeCloseTo(1.225, 6);
  });

  it("never returns negative density", () => {
    for (let h = 0; h <= 2000; h += 25) {
      expect(atmosphere.density(h)).toBeGreaterThan(0);
      expect(atmosphere.pressure(h)).toBeGreaterThanOrEqual(0);
    }
  });
});
