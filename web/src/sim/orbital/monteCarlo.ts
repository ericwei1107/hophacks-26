/**
 * Monte Carlo and one-parameter-at-a-time sensitivity analysis, ported from
 * the Python reference (simulate.py). Draws come from the browser's seeded
 * Rng; exact language parity is covered by the explicit perturbation
 * fixtures, not by matching PRNG streams.
 */

import { Rng } from "../prng";
import {
  BAD_LAUNCH_PROBABILITY,
  INSERTION_ALTITUDE_SIGMA_KM,
  INSERTION_INCLINATION_SIGMA_DEG,
  STORM_PROBABILITY,
  clip,
  simulate,
} from "./simulate";
import {
  LEGACY_MISSION_RULES,
  type MissionRules,
  type MonteCarloSummary,
  type OperationalDraw,
  type SensitivityResult,
  type SimulationResult,
  type SpacecraftMission,
  type SpaceWeather,
} from "./types";

/** covers mass growth, array deployment, and Cd underestimates. */
export const MISSION_STRESS_RANGES: Record<string, [number, number]> = {
  mass: [-0.1, 0.12],
  fuel: [-0.08, 0.05],
  lifespan: [-0.1, 0.15],
  target_altitude: [-0.08, 0.05],
  target_inclination: [-3.0, 3.0],
  cross_section_area: [-0.15, 0.2],
  drag_coefficient: [-0.15, 0.22],
  isp: [-0.08, 0.05],
};

export const WEATHER_STRESS_RANGES: Record<string, [number, number]> = {
  kp: [-0.4, 0.45],
  f107: [-0.22, 0.25],
  solar_wind_speed: [-0.18, 0.22],
  solar_wind_density: [-0.25, 0.3],
  solar_wind_temperature: [-0.2, 0.25],
};

const WEATHER_BOUNDS: Record<string, [number, number]> = {
  kp: [0, 9],
  f107: [60, 280],
  solar_wind_speed: [250, 1200],
  solar_wind_density: [0.5, 80],
  solar_wind_temperature: [1e4, 1e6],
};

function perturb(value: number, minimum: number, maximum: number, rng: Rng): number {
  const midpoint = (minimum + maximum) / 2;
  const sigma = (maximum - minimum) / 4;
  if (sigma <= 0) {
    return value;
  }
  const fraction = clip(rng.gauss(midpoint, sigma), minimum, maximum);
  return value * (1 + fraction);
}

export function perturbParameter(
  mission: SpacecraftMission,
  parameter: string,
  rng: Rng,
): SpacecraftMission {
  if (parameter === "target_inclination") {
    const [low, high] = MISSION_STRESS_RANGES[parameter];
    const delta = clip(rng.gauss((low + high) / 2, (high - low) / 4), low, high);
    const inclination = clip(mission.target_inclination + delta, 0, 180);
    return { ...mission, target_inclination: inclination };
  }
  const range = MISSION_STRESS_RANGES[parameter];
  const newValue = perturb(mission[parameter as keyof SpacecraftMission], range[0], range[1], rng);
  return { ...mission, [parameter]: Math.max(newValue, 1e-9) };
}

export function perturbWeatherParameter(
  weather: SpaceWeather,
  parameter: string,
  rng: Rng,
): SpaceWeather {
  const range = WEATHER_STRESS_RANGES[parameter];
  const bounds = WEATHER_BOUNDS[parameter];
  const newValue = perturb(weather[parameter as keyof SpaceWeather] as number, range[0], range[1], rng);
  return { ...weather, [parameter]: clip(newValue, bounds[0], bounds[1]) };
}

export function createStressedMission(mission: SpacecraftMission, rng: Rng): SpacecraftMission {
  let stressed = mission;
  for (const parameter of Object.keys(MISSION_STRESS_RANGES)) {
    stressed = perturbParameter(stressed, parameter, rng);
  }
  return stressed;
}

