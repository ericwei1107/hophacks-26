from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field, replace
import math
import random
from design import SpacecraftMission
from environment import REFERENCE_WEATHER, SpaceWeather

# covers mass growth, array deployment, and Cd underestimates.
MISSION_STRESS_RANGES = {
    "mass": (-0.10, 0.12),
    "fuel": (-0.08, 0.05),
    "lifespan": (-0.10, 0.15),
    "target_altitude": (-0.08, 0.05),
    "target_inclination": (-3.0, 3.0),
    "cross_section_area": (-0.15, 0.20),
    "drag_coefficient": (-0.15, 0.22),
    "isp": (-0.08, 0.05)
}

WEATHER_STRESS_RANGES = {
    "kp": (-0.40, 0.45),
    "f107": (-0.22, 0.25),
    "solar_wind_speed": (-0.18, 0.22),
    "solar_wind_density": (-0.25, 0.30),
    "solar_wind_temperature": (-0.20, 0.25)
}

MU_EARTH = 3.986004418e14
EARTH_RADIUS = 6_371_000
G0 = 9.80665
SECONDS_PER_DAY = 86_400
DAYS_PER_YEAR = 365.25
PROPULSION_RESERVE_FRACTION = 0.10
MIN_OPERATING_ALTITUDE_KM = 220.0
REENTRY_ALTITUDE_KM = 120.0
STORM_PROBABILITY = 0.12

_OPERATING_FLOOR_KM: ContextVar[float] = ContextVar(
    "operating_floor_km", default=MIN_OPERATING_ALTITUDE_KM
)


def _operating_floor_km() -> float:
    return _OPERATING_FLOOR_KM.get()


@contextmanager
def operating_altitude_floor(floor_km: float):
    """Temporarily use a different operating-altitude floor (game: 150 km)."""
    token = _OPERATING_FLOOR_KM.set(floor_km)
    try:
        yield
    finally:
        _OPERATING_FLOOR_KM.reset(token)


DISPOSAL_PERIGEE_KM = 150.0
INSERTION_ALTITUDE_SIGMA_KM = 12.0
INSERTION_INCLINATION_SIGMA_DEG = 0.70
BAD_LAUNCH_PROBABILITY = 0.08

@dataclass
class OperationalDraw:
    insertion_altitude_error_km: float = 0.0
    insertion_inclination_error_deg: float = 0.0
    cam_scale: float = 1.0

@dataclass
class SimulationResult:
    passed: bool
    failure_reasons: list[str] = field(default_factory = list)
    available_delta_v: float = 0.0
    required_delta_v: float = 0.0
    drag_delta_v: float = 0.0
    collision_avoidance_delta_v: float = 0.0
    insertion_delta_v: float = 0.0
    disposal_delta_v: float = 0.0
    propellant_required: float = 0.0
    propellant_consumed: float = 0.0
    propellant_remaining: float = 0.0
    initial_altitude: float = 0.0
    final_altitude: float = 0.0
    orbital_decay: float = 0.0
    average_density: float = 0.0
    average_drag: float = 0.0

@dataclass
class SensitivityResult:
    parameter: str
    runs: int
    passes: int
    failures: int
    failure_rate: float
    average_delta_v_change: float
    average_altitude_change: float
    average_propellant_change: float
    average_margin_change: float
    mean_abs_delta_v_change: float

@dataclass
class MonteCarloSummary:
    total_runs: int
    passes: int
    failures: int
    probability_pass: float
    probability_fail: float
    failure_modes: dict[str, int]
    sensitivity_results: list[SensitivityResult]
    baseline: SimulationResult

def clip(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))

def perturb(value: float, minimum: float, maximum: float, rng: random.Random) -> float:
    midpoint = (minimum + maximum) / 2
    sigma = (maximum - minimum) / 4
    if sigma <= 0:
        return value

    fraction = rng.gauss(midpoint, sigma)
    fraction = clip(fraction, minimum, maximum)
    return value * (1 + fraction)

