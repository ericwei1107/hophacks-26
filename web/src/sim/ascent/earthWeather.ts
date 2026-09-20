/** Ground and lower-atmosphere conditions supplied by the Earth-weather scenario model. */
export interface EarthWeatherConditions {
  temperatureC: number;
  pressureHpa: number;
  relativeHumidityPct: number;
  windSpeedMs: number;
  crosswindMs: number;
  windGustMs: number;
  precipitationMmH: number;
  visibilityKm: number;
  capeJKg: number;
}

export const referenceEarthWeather = (): EarthWeatherConditions => ({
  temperatureC: 15,
  pressureHpa: 1013.25,
  relativeHumidityPct: 50,
  windSpeedMs: 2,
  crosswindMs: 0,
  windGustMs: 4,
  precipitationMmH: 0,
  visibilityKm: 20,
  capeJKg: 0,
});

/**
 * Converts measured pad conditions to the two ascent inputs this solver owns:
 * horizontal wind and a bounded sea-level density multiplier. Gust, rain,
 * visibility, and CAPE stay as operational constraints rather than invented
 * forces; the scenario recognizer surfaces them as launch-commit factors.
 */
export function earthWeatherEffects(weather: EarthWeatherConditions): { windEastMs: number; windNorthMs: number; densityScale: number } {
  const temperatureK = Math.max(200, weather.temperatureC + 273.15);
  const pressureRatio = Math.max(0.7, Math.min(1.3, weather.pressureHpa / 1013.25));
  const temperatureRatio = 288.15 / temperatureK;
  const humidityCorrection = 1 - Math.max(0, Math.min(100, weather.relativeHumidityPct)) * 0.0008;
  return {
    windEastMs: weather.crosswindMs,
    windNorthMs: weather.windSpeedMs,
    densityScale: Math.max(0.8, Math.min(1.2, pressureRatio * temperatureRatio * humidityCorrection)),
  };
}
