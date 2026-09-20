/**
 * Worker message protocol. Requests carry run identifiers; responses echo
 * them so stale messages from canceled or superseded runs can be ignored.
 */

import type { RocketConfig } from "../domain/config";
import type { FlightEvent, FlightOutcome, FlightPerturbations } from "../sim/ascent/flight";
import type { Telemetry } from "../sim/ascent/flight";
import type { GuidanceCoefficients } from "../sim/ascent/guidance";
import type { AscentRobustnessResult, AscentSensitivityResult } from "../sim/ascent/robustness";
import type { MonteCarloSummary } from "../sim/orbital/types";
import type { SpacecraftMission } from "../sim/orbital/types";
import type { WeatherSnapshot } from "../sim/orbital/weather";
import type { OrbitalElements } from "../sim/physics/orbital";
import type { FlightAssessment, FlightEvidence } from "../sim/outcomes/types";
import type { TransferResult } from "../sim/lunar/transfer";

/** Plain-data flight input (class instances cannot cross the worker boundary). */
export interface SerializedFlightInput {
  config: RocketConfig;
  weather: WeatherSnapshot;
  launchLatitudeDeg: number;
  launchLongitudeDeg: number;
  localWindEastMs: number;
  localWindNorthMs: number;
  seed: number;
  guidance?: GuidanceCoefficients;
  perturbations?: FlightPerturbations;
  maxTimeS?: number;
}

/** Plain-data flight result; telemetry arrays transfer as buffers. */
export interface SerializableFlightResult {
  outcome: FlightOutcome;
  orbitAchieved: boolean;
  targetOrbitAchieved: boolean;
  failureCode: string | null;
  failureDetail: string | null;
  events: FlightEvent[];
  telemetry: Telemetry;
  finalElements: OrbitalElements | null;
  /** Parking-orbit elements, captured before any trans-lunar injection attempt — the meaningful "orbit reached" for a lunar-outcome flight, since `finalElements` then describes the trans-lunar trajectory instead. */
  parkingElements: OrbitalElements | null;
  /** Set once a trans-lunar injection was attempted; null otherwise. */
  lunarTransfer: TransferResult | null;
  maxQPa: number;
  maxG: number;
  stage2PropellantRemainingKg: number;
  config: RocketConfig;
  weather: WeatherSnapshot;
  seed: number;
  modelVersion: string;
  catalogVersion: string;
  guidanceVersion: string;
  totalTimeS: number;
  evidence: FlightEvidence;
  assessment: FlightAssessment;
}

export interface OrbitalMonteCarloRequest {
  mission: SpacecraftMission;
  weather: WeatherSnapshot;
  runs: number;
  sensitivityRuns: number;
  seed: number;
  rules: "legacy" | "game";
  camScaleMean?: number;
}

export interface AscentAnalysisRequest {
  input: SerializedFlightInput;
  runs: number;
  seed: number;
  onlyParameter?: string;
}

export interface AscentSensitivityRequest {
  input: SerializedFlightInput;
  runsPerParameter: number;
  seed: number;
}

export type WorkerRequest =
  | { type: "run_flight"; runId: number; input: SerializedFlightInput }
  | { type: "run_orbital_monte_carlo"; runId: number; request: OrbitalMonteCarloRequest }
  | { type: "run_ascent_analysis"; runId: number; request: AscentAnalysisRequest }
  | { type: "run_ascent_sensitivity"; runId: number; request: AscentSensitivityRequest }
  | { type: "cancel"; runId: number };

export type WorkerResponse =
  | { type: "progress"; runId: number; completed: number; total: number }
  | { type: "completed"; runId: number; result: SerializableFlightResult | MonteCarloSummary | AscentRobustnessResult | AscentSensitivityResult }
  | { type: "failed"; runId: number; error: string };