def perturb_parameter(mission: SpacecraftMission, parameter: str, rng: random.Random) -> SpacecraftMission:
    if parameter == "target_inclination":
        low, high = MISSION_STRESS_RANGES[parameter]
        delta = rng.gauss((low + high) / 2, (high - low) / 4)
        delta = clip(delta, low, high)
        inclination = clip(mission.target_inclination + delta, 0.0, 180.0)
        return replace(mission, target_inclination = inclination)

    new_value = perturb(getattr(mission, parameter), *MISSION_STRESS_RANGES[parameter], rng)
    return replace(mission, **{parameter: max(new_value, 1e-9)})

def perturb_weather_parameter(weather: SpaceWeather, parameter: str, rng: random.Random) -> SpaceWeather:
    new_value = perturb(getattr(weather, parameter), *WEATHER_STRESS_RANGES[parameter], rng)
    return replace(weather, **{parameter: _clip_weather_value(parameter, new_value)})

WEATHER_BOUNDS = {
    "kp": (0.0, 9.0),
    "f107": (60.0, 280.0),
    "solar_wind_speed": (250.0, 1200.0),
    "solar_wind_density": (0.5, 80.0),
    "solar_wind_temperature": (1.0e4, 1.0e6)
}

def _clip_weather_value(parameter: str, value: float) -> float:
    return clip(value, *WEATHER_BOUNDS[parameter])

def create_stressed_mission(mission: SpacecraftMission, rng: random.Random) -> SpacecraftMission:
    stressed = mission
    for parameter in MISSION_STRESS_RANGES:
        stressed = perturb_parameter(stressed, parameter, rng)
    return stressed

def create_stressed_weather(weather: SpaceWeather, rng: random.Random) -> SpaceWeather:
    # most years look like today, plus or minus forecast noise.
    if rng.random() < STORM_PROBABILITY:
        return SpaceWeather(
            kp = _clip_weather_value("kp", rng.uniform(5.2, 8.4)),
            f107 = _clip_weather_value("f107", weather.f107 * rng.uniform(1.25, 1.70)),
            solar_wind_speed = _clip_weather_value("solar_wind_speed", weather.solar_wind_speed * rng.uniform(1.20, 1.65)),
            solar_wind_density = _clip_weather_value("solar_wind_density", weather.solar_wind_density * rng.uniform(1.40, 2.50)),
            solar_wind_temperature = _clip_weather_value("solar_wind_temperature", weather.solar_wind_temperature * rng.uniform(1.15, 1.80))
        )

    return SpaceWeather(
        kp = _clip_weather_value("kp", perturb(weather.kp, *WEATHER_STRESS_RANGES["kp"], rng)),
        f107 = _clip_weather_value("f107", perturb(weather.f107, *WEATHER_STRESS_RANGES["f107"], rng)),
        solar_wind_speed = _clip_weather_value("solar_wind_speed", perturb(weather.solar_wind_speed, *WEATHER_STRESS_RANGES["solar_wind_speed"], rng)),
        solar_wind_density = _clip_weather_value("solar_wind_density", perturb(weather.solar_wind_density, *WEATHER_STRESS_RANGES["solar_wind_density"], rng)),
        solar_wind_temperature = _clip_weather_value("solar_wind_temperature", perturb(weather.solar_wind_temperature, *WEATHER_STRESS_RANGES["solar_wind_temperature"], rng))
    )

def create_stressed_ops(rng: random.Random) -> OperationalDraw:
    if rng.random() < BAD_LAUNCH_PROBABILITY:
        inclination_error = rng.gauss(0.0, 1.15)
    else:
        inclination_error = rng.gauss(0.0, INSERTION_INCLINATION_SIGMA_DEG)

    return OperationalDraw(
        insertion_altitude_error_km = clip(rng.gauss(0.0, INSERTION_ALTITUDE_SIGMA_KM), -40.0, 40.0),
        insertion_inclination_error_deg = clip(inclination_error, -2.4, 2.4),
        cam_scale = clip(rng.gauss(1.0, 0.28), 0.45, 2.3)
    )

