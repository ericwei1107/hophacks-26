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

/**
 * Runtime key list for SpacecraftMission, used to catch a Python field the
 * TS port doesn't know about. `Record<keyof SpacecraftMission, true>` makes
 * TypeScript refuse to compile this object literal if a key is missing or
 * extra, so the list can't silently drift from the interface above.
 */
export const SPACECRAFT_MISSION_KEYS = Object.keys({
  mass: true,
  fuel: true,
  lifespan: true,
  target_altitude: true,
  target_inclination: true,
  cross_section_area: true,
  drag_coefficient: true,
  isp: true,
} satisfies Record<keyof SpacecraftMission, true>) as (keyof SpacecraftMission)[];

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

/** Runtime key list for SpaceWeather — see SPACECRAFT_MISSION_KEYS. */
export const SPACE_WEATHER_KEYS = Object.keys({
  kp: true,
  f107: true,
  solar_wind_speed: true,
  solar_wind_density: true,
  solar_wind_temperature: true,
} satisfies Record<keyof SpaceWeather, true>) as (keyof SpaceWeather)[];

export interface OperationalDraw {
  insertion_altitude_error_km: number;
  insertion_inclination_error_deg: number;
  cam_scale: number;
}

/** Runtime key list for OperationalDraw — see SPACECRAFT_MISSION_KEYS. */
export const OPERATIONAL_DRAW_KEYS = Object.keys({
  insertion_altitude_error_km: true,
  insertion_inclination_error_deg: true,
  cam_scale: true,
} satisfies Record<keyof OperationalDraw, true>) as (keyof OperationalDraw)[];

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

/** Runtime key list for SimulationResult — see SPACECRAFT_MISSION_KEYS. */
export const SIMULATION_RESULT_KEYS = Object.keys({
  passed: true,
  failure_reasons: true,
  available_delta_v: true,
  required_delta_v: true,
  drag_delta_v: true,
  collision_avoidance_delta_v: true,
  insertion_delta_v: true,
  disposal_delta_v: true,
  propellant_required: true,
  propellant_consumed: true,
  propellant_remaining: true,
  initial_altitude: true,
  final_altitude: true,
  orbital_decay: true,
  average_density: true,
  average_drag: true,
} satisfies Record<keyof SimulationResult, true>) as (keyof SimulationResult)[];

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
