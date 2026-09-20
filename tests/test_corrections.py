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


# ---------------------------------------------------------------------------
# Correction: orbital decay stops at the reentry boundary
# ---------------------------------------------------------------------------

def test_decay_stops_at_reentry_boundary(failing_mission, reference_weather):
    # Before: final_altitude -252.80226690325162 km, decay 652.8022669032516 km.
    # After: decay clamps at the 120 km boundary with a shortened final step.
    result = s.simulate(failing_mission, reference_weather)
    assert result.final_altitude == pytest.approx(120.0)
    assert result.orbital_decay == pytest.approx(280.0)
    assert "orbital_decay" in result.failure_reasons


def test_decay_never_produces_negative_altitude(reference_weather):
    mission = make_mission(target_altitude=130.0, fuel=1.0, isp=100.0, lifespan=10.0)
    result = s.simulate(mission, reference_weather)
    assert result.final_altitude >= s.REENTRY_ALTITUDE_KM


# ---------------------------------------------------------------------------
# Correction: minimum required propellant vs. actual consumption
# ---------------------------------------------------------------------------

def test_propellant_consumed_exceeds_minimum_when_extra_fuel_loaded(passing_mission, reference_weather):
    # Extra loaded fuel makes actual consumption exceed the minimum starting load.
    result = s.simulate(passing_mission, reference_weather)
    assert result.propellant_required == pytest.approx(40.14754290262784)
    assert result.propellant_consumed == pytest.approx(48.26967583470244)
    assert result.propellant_consumed > result.propellant_required
    assert result.propellant_remaining == pytest.approx(
        passing_mission.fuel - result.propellant_consumed
    )


def test_consumption_matches_minimum_when_tanks_hold_exactly_the_minimum(reference_weather):
    # If loaded fuel equals the minimum required, both formulas agree.
    mission = make_mission()
    required_dv, *_ = s.estimate_mission_delta_v(mission, reference_weather)
    minimum = s.estimate_propellant_required(mission, required_dv)
    exact = make_mission(fuel=minimum)
    consumed = s.estimate_propellant_consumed(exact, required_dv)
    assert consumed == pytest.approx(minimum, rel=1e-9)


def test_reserve_check_uses_corrected_remaining(reference_weather):
    # fuel=64.8 kg at 420 km: minimum accounting still clears the 10% reserve,
    # actual consumption does not.
    mission = make_mission(fuel=64.8, target_altitude=420.0)
    result = s.simulate(mission, reference_weather)
    uncorrected_remaining = mission.fuel - result.propellant_required
    reserve = mission.fuel * s.PROPULSION_RESERVE_FRACTION
    assert uncorrected_remaining >= reserve
    assert result.propellant_remaining < reserve
    assert result.failure_reasons == ["insufficient_propellant_reserve"]
