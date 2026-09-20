/**
 * Live space-weather freeze: Kp, F10.7 and solar wind set thermospheric
 * density above 150 km. This is a launch environment, not a vehicle slider.
 */

import { NarratedText } from "../../narration/NarratedText";
import { ensureWeatherEffects, type WeatherSnapshot } from "../../sim/orbital/weather";

function sourceLabel(snapshot: WeatherSnapshot): string {
  if (snapshot.source === "python") {
    return snapshot.effects?.computedBy === "python" ? "Python NOAA (precomputed)" : "Python NOAA";
  }
  if (snapshot.source === "noaa") {
    return "browser NOAA";
  }
  return "quiet reference snapshot";
}

export function SpaceWeatherPanel({ snapshot }: { snapshot: WeatherSnapshot }) {
  const weather = ensureWeatherEffects(snapshot);
  const effects = weather.effects;
  const w = weather.weather;
  if (!effects) {
    return null;
  }
  const ratio = effects.densityRatioVsReference;
  const heading =
    effects.overallSeverity === "storm"
      ? "Space weather is a launch driver"
      : effects.overallSeverity === "elevated"
        ? "Space weather may affect this launch"
        : "Space weather is a launch input";

  return (
    <section className={`weather-card weather-${effects.overallSeverity}`}>
      <strong>{heading}</strong>
      <NarratedText className="weather-source">
        {sourceLabel(weather)}. High-altitude density is {ratio.toFixed(2)}× the quiet reference. Solar wind is not pad wind.
      </NarratedText>
      <div className="weather-metrics">
        <span>Kp {w.kp?.toFixed(2) ?? "—"}</span>
        <span>F10.7 {w.f107?.toFixed(0) ?? "—"}</span>
        <span>Wind {w.solar_wind_speed?.toFixed(0) ?? "—"} km/s</span>
        <span>n {w.solar_wind_density?.toFixed(1) ?? "—"} /cm³</span>
      </div>
      <p className="weather-causes-label">Other causes that may affect launch</p>
      <ul className="weather-causes">
        {effects.causes.map((cause) => (
          <li key={cause.id} className={`weather-cause ${cause.severity}`}>
            <span className="weather-cause-title">{cause.title}</span>
            <span className="weather-cause-copy">{cause.explanation}</span>
            <span className="weather-cause-evidence">{cause.evidence}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
