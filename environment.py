from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

import requests

BASE_URL = "https://services.swpc.noaa.gov"


@dataclass
class SpaceWeather:
    kp: Optional[float] = None
    f107: Optional[float] = None
    solar_wind_speed: Optional[float] = None  # km/s
    solar_wind_density: Optional[float] = None  # particles/cm^3
    solar_wind_temperature: Optional[float] = None  # K

    def validate(self) -> bool:
        values = [
            self.kp,
            self.f107,
            self.solar_wind_speed,
            self.solar_wind_density,
            self.solar_wind_temperature,
        ]
        return all(value is not None and value >= 0 for value in values)


def fetch_noaa(endpoint: str) -> Any:
    response = requests.get(BASE_URL + endpoint, timeout=10)
    response.raise_for_status()
    return response.json()


def _parse_time(tag: str) -> datetime | None:
    text = str(tag).strip()
    if not text:
        return None
    text = text.replace("Z", "+00:00")
    if "T" not in text and " " in text:
        text = text.replace(" ", "T", 1)
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def select_latest_valid(rows: Any, value_key: str) -> tuple[float, str] | None:
    """Newest observation with a parseable timestamp and a finite value."""
    if not isinstance(rows, list):
        return None
    best_value: float | None = None
    best_tag = ""
    best_time: datetime | None = None
    for row in rows:
        if not isinstance(row, dict):
            continue
        tag = row.get("time_tag")
        if not isinstance(tag, str):
            continue
        parsed = _parse_time(tag)
        if parsed is None:
            continue
        try:
            value = float(row[value_key])
        except (KeyError, TypeError, ValueError):
            continue
        if value != value:  # NaN
            continue
        if best_time is None or parsed > best_time:
            best_time = parsed
            best_value = value
            best_tag = tag
    if best_value is None:
        return None
    return best_value, best_tag


def _require(chosen: tuple[float, str] | None, label: str) -> tuple[float, str]:
    if chosen is None:
        raise RuntimeError(f"NOAA returned no valid {label} observation.")
    return chosen


def get_kp() -> float:
    return _require(select_latest_valid(fetch_noaa("/products/noaa-planetary-k-index.json"), "Kp"), "Kp")[0]


def get_f107() -> float:
    return _require(select_latest_valid(fetch_noaa("/json/f107_cm_flux.json"), "flux"), "F10.7")[0]


def get_solar_wind() -> dict:
    data = fetch_noaa("/json/rtsw/rtsw_wind_1m.json")
    speed = _require(select_latest_valid(data, "proton_speed"), "solar-wind speed")
    density = _require(select_latest_valid(data, "proton_density"), "solar-wind density")
    temperature = _require(select_latest_valid(data, "proton_temperature"), "solar-wind temperature")
    return {"speed": speed[0], "density": density[0], "temperature": temperature[0]}


def fetch_noaa_snapshot() -> dict[str, Any]:
    """Live NOAA snapshot in the shape the FastAPI weather endpoint returns."""
    with ThreadPoolExecutor(max_workers=3) as pool:
        kp_data = pool.submit(fetch_noaa, "/products/noaa-planetary-k-index.json").result()
        f107_data = pool.submit(fetch_noaa, "/json/f107_cm_flux.json").result()
        wind_data = pool.submit(fetch_noaa, "/json/rtsw/rtsw_wind_1m.json").result()

    kp = _require(select_latest_valid(kp_data, "Kp"), "Kp")
    f107 = _require(select_latest_valid(f107_data, "flux"), "F10.7")
    speed = _require(select_latest_valid(wind_data, "proton_speed"), "solar-wind speed")
    density = _require(select_latest_valid(wind_data, "proton_density"), "solar-wind density")
    temperature = _require(select_latest_valid(wind_data, "proton_temperature"), "solar-wind temperature")

    weather = SpaceWeather(
        kp=kp[0],
        f107=f107[0],
        solar_wind_speed=speed[0],
        solar_wind_density=density[0],
        solar_wind_temperature=temperature[0],
    )
    if not weather.validate():
        raise RuntimeError("NOAA returned invalid space-weather data.")

    timestamps = {
        "kp": kp[1],
        "f107": f107[1],
        "solar_wind_speed": speed[1],
        "solar_wind_density": density[1],
        "solar_wind_temperature": temperature[1],
    }
    now = datetime.now(timezone.utc)
    newest = max((_parse_time(tag) for tag in timestamps.values()), default=None)
    freshness_ms = None if newest is None else (now - newest).total_seconds() * 1000.0

    return {
        "weather": {
            "kp": weather.kp,
            "f107": weather.f107,
            "solar_wind_speed": weather.solar_wind_speed,
            "solar_wind_density": weather.solar_wind_density,
            "solar_wind_temperature": weather.solar_wind_temperature,
        },
        "source": "noaa",
        "sourceTimestamps": timestamps,
        "retrievedAt": now.isoformat(),
        "freshnessMs": freshness_ms,
    }


def get_space_weather() -> SpaceWeather:
    snapshot = fetch_noaa_snapshot()
    return SpaceWeather(**snapshot["weather"])


if __name__ == "__main__":
    weather = get_space_weather()
    print(f"Kp: {weather.kp}")
    print(f"F10.7: {weather.f107}")
    print(f"Speed: {weather.solar_wind_speed} km/s")
    print(f"Density: {weather.solar_wind_density} particles/cm^3")
    print(f"Temperature: {weather.solar_wind_temperature} K")
