import { describe, expect, it } from "vitest";

import { earthWeatherEffects, referenceEarthWeather } from "../earthWeather";

describe("earth-weather flight inputs", () => {
  it("turns pad weather into bounded density and wind inputs", () => {
    const reference = earthWeatherEffects(referenceEarthWeather());
    const hotLowPressure = earthWeatherEffects({
      ...referenceEarthWeather(),
      temperatureC: 35,
      pressureHpa: 930,
      crosswindMs: 12,
      windSpeedMs: 8,
    });
    expect(hotLowPressure.windEastMs).toBe(12);
    expect(hotLowPressure.windNorthMs).toBe(8);
    expect(hotLowPressure.densityScale).toBeLessThan(reference.densityScale);
    expect(hotLowPressure.densityScale).toBeGreaterThanOrEqual(0.8);
  });
});
