import requests
from dataclasses import dataclass
from typing import Optional, Any

BASE_URL = 'https://services.swpc.noaa.gov'

@dataclass
class SpaceWeather:
    # Geomagnetic activity
    kp: Optional[float] = None

    # Solar activity
    f107: Optional[float] = None
    solar_wind_speed: Optional[float] = None       # km/s
    solar_wind_density: Optional[float] = None     # particles/cm^3
    solar_wind_temperature: Optional[float] = None # K

    def validate(self) -> bool:
        values = [
            self.kp,
            self.f107,
            self.solar_wind_speed,
            self.solar_wind_density,
            self.solar_wind_temperature
        ]

        return all(value is not None and value >= 0 for value in values)

def fetch_noaa(endpoint: str) -> Any:
    url = BASE_URL + endpoint
    response = requests.get(url, timeout=10)
    response.raise_for_status()
    return response.json()

def get_kp() -> float:
    data = fetch_noaa('/products/noaa-planetary-k-index.json')
    return float(data[-1]['Kp'])

def get_f107() -> float:
    data = fetch_noaa('/json/f107_cm_flux.json')
    return float(data[0]['flux'])

def get_solar_wind() -> dict:
    data = fetch_noaa('/json/rtsw/rtsw_wind_1m.json')
    latest = data[-1]
    return {
        'speed': float(latest['proton_speed']),
        'density': float(latest['proton_density']),
        'temperature': float(latest['proton_temperature'])
    }

def get_space_weather() -> SpaceWeather:
    solar_wind = get_solar_wind()

    weather = SpaceWeather(
        kp=get_kp(),
        f107=get_f107(),
        solar_wind_speed=solar_wind['speed'],
        solar_wind_density=solar_wind['density'],
        solar_wind_temperature=solar_wind['temperature']
    )

    if not weather.validate():
        raise RuntimeError('NOAA returned invalid space-weather data.')

    return weather

if __name__ == '__main__':
    weather = get_space_weather()

    print(f'Kp: {weather.kp}')
    print(f'F10.7: {weather.f107}')
    print(f'Speed: {weather.solar_wind_speed} km/s')
    print(f'Density: {weather.solar_wind_density} particles/cm³')
    print(f'Temperature: {weather.solar_wind_temperature} K')