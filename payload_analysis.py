"""Map a launched TypeScript payload onto the original Python mission stack.

Ascent stays in the browser. This module owns the post-insertion case the CLI
already knew how to run: circularize, three-year operations, Monte Carlo,
IGEL emissions, and deterministic insights.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from design import MissionConstraints, SpacecraftMission
from emissions import CACHE_DIR, ARCHIVE_NAME, estimate_mission_footprint
from environment import SpaceWeather, fetch_noaa_snapshot
from explanations import build_insights
from insights import _api_key, build_analysis_brief, generate_llm_briefing
from regulations import evaluate_mission_compliance, get_latest_debris_rules
from scenario_patterns import recognize_patterns
import simulate as s

PAYLOAD_ISP_S = 325.0
PAYLOAD_DRAG_COEFFICIENT = 2.2
PAYLOAD_MISSION_YEARS = 3.0
GAME_MIN_OPERATING_ALTITUDE_KM = 150.0

GAME_PAYLOAD_CONSTRAINTS = MissionConstraints(
    mass_min=400.0,
    mass_max=16_000.0,
    fuel_min=1.0,
    fuel_max=4_000.0,
    life_min=1.0,
    life_max=7.0,
    altitude_min=120.0,
    altitude_max=400.0,
    inclination_min=0.0,
    inclination_max=180.0,
    area_min=1.0,
    area_max=80.0,
    drag_coefficient_min=1.5,
    drag_coefficient_max=2.5,
    isp_min=200.0,
    isp_max=450.0,
)


@dataclass(frozen=True)
class PayloadHandoff:
    payload_dry_mass_kg: float
    payload_propellant_kg: float
    achieved_perigee_km: float
    achieved_apogee_km: float
    achieved_inclination_deg: float
    stage2_propellant_remaining_kg: float
    weather: SpaceWeather
    seed: int = 0

    @property
    def payload_wet_mass_kg(self) -> float:
        return self.payload_dry_mass_kg + self.payload_propellant_kg


def circularization_delta_v(perigee_km: float, apogee_km: float) -> float:
    r_a = s.EARTH_RADIUS + apogee_km * 1000.0
    r_p = s.EARTH_RADIUS + perigee_km * 1000.0
    semi_major = (r_a + r_p) / 2.0
    v_apogee = (s.MU_EARTH * (2.0 / r_a - 1.0 / semi_major)) ** 0.5
    v_circular = (s.MU_EARTH / r_a) ** 0.5
    return max(0.0, v_circular - v_apogee)


def spacecraft_from_masses(dry_mass_kg: float, onboard_propellant_kg: float) -> tuple[float, float, float]:
    wet_mass_kg = dry_mass_kg + onboard_propellant_kg
    cross_section_area_m2 = 5.0 * (wet_mass_kg / 1000.0) ** (2.0 / 3.0)
    return dry_mass_kg, onboard_propellant_kg, cross_section_area_m2


def weather_snapshot_from_noaa() -> dict[str, Any]:
    snapshot = fetch_noaa_snapshot()
    weather = SpaceWeather(**snapshot["weather"])
    snapshot["effects"] = s.assess_space_weather_effects(weather, computed_by="python")
    snapshot["source"] = "python"
    return snapshot


def igel_archive_cached() -> bool:
    path = CACHE_DIR / ARCHIVE_NAME
    return path.exists() and path.stat().st_size > 1_000_000


def briefing_configured() -> bool:
    return bool(_api_key())


def analyze_launched_payload(
    handoff: PayloadHandoff,
    *,
    runs: int = 1_000,
    sensitivity_runs: int = 200,
    include_briefing: bool = False,
) -> dict[str, Any]:
    if runs <= 0 or sensitivity_runs <= 0:
        raise ValueError("Monte Carlo run counts must be positive.")

    dry_mass_kg, onboard_propellant_kg, area_m2 = spacecraft_from_masses(
        handoff.payload_dry_mass_kg, handoff.payload_propellant_kg
    )
    circ_dv = circularization_delta_v(
        handoff.achieved_perigee_km, handoff.achieved_apogee_km
    )
    circ_spec = SpacecraftMission(
        mass=dry_mass_kg,
        fuel=onboard_propellant_kg,
        lifespan=PAYLOAD_MISSION_YEARS,
        target_altitude=handoff.achieved_apogee_km,
        target_inclination=handoff.achieved_inclination_deg,
        cross_section_area=area_m2,
        drag_coefficient=PAYLOAD_DRAG_COEFFICIENT,
        isp=PAYLOAD_ISP_S,
    )
    circ_propellant = s.estimate_propellant_consumed(circ_spec, circ_dv)
    insertion_ok = circ_propellant <= onboard_propellant_kg

    report: dict[str, Any] = {
        "source": "python",
        "dryMassKg": dry_mass_kg,
        "onboardPropellantKg": onboard_propellant_kg,
        "crossSectionAreaM2": area_m2,
        "ispS": PAYLOAD_ISP_S,
        "missionYears": PAYLOAD_MISSION_YEARS,
        "circularizationDeltaVMs": circ_dv,
        "circularizationPropellantKg": circ_propellant,
        "insertionBudgetOk": insertion_ok,
        "operatingFloorKm": GAME_MIN_OPERATING_ALTITUDE_KM,
        "mission": None,
        "result": None,
        "monteCarlo": None,
        "explanations": [],
        "insights": [],
        "emissions": None,
        "regulatory": None,
        "regulatoryRules": [],
        "briefing": None,
        "patternRecognition": recognize_patterns(handoff.weather),
    }

    if not insertion_ok:
        report["explanations"] = [
            (
                f"Circularizing the achieved {handoff.achieved_perigee_km:.0f} x "
                f"{handoff.achieved_apogee_km:.0f} km orbit needs {circ_dv:.0f} m/s, "
                "but the payload's onboard propellant affords less. Insertion-budget "
                "failure: the launch left the payload too elliptical."
            )
        ]
        return report

    remaining_fuel = onboard_propellant_kg - circ_propellant
    mission = SpacecraftMission(
        mass=dry_mass_kg,
        fuel=remaining_fuel,
        lifespan=PAYLOAD_MISSION_YEARS,
        target_altitude=handoff.achieved_apogee_km,
        target_inclination=handoff.achieved_inclination_deg,
        cross_section_area=area_m2,
        drag_coefficient=PAYLOAD_DRAG_COEFFICIENT,
        isp=PAYLOAD_ISP_S,
    )
    report["mission"] = mission.to_dict()
    ops = s.OperationalDraw()

    with s.operating_altitude_floor(GAME_MIN_OPERATING_ALTITUDE_KM):
        result = s.simulate(mission, handoff.weather, ops)
        summary = s.run_monte_carlo(
            mission,
            handoff.weather,
            n=runs,
            sensitivity_runs=sensitivity_runs,
            seed=handoff.seed,
        )

    report["result"] = asdict(result)
    report["monteCarlo"] = {
        "total_runs": summary.total_runs,
        "passes": summary.passes,
        "failures": summary.failures,
        "probability_pass": summary.probability_pass,
        "probability_fail": summary.probability_fail,
        "failure_modes": summary.failure_modes,
        "sensitivity_results": [asdict(item) for item in summary.sensitivity_results],
        "baseline": asdict(summary.baseline),
    }
    report["explanations"] = _explain_payload(
        handoff, dry_mass_kg, onboard_propellant_kg, area_m2, circ_dv, mission, result
    )

    footprint = _safe_footprint(mission)
    if footprint is not None:
        analog = footprint.analog
        report["emissions"] = {
            "analog": f"{analog.vehicle} {analog.tag}",
            "orbitKm": [analog.perigee_km, analog.apogee_km],
            "inclinationDeg": analog.inclination_deg,
            "payloadShare": footprint.payload_share,
            "co2eTonnes": footprint.co2e_attributed_kg / 1000.0,
            "attributedExhaustKg": footprint.attributed.total_kg,
            "citation": footprint.citation,
        }

    decay_years = s.estimate_post_mission_decay_years(mission, handoff.weather, result)
    compliance_input = {
        "mission_name": "Launched payload",
        "post_mission_decay_years": decay_years,
        "fuel_margin_percent": (
            100.0 * summary.baseline.propellant_remaining / mission.fuel
            if mission.fuel
            else 0.0
        ),
    }
    report["regulatory"] = evaluate_mission_compliance(compliance_input)
    try:
        report["regulatoryRules"] = get_latest_debris_rules()
    except Exception as error:
        report["regulatoryRules"] = []
        report["regulatoryError"] = str(error)

    report["insights"] = build_insights(
        mission, handoff.weather, GAME_PAYLOAD_CONSTRAINTS, summary, footprint
    )

    if include_briefing and briefing_configured():
        brief = build_analysis_brief(
            mission,
            handoff.weather,
            GAME_PAYLOAD_CONSTRAINTS,
            summary,
            footprint,
            report["regulatory"],
            report["regulatoryRules"],
        )
        try:
            report["briefing"] = generate_llm_briefing(brief)
        except Exception as error:
            report["briefingError"] = str(error)

    return report


def _explain_payload(
    handoff: PayloadHandoff,
    dry_mass_kg: float,
    onboard_propellant_kg: float,
    area_m2: float,
    circ_dv: float,
    mission: SpacecraftMission,
    result: s.SimulationResult,
) -> list[str]:
    lines = [
        (
            f"Payload {(handoff.payload_wet_mass_kg / 1000):.1f} t: dry "
            f"{(dry_mass_kg / 1000):.2f} t, onboard propellant "
            f"{(onboard_propellant_kg / 1000):.2f} t, Isp {PAYLOAD_ISP_S:.0f} s, "
            f"area {area_m2:.1f} m^2, {PAYLOAD_MISSION_YEARS:.0f}-year mission at "
            f"{mission.target_altitude:.0f} km circularized (cost {circ_dv:.0f} m/s)."
        )
    ]
    if result.passed:
        lines.append(
            f"Baseline mission passes: required {result.required_delta_v:.1f} m/s vs "
            f"available {result.available_delta_v:.1f} m/s; "
            f"{result.propellant_remaining:.1f} kg propellant remains."
        )
    else:
        lines.append(f"Baseline mission fails: {', '.join(result.failure_reasons)}.")
        if "insufficient_delta_v" in result.failure_reasons or "orbital_decay" in result.failure_reasons:
            lines.append(
                f"At {mission.target_altitude:.0f} km the atmosphere still drags the "
                f"spacecraft down over {PAYLOAD_MISSION_YEARS:.0f} years. A higher orbit "
                "or more onboard propellant would survive longer — a real engineering "
                "tradeoff, not a guaranteed fix."
            )
        if "insufficient_propellant_reserve" in result.failure_reasons:
            lines.append("The mission completes but dips below the 10% propellant reserve rule.")
    if handoff.stage2_propellant_remaining_kg > 1:
        lines.append(
            f"Note: {(handoff.stage2_propellant_remaining_kg / 1000):.2f} t of "
            "upper-stage propellant was left over at cutoff — it stays with the "
            "spent stage and is not available to the payload."
        )
    return lines


def _safe_footprint(mission: SpacecraftMission):
    archive = Path(CACHE_DIR / ARCHIVE_NAME)
    try:
        if archive.exists():
            return estimate_mission_footprint(mission, archive)
        return estimate_mission_footprint(mission)
    except Exception:
        return None