def perturb_ops_parameter(ops: OperationalDraw, parameter: str, rng: random.Random) -> OperationalDraw:
    if parameter == "insertion_altitude_error_km":
        return replace(ops, insertion_altitude_error_km = clip(rng.gauss(0.0, INSERTION_ALTITUDE_SIGMA_KM), -40.0, 40.0))
    if parameter == "insertion_inclination_error_deg":
        return replace(ops, insertion_inclination_error_deg = clip(rng.gauss(0.0, INSERTION_INCLINATION_SIGMA_DEG), -2.4, 2.4))
    if parameter == "debris_environment":
        return replace(ops, cam_scale = clip(rng.gauss(1.0, 0.35), 0.45, 2.3))
    return ops

def orbital_velocity(altitude_km: float) -> float:
    radius = EARTH_RADIUS + altitude_km * 1000
    return math.sqrt(MU_EARTH / radius)

def atmospheric_relative_velocity(altitude_km: float, inclination_deg: float) -> float:
    inertial = orbital_velocity(altitude_km)
    radius = EARTH_RADIUS + altitude_km * 1000
    co_rotation = 465.0 * radius / EARTH_RADIUS
    inclination = math.radians(inclination_deg)
    relative_sq = inertial ** 2 + co_rotation ** 2 - 2 * inertial * co_rotation * math.cos(inclination)
    return math.sqrt(max(relative_sq, 0.0))

def _finite_or(value: float | None, fallback: float) -> float:
    # Missing, NaN, or infinite weather must never produce an invalid simulation.
    if value is None or not math.isfinite(value):
        return fallback
    return value

def _thermosphere_profile(weather: SpaceWeather, inclination_deg: float) -> tuple[float, float]:
    """Scale height (km) and weather multiplier; independent of altitude."""
    f107 = max(_finite_or(weather.f107, 70.0), 60.0)
    kp = max(_finite_or(weather.kp, 0.0), 0.0)
    speed = _finite_or(weather.solar_wind_speed, 400.0)
    sw_density = _finite_or(weather.solar_wind_density, 5.0)
    sw_temp = _finite_or(weather.solar_wind_temperature, 1.0e5)

    # Thermosphere expands under solar EUV and geomagnetic heating.
    scale_height = 42.0 + 0.07 * (f107 - 70.0) + 1.4 * kp
    solar_factor = (f107 / 150.0) ** 1.2
    geomagnetic_factor = 1.0 + 0.05 * kp + 0.12 * max(0.0, kp - 4.5) ** 1.3
    wind_factor = 1.0 + 0.0004 * (speed - 400.0) + 0.008 * (sw_density - 5.0) + 0.04 * ((sw_temp / 1.0e5) - 1.0)
    polar_factor = 1.0 + 0.08 * abs(math.sin(math.radians(inclination_deg))) * max(0.0, kp - 2.0) / 4.0
    weather_factor = solar_factor * max(0.25, geomagnetic_factor) * max(0.4, wind_factor) * max(1.0, polar_factor)
    return scale_height, weather_factor


def estimate_atmospheric_density(altitude_km: float, weather: SpaceWeather, inclination_deg: float = 0.0) -> float:
    if not math.isfinite(altitude_km) or not math.isfinite(inclination_deg):
        return 1e-16
    scale_height, weather_factor = _thermosphere_profile(weather, inclination_deg)
    base_density = 1.225e-12 * math.exp(-(altitude_km - 400.0) / scale_height)
    return max(1e-16, base_density * weather_factor)


def _severity_rank(severity: str) -> int:
    return {"quiet": 0, "elevated": 1, "storm": 2}.get(severity, 0)


