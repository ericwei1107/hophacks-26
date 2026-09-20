/**
 * Payload handoff: connects the launched payload to the preserved orbital
 * mission model.
 *
 * At successful insertion, an immutable handoff is created from the flight
 * result. The configured payload mass is its total wet mass; the spacecraft
 * specification is a fixed educational assumption reported to the player:
 *
 * - Dry mass: 80% of payload wet mass; onboard propellant: 20%.
 * - Specific impulse 325 s; drag coefficient 2.2.
 * - Cross-sectional area 5 × (wetMass/1000)^(2/3) m².
 * - Mission duration: three years; inclination from the achieved orbit.
 *
 * The slightly elliptical achieved orbit is adapted to the circular mission
 * model by charging the circularization burn at the achieved apogee against
 * the payload's own propellant (never the leftover upper-stage fuel, which is
 * reported separately). If the payload cannot afford circularization, the
 * analysis reports an insertion-budget failure.
 */

import { EARTH_RADIUS, MU_EARTH } from "../physics/constants";
import type { OrbitalElements } from "../physics/orbital";
import { estimatePropellantConsumed, simulate } from "./simulate";
import {
  GAME_MISSION_RULES,
  type MissionRules,
  type SimulationResult,
  type SpacecraftMission,
} from "./types";
import { MODEL_VERSION } from "../../domain/version";
import type { WeatherSnapshot } from "./weather";

export const PAYLOAD_ISP_S = 325;
export const PAYLOAD_DRAG_COEFFICIENT = 2.2;
export const PAYLOAD_MISSION_YEARS = 3;
export const PAYLOAD_DRY_FRACTION = 0.8;
export const PAYLOAD_PROPELLANT_FRACTION = 0.2;

export interface PayloadHandoff {
  modelVersion: string;
  payloadWetMassKg: number;
  achievedPerigeeKm: number;
  achievedApogeeKm: number;
  achievedInclinationDeg: number;
  /** Leftover upper-stage propellant — displayed separately, never used. */
  stage2PropellantRemainingKg: number;
  weather: WeatherSnapshot;
  seed: number;
}

export interface PayloadAnalysis {
  handoff: PayloadHandoff;
  rules: MissionRules;
  /** Spacecraft spec derived from the payload wet mass. */
  dryMassKg: number;
  onboardPropellantKg: number;
  crossSectionAreaM2: number;
  ispS: number;
  missionYears: number;
  /** Circularization at the achieved apogee, charged to payload propellant. */
  circularizationDeltaVMs: number;
  circularizationPropellantKg: number;
  insertionBudgetOk: boolean;
  /** The mission passed to the preserved model (null when unaffordable). */
  mission: SpacecraftMission | null;
  result: SimulationResult | null;
  /** Deterministic, evidence-tied explanations for the report. */
  explanations: string[];
}

/** Minimal plain-data shape a handoff needs (crosses the worker boundary). */
export interface HandoffSource {
  orbitAchieved: boolean;
  finalElements: OrbitalElements | null;
  stage2PropellantRemainingKg: number;
  payloadWetMassKg: number;
  weather: WeatherSnapshot;
  seed: number;
}

/** Create the immutable handoff from a successful flight result. */
export function createPayloadHandoff(source: HandoffSource): PayloadHandoff | null {
  const elements = source.finalElements;
  if (!source.orbitAchieved || elements === null || elements.apogeeAltitudeKm === null) {
    return null;
  }
  return {
    modelVersion: MODEL_VERSION,
    payloadWetMassKg: source.payloadWetMassKg,
    achievedPerigeeKm: elements.perigeeAltitudeKm,
    achievedApogeeKm: elements.apogeeAltitudeKm,
    achievedInclinationDeg: elements.inclinationDeg,
    stage2PropellantRemainingKg: source.stage2PropellantRemainingKg,
    weather: source.weather,
    seed: source.seed,
  };
}

/** Delta-v to circularize an elliptical orbit at its apogee, m/s. */
export function circularizationDeltaV(perigeeKm: number, apogeeKm: number): number {
  const rA = EARTH_RADIUS + apogeeKm * 1000;
  const rP = EARTH_RADIUS + perigeeKm * 1000;
  const a = (rA + rP) / 2;
  const vAtApogee = Math.sqrt(MU_EARTH * (2 / rA - 1 / a));
  const vCircular = Math.sqrt(MU_EARTH / rA);
  return Math.max(0, vCircular - vAtApogee);
}

