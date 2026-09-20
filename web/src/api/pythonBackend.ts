/**
 * Browser client for the Python payload-operations backend.
 *
 * Ascent stays in the TypeScript worker. When uvicorn is up, weather and
 * post-insertion analysis (Monte Carlo, emissions, SATCAT crowding) come
 * from the original Python stack via /api.
 */

import { useEffect, useState } from "react";

import type { PayloadHandoff } from "../sim/orbital/payload";
import type { SatcatCensus } from "../sim/orbital/debris";
import type { MonteCarloSummary, SimulationResult, SpacecraftMission } from "../sim/orbital/types";

export interface PythonHealth {
  ok: boolean;
  backend: "python";
  emissionsCached: boolean;
  briefingConfigured: boolean;
}

export interface PythonEmissions {
  analog: string;
  orbitKm: [number, number];
  inclinationDeg: number;
  payloadShare: number;
  co2eTonnes: number;
  attributedExhaustKg: number;
  citation: string;
}

export interface PythonRegulatory {
  mission_name: string;
  compliant: boolean;
  violations: string[];
}

export interface PatternMatch {
  dataset: "spaceWeather" | "earthWeather";
  scenarioId: string;
  title: string;
  severity: string;
  impact: string;
  systemsAffected: string;
  mitigation: string;
  source: string;
  confidence: number;
  evidence: string[];
}

export interface PatternRecognition {
  modelVersion: "scenario-recognition-v1";
  referenceRows: Record<"space_weather" | "earth_weather" | "rocketry", number>;
  matches: PatternMatch[];
}

export interface EarthWeatherInput {
  temperature_c?: number;
  wind_speed_m_s?: number;
  wind_gust_m_s?: number;
  crosswind_m_s?: number;
  precipitation_mm_h?: number;
  visibility_km?: number;
  relative_humidity_pct?: number;
  cape_j_kg?: number;
}

export interface PythonPayloadReport {
  source: "python";
  dryMassKg: number;
  onboardPropellantKg: number;
  crossSectionAreaM2: number;
  ispS: number;
  missionYears: number;
  circularizationDeltaVMs: number;
  circularizationPropellantKg: number;
  insertionBudgetOk: boolean;
  operatingFloorKm: number;
  mission: SpacecraftMission | null;
  result: SimulationResult | null;
  monteCarlo: MonteCarloSummary | null;
  explanations: string[];
  insights: string[];
  emissions: PythonEmissions | null;
  debris: SatcatCensus | null;
  regulatory: PythonRegulatory | null;
  regulatoryRules: Array<{ title?: string | null; html_url?: string | null }>;
  briefing: string | null;
  patternRecognition: PatternRecognition;
  briefingError?: string;
  regulatoryError?: string;
}

export async function recognizeWeatherPatterns(
  weather: PayloadHandoff["weather"]["weather"],
  earthWeather?: EarthWeatherInput,
): Promise<PatternRecognition> {
  const response = await fetch("/api/patterns/recognize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ weather, ...(earthWeather ? { earth_weather: earthWeather } : {}) }),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as PatternRecognition;
}

const PYTHON_DOWN =
  "Python backend is not running. In the repo root: python -m uvicorn api:app --reload --port 8000";

export async function pythonBackendAvailable(): Promise<boolean> {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    if (!response.ok) {
      return false;
    }
    const body = (await response.json()) as Partial<PythonHealth>;
    return body.ok === true && body.backend === "python";
  } catch {
    return false;
  }
}

export async function analyzeLaunchedPayload(
  handoff: PayloadHandoff,
  options?: { runs?: number; sensitivityRuns?: number; includeBriefing?: boolean },
): Promise<PythonPayloadReport> {
  let response: Response;
  try {
    response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        handoff,
        runs: options?.runs ?? 1_000,
        sensitivity_runs: options?.sensitivityRuns ?? 200,
        include_briefing: options?.includeBriefing ?? false,
      }),
    });
  } catch {
    throw new Error(PYTHON_DOWN);
  }
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || PYTHON_DOWN);
  }
  return (await response.json()) as PythonPayloadReport;
}

export function usePythonBackendStatus(): "checking" | "up" | "down" {
  const [status, setStatus] = useState<"checking" | "up" | "down">("checking");
  useEffect(() => {
    let cancelled = false;
    void pythonBackendAvailable().then((up) => {
      if (!cancelled) {
        setStatus(up ? "up" : "down");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return status;
}
