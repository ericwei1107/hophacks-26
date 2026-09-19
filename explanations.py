"""Deterministic mission-analysis explanations.

Replaces the removed LLM-based `insights` module. Every statement is derived
from the simulation summary data, so identical inputs always produce identical
explanations.
"""

from design import MissionConstraints, SpacecraftMission
from environment import SpaceWeather
from simulate import MonteCarloSummary

FAILURE_EXPLANATIONS = {
    "invalid_mass": "Spacecraft dry mass must be positive.",
    "no_fuel": "The mission carries no usable propellant.",
    "invalid_cross_section_area": "Cross-sectional area must be positive.",
    "invalid_drag_coefficient": "Drag coefficient must be positive.",
    "invalid_isp": "Specific impulse must be positive.",
    "invalid_lifespan": "Mission lifespan must be positive.",
    "insufficient_delta_v": (
        "Available delta-v cannot cover drag stationkeeping, collision "
        "avoidance, and insertion correction."
    ),
    "failed_disposal": (
        "Operations are affordable, but the end-of-life disposal burn is not."
    ),
    "insufficient_propellant": (
        "Loaded propellant is below the minimum required for the delta-v budget."
    ),
    "insufficient_propellant_reserve": (
        "The mission completes but violates the 10% propellant reserve rule."
    ),
    "below_operating_altitude": (
        "Without affordable stationkeeping, drag pulls the spacecraft below "
        "the minimum operating altitude."
    ),
    "orbital_decay": (
        "Without affordable stationkeeping, the spacecraft reenters before "
        "the end of the mission."
    ),
}


def explain_failure(reason: str) -> str:
    return FAILURE_EXPLANATIONS.get(reason, "Unclassified failure mode.")


def build_insights(
    mission: SpacecraftMission,
    weather: SpaceWeather,
    constraints: MissionConstraints,
    summary: MonteCarloSummary,
) -> list[str]:
    baseline = summary.baseline
    insights = []

    if baseline.passed:
        insights.append("Baseline mission passes all checks under reference weather.")
    else:
        reasons = ", ".join(baseline.failure_reasons)
        insights.append(f"Baseline mission fails: {reasons}.")
        for reason in baseline.failure_reasons:
            insights.append(f"  - {explain_failure(reason)}")

    margin = baseline.available_delta_v - baseline.required_delta_v
    insights.append(
        f"Delta-v margin: {margin:+.2f} m/s "
        f"(available {baseline.available_delta_v:.2f}, required {baseline.required_delta_v:.2f})."
    )

    components = {
        "drag stationkeeping": baseline.drag_delta_v,
        "collision avoidance": baseline.collision_avoidance_delta_v,
        "insertion correction": baseline.insertion_delta_v,
        "disposal": baseline.disposal_delta_v,
    }
    dominant = max(components, key=components.get)
    if components[dominant] > 0:
        insights.append(
            f"Largest budget component: {dominant} at {components[dominant]:.2f} m/s."
        )

    insights.append(
        f"Monte Carlo pass rate: {summary.probability_pass:.1%} over "
        f"{summary.total_runs:,} runs."
    )

    if summary.failure_modes:
        top_mode, top_count = max(summary.failure_modes.items(), key=lambda item: item[1])
        insights.append(
            f"Most common failure mode: {top_mode} "
            f"({top_count / summary.total_runs:.1%} of runs). {explain_failure(top_mode)}"
        )

    if summary.sensitivity_results:
        top = summary.sensitivity_results[0]
        insights.append(
            f"Most sensitive parameter: {top.parameter} "
            f"(failure rate {top.failure_rate:.1%}, "
            f"mean |delta-v| change {top.mean_abs_delta_v_change:.2f} m/s)."
        )

    return insights


def print_mission_insights(
    mission: SpacecraftMission,
    weather: SpaceWeather,
    constraints: MissionConstraints,
    summary: MonteCarloSummary,
) -> None:
    print("\nDeterministic mission insights:")
    for line in build_insights(mission, weather, constraints, summary):
        print(f"  {line}")
