import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

import requests

BASE_URL = "https://services.swpc.noaa.gov"


@dataclass
class SpaceWeather:
    kp: Optional[float] = None
    f107: Optional[float] = None
    solar_wind_speed: Optional[float] = None
    solar_wind_density: Optional[float] = None
    solar_wind_temperature: Optional[float] = None

    def validate(self) -> bool:
        values = [
            self.kp,
            self.f107,
            self.solar_wind_speed,
            self.solar_wind_density,
            self.solar_wind_temperature,
        ]
        return all(value is not None and value >= 0 and math.isfinite(value) for value in values)


def fetch_noaa(endpoint: str) -> Any:
    response = requests.get(BASE_URL + endpoint, timeout=10)
    response.raise_for_status()
    return response.json()


def _parse_time(tag: str) -> float | None:
    if not tag or not isinstance(tag, str):
        return None
    text = tag.strip().replace("Z", "+00:00")
    if " " in text and "T" not in text:
        text = text.replace(" ", "T", 1)
    try:
        return datetime.fromisoformat(text).timestamp()
    except ValueError:
        return None


def to_timed_values(data: Any, value_key: str) -> list[tuple[str, float]]:
    if not isinstance(data, list):
        return []
    entries = []
    for row in data:
        if not isinstance(row, dict):
            continue
        tag = row.get("time_tag")
        if not isinstance(tag, str):
            continue
        try:
            value = float(row[value_key])
        except (KeyError, TypeError, ValueError):
            continue
        entries.append((tag, value))
    return entries


def select_latest_valid(entries: list[tuple[str, float]]) -> tuple[str, float] | None:
    """Newest entry with a parseable timestamp and a finite value."""
    best: tuple[str, float] | None = None
    best_time = float("-inf")
    for tag, value in entries:
        if not math.isfinite(value):
            continue
        parsed = _parse_time(tag)
        if parsed is None:
            continue
        if parsed > best_time:
            best_time = parsed
            best = (tag, value)
    return best


def fetch_noaa_snapshot() -> dict[str, Any]:
    kp_json = fetch_noaa("/products/noaa-planetary-k-index.json")
    f107_json = fetch_noaa("/json/f107_cm_flux.json")
    wind_json = fetch_noaa("/json/rtsw/rtsw_wind_1m.json")

    kp = select_latest_valid(to_timed_values(kp_json, "Kp"))
    f107 = select_latest_valid(to_timed_values(f107_json, "flux"))
    speed = select_latest_valid(to_timed_values(wind_json, "proton_speed"))
    density = select_latest_valid(to_timed_values(wind_json, "proton_density"))
    temperature = select_latest_valid(to_timed_values(wind_json, "proton_temperature"))

    if not all((kp, f107, speed, density, temperature)):
        raise RuntimeError("NOAA returned incomplete space-weather data.")

    weather = SpaceWeather(
        kp=kp[1],
        f107=f107[1],
        solar_wind_speed=speed[1],
        solar_wind_density=density[1],
        solar_wind_temperature=temperature[1],
    )
    if not weather.validate():
        raise RuntimeError("NOAA returned invalid space-weather data.")

    timestamps = {
        "kp": kp[0],
        "f107": f107[0],
        "solar_wind_speed": speed[0],
        "solar_wind_density": density[0],
        "solar_wind_temperature": temperature[0],
    }
    now = datetime.now(timezone.utc)
    newest = max(t for t in (_parse_time(tag) for tag in timestamps.values()) if t is not None)
    return {
        "weather": {
            "kp": weather.kp,
            "f107": weather.f107,
            "solar_wind_speed": weather.solar_wind_speed,
            "solar_wind_density": weather.solar_wind_density,
            "solar_wind_temperature": weather.solar_wind_temperature,
        },
        "source": "python",
        "sourceTimestamps": timestamps,
        "retrievedAt": now.isoformat(),
        "freshnessMs": (now.timestamp() - newest) * 1000.0,
    }


def get_space_weather() -> SpaceWeather:
    snapshot = fetch_noaa_snapshot()
    fields = snapshot["weather"]
    weather = SpaceWeather(**fields)
    if not weather.validate():
        raise RuntimeError("NOAA returned invalid space-weather data.")
    return weather
