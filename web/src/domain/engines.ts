/**
 * Fictional educational engine catalog. These are gameplay data, clearly
 * identified as fictional, calibrated against the reference scenario.
 *
 * Mass flow is derived from the reference thrust and Isp via F = ṁ·g₀·Isp;
 * ambient-pressure thrust then follows F(p) = F_vac − p·A_exit, so thrust and
 * fuel consumption always stay consistent (they are never interpolated
 * independently).
 */

import { G0 } from "../sim/physics/constants";
import { CATALOG_VERSION } from "./version";

export const SEA_LEVEL_PRESSURE_PA = 101_325.0;

export type EngineId = "booster" | "sustainer" | "vacuum" | "cryogenic";

export interface EngineSpec {
  id: EngineId;
  name: string;
  /** Fictional educational engine — not a real engine. */
  fictional: true;
  /** May ignite at sea level (vacuum-optimized engines may not). */
  seaLevelRated: boolean;
  seaLevelIspS: number;
  vacuumIspS: number;
  dryMassKg: number;
  /** Nozzle exit diameter, m — used by the engine-packing check. */
  nozzleDiameterM: number;
  /** Minimum throttle fraction. */
  minThrottle: number;
  /** Derived: propellant mass flow at full throttle, kg/s. */
  massFlowKgS: number;
  /** Derived: thrust in vacuum, N. */
  vacuumThrustN: number;
  /** Derived: thrust at sea level, N. */
  seaLevelThrustN: number;
  /** Derived: nozzle exit area, m^2. */
  exitAreaM2: number;
}

interface EngineSeed {
  id: EngineId;
  name: string;
  seaLevelRated: boolean;
  seaLevelIspS: number;
  vacuumIspS: number;
  dryMassKg: number;
  nozzleDiameterM: number;
  minThrottle: number;
  /** Reference thrust the catalog quotes, with the condition it applies at. */
  referenceThrustN: number;
  referenceAtSeaLevel: boolean;
}

function deriveEngine(seed: EngineSeed): EngineSpec {
  const referenceIspS = seed.referenceAtSeaLevel ? seed.seaLevelIspS : seed.vacuumIspS;
  const massFlowKgS = seed.referenceThrustN / (G0 * referenceIspS);
  const vacuumThrustN = massFlowKgS * G0 * seed.vacuumIspS;
  const seaLevelThrustN = massFlowKgS * G0 * seed.seaLevelIspS;
  const exitAreaM2 = (vacuumThrustN - seaLevelThrustN) / SEA_LEVEL_PRESSURE_PA;
  return {
    id: seed.id,
    name: seed.name,
    fictional: true,
    seaLevelRated: seed.seaLevelRated,
    seaLevelIspS: seed.seaLevelIspS,
    vacuumIspS: seed.vacuumIspS,
    dryMassKg: seed.dryMassKg,
    nozzleDiameterM: seed.nozzleDiameterM,
    minThrottle: seed.minThrottle,
    massFlowKgS,
    vacuumThrustN,
    seaLevelThrustN,
    exitAreaM2,
  };
}

const ENGINE_SEEDS: EngineSeed[] = [
  {
    id: "booster",
    name: "B-1 Booster (fictional)",
    seaLevelRated: true,
    seaLevelIspS: 285,
    vacuumIspS: 320,
    dryMassKg: 900,
    nozzleDiameterM: 1.4,
    minThrottle: 0.3,
    referenceThrustN: 950_000,
    referenceAtSeaLevel: true,
  },
  {
    id: "sustainer",
    name: "S-2 Sustainer (fictional)",
    seaLevelRated: true,
    seaLevelIspS: 300,
    vacuumIspS: 335,
    dryMassKg: 600,
    nozzleDiameterM: 1.1,
    minThrottle: 0.2,
    referenceThrustN: 475_000,
    referenceAtSeaLevel: true,
  },
  {
    id: "vacuum",
    name: "V-9 Vacuum upper stage (fictional)",
    seaLevelRated: false,
    seaLevelIspS: 100,
    vacuumIspS: 345,
    dryMassKg: 1_000,
    nozzleDiameterM: 2.0,
    minThrottle: 0.1,
    referenceThrustN: 930_000,
    referenceAtSeaLevel: false,
  },
  {
    id: "cryogenic",
    name: "H-1 Cryogenic upper stage (fictional)",
    seaLevelRated: false,
    seaLevelIspS: 120,
    vacuumIspS: 440,
    dryMassKg: 1_800,
    nozzleDiameterM: 2.2,
    minThrottle: 0.15,
    referenceThrustN: 930000,
    referenceAtSeaLevel: false,
  },
];

export interface EngineCatalog {
  version: string;
  engines: Record<EngineId, EngineSpec>;
}

export function createEngineCatalog(): EngineCatalog {
  const entries = ENGINE_SEEDS.map((seed) => [seed.id, deriveEngine(seed)] as const);
  return {
    version: CATALOG_VERSION,
    engines: Object.fromEntries(entries) as Record<EngineId, EngineSpec>,
  };
}

/** Thrust at ambient pressure: F(p) = F_vac − p·A_exit. */
export function thrustAtPressure(engine: EngineSpec, pressurePa: number): number {
  return engine.vacuumThrustN - pressurePa * engine.exitAreaM2;
}

/** Isp at ambient pressure, consistent with thrust via F = ṁ·g₀·Isp. */
export function ispAtPressure(engine: EngineSpec, pressurePa: number): number {
  return thrustAtPressure(engine, pressurePa) / (engine.massFlowKgS * G0);
}
