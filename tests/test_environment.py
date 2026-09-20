from environment import SpaceWeather, select_latest_valid


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


def test_select_latest_valid_uses_timestamp_not_array_position():
    rows = [
        {"time_tag": "2026-09-19T12:00:00Z", "Kp": 5.0},
        {"time_tag": "2026-09-19T09:00:00Z", "Kp": 3.0},
        {"time_tag": "2026-09-19T13:00:00Z", "Kp": float("nan")},
        {"time_tag": "not-a-date", "Kp": 9.0},
    ]
    chosen = select_latest_valid(rows, "Kp")
    assert chosen is not None
    assert chosen[0] == 5.0


def test_select_latest_valid_returns_none_when_unusable():
    assert select_latest_valid([], "Kp") is None
    assert select_latest_valid([{"time_tag": "", "Kp": 1.0}], "Kp") is None
