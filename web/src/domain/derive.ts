/**
 * deriveRocket(config, catalog) → DerivedRocket
 *
 * The single pure function from which every displayed measurement and every
 * procedural mesh dimension comes. Changing a slider updates geometry and
 * engineering values from this same calculation.
 *
 * Geometry and mass rules (versioned model data):
 * - Frontal area A = πd²/4; ascent drag area CdA = 0.3A.
 * - Effective propellant density 1000 kg/m³, usable tank volume 95%.
 * - Tank structural mass: 7.2% of stage-1 capacity, 5% of stage-2 capacity.
 * - Fairing mass 800×(d/3.7)² kg, length 1.8d.
 * - Four fins together: 200×(span/2)² kg.
 * - Engine bays 0.5d each; interstage 0.3d (its mass is inside the stage-1
 *   structural fraction).
 * - Fixed trapezoidal fin proportions: root chord 1.2d, tip chord 0.4d,
 *   sweep 0.4d.
 *
 * Stability uses a simplified Barrowman-style model with fixed coefficients:
 * nose CNα = 2.0 at 0.466×fairing length; fin CNα = 4n(s/d)²·K·C_FIN with
 * body-interference factor K = 1 + r/(s+r) and C_FIN = 1.0, a fixed
 * educational coefficient chosen so the reference build sits near 1.3
 * calibers and fin spans under ~1.75 m go unstable.
 */

import { G0 } from "../sim/physics/constants";
import { MODEL_VERSION } from "./version";
import { CONFIG_RANGES, type RocketConfig } from "./config";
import type { EngineCatalog, EngineSpec } from "./engines";

export const PROPELLANT_DENSITY_KG_M3 = 1000.0;
export const USABLE_TANK_FRACTION = 0.95;
export const STAGE1_STRUCTURAL_FRACTION = 0.072;
export const STAGE2_STRUCTURAL_FRACTION = 0.05;
export const DRAG_COEFFICIENT = 0.3;
export const FIN_NORMAL_FORCE_COEFFICIENT = 1.0;
export const NOSE_CN_ALPHA = 2.0;
export const NOSE_CP_FRACTION = 0.466;
export const REQUIRED_STATIC_MARGIN = 1.0;
export const SLENDERNESS_WARNING = 15;
export const SLENDERNESS_LIMIT = 20;

export type ComponentKind =
  | "fairing"
  | "payload"
  | "stage2-tank"
  | "stage2-engine"
  | "interstage"
  | "stage1-tank"
  | "stage1-engine"
  | "fins";

export interface RocketComponent {
  kind: ComponentKind;
  /** Axial start, meters from the nose. */
  xStartM: number;
  lengthM: number;
  dryMassKg: number;
  /** Propellant capacity for tanks; zero otherwise. */
  propellantKg: number;
  /** Center of mass of this component, meters from the nose. */
  centerOfMassM: number;
}

export interface StageDerived {
  engine: EngineSpec;
  engineCount: number;
  propellantKg: number;
  structuralMassKg: number;
  engineMassKg: number;
  dryMassKg: number;
  tankLengthM: number;
  /** Mass ratio with the carried upper stack included. */
  massRatio: number;
  /** Ideal (vacuum) delta-v with the carried upper stack included, m/s. */
  idealDeltaVMs: number;
}

export type BuildCheckSeverity = "error" | "warning";

export interface BuildCheck {
  id: string;
  severity: BuildCheckSeverity;
  message: string;
}

export interface FinGeometry {
  spanM: number;
  rootChordM: number;
  tipChordM: number;
  sweepM: number;
  /** Leading-edge position, meters from the nose. */
  leadingEdgeM: number;
}

export interface DerivedRocket {
  modelVersion: string;
  catalogVersion: string;
  config: RocketConfig;
  components: RocketComponent[];
  fins: FinGeometry;
  diameterM: number;
  totalLengthM: number;
  frontalAreaM2: number;
  /** Ascent drag area CdA, m^2. */
  dragAreaM2: number;
  dryMassKg: number;
  wetMassKg: number;
  liftoffTwr: number;
  stage1: StageDerived;
  stage2: StageDerived;
  totalIdealDeltaVMs: number;
  /** Liftoff center of mass, meters from the nose. */
  centerOfMassM: number;
  /** Center of pressure, meters from the nose. */
  centerOfPressureM: number;
  /** (xCP − xCM) / diameter. */
  staticMargin: number;
  slenderness: number;
  enginePackingOk: boolean;
  checks: BuildCheck[];
}

