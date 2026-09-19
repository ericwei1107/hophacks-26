/**
 * Simulation worker: runs flights and batch analyses off the main thread.
 * Batches process in bounded chunks so cancellation is acknowledged promptly;
 * canceled run ids are checked between chunks.
 */

import { runAscentAnalysis, runAscentSensitivity } from "../sim/ascent/robustness";
import { runMonteCarlo } from "../sim/orbital/monteCarlo";
import { GAME_MISSION_RULES, LEGACY_MISSION_RULES } from "../sim/orbital/types";
import type { WorkerRequest, WorkerResponse } from "./protocol";
import {
  deserializeEnvironment,
  runSerializedFlight,
  telemetryTransferBuffers,
} from "./serialize";

const canceled = new Set<number>();

function post(response: WorkerResponse, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(response, transfer);
}

function progress(runId: number, completed: number, total: number): void {
  post({ type: "progress", runId, completed, total });
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === "cancel") {
    canceled.add(message.runId);
    return;
  }

  const runId = message.runId;
  try {
    switch (message.type) {
      case "run_flight": {
        const result = runSerializedFlight(message.input);
        post({ type: "completed", runId, result }, telemetryTransferBuffers(result));
        break;
      }
      case "run_orbital_monte_carlo": {
        const req = message.request;
        const rules = req.rules === "game" ? GAME_MISSION_RULES : LEGACY_MISSION_RULES;
        const summary = runMonteCarlo(
          req.mission,
          req.weather.weather,
          req.runs,
          req.sensitivityRuns,
          req.seed,
          rules,
          (p) => {
            progress(runId, p.completed, p.total);
            return !canceled.has(runId);
          },
        );
        post({ type: "completed", runId, result: summary });
        break;
      }
      case "run_ascent_analysis": {
        const req = message.request;
        const environment = deserializeEnvironment(req.input);
        const result = runAscentAnalysis({
          config: req.input.config,
          environment,
          ...(req.input.guidance !== undefined ? { guidance: req.input.guidance } : {}),
          runs: req.runs,
          seed: req.seed,
          ...(req.onlyParameter !== undefined ? { onlyParameter: req.onlyParameter } : {}),
          onChunk: (completed, total) => {
            progress(runId, completed, total);
            return !canceled.has(runId);
          },
        });
        post({ type: "completed", runId, result });
        break;
      }
      case "run_ascent_sensitivity": {
        const req = message.request;
        const environment = deserializeEnvironment(req.input);
        const result = runAscentSensitivity(
          req.input.config,
          environment,
          req.runsPerParameter,
          req.seed,
          req.input.guidance,
          (completed, total) => {
            progress(runId, completed, total);
            return !canceled.has(runId);
          },
        );
        post({ type: "completed", runId, result });
        break;
      }
    }
  } catch (error) {
    post({ type: "failed", runId, error: error instanceof Error ? error.message : String(error) });
  } finally {
    canceled.delete(runId);
  }
};
