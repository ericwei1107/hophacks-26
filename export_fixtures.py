"""Export golden fixtures from the Python reference simulation.

The TypeScript port replays these fixtures to prove language parity. Perturbed
cases carry their explicit inputs so the browser never has to reproduce
Python's PRNG draws.

Usage: .venv/bin/python export_fixtures.py
"""

import json
import random
from pathlib import Path

from design import SpacecraftMission
from environment import SpaceWeather
import simulate as s

FIXTURE_DIR = Path(__file__).parent / "fixtures"
MODEL_VERSION = "1.0.0"

REFERENCE_WEATHER = SpaceWeather(
    kp=3.0,
    f107=150.0,
    solar_wind_speed=400.0,
    solar_wind_density=5.0,
    solar_wind_temperature=100_000.0,
)

MISSIONS = {
    "passing": SpacecraftMission(
        mass=750.0, fuel=200.0, lifespan=5.0, target_altitude=500.0,
        target_inclination=51.6, cross_section_area=10.0,
        drag_coefficient=2.2, isp=325.0,
    ),
    "marginal": SpacecraftMission(
        mass=900.0, fuel=120.0, lifespan=5.0, target_altitude=420.0,
        target_inclination=51.6, cross_section_area=14.0,
        drag_coefficient=2.2, isp=300.0,
    ),
    "failing": SpacecraftMission(
        mass=1000.0, fuel=60.0, lifespan=7.0, target_altitude=400.0,
        target_inclination=97.4, cross_section_area=20.0,
        drag_coefficient=2.5, isp=220.0,
    ),
}


def weather_to_dict(weather: SpaceWeather) -> dict:
    return {
        "kp": weather.kp,
        "f107": weather.f107,
        "solar_wind_speed": weather.solar_wind_speed,
        "solar_wind_density": weather.solar_wind_density,
        "solar_wind_temperature": weather.solar_wind_temperature,
    }


def ops_to_dict(ops: s.OperationalDraw) -> dict:
    return {
        "insertion_altitude_error_km": ops.insertion_altitude_error_km,
        "insertion_inclination_error_deg": ops.insertion_inclination_error_deg,
        "cam_scale": ops.cam_scale,
    }


def result_to_dict(result: s.SimulationResult) -> dict:
    return {
        "passed": result.passed,
        "failure_reasons": result.failure_reasons,
        "available_delta_v": result.available_delta_v,
        "required_delta_v": result.required_delta_v,
        "drag_delta_v": result.drag_delta_v,
        "collision_avoidance_delta_v": result.collision_avoidance_delta_v,
        "insertion_delta_v": result.insertion_delta_v,
        "disposal_delta_v": result.disposal_delta_v,
        "propellant_required": result.propellant_required,
        "propellant_remaining": result.propellant_remaining,
        "initial_altitude": result.initial_altitude,
        "final_altitude": result.final_altitude,
        "orbital_decay": result.orbital_decay,
        "average_density": result.average_density,
        "average_drag": result.average_drag,
    }


def envelope(name: str, payload: dict) -> dict:
    return {
        "fixture": name,
        "model_version": MODEL_VERSION,
        "generator": "export_fixtures.py (Python reference)",
        "payload": payload,
    }


def export_weather() -> dict:
    return envelope("reference_weather", {
        "description": "Deterministic reference snapshot bundled with the game.",
        "weather": weather_to_dict(REFERENCE_WEATHER),
    })


def export_missions() -> dict:
    cases = []
    for name, mission in MISSIONS.items():
        result = s.simulate(mission, REFERENCE_WEATHER)
        cases.append({
            "name": name,
            "mission": mission.to_dict(),
            "expected": result_to_dict(result),
        })
    return envelope("missions", {
        "weather": weather_to_dict(REFERENCE_WEATHER),
        "cases": cases,
    })


