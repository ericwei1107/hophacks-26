"""Golden-value tests for the preserved orbital mission model.

These tests freeze the current (pre-correction) behavior of simulate.py so the
TypeScript port can be checked for parity and so intentional corrections land
as explicit, reviewable changes.
"""

import math

import pytest

import simulate as s
from design import SpacecraftMission


# ---------------------------------------------------------------------------
# Scalar helpers (preserved behavior)
# ---------------------------------------------------------------------------

def test_orbital_velocity_golden():
    assert s.orbital_velocity(500.0) == pytest.approx(7616.560806262885)


def test_atmospheric_relative_velocity_golden():
    assert s.atmospheric_relative_velocity(500.0, 51.6) == pytest.approx(7315.623896770228)


def test_density_golden(reference_weather):
    assert s.estimate_atmospheric_density(500.0, reference_weather, 51.6) == pytest.approx(2.0757826256407653e-13)
    assert s.estimate_atmospheric_density(400.0, reference_weather, 97.4) == pytest.approx(1.4366903350001435e-12)
    assert s.estimate_atmospheric_density(150.0, reference_weather, 0.0) == pytest.approx(1.757315616175113e-10)


def test_density_never_below_floor(reference_weather):
    assert s.estimate_atmospheric_density(2000.0, reference_weather, 0.0) >= 1e-16


def test_disposal_delta_v_golden():
    assert s.estimate_disposal_delta_v(500.0) == pytest.approx(100.18837085561881)
    assert s.estimate_disposal_delta_v(100.0) == 0.0  # already below disposal perigee


def test_delta_v_available_golden(passing_mission):
    assert s.estimate_delta_v_available(passing_mission) == pytest.approx(753.4091533811649)


def test_delta_v_available_handles_invalid():
    mission = SpacecraftMission(
        mass=0, fuel=0, lifespan=1, target_altitude=500,
        target_inclination=0, cross_section_area=1, drag_coefficient=1, isp=0,
    )
    assert s.estimate_delta_v_available(mission) == 0.0


# ---------------------------------------------------------------------------
# Full-mission outcomes (preserved behavior)
# ---------------------------------------------------------------------------

def test_passing_mission(passing_mission, reference_weather):
    result = s.simulate(passing_mission, reference_weather)
    assert result.passed
    assert result.failure_reasons == []
    assert result.available_delta_v == pytest.approx(753.4091533811649)
    assert result.required_delta_v == pytest.approx(142.39546589561252)
    assert result.drag_delta_v == pytest.approx(22.684663593874273)
    assert result.collision_avoidance_delta_v == pytest.approx(19.522431446119445)
    assert result.insertion_delta_v == pytest.approx(0.0)
    assert result.disposal_delta_v == pytest.approx(100.18837085561881)
    assert result.propellant_required == pytest.approx(34.26819082260879)
    assert result.propellant_remaining == pytest.approx(165.7318091773912)
    assert result.final_altitude == pytest.approx(500.0)
    assert result.orbital_decay == pytest.approx(0.0)


def test_marginal_mission(marginal_mission, reference_weather):
    result = s.simulate(marginal_mission, reference_weather)
    assert result.passed
    assert result.available_delta_v == pytest.approx(368.22934075497085)
    assert result.required_delta_v == pytest.approx(226.696511333117)
    assert result.propellant_remaining == pytest.approx(47.90830865750449)


def test_failing_mission(failing_mission, reference_weather):
    result = s.simulate(failing_mission, reference_weather)
    assert not result.passed
    assert result.failure_reasons == [
        "insufficient_delta_v",
        "insufficient_propellant",
        "below_operating_altitude",
        "orbital_decay",
    ]
    assert result.available_delta_v == pytest.approx(125.71301332787723)
    assert result.required_delta_v == pytest.approx(562.8078131413511)


def test_failing_mission_stays_above_surface(failing_mission, reference_weather):
    # Corrected behavior: decay stops at the reentry boundary. The
    # pre-correction values (-252.8 km final altitude) are preserved in
    # fixtures/corrections.json.
    result = s.simulate(failing_mission, reference_weather)
    assert result.final_altitude >= s.REENTRY_ALTITUDE_KM


def test_invalid_inputs_fail_before_calculation(reference_weather):
    mission = SpacecraftMission(
        mass=-1, fuel=0, lifespan=0, target_altitude=500,
        target_inclination=0, cross_section_area=-5,
        drag_coefficient=0, isp=-10,
    )
    result = s.simulate(mission, reference_weather)
    assert not result.passed
    assert set(result.failure_reasons) == {
        "invalid_mass", "no_fuel", "invalid_cross_section_area",
        "invalid_drag_coefficient", "invalid_isp", "invalid_lifespan",
    }


# ---------------------------------------------------------------------------
# Monte Carlo (structure and determinism)
# ---------------------------------------------------------------------------

def test_monte_carlo_deterministic_with_seed(passing_mission, reference_weather):
    a = s.run_monte_carlo(passing_mission, reference_weather, n=200, sensitivity_runs=50, seed=42)
    b = s.run_monte_carlo(passing_mission, reference_weather, n=200, sensitivity_runs=50, seed=42)
    assert a.passes == b.passes
    assert a.failures == b.failures
    assert a.failure_modes == b.failure_modes
    for ra, rb in zip(a.sensitivity_results, b.sensitivity_results):
        assert ra.parameter == rb.parameter
        assert ra.failure_rate == rb.failure_rate


def test_monte_carlo_covers_sixteen_parameters(passing_mission, reference_weather):
    summary = s.run_monte_carlo(passing_mission, reference_weather, n=50, sensitivity_runs=10, seed=1)
    assert len(summary.sensitivity_results) == 16
    parameters = {result.parameter for result in summary.sensitivity_results}
    assert parameters == {
        "mass", "fuel", "lifespan", "target_altitude", "target_inclination",
        "cross_section_area", "drag_coefficient", "isp",
        "kp", "f107", "solar_wind_speed", "solar_wind_density", "solar_wind_temperature",
        "insertion_altitude_error_km", "insertion_inclination_error_deg", "debris_environment",
    }


def test_monte_carlo_counts_add_up(passing_mission, reference_weather):
    summary = s.run_monte_carlo(passing_mission, reference_weather, n=100, sensitivity_runs=10, seed=7)
    assert summary.passes + summary.failures == summary.total_runs
    assert summary.probability_pass + summary.probability_fail == pytest.approx(1.0)
