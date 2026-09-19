/**
 * Ascent robustness and sensitivity analysis.
 *
 * Initial ascent uncertainties use bounded draws (clipped Gaussians, matching
 * the orbital model's perturbation style) for thrust, Isp, dry mass, loaded
 * propellant, atmospheric density, and horizontal wind. Distributions are
 * versioned model data, distinct from the orbital uncertainty ranges.
 *
 * Failure causes can overlap, so outcome counts are reported per-outcome and
 * must not be presented as mutually exclusive slices.
 */

import type { RocketConfig } from "../../domain/config";
import { Rng } from "../prng";
import { runFlight, type FlightEnvironment, type FlightOutcome, type FlightPerturbations } from "./flight";
import type { GuidanceCoefficients } from "./guidance";

export interface AscentUncertaintyRange {
  /** [min, max] multiplicative scale, or [min, max] absolute m/s for wind. */
  range: [number, number];
  /** True for multiplicative scales, false for additive wind (m/s). */
  multiplicative: boolean;
}

export const ASCENT_UNCERTAINTY: Record<string, AscentUncertaintyRange> = {
  thrust: { range: [0.97, 1.03], multiplicative: true },
  isp: { range: [0.98, 1.02], multiplicative: true },
  dryMass: { range: [0.95, 1.05], multiplicative: true },
  propellant: { range: [0.99, 1.01], multiplicative: true },
  density: { range: [0.85, 1.15], multiplicative: true },
  windEast: { range: [-10, 10], multiplicative: false },
};

export const ASCENT_SENSITIVITY_PARAMETERS = Object.keys(ASCENT_UNCERTAINTY);

/** Clipped Gaussian draw over a bounded range, mirroring the orbital model. */
function boundedDraw(range: [number, number], rng: Rng): number {
  const midpoint = (range[0] + range[1]) / 2;
  const sigma = (range[1] - range[0]) / 4;
  if (sigma <= 0) {
    return midpoint;
  }
  const value = rng.gauss(midpoint, sigma);
  return Math.max(range[0], Math.min(range[1], value));
}

export function drawPerturbations(rng: Rng, onlyParameter?: string): FlightPerturbations {
  const draw = (key: string) =>
    onlyParameter === undefined || onlyParameter === key
      ? boundedDraw(ASCENT_UNCERTAINTY[key].range, rng)
      : ASCENT_UNCERTAINTY[key].multiplicative
        ? 1
        : 0;
  return {
    thrustScale: draw("thrust"),
    ispScale: draw("isp"),
    dryMassScale: draw("dryMass"),
    propellantScale: draw("propellant"),
    densityScale: draw("density"),
    windEastMs: draw("windEast"),
  };
}

export interface AscentRunSummary {
  outcome: FlightOutcome;
  orbitAchieved: boolean;
  targetOrbitAchieved: boolean;
  maxQPa: number;
  maxG: number;
  perigeeKm: number | null;
  apogeeKm: number | null;
}

export interface AscentRobustnessResult {
  totalRuns: number;
  completedRuns: number;
  outcomeCounts: Partial<Record<FlightOutcome, number>>;
  orbitAchievedCount: number;
  targetOrbitCount: number;
  /** Wilson score interval for the orbit-achieved probability. */
  orbitProbability: number;
  orbitProbability95: [number, number];
  maxQPaP95: number;
  maxGP95: number;
  perigeeKmStats: { mean: number; min: number; max: number } | null;
  seed: number;
}

/** Wilson score interval for a binomial proportion. */
export function wilsonInterval(successes: number, total: number, z = 1.96): [number, number] {
  if (total === 0) {
    return [0, 0];
  }
  const p = successes / total;
  const denom = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denom;
  const margin = (z / denom) * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return Number.NaN;
  }
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

export interface AscentAnalysisRequest {
  config: RocketConfig;
  environment: FlightEnvironment;
  guidance?: GuidanceCoefficients;
  runs: number;
  seed: number;
  /** When set, perturb only this parameter (sensitivity analysis). */
  onlyParameter?: string;
  /** Chunk callback; return false to cancel. */
  onChunk?: (completed: number, total: number) => boolean | void;
}

