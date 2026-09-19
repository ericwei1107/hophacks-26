from environment import SpaceWeather


def test_validate_accepts_complete_weather(reference_weather):
    assert reference_weather.validate()


def test_validate_rejects_missing_fields():
    assert not SpaceWeather().validate()
    assert not SpaceWeather(kp=3.0, f107=150.0).validate()


def test_validate_rejects_negative_values():
    assert not SpaceWeather(
        kp=-1.0,
        f107=150.0,
        solar_wind_speed=400.0,
        solar_wind_density=5.0,
        solar_wind_temperature=100_000.0,
    ).validate()