export function analyzePayload(
  handoff: PayloadHandoff,
  rules: MissionRules = GAME_MISSION_RULES,
  camScale = 1.0,
): PayloadAnalysis {
  const wet = handoff.payloadWetMassKg;
  const dryMassKg = wet * PAYLOAD_DRY_FRACTION;
  const onboardPropellantKg = wet * PAYLOAD_PROPELLANT_FRACTION;
  const crossSectionAreaM2 = 5 * (wet / 1000) ** (2 / 3);

  const circDv = circularizationDeltaV(handoff.achievedPerigeeKm, handoff.achievedApogeeKm);
  const circSpec = { mass: dryMassKg, fuel: onboardPropellantKg, isp: PAYLOAD_ISP_S };
  const circPropellant = estimatePropellantConsumed(circSpec as SpacecraftMission, circDv);
  const insertionBudgetOk = circPropellant <= onboardPropellantKg;

  const base: Omit<PayloadAnalysis, "mission" | "result" | "explanations"> = {
    handoff,
    rules,
    dryMassKg,
    onboardPropellantKg,
    crossSectionAreaM2,
    ispS: PAYLOAD_ISP_S,
    missionYears: PAYLOAD_MISSION_YEARS,
    circularizationDeltaVMs: circDv,
    circularizationPropellantKg: circPropellant,
    insertionBudgetOk,
  };

  if (!insertionBudgetOk) {
    return {
      ...base,
      mission: null,
      result: null,
      explanations: [
        `Circularizing the achieved ${handoff.achievedPerigeeKm.toFixed(0)} x ${handoff.achievedApogeeKm.toFixed(0)} km orbit needs ${circDv.toFixed(0)} m/s, but the payload's onboard propellant affords less. Insertion-budget failure: the launch left the payload too elliptical.`,
      ],
    };
  }

  const remainingFuel = onboardPropellantKg - circPropellant;
  const mission: SpacecraftMission = {
    mass: dryMassKg,
    fuel: remainingFuel,
    lifespan: PAYLOAD_MISSION_YEARS,
    target_altitude: handoff.achievedApogeeKm,
    target_inclination: handoff.achievedInclinationDeg,
    cross_section_area: crossSectionAreaM2,
    drag_coefficient: PAYLOAD_DRAG_COEFFICIENT,
    isp: PAYLOAD_ISP_S,
  };
  const result = simulate(
    mission,
    handoff.weather.weather,
    { insertion_altitude_error_km: 0, insertion_inclination_error_deg: 0, cam_scale: camScale },
    rules,
  );

  return { ...base, mission, result, explanations: explainPayload(base, mission, result) };
}

function explainPayload(
  base: Omit<PayloadAnalysis, "mission" | "result" | "explanations">,
  mission: SpacecraftMission,
  result: SimulationResult,
): string[] {
  const lines: string[] = [
    `Payload ${(base.handoff.payloadWetMassKg / 1000).toFixed(1)} t: dry ${(base.dryMassKg / 1000).toFixed(2)} t, onboard propellant ${(base.onboardPropellantKg / 1000).toFixed(2)} t, Isp ${base.ispS} s, area ${base.crossSectionAreaM2.toFixed(1)} m^2, ${base.missionYears}-year mission at ${mission.target_altitude.toFixed(0)} km circularized (cost ${base.circularizationDeltaVMs.toFixed(0)} m/s).`,
  ];
  if (result.passed) {
    lines.push(
      `Baseline mission passes: required ${result.required_delta_v.toFixed(1)} m/s vs available ${result.available_delta_v.toFixed(1)} m/s; ${result.propellant_remaining.toFixed(1)} kg propellant remains.`,
    );
  } else {
    lines.push(`Baseline mission fails: ${result.failure_reasons.join(", ")}.`);
    if (result.failure_reasons.includes("insufficient_delta_v") || result.failure_reasons.includes("orbital_decay")) {
      lines.push(
        `At ${mission.target_altitude.toFixed(0)} km the atmosphere still drags the spacecraft down over ${base.missionYears} years. A higher orbit or more onboard propellant would survive longer — a real engineering tradeoff, not a guaranteed fix.`,
      );
    }
    if (result.failure_reasons.includes("insufficient_propellant_reserve")) {
      lines.push("The mission completes but dips below the 10% propellant reserve rule.");
    }
  }
  if (base.handoff.stage2PropellantRemainingKg > 1) {
    lines.push(
      `Note: ${(base.handoff.stage2PropellantRemainingKg / 1000).toFixed(2)} t of upper-stage propellant was left over at cutoff — it stays with the spent stage and is not available to the payload.`,
    );
  }
  return lines;
}
