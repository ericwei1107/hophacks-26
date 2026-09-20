import json
import os
from pathlib import Path

import requests

from design import MissionConstraints, SpacecraftMission
from emissions import MissionFootprint
from explanations import build_insights
from regulations import (
    evaluate_mission_compliance,
    format_for_grok,
    get_latest_debris_rules,
)
from environment import SpaceWeather
from simulate import MonteCarloSummary

XAI_CHAT_URL = "https://api.x.ai/v1/chat/completions"
DEFAULT_MODEL = "grok-4.6"
DEFAULT_TIMEOUT_S = 90
DEFAULT_REASONING = "low"
MAX_OUTPUT_TOKENS = 320

ANALYSIS_PROMPT = """Write a 45-second hackathon closer from these results. Audience already saw the plots.

Exactly this shape, no extra sections:
1) One-sentence verdict with pass rate.
2) The single biggest risk, in one sentence.
3) Launch CO2e / analog vehicle, one sentence.
4) Two concrete design moves inside the given bounds.
5) One limitation of the model.
6) Mention the regulatory screening result if it is not compliant.

Hard cap: 110 words. No bullets nested more than one level. No preamble.
"""

SYSTEM_PROMPT = """Pitch closer for a LEO mission Monte Carlo. Be numeric and spoken-word short.
Drag matters at 400 km, not 600 km. Disposal and collision avoidance still cost delta-v at 600 km.
Insertion inclination error is expensive. Fuel/Isp change margin, not drag.
Emissions are IGEL 2024 analog-launch shares. Stay inside design bounds. Do not invent data.
Regulatory records are context, not legal advice. Do not claim a Federal Register summary itself proves compliance.
"""


def load_dotenv(path: Path | None = None) -> None:
    env_path = path or (Path(__file__).resolve().parent / ".env")
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def _api_key() -> str:
    load_dotenv()
    return (os.environ.get("xai_api_key") or os.environ.get("XAI_API_KEY") or "").strip()


def _r(value, digits: int = 2):
    return None if value is None else round(float(value), digits)


def _bound_flags(mission: SpacecraftMission, constraints: MissionConstraints) -> dict:
    c = constraints
    pairs = {
        "mass_kg": (mission.mass, c.mass_min, c.mass_max),
        "fuel_kg": (mission.fuel, c.fuel_min, c.fuel_max),
        "life_yr": (mission.lifespan, c.life_min, c.life_max),
        "alt_km": (mission.target_altitude, c.altitude_min, c.altitude_max),
        "inc_deg": (mission.target_inclination, c.inclination_min, c.inclination_max),
        "area_m2": (mission.cross_section_area, c.area_min, c.area_max),
        "cd": (mission.drag_coefficient, c.drag_coefficient_min, c.drag_coefficient_max),
        "isp_s": (mission.isp, c.isp_min, c.isp_max),
    }
    flags = {}
    for name, (value, lo, hi) in pairs.items():
        if value <= lo + 1e-9:
            flags[name] = "at_min"
        elif value >= hi - 1e-9:
            flags[name] = "at_max"
        else:
            flags[name] = f"{_r(value)} ({_r(lo)}-{_r(hi)})"
    return flags


def _species_subset(species_kg: dict[str, float]) -> dict[str, float]:
    return {name: _r(species_kg[name], 1) for name in ("CO2", "H2O", "C", "NO") if name in species_kg}


def _footprint_block(footprint: MissionFootprint) -> dict:
    analog = footprint.analog
    return {
        "analog": f"{analog.vehicle} {analog.tag}",
        "orbit_km": [_r(analog.perigee_km, 0), _r(analog.apogee_km, 0)],
        "inc_deg": _r(analog.inclination_deg, 1),
        "share": _r(footprint.payload_share, 3),
        "co2e_t": _r(footprint.co2e_attributed_kg / 1000, 2),
        "species_kg": _species_subset(footprint.attributed.species_kg),
    }


