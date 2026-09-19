/**
 * Local persistence: the current build and the last ten run summaries.
 * Everything is versioned; a build edit invalidates prior analysis until
 * rerun (tracked by comparing model/catalog/guidance versions and config).
 */

import type { RocketConfig } from "../domain/config";
import { MODEL_VERSION } from "../domain/version";
import type { FlightOutcome } from "../sim/ascent/flight";
import type { FlightAssessment } from "../sim/outcomes/types";
import type { TransferResult } from "../sim/lunar/transfer";

const BUILD_KEY = "apogee.build.v1";
const RUNS_KEY = "apogee.runs.v2";
const LEGACY_RUNS_KEY = "apogee.runs.v1";
const SETTINGS_KEY = "apogee.settings.v1";
const MAX_RUN_SUMMARIES = 10;

export interface RunSummary {
  id: string;
  timestamp: string;
  config: RocketConfig;
  outcome: FlightOutcome;
  orbitAchieved: boolean;
  targetOrbitAchieved: boolean;
  maxQPa: number;
  maxG: number;
  /** Parking-orbit perigee/apogee — the meaningful "orbit reached" even when the flight went on to attempt trans-lunar injection. */
  perigeeKm: number | null;
  apogeeKm: number | null;
  modelVersion: string;
  catalogVersion: string;
  guidanceVersion: string;
  seed: number;
  assessment: FlightAssessment | null;
  /** Optional: absent on records saved before the lunar mission shipped. */
  lunarTransfer?: TransferResult | null;
  baselineRunId?: string;
  comparisonKind?: "one_relevant_change" | "multiple_changes" | "no_change" | "incompatible_baseline";
}

export interface Settings {
  reducedMotion: boolean;
  lowEffects: boolean;
  muted: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  reducedMotion: false,
  lowEffects: false,
  muted: false,
};

function safeRead<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

function safeWrite(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadBuild(): RocketConfig | null {
  const build = safeRead<RocketConfig>(BUILD_KEY);
  if (!build || build.modelVersion !== MODEL_VERSION) {
    return null;
  }
  return build;
}

export function saveBuild(config: RocketConfig): void {
  safeWrite(BUILD_KEY, config);
}

export function loadRunSummaries(): RunSummary[] {
  const current = safeRead<RunSummary[]>(RUNS_KEY);
  const legacy = current ?? safeRead<RunSummary[]>(LEGACY_RUNS_KEY) ?? [];
  return legacy.map((run) => ({ ...run, assessment: run.assessment ?? null }));
}

export interface PushRunSummaryResult {
  runs: RunSummary[];
  persisted: boolean;
}

export function pushRunSummary(summary: RunSummary): PushRunSummaryResult {
  const runs = [summary, ...loadRunSummaries()].slice(0, MAX_RUN_SUMMARIES);
  return { runs, persisted: safeWrite(RUNS_KEY, runs) };
}

export function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...(safeRead<Partial<Settings>>(SETTINGS_KEY) ?? {}) };
}

export function saveSettings(settings: Settings): void {
  safeWrite(SETTINGS_KEY, settings);
}

/** A build's prior analysis is stale once the config or versions change. */
export function isAnalysisStale(config: RocketConfig, lastRun: RunSummary | null): boolean {
  if (!lastRun) {
    return true;
  }
  return (
    JSON.stringify(config) !== JSON.stringify(lastRun.config) ||
    lastRun.modelVersion !== MODEL_VERSION
  );
}
