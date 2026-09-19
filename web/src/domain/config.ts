/**
 * Player-facing rocket configuration. The player configures only these eight
 * controls; everything else is derived by deriveRocket.
 */

import type { EngineId } from "./engines";
import { MODEL_VERSION } from "./version";

export interface RocketConfig {
  modelVersion: string;
  /** Payload wet mass, kg (0.5–20 t). */
  payloadWetMassKg: number;
  /** Fairing/body diameter, m (1–5). Sets the diameter of the whole stack. */
  diameterM: number;
  /** Stage 1 propellant capacity, kg (20–400 t). */
  stage1PropellantKg: number;
  /** Stage 1 engine count (1–9). */
  stage1EngineCount: number;
  /** Stage 1 engine: sea-level options only. */
  stage1Engine: EngineId;
  /** Stage 2 propellant capacity, kg (5–120 t). */
  stage2PropellantKg: number;
  /** Stage 2 engine: vacuum or sea-level. */
  stage2Engine: EngineId;
  /** Fin span, m (0–3). */
  finSpanM: number;
}

export const CONFIG_RANGES = {
  payloadWetMassKg: { min: 500, max: 20_000, step: 100, unit: "kg" },
  diameterM: { min: 1, max: 5, step: 0.1, unit: "m" },
  stage1PropellantKg: { min: 20_000, max: 400_000, step: 1_000, unit: "kg" },
  stage1EngineCount: { min: 1, max: 9, step: 1, unit: "" },
  stage2PropellantKg: { min: 5_000, max: 120_000, step: 1_000, unit: "kg" },
  finSpanM: { min: 0, max: 3, step: 0.1, unit: "m" },
} as const;

/** The reference build, matching the documented prototype calibration. */
export function referenceConfig(): RocketConfig {
  return {
    modelVersion: MODEL_VERSION,
    payloadWetMassKg: 5_000,
    diameterM: 3.7,
    stage1PropellantKg: 200_000,
    stage1EngineCount: 4,
    stage1Engine: "booster",
    stage2PropellantKg: 60_000,
    stage2Engine: "vacuum",
    finSpanM: 2.0,
  };
}
