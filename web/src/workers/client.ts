/**
 * Promise-based client for the simulation workers. Two instances are kept:
 * one for flight runs, one for batch analysis, so a long Monte Carlo batch
 * never blocks a launch. Cancellation sends a cancel message; stale messages
 * from superseded runs are ignored by run id.
 */

import type {
  AscentAnalysisRequest,
  AscentSensitivityRequest,
  OrbitalMonteCarloRequest,
  SerializableFlightResult,
  SerializedFlightInput,
  WorkerRequest,
  WorkerResponse,
} from "./protocol";
import type { MonteCarloSummary } from "../sim/orbital/types";
import type { AscentRobustnessResult, AscentSensitivityResult } from "../sim/ascent/robustness";

export class RunCanceledError extends Error {
  constructor() {
    super("Run canceled");
    this.name = "RunCanceledError";
  }
}

interface PendingRun {
  resolve: (result: never) => void;
  reject: (error: Error) => void;
  onProgress?: (completed: number, total: number) => void;
}

class WorkerHandle {
  private worker: Worker;
  private nextRunId = 1;
  private pending = new Map<number, PendingRun>();

  constructor() {
    this.worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      const run = this.pending.get(message.runId);
      if (!run) {
        return; // stale message from a canceled/superseded run
      }
      switch (message.type) {
        case "progress":
          run.onProgress?.(message.completed, message.total);
          break;
        case "completed":
          this.pending.delete(message.runId);
          run.resolve(message.result as never);
          break;
        case "failed":
          this.pending.delete(message.runId);
          run.reject(new Error(message.error));
          break;
      }
    };
    this.worker.onerror = (event) => {
      // A hard worker failure rejects everything in flight.
      for (const run of this.pending.values()) {
        run.reject(new Error(event.message));
      }
      this.pending.clear();
    };
  }

  private post<T>(request: WorkerRequest, onProgress?: (completed: number, total: number) => void): Promise<T> {
    const runId = request.runId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(runId, {
        resolve: resolve as (result: never) => void,
        reject,
        ...(onProgress !== undefined ? { onProgress } : {}),
      });
      this.worker.postMessage(request);
    });
  }

  private allocateRunId(): number {
    return this.nextRunId++;
  }

  runFlight(
    input: SerializedFlightInput,
    onProgress?: (completed: number, total: number) => void,
  ): { promise: Promise<SerializableFlightResult>; runId: number } {
    const runId = this.allocateRunId();
    return { promise: this.post({ type: "run_flight", runId, input }, onProgress), runId };
  }

  runOrbitalMonteCarlo(
    request: OrbitalMonteCarloRequest,
    onProgress?: (completed: number, total: number) => void,
  ): { promise: Promise<MonteCarloSummary>; runId: number } {
    const runId = this.allocateRunId();
    return { promise: this.post({ type: "run_orbital_monte_carlo", runId, request }, onProgress), runId };
  }

  runAscentAnalysis(
    request: AscentAnalysisRequest,
    onProgress?: (completed: number, total: number) => void,
  ): { promise: Promise<AscentRobustnessResult>; runId: number } {
    const runId = this.allocateRunId();
    return { promise: this.post({ type: "run_ascent_analysis", runId, request }, onProgress), runId };
  }

  runAscentSensitivity(
    request: AscentSensitivityRequest,
    onProgress?: (completed: number, total: number) => void,
  ): { promise: Promise<AscentSensitivityResult>; runId: number } {
    const runId = this.allocateRunId();
    return { promise: this.post({ type: "run_ascent_sensitivity", runId, request }, onProgress), runId };
  }

  cancel(runId: number): void {
    const run = this.pending.get(runId);
    if (run) {
      this.pending.delete(runId);
      this.worker.postMessage({ type: "cancel", runId } satisfies WorkerRequest);
      run.reject(new RunCanceledError());
    }
  }

  cancelAll(): void {
    for (const runId of [...this.pending.keys()]) {
      this.cancel(runId);
    }
  }

  terminate(): void {
    this.cancelAll();
    this.worker.terminate();
  }
}

/** Client holding the two dedicated workers. */
export class SimClient {
  private flightWorker = new WorkerHandle();
  private analysisWorker = new WorkerHandle();

  runFlight(input: SerializedFlightInput, onProgress?: (completed: number, total: number) => void) {
    return this.flightWorker.runFlight(input, onProgress);
  }

  runOrbitalMonteCarlo(request: OrbitalMonteCarloRequest, onProgress?: (completed: number, total: number) => void) {
    return this.analysisWorker.runOrbitalMonteCarlo(request, onProgress);
  }

  runAscentAnalysis(request: AscentAnalysisRequest, onProgress?: (completed: number, total: number) => void) {
    return this.analysisWorker.runAscentAnalysis(request, onProgress);
  }

  runAscentSensitivity(request: AscentSensitivityRequest, onProgress?: (completed: number, total: number) => void) {
    return this.analysisWorker.runAscentSensitivity(request, onProgress);
  }

  cancelFlight(runId: number): void {
    this.flightWorker.cancel(runId);
  }

  cancelAnalysis(runId: number): void {
    this.analysisWorker.cancel(runId);
  }

  terminate(): void {
    this.flightWorker.terminate();
    this.analysisWorker.terminate();
  }
}