def export_scalar_helpers() -> dict:
    weather = REFERENCE_WEATHER
    altitudes = [120.0, 150.0, 200.0, 300.0, 400.0, 500.0, 600.0, 850.0, 1500.0]
    inclinations = [0.0, 28.5, 51.6, 90.0, 97.4]

    return envelope("scalar_helpers", {
        "orbital_velocity": [
            {"altitude_km": a, "value": s.orbital_velocity(a)} for a in altitudes
        ],
        "atmospheric_relative_velocity": [
            {"altitude_km": a, "inclination_deg": i, "value": s.atmospheric_relative_velocity(a, i)}
            for a in altitudes for i in inclinations
        ],
        "density": [
            {"altitude_km": a, "inclination_deg": i, "value": s.estimate_atmospheric_density(a, weather, i)}
            for a in altitudes for i in inclinations
        ],
        "disposal_delta_v": [
            {"altitude_km": a, "value": s.estimate_disposal_delta_v(a)} for a in altitudes
        ],
        "collision_avoidance_delta_v": [
            {
                "altitude_km": a,
                "inclination_deg": i,
                "area": area,
                "lifespan": 5.0,
                "cam_scale": 1.0,
                "value": s.estimate_collision_avoidance_delta_v(SpacecraftMission(
                    mass=750.0, fuel=200.0, lifespan=5.0, target_altitude=a,
                    target_inclination=i, cross_section_area=area,
                    drag_coefficient=2.2, isp=325.0,
                )),
            }
            for a in [300.0, 500.0, 800.0] for i in [0.0, 51.6, 97.4] for area in [5.0, 10.0, 20.0]
        ],
        "stationkeeping": [
            {
                "mission": MISSIONS["passing"].to_dict(),
                "altitude_km": a,
                "value": s.estimate_stationkeeping_delta_v(
                    s.replace(MISSIONS["passing"], target_altitude=a), weather
                )[0],
            }
            for a in [300.0, 400.0, 500.0, 600.0]
        ],
    })


def export_perturbed_cases(n: int = 64, seed: int = 42) -> dict:
    """Explicit perturbed inputs -> expected results, for PRNG-free parity."""
    rng = random.Random(seed)
    base = MISSIONS["passing"]
    cases = []
    for index in range(n):
        stressed_mission = s.create_stressed_mission(base, rng)
        stressed_weather = s.create_stressed_weather(REFERENCE_WEATHER, rng)
        stressed_ops = s.create_stressed_ops(rng)
        result = s.simulate(stressed_mission, stressed_weather, stressed_ops)
        cases.append({
            "index": index,
            "mission": stressed_mission.to_dict(),
            "weather": weather_to_dict(stressed_weather),
            "ops": ops_to_dict(stressed_ops),
            "expected": result_to_dict(result),
        })
    return envelope("perturbed_cases", {
        "base_mission": base.to_dict(),
        "base_weather": weather_to_dict(REFERENCE_WEATHER),
        "seed": seed,
        "cases": cases,
    })


def export_corrections() -> dict:
    """Before/after pairs for intentional corrections.

    "before" values are frozen snapshots of the pre-correction Python code;
    "after" values are computed live, so any regression in a corrected path
    breaks the parity tests on both sides.
    """
    failing = MISSIONS["failing"]
    after = s.simulate(failing, REFERENCE_WEATHER)
    return envelope("corrections", {
        "decay_stops_at_reentry_boundary": {
            "description": (
                "Unpowered decay used to overshoot the reentry boundary in "
                "one 7-day step and report negative altitudes. It now stops "
                "at the boundary with a shortened final timestep."
            ),
            "mission": failing.to_dict(),
            "before": {
                "final_altitude": -252.80226690325162,
                "orbital_decay": 652.8022669032516,
                "failure_reasons": [
                    "insufficient_delta_v", "insufficient_propellant",
                    "below_operating_altitude", "orbital_decay",
                ],
            },
            "after": {
                "final_altitude": after.final_altitude,
                "orbital_decay": after.orbital_decay,
                "failure_reasons": after.failure_reasons,
            },
        },
    })


def main() -> None:
    FIXTURE_DIR.mkdir(exist_ok=True)
    exports = {
        "reference_weather.json": export_weather(),
        "missions.json": export_missions(),
        "scalar_helpers.json": export_scalar_helpers(),
        "perturbed_cases.json": export_perturbed_cases(),
        "corrections.json": export_corrections(),
    }
    for filename, data in exports.items():
        path = FIXTURE_DIR / filename
        path.write_text(json.dumps(data, indent=2) + "\n")
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