export function createStressedWeather(weather: SpaceWeather, rng: Rng): SpaceWeather {
  // most years look like today, plus or minus forecast noise.
  if (rng.uniform() < STORM_PROBABILITY) {
    return {
      kp: clip(rng.uniformRange(5.2, 8.4), 0, 9),
      f107: clip((weather.f107 ?? 150) * rng.uniformRange(1.25, 1.7), 60, 280),
      solar_wind_speed: clip((weather.solar_wind_speed ?? 400) * rng.uniformRange(1.2, 1.65), 250, 1200),
      solar_wind_density: clip((weather.solar_wind_density ?? 5) * rng.uniformRange(1.4, 2.5), 0.5, 80),
      solar_wind_temperature: clip((weather.solar_wind_temperature ?? 1e5) * rng.uniformRange(1.15, 1.8), 1e4, 1e6),
    };
  }
  const result: SpaceWeather = { ...weather };
  for (const parameter of Object.keys(WEATHER_STRESS_RANGES)) {
    const range = WEATHER_STRESS_RANGES[parameter];
    const bounds = WEATHER_BOUNDS[parameter];
    const base = (result[parameter as keyof SpaceWeather] as number) ?? 0;
    result[parameter as keyof SpaceWeather] = clip(perturb(base, range[0], range[1], rng), bounds[0], bounds[1]);
  }
  return result;
}

export function createStressedOps(rng: Rng): OperationalDraw {
  const inclinationError =
    rng.uniform() < BAD_LAUNCH_PROBABILITY
      ? rng.gauss(0, 1.15)
      : rng.gauss(0, INSERTION_INCLINATION_SIGMA_DEG);
  return {
    insertion_altitude_error_km: clip(rng.gauss(0, INSERTION_ALTITUDE_SIGMA_KM), -40, 40),
    insertion_inclination_error_deg: clip(inclinationError, -2.4, 2.4),
    cam_scale: clip(rng.gauss(1, 0.28), 0.45, 2.3),
  };
}

function perturbOpsParameter(ops: OperationalDraw, parameter: string, rng: Rng): OperationalDraw {
  if (parameter === "insertion_altitude_error_km") {
    return { ...ops, insertion_altitude_error_km: clip(rng.gauss(0, INSERTION_ALTITUDE_SIGMA_KM), -40, 40) };
  }
  if (parameter === "insertion_inclination_error_deg") {
    return { ...ops, insertion_inclination_error_deg: clip(rng.gauss(0, INSERTION_INCLINATION_SIGMA_DEG), -2.4, 2.4) };
  }
  if (parameter === "debris_environment") {
    return { ...ops, cam_scale: clip(rng.gauss(1, 0.35), 0.45, 2.3) };
  }
  return ops;
}

export interface BatchProgress {
  completed: number;
  total: number;
}

export function runOverallMonteCarlo(
  mission: SpacecraftMission,
  weather: SpaceWeather,
  n = 10_000,
  seed: number | null = null,
  rules: MissionRules = LEGACY_MISSION_RULES,
  onChunk?: (progress: BatchProgress) => boolean | void,
): { passes: number; failures: number; failureModes: Record<string, number>; baseline: SimulationResult } {
  if (n <= 0) {
    throw new Error("Monte Carlo run count must be positive.");
  }
  const rng = new Rng(seed ?? 0);
  const baseline = simulate(mission, weather, undefined, rules);
  let passes = 0;
  let failures = 0;
  const failureModes: Record<string, number> = {};

  const CHUNK = 250;
  for (let start = 0; start < n; start += CHUNK) {
    const end = Math.min(n, start + CHUNK);
    for (let i = start; i < end; i++) {
      const stressedMission = createStressedMission(mission, rng);
      const stressedWeather = createStressedWeather(weather, rng);
      const stressedOps = createStressedOps(rng);
      const result = simulate(stressedMission, stressedWeather, stressedOps, rules);
      if (result.passed) {
        passes++;
      } else {
        failures++;
        for (const reason of result.failure_reasons) {
          failureModes[reason] = (failureModes[reason] ?? 0) + 1;
        }
      }
    }
    if (onChunk && onChunk({ completed: end, total: n }) === false) {
      break; // canceled: return partial results
    }
  }
  return { passes, failures, failureModes, baseline };
}

function sensitivityStats(
  parameter: string,
  n: number,
  passes: number,
  failures: number,
  totalDeltaVChange: number,
  totalAltitudeChange: number,
  totalPropellantChange: number,
  totalMarginChange: number,
  totalAbsDeltaVChange: number,
): SensitivityResult {
  return {
    parameter,
    runs: n,
    passes,
    failures,
    failure_rate: failures / n,
    average_delta_v_change: totalDeltaVChange / n,
    average_altitude_change: totalAltitudeChange / n,
    average_propellant_change: totalPropellantChange / n,
    average_margin_change: totalMarginChange / n,
    mean_abs_delta_v_change: totalAbsDeltaVChange / n,
  };
}

