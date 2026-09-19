from dataclasses import dataclass, field
import math
import random

from design import SpacecraftMission
from environment import SpaceWeather

MISSION_STRESS_RANGES = {
    'mass': (-0.02, 0.02),
    'fuel': (-0.03, 0.03),
    'lifespan': (-0.05, 0.05),
    'target_altitude': (-0.01, 0.01),
    'target_inclination': (-0.5, 0.5),
    'cross_section_area': (-0.05, 0.05),
    'drag_coefficient': (-0.05, 0.05),
    'isp': (-0.02, 0.02)
}

WEATHER_STRESS_RANGES = {
    'kp': (-0.20, 0.20),
    'f107': (-0.10, 0.10),
    'solar_wind_speed': (-0.05, 0.05),
    'solar_wind_density': (-0.10, 0.10),
    'solar_wind_temperature': (-0.10, 0.10)
}

@dataclass
class SimulationResult:
    passed: bool
    failure_reasons: list[str] = field(default_factory=list)

    available_delta_v: float = 0.0
    required_delta_v: float = 0.0

    propellant_required: float = 0.0
    propellant_remaining: float = 0.0

    initial_altitude: float = 0.0
    final_altitude: float = 0.0
    orbital_decay: float = 0.0

    average_density: float = 0.0
    average_drag: float = 0.0

@dataclass
class MonteCarloSummary:
    total_runs: int
    passes: int
    failures: int
    probability_pass: float
    probability_fail: float
    failure_modes: dict[str, int]

MU_EARTH = 3.986004418e14
EARTH_RADIUS = 6_371_000
G0 = 9.80665
SECONDS_PER_DAY = 86_400
DAYS_PER_YEAR = 365.25

def perturb(value: float, minimum: float, maximum: float, rng: random.Random) -> float:
    percentage = rng.uniform(minimum, maximum)
    return value * (1 + percentage)

def create_stressed_mission(mission: SpacecraftMission, rng: random.Random) -> SpacecraftMission:
    return SpacecraftMission(
        mass = perturb(mission.mass, *MISSION_STRESS_RANGES['mass'], rng),
        fuel = perturb(mission.fuel, *MISSION_STRESS_RANGES['fuel'], rng),
        lifespan = perturb(mission.lifespan, *MISSION_STRESS_RANGES['lifespan'], rng),
        target_altitude = perturb(mission.target_altitude, *MISSION_STRESS_RANGES['target_altitude'], rng),
        target_inclination = mission.target_inclination + rng.uniform(*MISSION_STRESS_RANGES['target_inclination']),
        cross_section_area = perturb(mission.cross_section_area, *MISSION_STRESS_RANGES['cross_section_area'], rng),
        drag_coefficient = perturb(mission.drag_coefficient, *MISSION_STRESS_RANGES['drag_coefficient'], rng),
        isp = perturb(mission.isp, *MISSION_STRESS_RANGES['isp'], rng)
    )

def create_stressed_weather(weather: SpaceWeather, rng: random.Random) -> SpaceWeather:
    return SpaceWeather(
        kp = perturb(weather.kp, *WEATHER_STRESS_RANGES['kp'], rng),
        f107 = perturb(weather.f107, *WEATHER_STRESS_RANGES['f107'], rng),
        solar_wind_speed = perturb(weather.solar_wind_speed, *WEATHER_STRESS_RANGES['solar_wind_speed'], rng),
        solar_wind_density = perturb(weather.solar_wind_density, *WEATHER_STRESS_RANGES['solar_wind_density'], rng),
        solar_wind_temperature = perturb(weather.solar_wind_temperature, *WEATHER_STRESS_RANGES['solar_wind_temperature'], rng)
    )

def orbital_velocity(altitude_km: float) -> float:
    radius = EARTH_RADIUS + altitude_km * 1000
    return math.sqrt(MU_EARTH / radius)

def estimate_atmospheric_density(altitude_km: float, f107: float, kp: float) -> float:
    """
    captures the important dependency:
    altitude + solar activity + geomagnetic activity -> density.
    """

    base_density = 1.225e-9 * math.exp(-(altitude_km - 400) / 50)

    solar_factor = max(0.1, 1 + 0.002 * (f107 - 70))
    geomagnetic_factor = max(0.1, 1 + 0.05 * kp)

    return base_density * solar_factor * geomagnetic_factor

def estimate_drag_force(mission: SpacecraftMission, weather: SpaceWeather) -> float:
    density = estimate_atmospheric_density(mission.target_altitude, weather.f107, weather.kp)
    velocity = orbital_velocity(mission.target_altitude)

    return 0.5 * density * velocity ** 2 * mission.drag_coefficient * mission.cross_section_area

def estimate_drag_acceleration(mission: SpacecraftMission, weather: SpaceWeather) -> float:
    drag_force = estimate_drag_force(mission, weather)
    return drag_force / (mission.mass * 1000)

def estimate_orbital_decay_rate(mission: SpacecraftMission, weather: SpaceWeather) -> float:
    """
    calculates da/dt for a circular orbit.

    dE/dt from atmospheric drag is converted into
    a change in orbital semi-major axis.
    """

    radius = EARTH_RADIUS + mission.target_altitude * 1000
    velocity = orbital_velocity(mission.target_altitude)
    acceleration = estimate_drag_acceleration(mission, weather)

    return -2 * radius ** 2 * acceleration * velocity / MU_EARTH