def build_analysis_brief(
    mission: SpacecraftMission,
    weather: SpaceWeather,
    constraints: MissionConstraints,
    summary: MonteCarloSummary,
    footprint: MissionFootprint | None = None,
    regulatory_result: dict | None = None,
    regulatory_rules: list[dict] | None = None,
) -> dict:
    baseline = summary.baseline
    total = max(summary.total_runs, 1)
    failure_modes = [
        {"mode": reason, "pct": _r(100.0 * count / total, 1)}
        for reason, count in sorted(summary.failure_modes.items(), key=lambda item: item[1], reverse=True)[:3]
    ]
    top_drivers = [
        {"p": result.parameter, "fail_pct": _r(100.0 * result.failure_rate, 1), "dv_mps": _r(result.mean_abs_delta_v_change, 1)}
        for result in sorted(summary.sensitivity_results, key=lambda result: (result.failure_rate, abs(result.mean_abs_delta_v_change)), reverse=True)[:3]
    ]
    brief = {
        "pass_pct": _r(100.0 * summary.probability_pass, 1),
        "n": summary.total_runs,
        "mission": {key: _r(value, 2) for key, value in mission.to_dict().items()},
        "bounds": _bound_flags(mission, constraints),
        "wx": {"kp": _r(weather.kp, 2), "f107": _r(weather.f107, 0)},
        "dv": {"drag": _r(baseline.drag_delta_v, 1), "cam": _r(baseline.collision_avoidance_delta_v, 1), "insert": _r(baseline.insertion_delta_v, 1), "dispose": _r(baseline.disposal_delta_v, 1), "need": _r(baseline.required_delta_v, 1), "have": _r(baseline.available_delta_v, 1)},
        "fuel": {"load": _r(mission.fuel, 1), "need": _r(baseline.propellant_required, 1), "left": _r(baseline.propellant_remaining, 1)},
        "fails": failure_modes,
        "sensitive": top_drivers,
        "notes": build_insights(mission, weather, constraints, summary, footprint)[:6],
    }
    if footprint is not None:
        brief["emissions"] = _footprint_block(footprint)
    if regulatory_result is not None:
        brief["regulatory"] = regulatory_result
        brief["regulatory_prompt"] = format_for_grok(regulatory_result, regulatory_rules or [])
    return brief


def generate_llm_briefing(brief: dict, timeout_s: float | None = None, retries: int = 2) -> str:
    api_key = _api_key()
    if not api_key:
        raise RuntimeError("No xAI key found. Set xai_api_key or XAI_API_KEY in .env.")
    model = os.environ.get("XAI_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL
    reasoning = os.environ.get("XAI_REASONING", DEFAULT_REASONING).strip() or DEFAULT_REASONING
    timeout_s = float(timeout_s if timeout_s is not None else os.environ.get("XAI_TIMEOUT", DEFAULT_TIMEOUT_S))
    payload = {"model": model, "temperature": 0.2, "max_tokens": MAX_OUTPUT_TOKENS, "reasoning_effort": reasoning, "messages": [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": ANALYSIS_PROMPT + "\n" + json.dumps(brief, separators=(",", ":"))}]}
    last_error = None
    attempts = max(1, retries)
    for attempt in range(attempts):
        try:
            response = requests.post(XAI_CHAT_URL, headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}, json=payload, timeout=(10, timeout_s))
        except requests.exceptions.Timeout as error:
            last_error = error
            if attempt + 1 < attempts:
                continue
            raise RuntimeError(f"xAI timed out after {timeout_s:.0f}s.") from error
        if not response.ok:
            detail = response.text[:400]
            if response.status_code == 400 and "reasoning_effort" in detail:
                payload.pop("reasoning_effort", None)
                last_error = RuntimeError(detail)
                continue
            raise RuntimeError(f"xAI request failed ({response.status_code}): {detail}")
        text = (response.json()["choices"][0]["message"].get("content") or "").strip()
        if not text:
            raise RuntimeError("xAI returned an empty briefing.")
        return text
    raise RuntimeError(str(last_error) if last_error else "xAI request failed.")