export function runParameterSensitivity(
  mission: SpacecraftMission,
  weather: SpaceWeather,
  n = 1_000,
  seed: number | null = null,
  rules: MissionRules = LEGACY_MISSION_RULES,
  onChunk?: (progress: BatchProgress) => boolean | void,
): SensitivityResult[] {
  if (n <= 0) {
    throw new Error("Sensitivity run count must be positive.");
  }
  const rng = new Rng(seed ?? 0);
  const baseline = simulate(mission, weather, undefined, rules);
  const baselineMargin = baseline.available_delta_v - baseline.required_delta_v;
  const results: SensitivityResult[] = [];

  const groups: { parameter: string; kind: "mission" | "weather" | "ops" }[] = [
    ...Object.keys(MISSION_STRESS_RANGES).map((parameter) => ({ parameter, kind: "mission" as const })),
    ...Object.keys(WEATHER_STRESS_RANGES).map((parameter) => ({ parameter, kind: "weather" as const })),
    ...["insertion_altitude_error_km", "insertion_inclination_error_deg", "debris_environment"].map(
      (parameter) => ({ parameter, kind: "ops" as const }),
    ),
  ];

  let completed = 0;
  for (const { parameter, kind } of groups) {
    let passes = 0;
    let failures = 0;
    let totalDeltaVChange = 0;
    let totalAltitudeChange = 0;
    let totalPropellantChange = 0;
    let totalMarginChange = 0;
    let totalAbsDeltaVChange = 0;

    for (let i = 0; i < n; i++) {
      let stressedMission = mission;
      let stressedWeather = weather;
      let stressedOps: OperationalDraw = { insertion_altitude_error_km: 0, insertion_inclination_error_deg: 0, cam_scale: 1 };
      if (kind === "mission") {
        stressedMission = perturbParameter(mission, parameter, rng);
      } else if (kind === "weather") {
        stressedWeather = perturbWeatherParameter(weather, parameter, rng);
      } else {
        stressedOps = perturbOpsParameter(stressedOps, parameter, rng);
      }
      const result = simulate(stressedMission, stressedWeather, stressedOps, rules);
      if (result.passed) {
        passes++;
      } else {
        failures++;
      }
      const deltaVChange = result.required_delta_v - baseline.required_delta_v;
      totalDeltaVChange += deltaVChange;
      totalAbsDeltaVChange += Math.abs(deltaVChange);
      totalAltitudeChange += result.final_altitude - baseline.final_altitude;
      totalPropellantChange += result.propellant_required - baseline.propellant_required;
      totalMarginChange += result.available_delta_v - result.required_delta_v - baselineMargin;
    }

    results.push(
      sensitivityStats(
        parameter, n, passes, failures,
        totalDeltaVChange, totalAltitudeChange, totalPropellantChange, totalMarginChange, totalAbsDeltaVChange,
      ),
    );
    completed += n;
    if (onChunk && onChunk({ completed, total: groups.length * n }) === false) {
      break;
    }
  }

  return results.sort(
    (a, b) => b.failure_rate - a.failure_rate || b.mean_abs_delta_v_change - a.mean_abs_delta_v_change,
  );
}

export function runMonteCarlo(
  mission: SpacecraftMission,
  weather: SpaceWeather,
  n = 10_000,
  sensitivityRuns = 1_000,
  seed: number | null = null,
  rules: MissionRules = LEGACY_MISSION_RULES,
  onChunk?: (progress: BatchProgress) => boolean | void,
): MonteCarloSummary {
  if (n <= 0) {
    throw new Error("Monte Carlo run count must be positive.");
  }
  if (sensitivityRuns <= 0) {
    throw new Error("Sensitivity run count must be positive.");
  }
  const overall = runOverallMonteCarlo(mission, weather, n, seed, rules, (p) =>
    onChunk?.({ completed: p.completed, total: n + sensitivityRuns * 19 }),
  );
  const sensitivity = runParameterSensitivity(mission, weather, sensitivityRuns, seed, rules, (p) =>
    onChunk?.({ completed: n + p.completed, total: n + sensitivityRuns * 19 }),
  );
  return {
    total_runs: overall.passes + overall.failures,
    passes: overall.passes,
    failures: overall.failures,
    probability_pass: overall.passes / Math.max(1, overall.passes + overall.failures),
    probability_fail: overall.failures / Math.max(1, overall.passes + overall.failures),
    failure_modes: overall.failureModes,
    sensitivity_results: sensitivity,
    baseline: overall.baseline,
  };
}
