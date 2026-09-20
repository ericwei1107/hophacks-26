from payload_analysis import (
    PayloadHandoff,
    circularization_delta_v,
    spacecraft_from_wet_mass,
    analyze_launched_payload,
)
from environment import SpaceWeather
import pytest


@pytest.fixture(autouse=True)
def skip_network_side_effects(monkeypatch):
    monkeypatch.setattr("payload_analysis.get_latest_debris_rules", lambda **_: [])
    monkeypatch.setattr("payload_analysis._safe_footprint", lambda _mission: None)
    monkeypatch.setattr("payload_analysis.briefing_configured", lambda: False)


def _handoff(apogee=200.0, perigee=190.0, wet=5000.0) -> PayloadHandoff:
    return PayloadHandoff(
        payload_wet_mass_kg=wet,
        achieved_perigee_km=perigee,
        achieved_apogee_km=apogee,
        achieved_inclination_deg=5.0,
        stage2_propellant_remaining_kg=1200.0,
        weather=SpaceWeather(
            kp=3.0,
            f107=150.0,
            solar_wind_speed=400.0,
            solar_wind_density=5.0,
            solar_wind_temperature=100_000.0,
        ),
        seed=42,
    )


def test_circularization_is_zero_when_already_circular():
    assert circularization_delta_v(200.0, 200.0) == 0.0


def test_spacecraft_spec_matches_the_typescript_handoff_rule():
    dry, fuel, area = spacecraft_from_wet_mass(5000.0)
    assert dry == 4000.0
    assert fuel == 1000.0
    assert abs(area - 5.0 * 5.0 ** (2.0 / 3.0)) < 1e-9


def test_analyze_runs_python_mission_stack_on_a_game_orbit():
    report = analyze_launched_payload(_handoff(), runs=20, sensitivity_runs=10)
    assert report["source"] == "python"
    assert report["insertionBudgetOk"] is True
    assert report["operatingFloorKm"] == 150.0
    assert report["result"] is not None
    assert report["monteCarlo"]["total_runs"] == 20
    assert report["insights"]
    assert "debris" not in report
    assert any("Baseline mission" in line for line in report["explanations"])


def test_elliptical_insertion_can_exhaust_onboard_propellant():
    report = analyze_launched_payload(
        _handoff(apogee=2000.0, perigee=150.0, wet=500.0),
        runs=20,
        sensitivity_runs=10,
    )
    if not report["insertionBudgetOk"]:
        assert report["mission"] is None
        assert report["monteCarlo"] is None
        assert "Insertion-budget" in report["explanations"][0]
