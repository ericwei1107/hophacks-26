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

/**
 * The reference build. Calibrated to clear the trans-lunar delta-v
 * requirement (LUNAR_MISSION_PLAN.md §2.2) under the existing fixed
 * autopilot: 12,501 m/s ideal delta-v, liftoff TWR 1.33, static margin 1.84
 * calibers, slenderness 11.8 — reaches `target_orbit` exactly as the old LEO
 * reference did. The cryogenic upper stage is what makes lunar delta-v
 * reachable at all (the old `vacuum` engine tops out around 11.9 km/s on
 * this airframe), but headroom above ~12.6 km/s is bounded by the fixed
 * guidance, not by propellant: builds swept past that under this same
 * autopilot overshoot the parking-orbit apogee cap and land in
 * `sustained_orbit` (or worse) instead of `target_orbit`. That is a real,
 * measured steering-loss effect — see LUNAR_MISSION_PLAN.md §1 — not a
 * placeholder value.
 */
export function referenceConfig(): RocketConfig {
  return {
    modelVersion: MODEL_VERSION,
    payloadWetMassKg: 5_000,
    diameterM: 3.7,
    stage1PropellantKg: 260_000,
    stage1EngineCount: 5,
    stage1Engine: "booster",
    stage2PropellantKg: 70_000,
    stage2Engine: "cryogenic",
    finSpanM: 2.0,
  };
}
