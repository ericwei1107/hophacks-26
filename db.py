"""
Shared-storage client for the SpacetimeDB-backed mission store (see
docs/spacetimedb-integration.md and server/). This is the Python side of
the same store `web/src/persistence/spacetime.ts` writes to from the
browser — one source of truth for mission/weather/trajectory/emissions/
compliance data, not a separate database.

Writes go through SpacetimeDB reducers over HTTP, not direct SQL, because
`mission`, `weather_snapshot`, `trajectory_result`, `emissions_estimate`,
`regulatory_compliance`, and `debris_regulation` all have server-assigned
identity or timestamp columns, and SpacetimeDB's SQL engine (still
UNSTABLE) does not accept identity/timestamp literals in INSERT, nor
ORDER BY/LIMIT/aggregate functions in SELECT — confirmed empirically
against a local `spacetime start --pg-port` instance, not documented
upstream. `launch_catalog_entry` is the only table without such a column
and does accept a plain INSERT, but nothing here writes to it (it's
seeded once by the module's own `init` reducer).

Reads use SpacetimeDB's built-in PostgreSQL wire protocol
(`spacetime start --pg-port <port>`) via psycopg, which handles plain
filtered SELECTs fine. The wire protocol requires a real auth token
(a dummy password is rejected, unlike anonymous reducer calls), so read
paths here need SPACETIMEDB_TOKEN or a local `spacetime login` session;
without one, persistence is skipped with a clear message rather than
raising into the caller.

Env vars (all optional):
  SPACETIMEDB_HTTP_URL   default http://127.0.0.1:3000
  SPACETIMEDB_NAME       default apogee-launch-lab
  SPACETIMEDB_PG_HOST    default 127.0.0.1
  SPACETIMEDB_PG_PORT    default 5432
  SPACETIMEDB_TOKEN      bearer token for both the HTTP and PG paths;
                         falls back to the local `spacetime` CLI's own
                         ~/.config/spacetime/cli.toml token if present
"""

from __future__ import annotations

import json
import os
import tomllib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import psycopg
import requests

from design import SpacecraftMission
from environment import SpaceWeather
from simulate import MonteCarloSummary

HTTP_URL = os.environ.get("SPACETIMEDB_HTTP_URL", "http://127.0.0.1:3000")
DB_NAME = os.environ.get("SPACETIMEDB_NAME", "apogee-launch-lab")
PG_HOST = os.environ.get("SPACETIMEDB_PG_HOST", "127.0.0.1")
PG_PORT = int(os.environ.get("SPACETIMEDB_PG_PORT", "5432"))
_CLI_CONFIG_PATH = Path.home() / ".config" / "spacetime" / "cli.toml"


def _resolve_token() -> Optional[str]:
    env_token = os.environ.get("SPACETIMEDB_TOKEN")
    if env_token:
        return env_token
    try:
        with _CLI_CONFIG_PATH.open("rb") as handle:
            return tomllib.load(handle).get("spacetimedb_token")
    except (OSError, tomllib.TOMLDecodeError):
        return None


def _headers(token: Optional[str]) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _option(value: Any) -> Any:
    """Wire encoding for a SpacetimeDB `t.option(...)` reducer argument (a Rust-style sum type, not a bare nullable value): `{"some": value}` or the string `"none"`."""
    return "none" if value is None else {"some": value}


def call_reducer(name: str, args: list[Any], timeout: float = 10) -> None:
    """Calls a SpacetimeDB reducer by name with positional JSON args, matching the order in server/src/reducers.ts / logic.ts."""
    response = requests.post(
        f"{HTTP_URL}/v1/database/{DB_NAME}/call/{name}",
        data=json.dumps(args),
        headers=_headers(_resolve_token()),
        timeout=timeout,
    )
    response.raise_for_status()


def call_procedure(name: str, args: list[Any], timeout: float = 30) -> Any:
    """Calls a SpacetimeDB procedure by name; returns its decoded return value."""
    response = requests.post(
        f"{HTTP_URL}/v1/database/{DB_NAME}/call/{name}",
        data=json.dumps(args),
        headers=_headers(_resolve_token()),
        timeout=timeout,
    )
    response.raise_for_status()
    text = response.text.strip()
    return json.loads(text) if text else None