/**
 * Known optimal circle-packing ratios (small-circle radius / enclosing
 * radius) for n equal circles, used for the engine-packing check.
 */
const PACKING_RATIOS = [1.0, 0.5, 0.4641, 0.4142, 0.3702, 0.3611, 0.3333, 0.3026, 0.2767];

/**
 * Educational license: real engine packs tolerate nozzle overhang and gimbal
 * clearance, so the packing check allows 5% tighter than the mathematical
 * optimum.
 */
const PACKING_TOLERANCE = 0.95;

export function enginesFitDiameter(
  nozzleDiameterM: number,
  count: number,
  bodyDiameterM: number,
): boolean {
  if (count < 1 || count > 9) {
    return false;
  }
  const ratio = PACKING_RATIOS[count - 1] / PACKING_TOLERANCE;
  const requiredRadius = nozzleDiameterM / 2 / ratio;
  return requiredRadius <= bodyDiameterM / 2 + 1e-9;
}

export function deriveRocket(config: RocketConfig, catalog: EngineCatalog): DerivedRocket {
  const checks: BuildCheck[] = [];
  const d = config.diameterM;

  // --- Malformed configuration checks (block launch) -----------------------
  const rangeChecks: [keyof typeof CONFIG_RANGES, number][] = [
    ["payloadWetMassKg", config.payloadWetMassKg],
    ["diameterM", config.diameterM],
    ["stage1PropellantKg", config.stage1PropellantKg],
    ["stage1EngineCount", config.stage1EngineCount],
    ["stage2PropellantKg", config.stage2PropellantKg],
    ["finSpanM", config.finSpanM],
  ];
  for (const [key, value] of rangeChecks) {
    const range = CONFIG_RANGES[key];
    if (!Number.isFinite(value) || value < range.min || value > range.max) {
      checks.push({
        id: `out_of_range_${key}`,
        severity: "error",
        message: `${key} must be between ${range.min} and ${range.max} ${range.unit}.`,
      });
    }
  }

  const stage1Engine = catalog.engines[config.stage1Engine];
  const stage2Engine = catalog.engines[config.stage2Engine];

  if (!stage1Engine.seaLevelRated) {
    checks.push({
      id: "stage1_engine_not_sea_level",
      severity: "error",
      message: `${stage1Engine.name} cannot ignite at sea level; stage 1 needs a sea-level engine.`,
    });
  }

  const packingOk =
    enginesFitDiameter(stage1Engine.nozzleDiameterM, config.stage1EngineCount, d) &&
    enginesFitDiameter(stage2Engine.nozzleDiameterM, 1, d);
  if (!packingOk) {
    checks.push({
      id: "engine_packing",
      severity: "error",
      message: "Engines do not fit inside the body diameter. Add diameter or reduce engine count.",
    });
  }

  // --- Geometry -------------------------------------------------------------
  const frontalArea = (Math.PI * d ** 2) / 4;
  const dragArea = DRAG_COEFFICIENT * frontalArea;
  const effectiveDensity = PROPELLANT_DENSITY_KG_M3 * USABLE_TANK_FRACTION;

  const fairingLength = 1.8 * d;
  const engineBayLength = 0.5 * d;
  const interstageLength = 0.3 * d;
  const stage1TankLength = config.stage1PropellantKg / (effectiveDensity * frontalArea);
  const stage2TankLength = config.stage2PropellantKg / (effectiveDensity * frontalArea);
  const totalLength =
    fairingLength + stage2TankLength + engineBayLength + interstageLength + stage1TankLength + engineBayLength;

  // --- Masses ---------------------------------------------------------------
  const fairingMass = 800 * (d / 3.7) ** 2;
  const finMass = 200 * (config.finSpanM / 2) ** 2;
  const stage1Structure = STAGE1_STRUCTURAL_FRACTION * config.stage1PropellantKg;
  const stage2Structure = STAGE2_STRUCTURAL_FRACTION * config.stage2PropellantKg;
  const stage1EngineMass = config.stage1EngineCount * stage1Engine.dryMassKg;
  const stage2EngineMass = stage2Engine.dryMassKg;

  // --- Component stack, nose to tail ----------------------------------------
  let x = 0;
  const components: RocketComponent[] = [];
  const push = (component: Omit<RocketComponent, "xStartM">) => {
    components.push({ ...component, xStartM: x });
    x += component.lengthM;
  };

  push({
    kind: "fairing",
    lengthM: fairingLength,
    dryMassKg: fairingMass,
    propellantKg: 0,
    centerOfMassM: 0.45 * fairingLength,
  });
  // Payload rides inside the fairing.
  components.push({
    kind: "payload",
    xStartM: 0,
    lengthM: fairingLength,
    dryMassKg: config.payloadWetMassKg,
    propellantKg: 0,
    centerOfMassM: 0.55 * fairingLength,
  });
  push({
    kind: "stage2-tank",
    lengthM: stage2TankLength,
    dryMassKg: stage2Structure,
    propellantKg: config.stage2PropellantKg,
    centerOfMassM: stage2TankLength / 2,
  });
  push({
    kind: "stage2-engine",
    lengthM: engineBayLength,
    dryMassKg: stage2EngineMass,
    propellantKg: 0,
    centerOfMassM: engineBayLength / 2,
  });
  push({
    kind: "interstage",
    lengthM: interstageLength,
    dryMassKg: 0,
    propellantKg: 0,
    centerOfMassM: interstageLength / 2,
  });
  push({
    kind: "stage1-tank",
    lengthM: stage1TankLength,
    dryMassKg: stage1Structure,
    propellantKg: config.stage1PropellantKg,
    centerOfMassM: stage1TankLength / 2,
  });
  push({
    kind: "stage1-engine",
    lengthM: engineBayLength,
    dryMassKg: stage1EngineMass,
    propellantKg: 0,
    centerOfMassM: engineBayLength / 2,
  });

  const finRootChord = 1.2 * d;
  const fins: FinGeometry = {
    spanM: config.finSpanM,
    rootChordM: finRootChord,
    tipChordM: 0.4 * d,
    sweepM: 0.4 * d,
    leadingEdgeM: totalLength - finRootChord,
  };
  if (config.finSpanM > 0) {
    components.push({
      kind: "fins",
      xStartM: fins.leadingEdgeM,
      lengthM: finRootChord,
      dryMassKg: finMass,
      propellantKg: 0,
      centerOfMassM: finRootChord / 2,
    });
  }

  // --- Whole-vehicle values ---------------------------------------------------
  const dryMass =
    fairingMass +
    config.payloadWetMassKg +
    stage2Structure +
    stage2EngineMass +
    stage1Structure +
    stage1EngineMass +
    finMass;
  const wetMass = dryMass + config.stage1PropellantKg + config.stage2PropellantKg;

  const centerOfMass = centerOfMassFromComponents(components);

  // Center of pressure: nose contribution + four-fin contribution.
  const xCpNose = NOSE_CP_FRACTION * fairingLength;
  const bodyRadius = d / 2;
  const s = config.finSpanM;
  const interferenceK = s > 0 ? 1 + bodyRadius / (s + bodyRadius) : 0;
  const finCnAlpha =
    s > 0
      ? 4 * 4 * (s / d) ** 2 * interferenceK * FIN_NORMAL_FORCE_COEFFICIENT
      : 0;
  // Fin CP from the leading edge (Barrowman mean-aerodynamic-chord location,
  // fixed proportions make the mid-chord sweep zero).
  const xCpFinLocal =
    (1 / 6) * (fins.rootChordM + fins.tipChordM -
      (fins.rootChordM * fins.tipChordM) / (fins.rootChordM + fins.tipChordM));
  const xCpFin = fins.leadingEdgeM + xCpFinLocal;
  const centerOfPressure =
    (NOSE_CN_ALPHA * xCpNose + finCnAlpha * xCpFin) / (NOSE_CN_ALPHA + finCnAlpha);

  const staticMargin = (centerOfPressure - centerOfMass) / d;
  const slenderness = totalLength / d;

  // --- Performance ------------------------------------------------------------
  const liftoffThrust = config.stage1EngineCount * stage1Engine.seaLevelThrustN;
  const liftoffTwr = liftoffThrust / (wetMass * G0);

  const stage1BurnoutMass = wetMass - config.stage1PropellantKg;
  const stage1MassRatio = wetMass / stage1BurnoutMass;
  const stage1IdealDeltaV =
    stage1Engine.vacuumIspS * G0 * Math.log(stage1MassRatio);

  // Discarded hardware (stage 1) leaves the mass budget at staging.
  const stage2WetMass = stage1BurnoutMass - stage1Structure - stage1EngineMass - finMass;
  const stage2DryStack = stage2WetMass - config.stage2PropellantKg;
  const stage2MassRatio = stage2WetMass / stage2DryStack;
  const stage2IdealDeltaV =
    stage2Engine.vacuumIspS * G0 * Math.log(stage2MassRatio);

  // --- Warnings ---------------------------------------------------------------
  if (slenderness > SLENDERNESS_LIMIT) {
    // Not a blocking error: a physically assembled but poor design may still
    // be launched to demonstrate the structural failure at liftoff.
    checks.push({
      id: "slenderness_limit",
      severity: "warning",
      message: `Slenderness ${slenderness.toFixed(1)} exceeds the structural limit of ${SLENDERNESS_LIMIT}: the stack will not survive liftoff loads.`,
    });
  } else if (slenderness > SLENDERNESS_WARNING) {
    checks.push({
      id: "slenderness_warning",
      severity: "warning",
      message: `Slenderness ${slenderness.toFixed(1)} is above ${SLENDERNESS_WARNING}: structural risk in high dynamic pressure.`,
    });
  }
  if (staticMargin < REQUIRED_STATIC_MARGIN) {
    checks.push({
      id: "static_margin",
      severity: "warning",
      message: `Static margin ${staticMargin.toFixed(2)} calibers is below ${REQUIRED_STATIC_MARGIN}: aerodynamically unstable once dynamic pressure builds. Increase fin span.`,
    });
  }

  return {
    modelVersion: MODEL_VERSION,
    catalogVersion: catalog.version,
    config,
    components,
    fins,
    diameterM: d,
    totalLengthM: totalLength,
    frontalAreaM2: frontalArea,
    dragAreaM2: dragArea,
    dryMassKg: dryMass,
    wetMassKg: wetMass,
    liftoffTwr,
    stage1: {
      engine: stage1Engine,
      engineCount: config.stage1EngineCount,
      propellantKg: config.stage1PropellantKg,
      structuralMassKg: stage1Structure,
      engineMassKg: stage1EngineMass,
      dryMassKg: stage1Structure + stage1EngineMass,
      tankLengthM: stage1TankLength,
      massRatio: stage1MassRatio,
      idealDeltaVMs: stage1IdealDeltaV,
    },
    stage2: {
      engine: stage2Engine,
      engineCount: 1,
      propellantKg: config.stage2PropellantKg,
      structuralMassKg: stage2Structure,
      engineMassKg: stage2EngineMass,
      dryMassKg: stage2Structure + stage2EngineMass,
      tankLengthM: stage2TankLength,
      massRatio: stage2MassRatio,
      idealDeltaVMs: stage2IdealDeltaV,
    },
    totalIdealDeltaVMs: stage1IdealDeltaV + stage2IdealDeltaV,
    centerOfMassM: centerOfMass,
    centerOfPressureM: centerOfPressure,
    staticMargin,
    slenderness,
    enginePackingOk: packingOk,
    checks,
  };
}

/** Center of mass of the assembled stack, meters from the nose. */
export function centerOfMassFromComponents(components: RocketComponent[]): number {
  let totalMass = 0;
  let moment = 0;
  for (const component of components) {
    const mass = component.dryMassKg + component.propellantKg;
    if (mass <= 0) {
      continue;
    }
    totalMass += mass;
    moment += mass * (component.xStartM + component.centerOfMassM);
  }
  return totalMass > 0 ? moment / totalMass : 0;
}
