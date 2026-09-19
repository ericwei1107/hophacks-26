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
      reportVersion: 1,
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
      finalOrbit: flight.finalElements,
      stage2PropellantRemainingKg: flight.stage2PropellantRemainingKg,
      totalTimeS: flight.totalTimeS,
      events: flight.events,
      sampleCount: t.sampleCount,
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
): { configDiffs: string[]; outcomeChange: string } {
  return {
    configDiffs: configDifferences(previous.config, current.config),
    outcomeChange: `${previous.outcome} → ${current.outcome}`,
  };
}