def pg_connect() -> psycopg.Connection:
    """Opens a read connection to the mission store via SpacetimeDB's Postgres wire protocol. Raises if no auth token is available."""
    token = _resolve_token()
    if not token:
        raise RuntimeError(
            "No SpacetimeDB auth token found. Run `spacetime login` or set "
            "SPACETIMEDB_TOKEN — the Postgres wire protocol requires real "
            "auth even for local reads."
        )
    return psycopg.connect(
        host=PG_HOST,
        port=PG_PORT,
        dbname=DB_NAME,
        user="token",
        password=token,
        autocommit=True,
        # SpacetimeDB's Postgres wire protocol only implements the simple
        # query protocol, not Bind/Execute — the default cursor's
        # server-side parameter binding fails with "This feature is not
        # implemented." ClientCursor interpolates %s placeholders
        # client-side and sends one plain-text query instead.
        cursor_factory=psycopg.ClientCursor,
    )


def _find_mission_id(seed: int) -> Optional[int]:
    with pg_connect() as conn:
        cur = conn.execute("SELECT id, seed FROM mission WHERE seed = %s", (seed,))
        rows = cur.fetchall()
    if not rows:
        return None
    return max(int(row[0]) for row in rows)


def persist_mission_analysis(
    mission: SpacecraftMission,
    weather: SpaceWeather,
    summary: MonteCarloSummary,
    seed: int,
    model_version: str,
    weather_source: str = "noaa",
) -> Optional[int]:
    """
    Best-effort: persists a completed mission analysis to the shared
    SpacetimeDB store (mission params, weather input, Monte Carlo
    baseline) and triggers the server-side emissions estimate and
    regulatory compliance reducers. Never raises — on any failure
    (SpacetimeDB unreachable, no auth token, etc.) it prints one line and
    returns None, since the CLI's own printed analysis must not depend on
    this succeeding.

    Note: the persisted emissions/compliance figures come from
    `estimate_emissions`/`evaluate_compliance` running against the shared
    store's condensed placeholder launch catalog (see
    server/src/catalog_seed.ts), so they may differ slightly from this
    process's own `estimate_mission_footprint` output printed above —
    that gap is tracked, not accidental. See docs/spacetimedb-integration.md.
    """
    try:
        call_reducer(
            "create_mission",
            [
                seed,
                mission.mass,
                mission.fuel,
                mission.lifespan,
                mission.target_altitude,
                mission.target_inclination,
                mission.cross_section_area,
                mission.drag_coefficient,
                mission.isp,
                model_version,
            ],
        )

        mission_id = _find_mission_id(seed)
        if mission_id is None:
            print("SpacetimeDB sync skipped: could not read back the new mission row.")
            return None

        call_reducer(
            "record_weather_snapshot",
            [
                mission_id,
                _option(weather.kp),
                _option(weather.f107),
                _option(weather.solar_wind_speed),
                _option(weather.solar_wind_density),
                _option(weather.solar_wind_temperature),
                weather_source,
                datetime.now(timezone.utc).isoformat(),
            ],
        )

        baseline = summary.baseline
        call_reducer(
            "record_trajectory_result",
            [
                mission_id,
                summary.total_runs,
                summary.passes,
                summary.failures,
                summary.probability_pass,
                summary.probability_fail,
                baseline.passed,
                baseline.failure_reasons,
                baseline.available_delta_v,
                baseline.required_delta_v,
                baseline.propellant_remaining,
                baseline.final_altitude,
            ],
        )

        call_reducer("estimate_emissions", [mission_id])
        call_reducer("evaluate_compliance", [mission_id])
        return mission_id
    except Exception as error:  # noqa: BLE001 - best-effort by design, see docstring
        print(f"SpacetimeDB sync skipped: {error}")
        return None


def sync_debris_rules() -> Optional[int]:
    """Triggers the server-side Federal Register cache refresh (server/src/procedures.ts). Best-effort, like persist_mission_analysis."""
    try:
        return call_procedure("sync_debris_rules", [])
    except Exception as error:  # noqa: BLE001
        print(f"Debris-rule sync skipped: {error}")
        return None
