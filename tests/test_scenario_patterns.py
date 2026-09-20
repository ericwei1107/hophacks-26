from environment import SpaceWeather
from scenario_patterns import load_scenarios, recognize_patterns, rocket_catalog


def test_supplied_workbooks_load_their_30_reference_rows():
    assert len(load_scenarios("space_weather")) == 30
    assert len(load_scenarios("earth_weather")) == 30
    assert len(rocket_catalog()) == 30


def test_recognizer_returns_traceable_space_and_earth_matches():
    result = recognize_patterns(
        SpaceWeather(kp=7, f107=210, solar_wind_speed=700, solar_wind_density=15),
        {"wind_speed_m_s": 14, "precipitation_mm_h": 1},
    )
    assert result["modelVersion"] == "scenario-recognition-v1"
    assert result["referenceRows"] == {"space_weather": 30, "earth_weather": 30, "rocketry": 30}
    assert {match["dataset"] for match in result["matches"]} == {"spaceWeather", "earthWeather"}
    assert all(match["source"].startswith("http") for match in result["matches"])
    assert any(match["scenarioId"] == "2" for match in result["matches"])