def _weather_causes(weather: SpaceWeather, density_ratio: float) -> list[dict[str, str]]:
    kp = _finite_or(weather.kp, 0.0)
    f107 = _finite_or(weather.f107, 70.0)
    speed = _finite_or(weather.solar_wind_speed, 400.0)
    sw_density = _finite_or(weather.solar_wind_density, 5.0)

    if kp >= 5.0:
        kp_cause = ("storm", "Geomagnetic storm", "Kp at storm levels heats and inflates the thermosphere, raising high-altitude drag during the vacuum portion of ascent and later stationkeeping.")
    elif kp >= 4.0:
        kp_cause = ("elevated", "Geomagnetic activity", "Active geomagnetic conditions expand the upper atmosphere. This is an environmental cause, not a vehicle control.")
    else:
        kp_cause = ("quiet", "Quiet geomagnetic field", "Kp is quiet, so geomagnetic heating is not adding extra thermospheric drag.")

    if f107 >= 200.0:
        f107_cause = ("storm", "High solar EUV", "F10.7 is at high solar-cycle levels, so the thermosphere is expanded and high-altitude density is up.")
    elif f107 >= 180.0:
        f107_cause = ("elevated", "Elevated solar EUV", "F10.7 is high enough to inflate the thermosphere versus the reference snapshot.")
    else:
        f107_cause = ("quiet", "Moderate solar EUV", "F10.7 is near or below the reference 150 sfu used for the quiet thermosphere.")

    if speed >= 700.0 or sw_density >= 20.0:
        wind_cause = ("storm", "Disturbed solar wind", "Fast or dense solar wind couples into geomagnetic heating and raises the weather factor on thermospheric density.")
    elif speed >= 500.0 or sw_density >= 10.0:
        wind_cause = ("elevated", "Enhanced solar wind", "Solar-wind speed or density is above the quiet reference and contributes to upper-atmosphere drag.")
    else:
        wind_cause = ("quiet", "Nominal solar wind", "Solar-wind speed and density are near the quiet reference (400 km/s, 5 /cm³).")

    if density_ratio >= 1.5:
        drag_cause = ("storm", "Thermosphere well above reference", "High-altitude density is at least 1.5× the quiet reference. Drag above 150 km is an environmental cause of extra Δv, not a build slider.")
    elif density_ratio >= 1.15:
        drag_cause = ("elevated", "Thermosphere above reference", "High-altitude density is elevated versus the quiet reference snapshot. Ascent still uses this weather freeze.")
    else:
        drag_cause = ("quiet", "Thermosphere near reference", "High-altitude density is within about 15% of the quiet reference. Weather is still a launch input, just not a storm driver.")

    packed = [
        ("geomagnetic", kp, kp_cause, f"Kp {kp:.2f} (quiet < 4, storm ≥ 5)."),
        ("solar_euv", f107, f107_cause, f"F10.7 {f107:.0f} sfu (reference 150)."),
        ("solar_wind", speed, wind_cause, f"Solar wind {speed:.0f} km/s, {sw_density:.1f} /cm³."),
        ("thermosphere_drag", density_ratio, drag_cause, f"Density at 150 km is {density_ratio:.2f}× the quiet reference."),
    ]
    causes = []
    for cause_id, _value, (severity, title, explanation), evidence in packed:
        causes.append(
            {
                "id": cause_id,
                "title": title,
                "severity": severity,
                "explanation": explanation,
                "evidence": evidence,
            }
        )
    return causes


def assess_space_weather_effects(
    weather: SpaceWeather,
    inclination_deg: float = 0.0,
    computed_by: str = "python",
) -> dict:
    """Precompute thermosphere impact vs the quiet reference snapshot.

    TypeScript ascent reuses this block when Python already computed it.
    """
    scale_height, weather_factor = _thermosphere_profile(weather, inclination_deg)
    _ref_scale, reference_factor = _thermosphere_profile(REFERENCE_WEATHER, inclination_deg)
    density_150 = estimate_atmospheric_density(150.0, weather, inclination_deg)
    density_400 = estimate_atmospheric_density(400.0, weather, inclination_deg)
    reference_150 = estimate_atmospheric_density(150.0, REFERENCE_WEATHER, inclination_deg)
    ratio = density_150 / reference_150 if reference_150 > 0 else 1.0
    causes = _weather_causes(weather, ratio)
    overall = "quiet"
    for cause in causes:
        if _severity_rank(cause["severity"]) > _severity_rank(overall):
            overall = cause["severity"]
    return {
        "scaleHeightKm": scale_height,
        "weatherFactor": weather_factor,
        "referenceWeatherFactor": reference_factor,
        "densityAt150Km": density_150,
        "densityAt400Km": density_400,
        "referenceDensityAt150Km": reference_150,
        "densityRatioVsReference": ratio,
        "overallSeverity": overall,
        "causes": causes,
        "computedBy": computed_by,
    }

def average_spacecraft_mass(mission: SpacecraftMission) -> float:
    return max(mission.mass + 0.5 * max(mission.fuel, 0.0), 1e-9)

