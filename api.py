"""HTTP surface that puts the original Python mission stack in the game loop.

  python -m uvicorn api:app --reload --port 8000

The browser still flies the rocket. These endpoints own live NOAA weather and
post-insertion analysis (operations, Monte Carlo, emissions, SATCAT crowding).
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from debris import crowding_census
from environment import SpaceWeather
from payload_analysis import (
    PayloadHandoff,
    analyze_launched_payload,
    briefing_configured,
    igel_archive_cached,
    weather_snapshot_from_noaa,
)
from scenario_patterns import recognize_patterns, rocket_catalog

app = FastAPI(title="Apogee Python backend", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class WeatherBody(BaseModel):
    kp: float
    f107: float
    solar_wind_speed: float
    solar_wind_density: float
    solar_wind_temperature: float


class WeatherSnapshotBody(BaseModel):
    weather: WeatherBody
    source: str = "reference"


class HandoffBody(BaseModel):
    payloadWetMassKg: float = Field(gt=0)
    achievedPerigeeKm: float
    achievedApogeeKm: float
    achievedInclinationDeg: float
    stage2PropellantRemainingKg: float = 0
    weather: WeatherSnapshotBody
    seed: int = 0


class AnalyzeRequest(BaseModel):
    handoff: HandoffBody
    runs: int = Field(default=1_000, ge=1, le=10_000)
    sensitivity_runs: int = Field(default=200, ge=1, le=2_000)
    include_briefing: bool = False


class EarthWeatherBody(BaseModel):
    temperature_c: float | None = None
    wind_speed_m_s: float | None = None
    wind_gust_m_s: float | None = None
    crosswind_m_s: float | None = None
    precipitation_mm_h: float | None = None
    visibility_km: float | None = None
    relative_humidity_pct: float | None = None
    cape_j_kg: float | None = None


class PatternRequest(BaseModel):
    weather: WeatherBody
    earth_weather: EarthWeatherBody | None = None


@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "backend": "python",
        "emissionsCached": igel_archive_cached(),
        "briefingConfigured": briefing_configured(),
    }


@app.get("/api/weather")
def weather() -> dict:
    try:
        return weather_snapshot_from_noaa()
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"NOAA unavailable: {error}") from error


@app.get("/api/satcat")
def satcat(altitude_km: float = 400.0, refresh: bool = False, seed: int | None = None) -> dict:
    """Shell census only — never the full catalog."""
    try:
        return crowding_census(altitude_km, force_refresh=refresh, seed=seed)
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"SATCAT unavailable: {error}") from error


@app.get("/api/patterns/catalog")
def pattern_catalog() -> dict:
    return {"modelVersion": "scenario-recognition-v1", "rocketry": rocket_catalog()}


@app.post("/api/patterns/recognize")
def recognize(request: PatternRequest) -> dict:
    earth = request.earth_weather.model_dump(exclude_none=True) if request.earth_weather else None
    return recognize_patterns(SpaceWeather(**request.weather.model_dump()), earth)


@app.post("/api/analyze")
def analyze(request: AnalyzeRequest) -> dict:
    wx = request.handoff.weather.weather
    handoff = PayloadHandoff(
        payload_wet_mass_kg=request.handoff.payloadWetMassKg,
        achieved_perigee_km=request.handoff.achievedPerigeeKm,
        achieved_apogee_km=request.handoff.achievedApogeeKm,
        achieved_inclination_deg=request.handoff.achievedInclinationDeg,
        stage2_propellant_remaining_kg=request.handoff.stage2PropellantRemainingKg,
        weather=SpaceWeather(
            kp=wx.kp,
            f107=wx.f107,
            solar_wind_speed=wx.solar_wind_speed,
            solar_wind_density=wx.solar_wind_density,
            solar_wind_temperature=wx.solar_wind_temperature,
        ),
        seed=request.handoff.seed,
    )
    try:
        return analyze_launched_payload(
            handoff,
            runs=request.runs,
            sensitivity_runs=request.sensitivity_runs,
            include_briefing=request.include_briefing,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("api:app", host="127.0.0.1", port=8000, reload=True)
