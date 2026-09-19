/**
 * Versioned run reports: download a flight result as JSON, and copy the
 * build configuration to the clipboard.
 */

import type { RocketConfig } from "../domain/config";
import { CONFIG_RANGES } from "../domain/config";
import type { RunSummary } from "./storage";
import type { SerializableFlightResult } from "../workers/serialize";

export function buildRunReport(flight: SerializableFlightResult): string {
  const t = flight.telemetry;
  return JSON.stringify(
    {
      reportVersion: 2,
      modelVersion: flight.modelVersion,
      catalogVersion: flight.catalogVersion,
      guidanceVersion: flight.guidanceVersion,
      seed: flight.seed,
      timestamp: new Date().toISOString(),
      config: flight.config,
      weather: flight.weather,
      outcome: flight.outcome,
      orbitAchieved: flight.orbitAchieved,
      targetOrbitAchieved: flight.targetOrbitAchieved,
      failureCode: flight.failureCode,
      failureDetail: flight.failureDetail,
      maxQPa: flight.maxQPa,
      maxG: flight.maxG,
      // `finalOrbit` is the trans-lunar trajectory for any flight that
      // attempted TLI (see `lunarTransfer`), not the parking orbit —
      // `parkingOrbit` is the one to read for "what orbit did it reach".
      finalOrbit: flight.finalElements,
      parkingOrbit: flight.parkingElements,
      lunarTransfer: flight.lunarTransfer,
      stage2PropellantRemainingKg: flight.stage2PropellantRemainingKg,
      totalTimeS: flight.totalTimeS,
      events: flight.events,
      sampleCount: t.sampleCount,
      evidence: flight.evidence,
      assessment: flight.assessment,
    },
    null,
    2,
  );
}

export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function copyConfigToClipboard(config: RocketConfig): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(JSON.stringify(config, null, 2));
    return true;
  } catch {
    return false;
  }
}

/** Human-readable differences between two build configurations. */
export function configDifferences(a: RocketConfig, b: RocketConfig): string[] {
  const diffs: string[] = [];
  const labels: Record<keyof typeof CONFIG_RANGES | "stage1Engine" | "stage2Engine", string> = {
    payloadWetMassKg: "payload",
    diameterM: "diameter",
    stage1PropellantKg: "stage-1 propellant",
    stage1EngineCount: "stage-1 engines",
    stage1Engine: "stage-1 engine",
    stage2PropellantKg: "stage-2 propellant",
    stage2Engine: "stage-2 engine",
    finSpanM: "fin span",
  };
  for (const key of Object.keys(labels) as (keyof typeof labels)[]) {
    const va = a[key];
    const vb = b[key];
    if (va !== vb) {
      diffs.push(`${labels[key]}: ${String(va)} → ${String(vb)}`);
    }
  }
  return diffs;
}

export function compareRunToCurrent(
  current: SerializableFlightResult,
  previous: RunSummary,
): { configDiffs: string[]; outcomeChange: string; kind: "one_relevant_change" | "multiple_changes" | "no_change" | "incompatible_baseline" } {
  const configDiffs = configDifferences(previous.config, current.config);
  const recommended = previous.assessment?.primaryDiagnosis?.recommendedExperiment;
  const changed = Object.keys(previous.config).filter((key) => key !== "modelVersion" && previous.config[key as keyof typeof previous.config] !== current.config[key as keyof typeof current.config]);
  const compatible = previous.modelVersion === current.modelVersion && previous.catalogVersion === current.catalogVersion && previous.guidanceVersion === current.guidanceVersion;
  const kind = !compatible
    ? "incompatible_baseline"
    : changed.length === 0
      ? "no_change"
      : changed.length === 1 && recommended !== undefined && changed[0] === recommended.control
        ? "one_relevant_change"
        : "multiple_changes";
  return {
    configDiffs,
    outcomeChange: `${previous.outcome} → ${current.outcome}`,
    kind,
  };
}
