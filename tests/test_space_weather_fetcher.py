from __future__ import annotations

import numpy as np
import pandas as pd

from space_weather_fetcher import SpaceWeatherDataFetcher


class Response:
    def __init__(self, payload, text="", content_type="application/json"):
        self.payload = payload
        self.text = text
        self.headers = {"Content-Type": content_type}

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


class Session:
    def get(self, url, **kwargs):
        if "plasma" in url:
            return Response([{"time_tag": "2026-01-01T00:00:00Z", "speed": 400, "density": -999.9}])
        if "mag_" in url:
            return Response([{"time_tag": "2026-01-01T00:00:20Z", "bx_gsm": 1, "by_gsm": 2, "bz_gsm": -3}])
        return Response([{"time_tag": "2026-01-01T00:00:30Z", "kp": 4.33}])


def test_swpc_frame_is_utc_aligned_and_replaces_sentinel_values():
    frame = SpaceWeatherDataFetcher(session=Session()).fetch_swpc_solar_wind()
    assert isinstance(frame.index, pd.DatetimeIndex)
    assert str(frame.index.tz) == "UTC"
    assert frame.loc[pd.Timestamp("2026-01-01T00:00:00Z"), "solar_wind_speed_km_s"] == 400
    assert np.isnan(frame.loc[pd.Timestamp("2026-01-01T00:00:00Z"), "solar_wind_density_cm3"])
    assert frame.loc[pd.Timestamp("2026-01-01T00:00:00Z"), "bz_gsm_nt"] == -3
