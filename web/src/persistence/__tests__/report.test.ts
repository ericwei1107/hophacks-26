import { describe, expect, it } from "vitest";

import { referenceConfig } from "../../domain/config";
import { compareRunToCurrent } from "../report";
import type { RunSummary } from "../storage";
import type { SerializableFlightResult } from "../../workers/protocol";

const config = referenceConfig();
const assessment = {
  assessmentVersion: "1",
  rawOutcome: "insufficient_liftoff_thrust" as const,
  metrics: [],
  evidence: { maxQPa: 0, maxG: 0, terminalTimeS: 5, perigeeKm: null, source: "observed" as const },
  primaryDiagnosis: { id: "underpowered" as const, title: "", explanation: "", evidence: "", recommendedExperiment: { control: "stage1EngineCount" as const, direction: "increase" as const, metric: "liftoff_twr" as const, label: "" } },
  contributingDiagnoses: [],
};
const previous: RunSummary = { id: "before", timestamp: "", config, outcome: "insufficient_liftoff_thrust", orbitAchieved: false, targetOrbitAchieved: false, maxQPa: 0, maxG: 0, perigeeKm: null, apogeeKm: null, modelVersion: "1.0.0", catalogVersion: "1.1.0", guidanceVersion: "1.0.0", seed: 1, assessment };
const current = { config: { ...config, stage1EngineCount: config.stage1EngineCount + 1 }, modelVersion: "1.0.0", catalogVersion: "1.1.0", guidanceVersion: "1.0.0" } as SerializableFlightResult;

describe("compareRunToCurrent", () => {
  it("recognizes one relevant recommended edit", () => {
    expect(compareRunToCurrent(current, previous).kind).toBe("one_relevant_change");
  });

  it("downgrades multiple edits to correlation", () => {
    expect(compareRunToCurrent({ ...current, config: { ...current.config, finSpanM: 2.5 } }, previous).kind).toBe("multiple_changes");
  });
});
