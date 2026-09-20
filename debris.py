"""SATCAT shell crowding screen for LEO collision-avoidance budgeting.

This is a population screen, not operational collision probability (Pc). SATCAT
counts objects in altitude shells; it does not propagate objects in 3D.
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Iterable
from urllib.request import urlopen

SATCAT_URL = "https://celestrak.org/satcat/records.php?FORMAT=JSON&ONORBIT=1"
CACHE_PATH = Path(__file__).resolve().parent / ".cache" / "satcat_onorbit.json"
CACHE_TTL_S = 6 * 60 * 60

# Labeled fallback: deliberately small and synthetic, never presented as SATCAT.
SYNTHETIC_SATCAT = [
    *({"APOGEE": 545, "PERIGEE": 545, "OBJECT_TYPE": "PAY", "OBJECT_NAME": "synthetic payload"} for _ in range(18)),
    *({"APOGEE": 540, "PERIGEE": 540, "OBJECT_TYPE": "DEB", "OBJECT_NAME": "synthetic debris"} for _ in range(14)),
    *({"APOGEE": 400, "PERIGEE": 400, "OBJECT_TYPE": "R/B", "OBJECT_NAME": "synthetic rocket body"} for _ in range(5)),
    *({"APOGEE": 400, "PERIGEE": 400, "OBJECT_TYPE": "PAY", "OBJECT_NAME": "synthetic reference payload"} for _ in range(3)),
]


def _valid_records(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise ValueError("SATCAT response was not a JSON array")
    return [row for row in value if isinstance(row, dict)]


_satcat_memory: list[dict[str, Any]] | None = None
_satcat_memory_time = 0.0
_satcat_memory_source = "synthetic fallback"


def load_satcat(force_refresh: bool = False) -> list[dict[str, Any]]:
    """Load on-orbit SATCAT records, caching for about six hours.

    Network and cache errors intentionally return a labeled synthetic LEO mix so
    a simulation remains usable when CelesTrak is unavailable.
    """
    global _satcat_memory, _satcat_memory_time, _satcat_memory_source
    now = time.time()
    if (
        not force_refresh
        and _satcat_memory is not None
        and now - _satcat_memory_time < CACHE_TTL_S
    ):
        return _satcat_memory
    try:
        if not force_refresh and CACHE_PATH.exists() and now - CACHE_PATH.stat().st_mtime < CACHE_TTL_S:
            records = _valid_records(json.loads(CACHE_PATH.read_text(encoding="utf-8")))
            _satcat_memory, _satcat_memory_time, _satcat_memory_source = records, now, "CelesTrak SATCAT"
            return records
        with urlopen(SATCAT_URL, timeout=15) as response:
            records = _valid_records(json.loads(response.read().decode("utf-8")))
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        CACHE_PATH.write_text(json.dumps(records), encoding="utf-8")
        _satcat_memory, _satcat_memory_time, _satcat_memory_source = records, now, "CelesTrak SATCAT"
        return records
    except Exception:
        fallback = [dict(row) for row in SYNTHETIC_SATCAT]
        _satcat_memory, _satcat_memory_time, _satcat_memory_source = fallback, now, "synthetic fallback"
        return fallback


def cam_scale_from_counts(shell_total: int, reference_total: int) -> float:
    return max(0.4, min(2.5, shell_total / max(reference_total, 1)))


def _altitude(row: dict[str, Any]) -> tuple[float, float] | None:
    try:
        apogee, perigee = float(row["APOGEE"]), float(row["PERIGEE"])
    except (KeyError, TypeError, ValueError):
        return None
    if min(apogee, perigee) < 80 or max(apogee, perigee) > 2000:
        return None
    return apogee, perigee


def _earth(row: dict[str, Any]) -> bool:
    return row.get("ORBIT_CENTER") in (None, "", "EA")


def _empty_counts() -> dict[str, int]:
    return {"payload": 0, "rocket_body": 0, "debris": 0, "unknown": 0, "total": 0}


def _dual_counts(rows: Iterable[dict[str, Any]], altitude_km: float, reference_alt_km: float, half_width_km: float) -> tuple[dict[str, int], dict[str, int]]:
    counts = _empty_counts()
    reference = _empty_counts()
    for row in rows:
        if not _earth(row):
            continue
        bounds = _altitude(row)
        if bounds is None:
            continue
        mean = sum(bounds) / 2
        kind = {"PAY": "payload", "R/B": "rocket_body", "DEB": "debris"}.get(row.get("OBJECT_TYPE"), "unknown")
        if abs(mean - altitude_km) <= half_width_km:
            counts[kind] += 1
            counts["total"] += 1
        if abs(mean - reference_alt_km) <= half_width_km:
            reference[kind] += 1
            reference["total"] += 1
    return counts, reference


def shell_census(satcat: Iterable[dict[str, Any]], altitude_km: float, half_width_km: float = 30, reference_alt_km: float = 400, source: str | None = None) -> dict[str, Any]:
    rows = satcat if isinstance(satcat, list) else list(satcat)
    counts, reference = _dual_counts(rows, altitude_km, reference_alt_km, half_width_km)
    scale = cam_scale_from_counts(counts["total"], reference["total"])
    obstacle = "quiet" if scale < 0.85 else "nominal" if scale <= 1.25 else "crowded" if scale <= 1.8 else "severe"
    labeled = source or (_satcat_memory_source if rows is _satcat_memory else "synthetic fallback" if rows == SYNTHETIC_SATCAT else "CelesTrak SATCAT")
    note = "Screening shell count; not collision probability (Pc). Close approaches use a 5 km screening volume, not NASA-grade Pc."
    return {"altitude": altitude_km, "shell_low": altitude_km - half_width_km, "shell_high": altitude_km + half_width_km, "counts": counts, "reference_counts": reference, "cam_scale": scale, "obstacle": obstacle, "source": labeled, "note": note}
