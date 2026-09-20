from design import MissionConstraints, MissionDesigner
from emissions import estimate_mission_footprint, print_footprint
from environment import get_space_weather
from explanations import print_mission_insights
from insights import print_llm_briefing
from regulations import evaluate_mission_compliance, get_latest_debris_rules
from simulate import run_monte_carlo, print_summary


def main():
    constraints = MissionConstraints(
        mass_min=500, mass_max=1000, fuel_min=100, fuel_max=300,
        life_min=3, life_max=7, altitude_min=400, altitude_max=600,
        inclination_min=50, inclination_max=100, area_min=5, area_max=20,
        drag_coefficient_min=1.5, drag_coefficient_max=2.5,
        isp_min=200, isp_max=450,
    )
    mission = MissionDesigner(constraints).prompt_user()

    print("\nNominal Mission")
    for key, value in mission.to_dict().items():
        print(f"{key}: {value:.3f}")

    print("\nSpace Weather")
    weather = get_space_weather()
    print(f"Kp: {weather.kp}")
    print(f"F10.7: {weather.f107}")
    print(f"Solar wind speed: {weather.solar_wind_speed} km/s")
    print(f"Solar wind density: {weather.solar_wind_density} particles/cm^3")
    print(f"Solar wind temperature: {weather.solar_wind_temperature} K")

    print("\nEstimating launch environmental footprint from IGEL 2024...")
    footprint = estimate_mission_footprint(mission)
    print_footprint(footprint)

    print("\nRunning Monte Carlo analysis...")
    summary = run_monte_carlo(mission, weather, n=10_000, sensitivity_runs=1_000, seed=42)
    print_summary(summary)
    print_mission_insights(mission, weather, constraints, summary, footprint)

    # The current Python model exposes mission lifespan, but not a separate
    # orbital-decay prediction after disposal. Keep the connection explicit and
    # label this as a screening input rather than claiming a physical estimate.
    compliance_input = {
        "mission_name": "Interactive mission",
        "post_mission_decay_years": mission.lifespan,
        "fuel_margin_percent": 100 * summary.baseline.propellant_remaining / mission.fuel,
    }
    regulatory_result = evaluate_mission_compliance(compliance_input)
    try:
        regulatory_rules = get_latest_debris_rules()
    except (OSError, ValueError) as error:
        print(f"Federal Register rules unavailable: {error}")
        regulatory_rules = []
    except Exception as error:
        print(f"Federal Register request failed: {error}")
        regulatory_rules = []

    print("\nRegulatory screening")
    print(regulatory_result)
    print_llm_briefing(
        mission, weather, constraints, summary, footprint,
        regulatory_result, regulatory_rules,
    )


if __name__ == "__main__":
    main()