export function runAscentAnalysis(request: AscentAnalysisRequest): AscentRobustnessResult {
  const rng = new Rng(request.seed);
  const outcomeCounts: Partial<Record<FlightOutcome, number>> = {};
  let orbitAchievedCount = 0;
  let targetOrbitCount = 0;
  const maxQs: number[] = [];
  const maxGs: number[] = [];
  const perigees: number[] = [];

  const CHUNK = 25;
  let completedRuns = 0;
  for (let start = 0; start < request.runs; start += CHUNK) {
    const end = Math.min(request.runs, start + CHUNK);
    for (let i = start; i < end; i++) {
      const perturbations = drawPerturbations(rng, request.onlyParameter);
      const environment: FlightEnvironment = {
        ...request.environment,
        localWindEastMs: request.environment.localWindEastMs + perturbations.windEastMs,
        atmosphere: request.environment.atmosphere.withDensityScale(perturbations.densityScale),
      };
      const result = runFlight({
        config: request.config,
        environment,
        ...(request.guidance !== undefined ? { guidance: request.guidance } : {}),
        perturbations,
        seed: request.seed * 1_000_000 + i,
        recordTelemetry: false,
      });
      outcomeCounts[result.outcome] = (outcomeCounts[result.outcome] ?? 0) + 1;
      if (result.orbitAchieved) {
        orbitAchievedCount++;
      }
      if (result.targetOrbitAchieved) {
        targetOrbitCount++;
      }
      maxQs.push(result.maxQPa);
      maxGs.push(result.maxG);
      if (result.finalElements?.bound && !result.finalElements.intersectsGround) {
        perigees.push(result.finalElements.perigeeAltitudeKm);
      }
    }
    completedRuns = end;
    if (request.onChunk && request.onChunk(end, request.runs) === false) {
      break;
    }
  }

  maxQs.sort((a, b) => a - b);
  maxGs.sort((a, b) => a - b);
  perigees.sort((a, b) => a - b);

  return {
    totalRuns: request.runs,
    completedRuns,
    outcomeCounts,
    orbitAchievedCount,
    targetOrbitCount,
    orbitProbability: completedRuns > 0 ? orbitAchievedCount / completedRuns : 0,
    orbitProbability95: wilsonInterval(orbitAchievedCount, completedRuns),
    maxQPaP95: percentile(maxQs, 95),
    maxGP95: percentile(maxGs, 95),
    perigeeKmStats:
      perigees.length > 0
        ? {
            mean: perigees.reduce((a, b) => a + b, 0) / perigees.length,
            min: perigees[0],
            max: perigees[perigees.length - 1],
          }
        : null,
    seed: request.seed,
  };
}

export interface AscentSensitivityEntry {
  parameter: string;
  runs: number;
  orbitProbability: number;
  orbitProbability95: [number, number];
  /** Change vs. the nominal orbit probability. */
  probabilityChange: number;
}

export interface AscentSensitivityResult {
  nominal: AscentRobustnessResult;
  entries: AscentSensitivityEntry[];
}

export function runAscentSensitivity(
  config: RocketConfig,
  environment: FlightEnvironment,
  runsPerParameter: number,
  seed: number,
  guidance?: GuidanceCoefficients,
  onChunk?: (completed: number, total: number) => boolean | void,
): AscentSensitivityResult {
  const guidanceOpt = guidance !== undefined ? { guidance } : {};
  const nominal = runAscentAnalysis({ config, environment, ...guidanceOpt, runs: runsPerParameter, seed, onChunk: (c) => onChunk?.(c, runsPerParameter * (ASCENT_SENSITIVITY_PARAMETERS.length + 1)) });
  const entries: AscentSensitivityEntry[] = [];
  ASCENT_SENSITIVITY_PARAMETERS.forEach((parameter, index) => {
    const result = runAscentAnalysis({
      config,
      environment,
      ...guidanceOpt,
      runs: runsPerParameter,
      seed: seed + 77_000 + index,
      onlyParameter: parameter,
      onChunk: (c) =>
        onChunk?.(runsPerParameter * (index + 1) + c, runsPerParameter * (ASCENT_SENSITIVITY_PARAMETERS.length + 1)),
    });
    entries.push({
      parameter,
      runs: result.completedRuns,
      orbitProbability: result.orbitProbability,
      orbitProbability95: result.orbitProbability95,
      probabilityChange: result.orbitProbability - nominal.orbitProbability,
    });
  });
  entries.sort((a, b) => Math.abs(b.probabilityChange) - Math.abs(a.probabilityChange));
  return { nominal, entries };
}