def estimate_stationkeeping_delta_v(mission: SpacecraftMission, weather: SpaceWeather) -> tuple[float, float, float, float]:
    """
    returns:
        required delta-v,
        total altitude loss,
        average density,
        average drag force
    """

    radius = EARTH_RADIUS + mission.target_altitude * 1000
    altitude = mission.target_altitude * 1000

    total_seconds = mission.lifespan * DAYS_PER_YEAR * SECONDS_PER_DAY
    timestep = SECONDS_PER_DAY

    steps = max(1, math.ceil(total_seconds / timestep))

    total_delta_v = 0.0
    total_density = 0.0
    total_drag = 0.0

    for _ in range(steps):
        current_altitude_km = altitude / 1000

        if current_altitude_km <= 120:
            break

        density = estimate_atmospheric_density(
            current_altitude_km,
            weather.f107,
            weather.kp
        )

        velocity = orbital_velocity(current_altitude_km)
        drag_force = 0.5 * density * velocity ** 2 * mission.drag_coefficient * mission.cross_section_area
        drag_acceleration = drag_force / (mission.mass * 1000)

        # Orbital energy loss caused by drag.
        decay_rate = -2 * radius ** 2 * drag_acceleration * velocity / MU_EARTH
        altitude_change = decay_rate * timestep

        # Δv required to restore the lost orbital energy.
        delta_v = abs(altitude_change) * velocity / (2 * radius)

        total_delta_v += delta_v
        total_density += density
        total_drag += drag_force

        altitude += altitude_change
        radius = EARTH_RADIUS + altitude

    average_density = total_density / steps
    average_drag = total_drag / steps
    altitude_loss = mission.target_altitude - altitude / 1000

    return total_delta_v, altitude_loss, average_density, average_drag

def estimate_delta_v_available(mission: SpacecraftMission) -> float:
    if mission.fuel <= 0 or mission.mass <= 0 or mission.isp <= 0:
        return 0.0

    initial_mass = mission.mass + mission.fuel
    final_mass = mission.mass

    return mission.isp * G0 * math.log(initial_mass / final_mass)

def estimate_propellant_required(mission: SpacecraftMission, required_delta_v: float) -> float:
    if required_delta_v <= 0:
        return 0.0

    if mission.isp <= 0 or mission.mass <= 0:
        return float('inf')

    mass_ratio = math.exp(required_delta_v / (mission.isp * G0))
    final_mass = mission.mass

    initial_mass = final_mass * mass_ratio

    return initial_mass - final_mass


def simulate(mission: SpacecraftMission, weather: SpaceWeather) -> SimulationResult:
    failures = []

    if mission.mass <= 0:
        failures.append('invalid_mass')

    if mission.fuel <= 0:
        failures.append('no_fuel')

    if mission.cross_section_area <= 0:
        failures.append('invalid_cross_section_area')

    if mission.drag_coefficient <= 0:
        failures.append('invalid_drag_coefficient')

    if mission.isp <= 0:
        failures.append('invalid_isp')

    if mission.lifespan <= 0:
        failures.append('invalid_lifespan')

    if failures:
        return SimulationResult(
            passed=False,
            failure_reasons=failures
        )

    required_delta_v, altitude_loss, average_density, average_drag = estimate_stationkeeping_delta_v(
        mission,
        weather
    )

    available_delta_v = estimate_delta_v_available(mission)
    propellant_required = estimate_propellant_required(mission, required_delta_v)
    propellant_remaining = mission.fuel - propellant_required

    if propellant_required > mission.fuel:
        failures.append('insufficient_propellant')

    if required_delta_v > available_delta_v:
        failures.append('insufficient_delta_v')

    final_altitude = mission.target_altitude - altitude_loss

    if final_altitude < 120:
        failures.append('orbital_decay')

    return SimulationResult(
        passed = len(failures) == 0,
        failure_reasons = failures,
        available_delta_v = available_delta_v,
        required_delta_v = required_delta_v,
        propellant_required = propellant_required,
        propellant_remaining = propellant_remaining,
        initial_altitude = mission.target_altitude,
        final_altitude = final_altitude,
        orbital_decay = altitude_loss,
        average_density = average_density,
        average_drag = average_drag
    )

def run_stress_test(mission: SpacecraftMission, weather: SpaceWeather, n: int = 10_000, seed: int | None = 42) -> MonteCarloSummary:
    rng = random.Random(seed)
    passes = 0
    failures = 0
    failure_modes = {}

    for _ in range(n):
        stressed_mission = create_stressed_mission(mission, rng)
        stressed_weather = create_stressed_weather(weather, rng)
        result = simulate(stressed_mission, stressed_weather)

        if result.passed:
            passes += 1
        else:
            failures += 1

            for reason in result.failure_reasons:
                failure_modes[reason] = failure_modes.get(reason, 0) + 1

    return MonteCarloSummary(
        total_runs = n,
        passes = passes,
        failures = failures,
        probability_pass = passes / n,
        probability_fail = failures / n,
        failure_modes = failure_modes
    )