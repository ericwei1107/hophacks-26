"""Tests for intentional corrections to the original simulation.

Each correction pairs with before/after entries in fixtures/corrections.json.
Pre-correction behavior remains frozen in tests/test_simulate.py history and
the original fixture export.
"""

import math

import pytest

import simulate as s
from design import SpacecraftMission
from environment import SpaceWeather


def make_mission(**overrides) -> SpacecraftMission:
    values = dict(
        mass=750.0, fuel=200.0, lifespan=5.0, target_altitude=500.0,
        target_inclination=51.6, cross_section_area=10.0,
        drag_coefficient=2.2, isp=325.0,
    )
    values.update(overrides)
    return SpacecraftMission(**values)


# ---------------------------------------------------------------------------
# Correction: reject non-finite values and invalid physical inputs
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("field,code", [
    ("mass", "invalid_mass"),
    ("fuel", "no_fuel"),
    ("cross_section_area", "invalid_cross_section_area"),
    ("drag_coefficient", "invalid_drag_coefficient"),
    ("isp", "invalid_isp"),
    ("lifespan", "invalid_lifespan"),
    ("target_altitude", "invalid_target_altitude"),
    ("target_inclination", "invalid_target_inclination"),
])
@pytest.mark.parametrize("bad", [float("nan"), float("inf"), -float("inf")])
def test_non_finite_inputs_rejected(reference_weather, field, code, bad):
    result = s.simulate(make_mission(**{field: bad}), reference_weather)
    assert not result.passed
    assert code in result.failure_reasons


def test_out_of_range_inclination_rejected(reference_weather):
    result = s.simulate(make_mission(target_inclination=190.0), reference_weather)
    assert "invalid_target_inclination" in result.failure_reasons


def test_malformed_weather_still_simulates(passing_mission):
    broken = SpaceWeather(
        kp=float("nan"),
        f107=None,
        solar_wind_speed=float("inf"),
        solar_wind_density=5.0,
        solar_wind_temperature=100_000.0,
    )
    result = s.simulate(passing_mission, broken)
    assert math.isfinite(result.required_delta_v)
    assert math.isfinite(result.average_density)


def test_density_helpers_tolerate_non_finite_inputs(reference_weather):
    assert s.estimate_atmospheric_density(float("nan"), reference_weather, 0.0) == 1e-16
    assert s.estimate_atmospheric_density(500.0, reference_weather, float("inf")) == 1e-16


# ---------------------------------------------------------------------------
# Correction: positive run counts required
# ---------------------------------------------------------------------------

def test_monte_carlo_rejects_non_positive_counts(passing_mission, reference_weather):
    with pytest.raises(ValueError):
        s.run_monte_carlo(passing_mission, reference_weather, n=0, sensitivity_runs=10)
    with pytest.raises(ValueError):
        s.run_monte_carlo(passing_mission, reference_weather, n=10, sensitivity_runs=0)
    with pytest.raises(ValueError):
        s.run_overall_monte_carlo(passing_mission, reference_weather, n=-5)
    with pytest.raises(ValueError):
        s.run_parameter_sensitivity(passing_mission, reference_weather, n=0)