def estimate_delta_v_available(mission: SpacecraftMission) -> float:
    if mission.fuel <= 0 or mission.mass <= 0 or mission.isp <= 0:
        return 0.0

    initial_mass = mission.mass + mission.fuel
    return mission.isp * G0 * math.log(initial_mass / mission.mass)

def estimate_propellant_required(mission: SpacecraftMission, required_delta_v: float) -> float:
    """Minimum starting propellant: the propellant load for which burning it
    all produces exactly required_delta_v and ends at dry mass."""
    if required_delta_v <= 0:
        return 0.0

    if mission.isp <= 0 or mission.mass <= 0:
        return float("inf")

    mass_ratio = math.exp(required_delta_v / (mission.isp * G0))
    return mission.mass * (mass_ratio - 1)

def estimate_propellant_consumed(mission: SpacecraftMission, required_delta_v: float) -> float:
    """Propellant actually consumed producing required_delta_v starting from
    the loaded tanks (dry mass + loaded fuel). Burning while heavier than the
    minimum-load case consumes more than the minimum starting propellant, so
    remaining fuel must be computed from this, not from
    estimate_propellant_required."""
    if required_delta_v <= 0:
        return 0.0

    if mission.isp <= 0 or mission.mass <= 0 or mission.fuel <= 0:
        return float("inf")

    full_mass = mission.mass + mission.fuel
    return full_mass * (1.0 - math.exp(-required_delta_v / (mission.isp * G0)))

def estimate_unpowered_decay(mission: SpacecraftMission, weather: SpaceWeather, duration_s: float, spacecraft_mass: float) -> float:
    """Altitude lost to drag over duration_s with no stationkeeping.

    This fallback approximates a mission that performs no stationkeeping at
    all; it does not predict the exact moment propulsion runs out. Decay stops
    at the reentry boundary: the final step is shortened so the trajectory
    never produces an altitude below REENTRY_ALTITUDE_KM.
    """
    altitude = mission.target_altitude * 1000
    reentry_m = REENTRY_ALTITUDE_KM * 1000
    timestep = 7 * SECONDS_PER_DAY
    steps = max(1, math.ceil(duration_s / timestep))
    total_altitude_loss = 0.0
    scale_height, weather_factor = _thermosphere_profile(weather, mission.target_inclination)
    drag_area = mission.drag_coefficient * mission.cross_section_area

    for _ in range(steps):
        if altitude <= reentry_m:
            break

        current_altitude_km = altitude / 1000
        radius = EARTH_RADIUS + altitude
        density = max(1e-16, 1.225e-12 * math.exp(-(current_altitude_km - 400.0) / scale_height) * weather_factor)
        velocity = atmospheric_relative_velocity(current_altitude_km, mission.target_inclination)
        drag_force = 0.5 * density * velocity ** 2 * drag_area
        drag_acceleration = drag_force / spacecraft_mass
        decay_rate = -2 * radius ** 2 * drag_acceleration * velocity / MU_EARTH
        altitude_change = decay_rate * timestep

        if altitude + altitude_change <= reentry_m:
            # Shortened final timestep: integrate only to the reentry boundary.
            fraction = (altitude - reentry_m) / (-altitude_change)
            total_altitude_loss += abs(altitude_change) * fraction / 1000
            break

        total_altitude_loss += abs(altitude_change) / 1000
        altitude += altitude_change

    return total_altitude_loss

def estimate_stationkeeping_delta_v(mission: SpacecraftMission, weather: SpaceWeather) -> tuple[float, float, float, float]:
    # Stationkeeping holds the target orbit, so budget Δv at that altitude.
    # Natural decay is only used later if the spacecraft cannot afford that budget.
    duration = mission.lifespan * DAYS_PER_YEAR * SECONDS_PER_DAY
    spacecraft_mass = average_spacecraft_mass(mission)
    density = estimate_atmospheric_density(mission.target_altitude, weather, mission.target_inclination)
    velocity = atmospheric_relative_velocity(mission.target_altitude, mission.target_inclination)
    drag_force = 0.5 * density * velocity ** 2 * mission.drag_coefficient * mission.cross_section_area
    drag_acceleration = drag_force / spacecraft_mass
    total_delta_v = drag_acceleration * duration

    return total_delta_v, 0.0, density, drag_force

