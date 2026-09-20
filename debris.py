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


def load_satcat(force_refresh: bool = False) -> list[dict[str, Any]]:
    """Load on-orbit SATCAT records, caching for about six hours.

    Network and cache errors intentionally return a labeled synthetic LEO mix so
    a simulation remains usable when CelesTrak is unavailable.
    """
    try:
        if not force_refresh and CACHE_PATH.exists() and time.time() - CACHE_PATH.stat().st_mtime < CACHE_TTL_S:
            return _valid_records(json.loads(CACHE_PATH.read_text(encoding="utf-8")))
        with urlopen(SATCAT_URL, timeout=15) as response:
            records = _valid_records(json.loads(response.read().decode("utf-8")))
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        CACHE_PATH.write_text(json.dumps(records), encoding="utf-8")
        return records
    except Exception:
        return [dict(row) for row in SYNTHETIC_SATCAT]


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


def _counts(rows: Iterable[dict[str, Any]], altitude_km: float, half_width_km: float) -> dict[str, int]:
    counts = {"payload": 0, "rocket_body": 0, "debris": 0, "unknown": 0}
    for row in rows:
        if not _earth(row):
            continue
        bounds = _altitude(row)
        if bounds is None or not (altitude_km - half_width_km <= sum(bounds) / 2 <= altitude_km + half_width_km):
            continue
        kind = {"PAY": "payload", "R/B": "rocket_body", "DEB": "debris"}.get(row.get("OBJECT_TYPE"), "unknown")
        counts[kind] += 1
    counts["total"] = sum(counts.values())
    return counts


def shell_census(satcat: Iterable[dict[str, Any]], altitude_km: float, half_width_km: float = 30, reference_alt_km: float = 400) -> dict[str, Any]:
    rows = list(satcat)
    counts = _counts(rows, altitude_km, half_width_km)
    reference = _counts(rows, reference_alt_km, half_width_km)
    scale = cam_scale_from_counts(counts["total"], reference["total"])
    total = counts["total"]
    obstacle = "quiet" if scale < 0.85 else "nominal" if scale <= 1.25 else "crowded" if scale <= 1.8 else "severe"
    source = "CelesTrak SATCAT" if rows and not rows == SYNTHETIC_SATCAT else "synthetic fallback"
    note = "Screening shell count; not collision probability (Pc). Close approaches use a 5 km screening volume, not NASA-grade Pc."
    return {"altitude": altitude_km, "shell_low": altitude_km - half_width_km, "shell_high": altitude_km + half_width_km, "counts": counts, "reference_counts": reference, "cam_scale": scale, "obstacle": obstacle, "source": source, "note": note}
