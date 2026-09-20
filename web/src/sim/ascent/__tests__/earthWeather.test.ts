import { describe, expect, it } from "vitest";

import { referenceConfig } from "../../../domain/config";
import { referenceSnapshot } from "../../orbital/weather";
import { defaultEnvironment } from "../flight";
import { runSerializedFlight, serializeFlightInput } from "../../../workers/serialize";
import { earthWeatherEffects, referenceEarthWeather } from "../earthWeather";

function flyWithWeather(weather = referenceEarthWeather()) {
  return runSerializedFlight(serializeFlightInput(
    referenceConfig(),
    defaultEnvironment(referenceSnapshot()),
    17,
    undefined,
    undefined,
    undefined,
    weather,
  ));
}

function valueAtTime(result: ReturnType<typeof flyWithWeather>, timeS: number, values: Float64Array): number {
  const { tS, sampleCount } = result.telemetry;
  for (let index = 0; index < sampleCount; index += 1) {
    if (tS[index] >= timeS) return values[index];
  }
  throw new Error(`Telemetry does not reach T+${timeS}s`);
}

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

  it("changes the recorded ascent course when the Earth-weather controls change", () => {
    const calm = flyWithWeather();
    const denseCrosswind = flyWithWeather({
      ...referenceEarthWeather(),
      temperatureC: -20,
      pressureHpa: 1050,
      relativeHumidityPct: 0,
      windSpeedMs: 30,
      crosswindMs: 25,
    });

    // These results passed through SerializedFlightInput, which is the same
    // boundary used by the browser worker. A fixed seed isolates weather.
    expect(denseCrosswind.earthWeather).toMatchObject({ crosswindMs: 25, windSpeedMs: 30 });
    expect(denseCrosswind.outcome).not.toBe(calm.outcome);
    expect(denseCrosswind.maxQPa).toBeGreaterThan(calm.maxQPa);
    expect(valueAtTime(denseCrosswind, 40, denseCrosswind.telemetry.posX))
      .not.toBeCloseTo(valueAtTime(calm, 40, calm.telemetry.posX), 4);
  });
});