def estimate_disposal_delta_v(altitude_km: float) -> float:
    r_apogee = EARTH_RADIUS + altitude_km * 1000
    r_perigee = EARTH_RADIUS + DISPOSAL_PERIGEE_KM * 1000
    if r_apogee <= r_perigee:
        return 0.0

    circular_velocity = math.sqrt(MU_EARTH / r_apogee)
    transfer_a = 0.5 * (r_apogee + r_perigee)
    transfer_velocity = math.sqrt(MU_EARTH * (2.0 / r_apogee - 1.0 / transfer_a))
    return max(0.0, circular_velocity - transfer_velocity)

def estimate_collision_avoidance_delta_v(mission: SpacecraftMission, cam_scale: float = 1.0) -> float:
    # Debris flux peaks near 750-850 km and is higher on polar/SSO paths.
    debris_environment = math.exp(-((mission.target_altitude - 750.0) / 280.0) ** 2)
    inclination_factor = 0.65 + 0.35 * abs(math.sin(math.radians(mission.target_inclination)))
    area_factor = mission.cross_section_area / 8.0
    annual = 7.5 * debris_environment * inclination_factor * area_factor
    return max(0.0, annual * mission.lifespan * cam_scale)

def estimate_insertion_delta_v(mission: SpacecraftMission, ops: OperationalDraw) -> float:
    radius = EARTH_RADIUS + mission.target_altitude * 1000
    velocity = orbital_velocity(mission.target_altitude)
    altitude_dv = velocity * abs(ops.insertion_altitude_error_km) * 1000.0 / radius
    inclination_dv = 2.0 * velocity * math.sin(math.radians(abs(ops.insertion_inclination_error_deg)) / 2.0)
    return altitude_dv + inclination_dv

def estimate_mission_delta_v(mission: SpacecraftMission, weather: SpaceWeather, ops: OperationalDraw | None = None):
    ops = ops or OperationalDraw()
    drag_delta_v, _, density, drag_force = estimate_stationkeeping_delta_v(mission, weather)
    cam_delta_v = estimate_collision_avoidance_delta_v(mission, ops.cam_scale)
    insertion_delta_v = estimate_insertion_delta_v(mission, ops)
    disposal_delta_v = estimate_disposal_delta_v(mission.target_altitude)
    required_delta_v = drag_delta_v + cam_delta_v + insertion_delta_v + disposal_delta_v
    return required_delta_v, drag_delta_v, cam_delta_v, insertion_delta_v, disposal_delta_v, density, drag_force

