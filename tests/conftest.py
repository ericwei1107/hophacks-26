import pytest

from design import SpacecraftMission
from environment import SpaceWeather


@pytest.fixture
def reference_weather() -> SpaceWeather:
    """Deterministic reference snapshot shared with the browser game."""
    return SpaceWeather(
        kp=3.0,
        f107=150.0,
        solar_wind_speed=400.0,
        solar_wind_density=5.0,
        solar_wind_temperature=100_000.0,
    )


@pytest.fixture
def passing_mission() -> SpacecraftMission:
    return SpacecraftMission(
        mass=750.0,
        fuel=200.0,
        lifespan=5.0,
        target_altitude=500.0,
        target_inclination=51.6,
        cross_section_area=10.0,
        drag_coefficient=2.2,
        isp=325.0,
    )


@pytest.fixture
def marginal_mission() -> SpacecraftMission:
    return SpacecraftMission(
        mass=900.0,
        fuel=120.0,
        lifespan=5.0,
        target_altitude=420.0,
        target_inclination=51.6,
        cross_section_area=14.0,
        drag_coefficient=2.2,
        isp=300.0,
    )


@pytest.fixture
def failing_mission() -> SpacecraftMission:
    return SpacecraftMission(
        mass=1000.0,
        fuel=60.0,
        lifespan=7.0,
        target_altitude=400.0,
        target_inclination=97.4,
        cross_section_area=20.0,
        drag_coefficient=2.5,
        isp=220.0,
    )
