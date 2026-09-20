import type { RocketConfig } from "../../domain/config";
import type { FlightOutcome } from "../ascent/flight";

export const ASSESSMENT_VERSION = "2";

export type PerformanceMetricId = "liftoff_twr" | "ideal_delta_v" | "drag_area" | "static_margin" | "peak_g";
export type MetricBand = "within_range" | "marginal" | "outside_limit" | "context_only" | "not_measured";
export type EvidenceSource = "observed" | "game_rule" | "inferred";

export interface EnvironmentalCause {
  id: string;
  title: string;
  severity: "quiet" | "elevated" | "storm";
  explanation: string;
  evidence: string;
}
export type DiagnosisId =
  | "underpowered"
  | "fuel_hog"
  | "overpowered_stack"
  | "max_q_overload"
  | "static_stability_limit"
  | "pencil"
  | "upper_stage_ignition"
  | "off_target_orbit"
  | "weak_upper_stage"
  | "overshoot";

export interface MetricAssessment {
  id: PerformanceMetricId;
  label: string;
  value: number | null;
  unit: string;
  band: MetricBand;
  threshold: string;
  hint: string;
}

export interface RecommendedExperiment {
  control: keyof Omit<RocketConfig, "modelVersion">;
  direction: "increase" | "decrease" | "change";
  metric: PerformanceMetricId;
  label: string;
}

export interface FlightEvidence {
  maxQPa: number;
  maxG: number;
  terminalTimeS: number;
  perigeeKm: number | null;
  source: EvidenceSource;
}

export interface Diagnosis {
  id: DiagnosisId;
  title: string;
  explanation: string;
  evidence: string;
  recommendedExperiment: RecommendedExperiment;
}

export interface FlightAssessment {
  assessmentVersion: string;
  rawOutcome: FlightOutcome;
  metrics: MetricAssessment[];
  evidence: FlightEvidence;
  primaryDiagnosis: Diagnosis | null;
  contributingDiagnoses: Diagnosis[];
  /** Space weather and other non-vehicle launch drivers. */
  environmentalCauses: EnvironmentalCause[];
}