def simulate(mission: SpacecraftMission, weather: SpaceWeather, ops: OperationalDraw | None = None) -> SimulationResult:
    ops = ops or OperationalDraw()
    failures = []

    # Reject non-finite values and invalid physical inputs before calculation.
    if not math.isfinite(mission.mass) or mission.mass <= 0:
        failures.append("invalid_mass")
    if not math.isfinite(mission.fuel) or mission.fuel <= 0:
        failures.append("no_fuel")
    if not math.isfinite(mission.cross_section_area) or mission.cross_section_area <= 0:
        failures.append("invalid_cross_section_area")
    if not math.isfinite(mission.drag_coefficient) or mission.drag_coefficient <= 0:
        failures.append("invalid_drag_coefficient")
    if not math.isfinite(mission.isp) or mission.isp <= 0:
        failures.append("invalid_isp")
    if not math.isfinite(mission.lifespan) or mission.lifespan <= 0:
        failures.append("invalid_lifespan")
    if not math.isfinite(mission.target_altitude) or mission.target_altitude <= 0:
        failures.append("invalid_target_altitude")
    if not math.isfinite(mission.target_inclination) or not 0.0 <= mission.target_inclination <= 180.0:
        failures.append("invalid_target_inclination")

    if failures:
        return SimulationResult(passed = False, failure_reasons = failures)

    required_delta_v, drag_delta_v, cam_delta_v, insertion_delta_v, disposal_delta_v, average_density, average_drag = estimate_mission_delta_v(mission, weather, ops)
    available_delta_v = estimate_delta_v_available(mission)
    propellant_required = estimate_propellant_required(mission, required_delta_v)
    propellant_consumed = estimate_propellant_consumed(mission, required_delta_v)
    propellant_remaining = mission.fuel - propellant_consumed
    reserve_required = mission.fuel * PROPULSION_RESERVE_FRACTION
    operations_delta_v = drag_delta_v + cam_delta_v + insertion_delta_v

    if operations_delta_v > available_delta_v:
        failures.append("insufficient_delta_v")
    elif required_delta_v > available_delta_v:
        failures.append("failed_disposal")

    if propellant_required > mission.fuel:
        failures.append("insufficient_propellant")
    elif propellant_remaining < reserve_required:
        failures.append("insufficient_propellant_reserve")

    if available_delta_v >= operations_delta_v:
        final_altitude = mission.target_altitude
        orbital_decay = 0.0
    else:
        duration = mission.lifespan * DAYS_PER_YEAR * SECONDS_PER_DAY
        natural_altitude_loss = estimate_unpowered_decay(mission, weather, duration, average_spacecraft_mass(mission))
        final_altitude = mission.target_altitude - natural_altitude_loss
        orbital_decay = natural_altitude_loss

        if final_altitude < _operating_floor_km():
            failures.append("below_operating_altitude")
        # Decay stops at the reentry boundary; reaching it means reentry.
        if final_altitude <= REENTRY_ALTITUDE_KM + 1e-6:
            failures.append("orbital_decay")

    return SimulationResult(
        passed = len(failures) == 0,
        failure_reasons = failures,
        available_delta_v = available_delta_v,
        required_delta_v = required_delta_v,
        drag_delta_v = drag_delta_v,
        collision_avoidance_delta_v = cam_delta_v,
        insertion_delta_v = insertion_delta_v,
        disposal_delta_v = disposal_delta_v,
        propellant_required = propellant_required,
        propellant_consumed = propellant_consumed,
        propellant_remaining = propellant_remaining,
        initial_altitude = mission.target_altitude,
        final_altitude = final_altitude,
        orbital_decay = orbital_decay,
        average_density = average_density,
        average_drag = average_drag
    )

def run_overall_monte_carlo(mission: SpacecraftMission, weather: SpaceWeather, n: int = 10_000, seed: int | None = None):
    if n <= 0:
        raise ValueError("Monte Carlo run count must be positive.")
    rng = random.Random(seed)
    baseline = simulate(mission, weather)
    passes = 0
    failures = 0
    failure_modes = {}

    for _ in range(n):
        stressed_mission = create_stressed_mission(mission, rng)
        stressed_weather = create_stressed_weather(weather, rng)
        stressed_ops = create_stressed_ops(rng)
        result = simulate(stressed_mission, stressed_weather, stressed_ops)

        if result.passed:
            passes += 1
        else:
            failures += 1
            for reason in result.failure_reasons:
                failure_modes[reason] = failure_modes.get(reason, 0) + 1

    return passes, failures, failure_modes, baseline

def _sensitivity_stats(parameter: str, n: int, passes: int, failures: int, total_delta_v_change: float, total_altitude_change: float, total_propellant_change: float, total_margin_change: float, total_abs_delta_v_change: float) -> SensitivityResult:
    return SensitivityResult(
        parameter = parameter,
        runs = n,
        passes = passes,
        failures = failures,
        failure_rate = failures / n,
        average_delta_v_change = total_delta_v_change / n,
        average_altitude_change = total_altitude_change / n,
        average_propellant_change = total_propellant_change / n,
        average_margin_change = total_margin_change / n,
        mean_abs_delta_v_change = total_abs_delta_v_change / n
    )

