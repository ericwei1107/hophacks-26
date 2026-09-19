/**
 * Ported mission types from the Python reference (design.py, simulate.py).
 * Field names match the exported fixtures exactly.
 */

export interface SpacecraftMission {
  /** Dry mass, kg. */
  mass: number;
  /** Loaded propellant, kg. */
  fuel: number;
  /** Mission duration, years. */
  lifespan: number;
  /** Circular target altitude, km. */
  target_altitude: number;
  /** Target inclination, degrees. */
  target_inclination: number;
  /** Cross-sectional area, m^2. */
  cross_section_area: number;
  drag_coefficient: number;
  /** Specific impulse, s. */
  isp: number;
}

export interface SpaceWeather {
  kp: number | null;
  f107: number | null;
  /** km/s */
  solar_wind_speed: number | null;
  /** particles/cm^3 */
  solar_wind_density: number | null;
  /** K */
  solar_wind_temperature: number | null;
}

export interface OperationalDraw {
  insertion_altitude_error_km: number;
  insertion_inclination_error_deg: number;
  cam_scale: number;
}

export interface SimulationResult {
  passed: boolean;
  failure_reasons: string[];
  available_delta_v: number;
  required_delta_v: number;
  drag_delta_v: number;
  collision_avoidance_delta_v: number;
  insertion_delta_v: number;
  disposal_delta_v: number;
  /** Minimum starting propellant for the required delta-v, kg. */
  propellant_required: number;
  /** Propellant actually consumed starting from loaded tanks, kg. */
  propellant_consumed: number;
  propellant_remaining: number;
  initial_altitude: number;
  final_altitude: number;
  orbital_decay: number;
  average_density: number;
  average_drag: number;
}

export interface SensitivityResult {
  parameter: string;
  runs: number;
  passes: number;
  failures: number;
  failure_rate: number;
  average_delta_v_change: number;
  average_altitude_change: number;
  average_propellant_change: number;
  average_margin_change: number;
  mean_abs_delta_v_change: number;
}

export interface MonteCarloSummary {
  total_runs: number;
  passes: number;
  failures: number;
  probability_pass: number;
  probability_fail: number;
  failure_modes: Record<string, number>;
  sensitivity_results: SensitivityResult[];
  baseline: SimulationResult;
}

/**
 * Explicit mission-rule parameters. The legacy Python defaults remain
 * unchanged; the game's payload analysis uses a lower operating floor because
 * the launch targets roughly 200 km.
 */
export interface MissionRules {
  minOperatingAltitudeKm: number;
  reentryAltitudeKm: number;
  propulsionReserveFraction: number;
  disposalPerigeeKm: number;
}

/** Legacy Python/reference defaults — do not change. */
export const LEGACY_MISSION_RULES: MissionRules = {
  minOperatingAltitudeKm: 220.0,
  reentryAltitudeKm: 120.0,
  propulsionReserveFraction: 0.1,
  disposalPerigeeKm: 150.0,
};

/** Rules for analyzing the payload the game actually launches. */
export const GAME_MISSION_RULES: MissionRules = {
  minOperatingAltitudeKm: 150.0,
  reentryAltitudeKm: 120.0,
  propulsionReserveFraction: 0.1,
  disposalPerigeeKm: 150.0,
};
