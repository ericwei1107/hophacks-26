"""Retrieval and normalization of operational space-weather data sources.

This module is intentionally separate from :mod:`environment`: the latter is
the simulation's compact snapshot adapter, while this module retains time
series and source-specific metadata for analysis and telemetry workflows.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
from io import StringIO
from typing import Any

import numpy as np
import pandas as pd
import requests


SWPC_PLASMA_URL = "https://services.swpc.noaa.gov/json/rtsw/rtsw_plasma_1m.json"
SWPC_PLASMA_FALLBACK_URL = "https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json"
SWPC_MAG_URL = "https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json"
SWPC_KP_URL = "https://services.swpc.noaa.gov/json/planetary_k_index_1m.json"
LASP_API_BASE = "https://lasp.colorado.edu/space-weather-portal/api/v1"
CDAWEB_BASE = "https://cdaweb.gsfc.nasa.gov/WS/cdasr/1"
_MISSING_SENTINELS = {-999.0, -999.9, -9999.0, -1.0e31}
_TIME_COLUMNS = ("time_tag", "timestamp", "time", "datetime", "epoch", "Epoch")


class SpaceWeatherDataFetcher:
    """Unified client for NOAA SWPC, LASP SWx TREC, and NASA CDAWeb.

    All returned frames have a timezone-aware UTC ``DatetimeIndex``. Values
    flagged as missing by a provider are represented by ``numpy.nan``.
    """

    def __init__(self, timeout: int = 30, session: requests.Session | None = None):
        if timeout <= 0:
            raise ValueError("timeout must be positive")
        self.timeout = timeout
        self.session = session or requests.Session()

    def _get(self, url: str, *, params: Mapping[str, str] | None = None) -> requests.Response:
        try:
            response = self.session.get(
                url,
                params=params,
                timeout=self.timeout,
                headers={"Accept": "application/json, text/csv;q=0.9, text/plain;q=0.8"},
            )
            response.raise_for_status()
            return response
        except requests.exceptions.RequestException as error:
            raise RuntimeError(f"Space-weather request failed for {url}: {error}") from error

    def _get_with_404_fallback(self, url: str, fallback_url: str) -> requests.Response:
        """Use the documented endpoint first, with a versioned operational fallback."""
        try:
            return self._get(url)
        except RuntimeError as error:
            if "404" not in str(error):
                raise
            return self._get(fallback_url)

    @staticmethod
    def _json(response: requests.Response, source: str) -> Any:
        try:
            return response.json()
        except ValueError as error:
            raise RuntimeError(f"{source} returned invalid JSON.") from error

    @staticmethod
    def _format_time(value: str | datetime) -> str:
        stamp = pd.Timestamp(value)
        if stamp.tzinfo is None:
            stamp = stamp.tz_localize("UTC")
        else:
            stamp = stamp.tz_convert("UTC")
        return stamp.strftime("%Y%m%dT%H%M%SZ")

    @staticmethod
    def _records(payload: Any, source: str) -> list[dict[str, Any]]:
        if isinstance(payload, list) and all(isinstance(row, Mapping) for row in payload):
            return [dict(row) for row in payload]
        if isinstance(payload, Mapping):
            for key in ("data", "results", "records", "items"):
                candidate = payload.get(key)
                if isinstance(candidate, list) and all(isinstance(row, Mapping) for row in candidate):
                    return [dict(row) for row in candidate]
        raise RuntimeError(f"{source} payload does not contain a list of object records.")

    @classmethod
    def _frame(cls, payload: Any, source: str) -> pd.DataFrame:
        frame = pd.DataFrame(cls._records(payload, source))
        time_column = next((column for column in _TIME_COLUMNS if column in frame.columns), None)
        if time_column is None:
            raise RuntimeError(f"{source} payload has no supported timestamp field.")
        index = pd.to_datetime(frame.pop(time_column), utc=True, errors="coerce")
        frame.index = pd.DatetimeIndex(index, name="timestamp")
        frame = frame[~frame.index.isna()].sort_index()
        if frame.empty:
            return frame
        for column in frame.columns:
            converted = pd.to_numeric(frame[column], errors="coerce")
            if converted.notna().any() or frame[column].map(lambda value: value is None).any():
                frame[column] = converted.mask(converted.isin(_MISSING_SENTINELS), np.nan)
        return frame

    @staticmethod
    def _rename_first(frame: pd.DataFrame, destination: str, candidates: Sequence[str]) -> pd.DataFrame:
        source = next((name for name in candidates if name in frame.columns), None)
        return frame.rename(columns={source: destination}) if source else frame

    @staticmethod
    def _nearest_align(frames: Sequence[pd.DataFrame], tolerance: pd.Timedelta | None = None) -> pd.DataFrame:
        nonempty = [frame.sort_index() for frame in frames if not frame.empty]
        if not nonempty:
            return pd.DataFrame(index=pd.DatetimeIndex([], tz="UTC", name="timestamp"))
        start = min(frame.index.min() for frame in nonempty).floor("min")
        stop = max(frame.index.max() for frame in nonempty).ceil("min")
        base = pd.DataFrame(index=pd.date_range(start, stop, freq="min", tz="UTC", name="timestamp"))
        if tolerance is None:
            tolerance = pd.to_timedelta(300, unit="s")
        for frame in nonempty:
            base = pd.merge_asof(
                base.reset_index().sort_values("timestamp"),
                frame.reset_index().sort_values("timestamp"),
                on="timestamp",
                direction="nearest",
                tolerance=tolerance,
            ).set_index("timestamp")
        return base

    def fetch_swpc_solar_wind(self) -> pd.DataFrame:
        """Fetch and align one-minute NOAA plasma, IMF, and estimated Kp data."""
        plasma = self._frame(
            self._json(self._get_with_404_fallback(SWPC_PLASMA_URL, SWPC_PLASMA_FALLBACK_URL), "NOAA plasma"),
            "NOAA plasma",
        )
        magnetic = self._frame(self._json(self._get(SWPC_MAG_URL), "NOAA magnetic field"), "NOAA magnetic field")
        kp = self._frame(self._json(self._get(SWPC_KP_URL), "NOAA Kp"), "NOAA Kp")
        plasma = self._rename_first(plasma, "solar_wind_speed_km_s", ("speed", "proton_speed", "bulk_speed"))
        plasma = self._rename_first(plasma, "solar_wind_density_cm3", ("density", "proton_density", "np"))
        plasma = self._rename_first(plasma, "solar_wind_temperature_k", ("temperature", "proton_temperature", "tp"))
        magnetic = self._rename_first(magnetic, "bx_gsm_nt", ("bx_gsm", "bx", "bx_gse"))
        magnetic = self._rename_first(magnetic, "by_gsm_nt", ("by_gsm", "by", "by_gse"))
        magnetic = self._rename_first(magnetic, "bz_gsm_nt", ("bz_gsm", "bz", "bz_gse"))
        magnetic = self._rename_first(magnetic, "magnetic_field_nt", ("bt", "bt_gsm", "total_field"))
        kp = self._rename_first(kp, "kp", ("kp", "Kp", "estimated_kp_index"))
        return self._nearest_align((plasma, magnetic, kp))

    def fetch_lasp_data(self, resource: str, start_time: str | datetime, end_time: str | datetime) -> pd.DataFrame:
        """Fetch a LASP SWx TREC resource with explicit UTC time bounds.

        ``resource`` is intentionally caller-supplied because LASP portal
        products change independently. Examples include ``tec``, ``f107``,
        and a geomagnetic-index product exposed by the portal.
        """
        if not resource or "/" in resource.strip("/"):
            raise ValueError("resource must be one API path segment")
        params = {
            "start_time": pd.Timestamp(start_time, tz="UTC").isoformat().replace("+00:00", "Z"),
            "end_time": pd.Timestamp(end_time, tz="UTC").isoformat().replace("+00:00", "Z"),
        }
        if pd.Timestamp(params["start_time"]) >= pd.Timestamp(params["end_time"]):
            raise ValueError("start_time must be earlier than end_time")
        url = f"{LASP_API_BASE}/{resource.strip('/') }"
        return self._frame(self._json(self._get(url, params=params), f"LASP {resource}"), f"LASP {resource}")

    def fetch_cdaweb_data(
        self,
        dataset_id: str,
        start_time: str | datetime,
        end_time: str | datetime,
        variables: Sequence[str],
    ) -> pd.DataFrame:
        """Retrieve CDAWeb variables through its documented REST GET endpoint.

        CDAWeb variable names are dataset-specific. Callers should obtain them
        with :meth:`fetch_cdaweb_variables` rather than relying on assumed
        ACE, WIND, or DSCOVR names.
        """
        if not dataset_id or not variables:
            raise ValueError("dataset_id and at least one variable are required")
        interval = f"{self._format_time(start_time)},{self._format_time(end_time)}"
        url = f"{CDAWEB_BASE}/dataviews/sp_phys/datasets/{dataset_id}/data/{interval}/{','.join(variables)}"
        response = self._get(url, params={"format": "csv"})
        content_type = response.headers.get("Content-Type", "")
        if "json" in content_type:
            return self._frame(self._json(response, f"CDAWeb {dataset_id}"), f"CDAWeb {dataset_id}")
        try:
            frame = pd.read_csv(StringIO(response.text), comment="#")
        except (pd.errors.ParserError, UnicodeDecodeError) as error:
            raise RuntimeError(f"CDAWeb {dataset_id} returned an unreadable CSV payload.") from error
        if frame.empty:
            return pd.DataFrame(index=pd.DatetimeIndex([], tz="UTC", name="timestamp"))
        time_column = next((column for column in _TIME_COLUMNS if column in frame.columns), frame.columns[0])
        index = pd.to_datetime(frame.pop(time_column), utc=True, errors="coerce")
        frame.index = pd.DatetimeIndex(index, name="timestamp")
        frame = frame[~frame.index.isna()].sort_index()
        for column in frame.columns:
            frame[column] = pd.to_numeric(frame[column], errors="coerce").mask(lambda values: values.isin(_MISSING_SENTINELS), np.nan)
        return frame

    def fetch_cdaweb_variables(self, dataset_id: str) -> list[dict[str, Any]]:
        """Return CDAWeb's live variable metadata for a dataset."""
        url = f"{CDAWEB_BASE}/dataviews/sp_phys/datasets/{dataset_id}/variables"
        payload = self._json(self._get(url), f"CDAWeb {dataset_id} variables")
        if isinstance(payload, Mapping):
            variables = payload.get("VariableDescription") or payload.get("variables")
            if isinstance(variables, list):
                return [dict(value) for value in variables if isinstance(value, Mapping)]
        raise RuntimeError(f"CDAWeb {dataset_id} returned invalid variable metadata.")


def utc_now() -> datetime:
    """Expose a testable standard UTC clock for pipeline callers."""
    return datetime.now(timezone.utc)