def run_parameter_sensitivity(mission: SpacecraftMission, weather: SpaceWeather, n: int = 1_000, seed: int | None = None):
    if n <= 0:
        raise ValueError("Sensitivity run count must be positive.")
    rng = random.Random(seed)
    baseline = simulate(mission, weather)
    baseline_margin = baseline.available_delta_v - baseline.required_delta_v
    results = []

    for parameter in MISSION_STRESS_RANGES:
        passes = 0
        failures = 0
        total_delta_v_change = 0.0
        total_altitude_change = 0.0
        total_propellant_change = 0.0
        total_margin_change = 0.0
        total_abs_delta_v_change = 0.0

        for _ in range(n):
            stressed_mission = perturb_parameter(mission, parameter, rng)
            result = simulate(stressed_mission, weather)

            if result.passed:
                passes += 1
            else:
                failures += 1

            delta_v_change = result.required_delta_v - baseline.required_delta_v
            total_delta_v_change += delta_v_change
            total_abs_delta_v_change += abs(delta_v_change)
            total_altitude_change += result.final_altitude - baseline.final_altitude
            total_propellant_change += result.propellant_required - baseline.propellant_required
            total_margin_change += (result.available_delta_v - result.required_delta_v) - baseline_margin

        results.append(
            _sensitivity_stats(parameter, n, passes, failures,
                total_delta_v_change,
                total_altitude_change,
                total_propellant_change,
                total_margin_change,
                total_abs_delta_v_change
            )
        )

    for parameter in WEATHER_STRESS_RANGES:
        passes = 0
        failures = 0
        total_delta_v_change = 0.0
        total_altitude_change = 0.0
        total_propellant_change = 0.0
        total_margin_change = 0.0
        total_abs_delta_v_change = 0.0

        for _ in range(n):
            stressed_weather = perturb_weather_parameter(weather, parameter, rng)
            result = simulate(mission, stressed_weather)

            if result.passed:
                passes += 1
            else:
                failures += 1

            delta_v_change = result.required_delta_v - baseline.required_delta_v
            total_delta_v_change += delta_v_change
            total_abs_delta_v_change += abs(delta_v_change)
            total_altitude_change += result.final_altitude - baseline.final_altitude
            total_propellant_change += result.propellant_required - baseline.propellant_required
            total_margin_change += (result.available_delta_v - result.required_delta_v) - baseline_margin

        results.append(
            _sensitivity_stats(parameter, n, passes, failures,
                total_delta_v_change,
                total_altitude_change,
                total_propellant_change,
                total_margin_change,
                total_abs_delta_v_change
            )
        )

    for parameter in ("insertion_altitude_error_km", "insertion_inclination_error_deg", "debris_environment"):
        passes = 0
        failures = 0
        total_delta_v_change = 0.0
        total_altitude_change = 0.0
        total_propellant_change = 0.0
        total_margin_change = 0.0
        total_abs_delta_v_change = 0.0

        for _ in range(n):
            stressed_ops = perturb_ops_parameter(OperationalDraw(), parameter, rng)
            result = simulate(mission, weather, stressed_ops)

            if result.passed:
                passes += 1
            else:
                failures += 1

            delta_v_change = result.required_delta_v - baseline.required_delta_v
            total_delta_v_change += delta_v_change
            total_abs_delta_v_change += abs(delta_v_change)
            total_altitude_change += result.final_altitude - baseline.final_altitude
            total_propellant_change += result.propellant_required - baseline.propellant_required
            total_margin_change += (result.available_delta_v - result.required_delta_v) - baseline_margin

        results.append(
            _sensitivity_stats(parameter, n, passes, failures,
                total_delta_v_change,
                total_altitude_change,
                total_propellant_change,
                total_margin_change,
                total_abs_delta_v_change
            )
        )

    return sorted(results, key = lambda result: (result.failure_rate, result.mean_abs_delta_v_change), reverse = True)

def run_monte_carlo(mission: SpacecraftMission, weather: SpaceWeather, n: int = 10_000, sensitivity_runs: int = 1_000, seed: int | None = None) -> MonteCarloSummary:
    if n <= 0:
        raise ValueError("Monte Carlo run count must be positive.")
    if sensitivity_runs <= 0:
        raise ValueError("Sensitivity run count must be positive.")
    passes, failures, failure_modes, baseline = run_overall_monte_carlo(mission, weather, n, seed)

    sensitivity_results = run_parameter_sensitivity(mission, weather, sensitivity_runs, seed)

    return MonteCarloSummary(
        total_runs = n,
        passes = passes,
        failures = failures,
        probability_pass = passes / n,
        probability_fail = failures / n,
        failure_modes = failure_modes,
        sensitivity_results = sensitivity_results,
        baseline = baseline
    )
