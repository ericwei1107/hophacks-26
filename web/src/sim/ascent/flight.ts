/**
 * Authoritative ascent solver.
 *
 * Earth-centered inertial frame: +Z is the rotation axis, the default launch
 * site is on the equator, and the initial velocity includes ω × r. RK4 with
 * a fixed 0.05 s timestep; timesteps split at burnout, separation, ignition,
 * cutoff, and ground contact so events land on their exact boundaries and
 * fuel never goes negative.
 *
 * Attitude is integrated as a rate-limited commanded direction (no full
 * rotational dynamics). Angle of attack derives from attitude and airflow and
 * is undefined at negligible airspeed.
 *
 * A landed state is kept before liftoff: a vehicle with TWR ≤ 1 sits on the
 * pad held by the normal force — it never falls through Earth and never
 * receives an artificial velocity impulse.
 */

import { payloadWetMassKg, type RocketConfig } from "../../domain/config";
import { deriveRocket, type DerivedRocket } from "../../domain/derive";
import { createEngineCatalog, thrustAtPressure, type EngineSpec } from "../../domain/engines";
import { CATALOG_VERSION, MODEL_VERSION } from "../../domain/version";
import { Atmosphere } from "../physics/atmosphere";
import { EARTH_RADIUS, G0, MU_EARTH } from "../physics/constants";
import { atmosphereVelocity, orbitalElements, type OrbitalElements } from "../physics/orbital";
import {
  angleBetween,
  clone,
  copy,
  dot,
  norm,
  normalize,
  rotateToward,
  scale,
  set,
  sub,
  vec3,
  type Vec3,
} from "../physics/vec3";
import type { WeatherSnapshot } from "../orbital/weather";
import {
  circularizationCommand,
  defaultGuidanceCoefficients,
  estimateBurnDurationS,
  guidanceCommand,
  timeToApogee,
  type GuidanceCoefficients,
  type GuidanceCommand,
  type GuidanceContext,
} from "./guidance";
import { evaluateFlightOutcome } from "../outcomes/evaluate";
import type { FlightAssessment, FlightEvidence } from "../outcomes/types";
import { propagateKepler } from "../physics/kepler";
import { findSoiEncounter, phasedMoonEpoch } from "../lunar/coast";
import { evaluateTransfer, transferRequirement, type TransferResult } from "../lunar/transfer";

export const FIXED_TIMESTEP_S = 0.05;

/** Reused scratch vectors for the inner RK4 / atmosphere-relative path. */
const SCRATCH = {
  coRot: vec3(),
  vRel: vec3(),
  up: vec3(),
  east: vec3(),
  north: vec3(),
  leUp: vec3(),
  lnUp: vec3(),
  lnEast: vec3(),
  y0pos: vec3(),
  y0vel: vec3(),
  y2pos: vec3(),
  y2vel: vec3(),
  y3pos: vec3(),
  y3vel: vec3(),
  y4pos: vec3(),
  y4vel: vec3(),
  k1dPos: vec3(),
  k1dVel: vec3(),
  k2dPos: vec3(),
  k2dVel: vec3(),
  k3dPos: vec3(),
  k3dVel: vec3(),
  k4dPos: vec3(),
  k4dVel: vec3(),
  dragDir: vec3(),
  accel: vec3(),
};

function isTerminalPhase(phase: FlightPhase): boolean {
  return phase === "COMPLETE" || phase === "FAILED";
}
const MAX_SIM_TIME_S = 3_600;
const PAD_TIMEOUT_S = 5;
const BURNOUT_DELAY_S = 1.0;
const IGNITION_DELAY_S = 1.0;
const SEPARATION_RELATIVE_VELOCITY_MS = 1.0;
const FAIRING_JETTISON_ALTITUDE_KM = 100;
const VACUUM_IGNITION_MIN_ALTITUDE_KM = 60;
const MAX_Q_STRUCTURAL_PA = 45_000;
const INSTABILITY_Q_PA = 500;
const MAX_PROPER_ACCEL_G = 5.0;
const MIN_AIRSPEED_FOR_AOA_MS = 1.0;
/** Game rule: a sustained orbit keeps perigee at or above 150 km. */
export const SUSTAINED_PERIGEE_KM = 150;
/** Game rule: target corridor. */
export const TARGET_PERIGEE_RANGE_KM: [number, number] = [180, 220];
export const TARGET_APOGEE_RANGE_KM: [number, number] = [180, 250];
/**
 * Game rule: a fixed coast before trans-lunar injection, rather than a
 * modelled phasing wait. Real missions vary this; a fixed duration keeps
 * the encounter geometry (see `phasedMoonEpoch`) deterministic and keeps
 * the mission clock well under `MAX_SIM_TIME_S`.
 */
export const PARKING_COAST_DURATION_S = 600;

export type FlightPhase =
  | "PAD"
  | "ASCENT_1"
  | "BURNOUT_DELAY"
  | "SEPARATION"
  | "IGNITION_DELAY"
  | "ASCENT_2"
  | "COAST"
  | "CIRCULARIZE"
  | "PARKING_COAST"
  | "TLI_BURN"
  | "TRANS_LUNAR"
  | "COMPLETE"
  | "FAILED";

export interface FlightEnvironment {
  atmosphere: Atmosphere;
  weather: WeatherSnapshot;
  launchLatitudeDeg: number;
  launchLongitudeDeg: number;
  /** Horizontal local wind, m/s (east/north). Perturbable; never solar wind. */
  localWindEastMs: number;
  localWindNorthMs: number;
}

export function defaultEnvironment(weather: WeatherSnapshot): FlightEnvironment {
  return {
    atmosphere: new Atmosphere(weather.weather),
    weather,
    launchLatitudeDeg: 0,
    launchLongitudeDeg: 0,
    localWindEastMs: 0,
    localWindNorthMs: 0,
  };
}

/** Bounded perturbations for robustness analysis (Step 8). */
export interface FlightPerturbations {
  thrustScale: number;
  ispScale: number;
  dryMassScale: number;
  propellantScale: number;
  densityScale: number;
  windEastMs: number;
}

export const NO_PERTURBATIONS: FlightPerturbations = {
  thrustScale: 1,
  ispScale: 1,
  dryMassScale: 1,
  propellantScale: 1,
  densityScale: 1,
  windEastMs: 0,
};

export interface FlightEvent {
  t: number;
  id: string;
  phase: FlightPhase;
  detail?: string;
}

export interface DetachedStage {
  position: Vec3;
  velocity: Vec3;
  massKg: number;
  dragAreaM2: number;
  landed: boolean;
}

export interface FlightState {
  rocket: DerivedRocket;
  environment: FlightEnvironment;
  guidance: GuidanceCoefficients;
  seed: number;
  t: number;
  phase: FlightPhase;
  position: Vec3;
  velocity: Vec3;
  /** Current commanded attitude (unit vector), rate-limited. */
  attitude: Vec3;
  stage1PropellantKg: number;
  stage2PropellantKg: number;
  phaseTimeS: number;
  fairingJettisoned: boolean;
  stage1Attached: boolean;
  throttle: number;
  detachedStages: DetachedStage[];
  events: FlightEvent[];
  failureCode: string | null;
  failureDetail: string | null;
  maxQPa: number;
  maxG: number;
  /** True once the max-Q event has been recorded for this flight. */
  maxQRecorded: boolean;
  /** Highest altitude reached, km — gates ground-impact detection. */
  maxAltitudeKm: number;
  stepCount: number;
  /** Set when the vehicle first lifts off. */
  liftoffT: number | null;
  /** Parking-orbit elements at the moment a sustained orbit was confirmed — the baseline `orbitAchieved`/`targetOrbitAchieved` are measured against, since the trans-lunar burn moves the vehicle onto a different orbit entirely. */
  parkingElements: OrbitalElements | null;
  /** Mission clock at TLI ignition, s. */
  tliIgnitionTimeS: number | null;
  /** Orbital radius at TLI ignition, m from Earth's center. */
  tliIgnitionRadiusM: number | null;
  /** Speed at TLI ignition, m/s — the baseline `norm(velocity) - this` measures delta-v spent during the burn. */
  tliIgnitionSpeedMs: number | null;
  /** Ideal delta-v this build's parking orbit needs for a minimum-energy transfer, m/s. */
  tliDeltaVRequiredMs: number | null;
  /**
   * Absolute cutoff speed, m/s — local circular velocity at ignition plus
   * `tliDeltaVRequiredMs`. The parking orbit is never perfectly circular, so
   * this is deliberately not `tliIgnitionSpeedMs + tliDeltaVRequiredMs`:
   * that would fold the orbit's small eccentricity (the vehicle may already
   * be a few m/s faster or slower than local circular at the ignition
   * point) into the cutoff, biasing the achieved apogee and the resulting
   * lunar aim.
   */
  tliTargetSpeedMs: number | null;
  /** Set once the trans-lunar phase resolves; carried through to `FlightResult`. */
  lunarTransfer: TransferResult | null;
  /** When set, overrides the elements-derived outcome classification at the end of `runFlight` — used for every lunar-mission terminal state. */
  terminalOutcomeOverride: FlightOutcome | null;
}

export interface FlightInput {
  config: RocketConfig;
  environment: FlightEnvironment;
  seed?: number;
  guidance?: GuidanceCoefficients;
  perturbations?: FlightPerturbations;
  maxTimeS?: number;
  /** Test-only timestep override; production flights always use 0.05 s. */
  timestepS?: number;
  /** Batch analysis runs skip telemetry recording (faster, lighter). */
  recordTelemetry?: boolean;
}

// ---------------------------------------------------------------------------
// createFlight
// ---------------------------------------------------------------------------

export function createFlight(
  config: RocketConfig,
  environment: FlightEnvironment,
  seed = 0,
  guidance: GuidanceCoefficients = defaultGuidanceCoefficients(),
  perturbations: FlightPerturbations = NO_PERTURBATIONS,
): FlightState {
  const catalog = createEngineCatalog();
  let effectiveConfig = config;
  if (perturbations !== NO_PERTURBATIONS) {
    effectiveConfig = {
      ...config,
      payloadDryMassKg: config.payloadDryMassKg, // payload mass is fixed by the player
      payloadPropellantKg: config.payloadPropellantKg,
      stage1PropellantKg: config.stage1PropellantKg * perturbations.propellantScale,
      stage2PropellantKg: config.stage2PropellantKg * perturbations.propellantScale,
    };
  }
  const rocket = deriveRocket(effectiveConfig, catalog);
  if (perturbations !== NO_PERTURBATIONS) {
    applyPerturbations(rocket, perturbations);
  }

  const lat = (environment.launchLatitudeDeg * Math.PI) / 180;
  const lon = (environment.launchLongitudeDeg * Math.PI) / 180;
  const position = vec3(
    EARTH_RADIUS * Math.cos(lat) * Math.cos(lon),
    EARTH_RADIUS * Math.cos(lat) * Math.sin(lon),
    EARTH_RADIUS * Math.sin(lat),
  );
  const velocity = vec3();
  atmosphereVelocity(velocity, position);
  const attitude = normalize(vec3(), position); // vertical on the pad

  const state: FlightState = {
    rocket,
    environment,
    guidance,
    seed,
    t: 0,
    phase: "PAD",
    position,
    velocity,
    attitude,
    stage1PropellantKg: rocket.stage1.propellantKg,
    stage2PropellantKg: rocket.stage2.propellantKg,
    phaseTimeS: 0,
    fairingJettisoned: false,
    stage1Attached: true,
    throttle: 0,
    detachedStages: [],
    events: [],
    failureCode: null,
    failureDetail: null,
    maxQPa: 0,
    maxG: 0,
    maxQRecorded: false,
    maxAltitudeKm: 0,
    stepCount: 0,
    liftoffT: null,
    parkingElements: null,
    tliIgnitionTimeS: null,
    tliIgnitionRadiusM: null,
    tliIgnitionSpeedMs: null,
    tliDeltaVRequiredMs: null,
    tliTargetSpeedMs: null,
    lunarTransfer: null,
    terminalOutcomeOverride: null,
  };

  const blocking = rocket.checks.find((c) => c.severity === "error");
  if (blocking) {
    fail(state, "invalid_build", blocking.message);
  }
  return state;
}

function applyPerturbations(rocket: DerivedRocket, p: FlightPerturbations): void {
  for (const stage of [rocket.stage1, rocket.stage2]) {
    const engine = stage.engine;
    stage.engine = {
      ...engine,
      vacuumThrustN: engine.vacuumThrustN * p.thrustScale,
      seaLevelThrustN: engine.seaLevelThrustN * p.thrustScale,
      seaLevelIspS: engine.seaLevelIspS * p.ispScale,
      vacuumIspS: engine.vacuumIspS * p.ispScale,
      massFlowKgS: (engine.massFlowKgS * p.thrustScale) / p.ispScale,
    };
  }
  rocket.stage1.dryMassKg *= p.dryMassScale;
  rocket.stage2.dryMassKg *= p.dryMassScale;
  rocket.dryMassKg *= p.dryMassScale;
  rocket.wetMassKg =
    rocket.dryMassKg + rocket.stage1.propellantKg + rocket.stage2.propellantKg;
  rocket.liftoffTwr =
    (rocket.stage1.engineCount * rocket.stage1.engine.seaLevelThrustN) / (rocket.wetMassKg * G0);
}

// ---------------------------------------------------------------------------
// Mass bookkeeping
// ---------------------------------------------------------------------------

function fairingMassKg(state: FlightState): number {
  return state.rocket.components.find((c) => c.kind === "fairing")?.dryMassKg ?? 0;
}

function finMassKg(state: FlightState): number {
  return state.rocket.components.find((c) => c.kind === "fins")?.dryMassKg ?? 0;
}

/** Mass of everything currently attached, excluding active-stage propellant. */
function baseMassKg(state: FlightState): number {
  const r = state.rocket;
  let mass = payloadWetMassKg(r.config) + r.stage2.dryMassKg + state.stage2PropellantKg;
  if (!state.fairingJettisoned) {
    mass += fairingMassKg(state);
  }
  if (state.stage1Attached) {
    mass += r.stage1.dryMassKg + finMassKg(state) + state.stage1PropellantKg;
  }
  return mass;
}

function currentMassKg(state: FlightState): number {
  return baseMassKg(state);
}

/** Current center of mass (m from the nose) for stability updates. */
function currentCenterOfMassM(state: FlightState): number {
  let mass = 0;
  let moment = 0;
  for (const c of state.rocket.components) {
    if (c.kind === "payload" && state.fairingJettisoned) {
      // payload remains; only the fairing shell is jettisoned
    }
    if (state.fairingJettisoned && c.kind === "fairing") {
      continue;
    }
    if (
      !state.stage1Attached &&
      (c.kind === "stage1-tank" || c.kind === "stage1-engine" || c.kind === "fins" || c.kind === "interstage")
    ) {
      continue;
    }
    let m = c.dryMassKg;
    if (c.kind === "stage1-tank") {
      m += state.stage1Attached ? state.stage1PropellantKg : 0;
    } else if (c.kind === "stage2-tank") {
      m += state.stage2PropellantKg;
    }
    if (m <= 0) {
      continue;
    }
    mass += m;
    moment += m * (c.xStartM + c.centerOfMassM);
  }
  return mass > 0 ? moment / mass : 0;
}

/**
 * Length of the still-attached stack, m. Stage 1 (tank, engine bay, fins and
 * interstage) leaves at separation, so the drawn vehicle shortens to the
 * upper stage plus fairing.
 */
function attachedLengthM(state: FlightState): number {
  if (state.stage1Attached) {
    return state.rocket.totalLengthM;
  }
  let length = 0;
  for (const c of state.rocket.components) {
    if (
      c.kind === "stage1-tank" ||
      c.kind === "stage1-engine" ||
      c.kind === "fins" ||
      c.kind === "interstage" ||
      c.kind === "payload" ||
      (c.kind === "fairing" && state.fairingJettisoned)
    ) {
      continue;
    }
    length += c.lengthM;
  }
  return length;
}

function activeEngine(state: FlightState): { engine: EngineSpec; count: number } | null {
  if (state.phase === "ASCENT_1" && state.stage1PropellantKg > 0) {
    return { engine: state.rocket.stage1.engine, count: state.rocket.stage1.engineCount };
  }
  if (
    (state.phase === "ASCENT_2" || state.phase === "CIRCULARIZE" || state.phase === "TLI_BURN") &&
    state.stage2PropellantKg > 0
  ) {
    return { engine: state.rocket.stage2.engine, count: 1 };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Local frame helpers
// ---------------------------------------------------------------------------

function localUp(out: Vec3, position: Vec3): Vec3 {
  return normalize(out, position);
}

function localEast(out: Vec3, position: Vec3): Vec3 {
  // east = normalize(ẑ × r̂)
  const up = localUp(SCRATCH.leUp, position);
  out[0] = -up[1];
  out[1] = up[0];
  out[2] = 0;
  if (norm(out) < 1e-9) {
    return set(out, 0, 1, 0);
  }
  return normalize(out, out);
}

function localNorth(out: Vec3, position: Vec3): Vec3 {
  const up = localUp(SCRATCH.lnUp, position);
  const east = localEast(SCRATCH.lnEast, position);
  // north = up × east
  const x = up[1] * east[2] - up[2] * east[1];
  const y = up[2] * east[0] - up[0] * east[2];
  const z = up[0] * east[1] - up[1] * east[0];
  return set(out, x, y, z);
}

/** Atmosphere-relative velocity: v − ω×r − localWind. */
export function relativeVelocity(out: Vec3, state: FlightState, position: Vec3, velocity: Vec3): Vec3 {
  atmosphereVelocity(SCRATCH.coRot, position);
  sub(out, velocity, SCRATCH.coRot);
  const env = state.environment;
  if (env.localWindEastMs !== 0 || env.localWindNorthMs !== 0) {
    const east = localEast(SCRATCH.east, position);
    const north = localNorth(SCRATCH.north, position);
    out[0] -= env.localWindEastMs * east[0] + env.localWindNorthMs * north[0];
    out[1] -= env.localWindEastMs * east[1] + env.localWindNorthMs * north[1];
    out[2] -= env.localWindEastMs * east[2] + env.localWindNorthMs * north[2];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Guidance context assembly
// ---------------------------------------------------------------------------

function buildGuidanceContext(state: FlightState, position: Vec3, velocity: Vec3, propKg: number): GuidanceContext {
  const env = state.environment;
  const r = norm(position);
  const altitudeKm = (r - EARTH_RADIUS) / 1000;
  const sample = env.atmosphere.sample(Math.max(0, altitudeKm));
  const vRel = relativeVelocity(vec3(), state, position, velocity);
  const airspeed = norm(vRel);
  const q = 0.5 * sample.density * airspeed * airspeed;
  const elements = orbitalElements(position, velocity);

  const active = activeEngine(state);
  const mass = baseMassKg(state) - activePropellantKg(state) + propKg;

  let fullThrustN = 0;
  let massFlowKgS = 0;
  let minThrottle = 1;
  if (active) {
    fullThrustN = active.count * thrustAtPressure(active.engine, sample.pressure);
    massFlowKgS = active.count * active.engine.massFlowKgS;
    minThrottle = active.engine.minThrottle;
  }

  return {
    position,
    velocity,
    vRel,
    airspeedMs: airspeed,
    altitudeKm,
    dynamicPressurePa: q,
    massKg: mass,
    fullThrustN,
    massFlowKgS,
    minThrottle,
    elements,
    timeToApogeeS: timeToApogee(position, velocity, elements),
    up: localUp(vec3(), position),
    east: localEast(vec3(), position),
    burning: active !== null,
  };
}

// ---------------------------------------------------------------------------
// RK4 integration of [pos, vel, propellant]
// ---------------------------------------------------------------------------

interface DynState {
  pos: Vec3;
  vel: Vec3;
  propKg: number;
}

interface DynDerivative {
  dPos: Vec3;
  dVel: Vec3;
  dProp: number;
}

function derivative(state: FlightState, dyn: DynState, attitude: Vec3, out: DynDerivative): void {
  const env = state.environment;
  copy(out.dPos, dyn.vel);

  const r = norm(dyn.pos);
  const altitudeKm = Math.max(0, (r - EARTH_RADIUS) / 1000);
  const sample = env.atmosphere.sample(altitudeKm);

  const mass = baseMassKg(state) - activePropellantKg(state) + dyn.propKg;

  // Gravity: −μr/|r|³
  const gravityScale = -MU_EARTH / (r * r * r);
  scale(out.dVel, dyn.pos, gravityScale);

  // Thrust along the commanded direction.
  const active = activeEngine(state);
  if (active && dyn.propKg > 0) {
    const fullThrust = active.count * thrustAtPressure(active.engine, sample.pressure);
    const fullAccel = fullThrust / mass / G0;
    let throttle = 1;
    if (fullAccel > state.guidance.maxProperAccelG) {
      throttle = Math.max(active.engine.minThrottle, state.guidance.maxProperAccelG / fullAccel);
    }
    const thrust = throttle * fullThrust;
    const accelScale = thrust / mass;
    out.dVel[0] += accelScale * attitude[0];
    out.dVel[1] += accelScale * attitude[1];
    out.dVel[2] += accelScale * attitude[2];
    out.dProp = -throttle * active.count * active.engine.massFlowKgS;
  } else {
    out.dProp = 0;
  }

  // Drag: −½ρCdA|vRel|vRel
  const vRel = relativeVelocity(SCRATCH.vRel, state, dyn.pos, dyn.vel);
  const vRelMag = norm(vRel);
  if (vRelMag > 1e-9 && sample.density > 0) {
    const dragAccel = (0.5 * sample.density * state.rocket.dragAreaM2 * vRelMag) / mass;
    out.dVel[0] -= dragAccel * vRel[0];
    out.dVel[1] -= dragAccel * vRel[1];
    out.dVel[2] -= dragAccel * vRel[2];
  }
}

function activePropellantKg(state: FlightState): number {
  if (state.phase === "ASCENT_1") {
    return state.stage1PropellantKg;
  }
  if (state.phase === "ASCENT_2" || state.phase === "CIRCULARIZE" || state.phase === "TLI_BURN") {
    return state.stage2PropellantKg;
  }
  return 0;
}

function rk4Step(state: FlightState, dt: number): void {
  const attitude = state.attitude;
  const prop0 = activePropellantKg(state);

  const y0: DynState = { pos: copy(SCRATCH.y0pos, state.position), vel: copy(SCRATCH.y0vel, state.velocity), propKg: prop0 };
  const k1: DynDerivative = { dPos: SCRATCH.k1dPos, dVel: SCRATCH.k1dVel, dProp: 0 };
  const k2: DynDerivative = { dPos: SCRATCH.k2dPos, dVel: SCRATCH.k2dVel, dProp: 0 };
  const k3: DynDerivative = { dPos: SCRATCH.k3dPos, dVel: SCRATCH.k3dVel, dProp: 0 };
  const k4: DynDerivative = { dPos: SCRATCH.k4dPos, dVel: SCRATCH.k4dVel, dProp: 0 };

  derivative(state, y0, attitude, k1);

  const y2: DynState = {
    pos: SCRATCH.y2pos,
    vel: SCRATCH.y2vel,
    propKg: Math.max(0, y0.propKg + 0.5 * dt * k1.dProp),
  };
  for (let i = 0; i < 3; i++) {
    y2.pos[i] = y0.pos[i] + 0.5 * dt * k1.dPos[i];
    y2.vel[i] = y0.vel[i] + 0.5 * dt * k1.dVel[i];
  }
  derivative(state, y2, attitude, k2);

  const y3: DynState = {
    pos: SCRATCH.y3pos,
    vel: SCRATCH.y3vel,
    propKg: Math.max(0, y0.propKg + 0.5 * dt * k2.dProp),
  };
  for (let i = 0; i < 3; i++) {
    y3.pos[i] = y0.pos[i] + 0.5 * dt * k2.dPos[i];
    y3.vel[i] = y0.vel[i] + 0.5 * dt * k2.dVel[i];
  }
  derivative(state, y3, attitude, k3);

  const y4: DynState = {
    pos: SCRATCH.y4pos,
    vel: SCRATCH.y4vel,
    propKg: Math.max(0, y0.propKg + dt * k3.dProp),
  };
  for (let i = 0; i < 3; i++) {
    y4.pos[i] = y0.pos[i] + dt * k3.dPos[i];
    y4.vel[i] = y0.vel[i] + dt * k3.dVel[i];
  }
  derivative(state, y4, attitude, k4);

  for (let i = 0; i < 3; i++) {
    state.position[i] += (dt / 6) * (k1.dPos[i] + 2 * k2.dPos[i] + 2 * k3.dPos[i] + k4.dPos[i]);
    state.velocity[i] += (dt / 6) * (k1.dVel[i] + 2 * k2.dVel[i] + 2 * k3.dVel[i] + k4.dVel[i]);
  }
  const propDelta = (dt / 6) * (k1.dProp + 2 * k2.dProp + 2 * k3.dProp + k4.dProp);
  const newProp = Math.max(0, prop0 + propDelta);
  if (state.phase === "ASCENT_1") {
    state.stage1PropellantKg = newProp;
  } else if (state.phase === "ASCENT_2" || state.phase === "CIRCULARIZE" || state.phase === "TLI_BURN") {
    state.stage2PropellantKg = newProp;
  }
}

// ---------------------------------------------------------------------------
// Events and failures
// ---------------------------------------------------------------------------

function addEvent(state: FlightState, id: string, detail?: string): void {
  state.events.push(detail === undefined ? { t: state.t, id, phase: state.phase } : { t: state.t, id, phase: state.phase, detail });
}

function fail(state: FlightState, code: string, detail: string): void {
  if (state.phase === "FAILED" || state.phase === "COMPLETE") {
    return;
  }
  state.phase = "FAILED";
  state.failureCode = code;
  state.failureDetail = detail;
  addEvent(state, "failed", `${code}: ${detail}`);
}

function enterPhase(state: FlightState, phase: FlightPhase): void {
  state.phase = phase;
  state.phaseTimeS = 0;
}

function separateStage1(state: FlightState): void {
  const r = state.rocket;
  const spentMass = r.stage1.dryMassKg + finMassKg(state);
  const upperMass = currentMassKg(state) - spentMass;

  // Momentum-conserving push: ~1 m/s relative velocity along the stack axis.
  const totalMass = spentMass + upperMass;
  const dvUpper = (SEPARATION_RELATIVE_VELOCITY_MS * spentMass) / totalMass;
  const dvSpent = (SEPARATION_RELATIVE_VELOCITY_MS * upperMass) / totalMass;

  const spent: DetachedStage = {
    position: clone(state.position),
    velocity: clone(state.velocity),
    massKg: spentMass,
    dragAreaM2: r.dragAreaM2,
    landed: false,
  };
  for (let i = 0; i < 3; i++) {
    spent.velocity[i] -= dvSpent * state.attitude[i];
    state.velocity[i] += dvUpper * state.attitude[i];
  }
  state.detachedStages.push(spent);
  state.stage1Attached = false;
  addEvent(state, "separation", "Stage 1 separated");
}

function jettisonFairing(state: FlightState): void {
  state.fairingJettisoned = true;
  addEvent(state, "fairing_jettison", "Fairing jettisoned above 100 km");
}

/** Current proper (non-gravitational) acceleration in g, from thrust + drag. */
function properAccelerationG(state: FlightState): number {
  const mass = currentMassKg(state);
  const r = norm(state.position);
  const altitudeKm = Math.max(0, (r - EARTH_RADIUS) / 1000);
  const sample = state.environment.atmosphere.sample(altitudeKm);
  let thrust = 0;
  const active = activeEngine(state);
  if (active) {
    thrust = state.throttle * active.count * thrustAtPressure(active.engine, sample.pressure);
  }
  const vRel = relativeVelocity(SCRATCH.vRel, state, state.position, state.velocity);
  const drag = 0.5 * sample.density * state.rocket.dragAreaM2 * norm(vRel) ** 2;
  // Thrust and drag act along (nearly) opposite axes; the felt magnitude is
  // their vector sum, dominated by thrust along the attitude.
  const a = scale(SCRATCH.accel, state.attitude, thrust / mass);
  const dragScale = drag / mass;
  if (norm(vRel) > 1e-9) {
    const dragDir = normalize(SCRATCH.dragDir, vRel);
    a[0] -= dragScale * dragDir[0];
    a[1] -= dragScale * dragDir[1];
    a[2] -= dragScale * dragDir[2];
  }
  return norm(a) / G0;
}

function checkInFlightFailures(state: FlightState): void {
  if (state.phase === "FAILED" || state.phase === "COMPLETE" || state.phase === "PAD") {
    return;
  }
  const r = norm(state.position);
  const altitudeKm = (r - EARTH_RADIUS) / 1000;
  const vRel = relativeVelocity(SCRATCH.vRel, state, state.position, state.velocity);
  const airspeed = norm(vRel);
  const density = state.environment.atmosphere.density(Math.max(0, altitudeKm));
  const q = 0.5 * density * airspeed * airspeed;

  if (altitudeKm > state.maxAltitudeKm) {
    state.maxAltitudeKm = altitudeKm;
  }
  if (q > state.maxQPa) {
    state.maxQPa = q;
  }
  const g = properAccelerationG(state);
  if (g > state.maxG) {
    state.maxG = g;
  }

  if (q > MAX_Q_STRUCTURAL_PA) {
    if (state.phase === "COAST") {
      // Unpowered descent after burnout: the root cause is that the upper
      // stage never reached a sustainable orbit, not the ascent structure.
      fail(
        state,
        "insufficient_orbital_energy",
        `Stage 2 exhausted before reaching a sustainable orbit; the vehicle reentered (q = ${(q / 1000).toFixed(1)} kPa at T+${state.t.toFixed(0)} s).`,
      );
    } else {
      fail(
        state,
        "dynamic_pressure_limit",
        `Dynamic pressure ${(q / 1000).toFixed(1)} kPa exceeded the 45 kPa structural limit.`,
      );
    }
    return;
  }
  if (g > MAX_PROPER_ACCEL_G) {
    fail(
      state,
      "acceleration_limit",
      `Proper acceleration ${g.toFixed(2)} g exceeded the 5 g limit even at minimum throttle.`,
    );
    return;
  }
  // Static stability is enforced only while aerodynamic loading is
  // significant, and only while the finned first stage is attached; the
  // finless upper stage is actively stabilized and must not fail in vacuum.
  if (q > INSTABILITY_Q_PA && state.stage1Attached) {
    const margin = (state.rocket.centerOfPressureM - currentCenterOfMassM(state)) / state.rocket.diameterM;
    if (margin < 1.0) {
      fail(
        state,
        "aerodynamic_instability",
        `Static margin ${margin.toFixed(2)} calibers below 1 at q = ${(q / 1000).toFixed(1)} kPa: the rocket weathercocks. Increase fin span.`,
      );
      return;
    }
  }

  if (altitudeKm <= 0 && state.maxAltitudeKm > 0.05) {
    if (state.phase === "COAST") {
      fail(
        state,
        "insufficient_orbital_energy",
        `Stage 2 exhausted before reaching a sustainable orbit; suborbital impact at T+${state.t.toFixed(0)} s after reaching ${state.maxAltitudeKm.toFixed(0)} km.`,
      );
    } else {
      fail(state, "impact", `Ground impact at T+${state.t.toFixed(1)} s after reaching ${state.maxAltitudeKm.toFixed(1)} km.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Phase logic
// ---------------------------------------------------------------------------

function updateGuidance(state: FlightState, dt: number): GuidanceCommand {
  const ctx = buildGuidanceContext(state, state.position, state.velocity, activePropellantKg(state));
  let command: GuidanceCommand;
  if (state.phase === "CIRCULARIZE") {
    command = circularizationCommand(ctx, state.guidance);
  } else {
    command = guidanceCommand(ctx, state.guidance);
  }
  // Rate-limit the attitude toward the commanded direction.
  const maxAngle = state.guidance.attitudeRateLimitDegS * (Math.PI / 180) * dt;
  rotateToward(state.attitude, state.attitude, command.direction, maxAngle);
  state.throttle = command.throttle;
  return command;
}

/** Timed triggers evaluated at step boundaries (liftoff, circularization). */
function handlePhaseTriggers(state: FlightState): void {
  switch (state.phase) {
    case "PAD": {
      // Full throttle on the pad; lift off only if thrust exceeds weight.
      const mass = currentMassKg(state);
      const sample = state.environment.atmosphere.sample(0);
      const thrust = state.rocket.stage1.engineCount * thrustAtPressure(state.rocket.stage1.engine, sample.pressure);
      if (thrust > mass * G0) {
        if (state.rocket.slenderness > 20) {
          fail(state, "slenderness_limit", `Slenderness ${state.rocket.slenderness.toFixed(1)} exceeds the structural limit of 20 at liftoff.`);
          return;
        }
        state.liftoffT = state.t;
        addEvent(state, "liftoff");
        enterPhase(state, "ASCENT_1");
      }
      break;
    }
    case "COAST": {
      if (state.stage2PropellantKg <= 1e-6) {
        const elements = orbitalElements(state.position, state.velocity);
        if (!elements.intersectsGround) {
          finalizeOrbit(state);
        }
        return;
      }
      const elements = orbitalElements(state.position, state.velocity);
      const apogeeKm = elements.apogeeAltitudeKm;
      const tApo = timeToApogee(state.position, state.velocity, elements);
      if (apogeeKm !== null && tApo !== null) {
        const burnS = circularizationBurnEstimateS(state, apogeeKm);
        if (tApo <= burnS / 2 + state.guidance.circularizeLeadS) {
          addEvent(state, "circularization_ignition", `Circularizing at ~${apogeeKm.toFixed(0)} km apogee`);
          enterPhase(state, "CIRCULARIZE");
        }
      }
      break;
    }
    default:
      break;
  }
}

function circularizationBurnEstimateS(state: FlightState, apogeeKm: number): number {
  const vCirc = Math.sqrt(MU_EARTH / (EARTH_RADIUS + apogeeKm * 1000));
  const deltaV = Math.max(0, vCirc - norm(state.velocity));
  return estimateBurnDurationS(
    deltaV,
    currentMassKg(state),
    state.rocket.stage2.engine.massFlowKgS,
    state.rocket.stage2.engine.vacuumIspS,
  );
}

function applyBurnout(state: FlightState): void {
  // The split estimate can leave a sub-gram residue; burnout consumes the
  // stage's propellant exactly.
  if (state.phase === "ASCENT_1") {
    state.stage1PropellantKg = 0;
    addEvent(state, "stage1_burnout");
    enterPhase(state, "BURNOUT_DELAY");
  } else if (state.phase === "ASCENT_2" || state.phase === "CIRCULARIZE") {
    state.stage2PropellantKg = 0;
    addEvent(state, "stage2_burnout");
    finalizeOrbit(state);
  } else if (state.phase === "TLI_BURN") {
    state.stage2PropellantKg = 0;
    addEvent(state, "stage2_burnout");
    resolveTliBurnout(state);
  }
}

function applyIgnition(state: FlightState): void {
  const altitudeKm = (norm(state.position) - EARTH_RADIUS) / 1000;
  const engine = state.rocket.stage2.engine;
  if (!engine.seaLevelRated && altitudeKm < VACUUM_IGNITION_MIN_ALTITUDE_KM) {
    fail(
      state,
      "vacuum_engine_low_ignition",
      `Stage 2 ignited at ${altitudeKm.toFixed(0)} km. This vacuum engine requires ${VACUUM_IGNITION_MIN_ALTITUDE_KM} km. Use a sea-level upper-stage engine or increase the first stage's capability.`,
    );
    return;
  }
  addEvent(state, "stage2_ignition");
  enterPhase(state, "ASCENT_2");
}

function finalizeOrbit(state: FlightState): void {
  const elements = orbitalElements(state.position, state.velocity);
  if (!elements.bound) {
    fail(state, "unbound_trajectory", "The trajectory escapes Earth orbit instead of closing.");
    return;
  }
  if (elements.intersectsGround) {
    // Let the trajectory continue to impact for telemetry completeness.
    enterPhase(state, "COAST");
    return;
  }
  addEvent(state, "orbit_achieved", `Orbit ${elements.perigeeAltitudeKm.toFixed(0)} x ${elements.apogeeAltitudeKm?.toFixed(0) ?? "?"} km`);
  if (elements.perigeeAltitudeKm < SUSTAINED_PERIGEE_KM) {
    // Bound but decaying: not a sustained orbit, so no trans-lunar attempt.
    state.phase = "COMPLETE";
    return;
  }
  state.parkingElements = elements;
  enterPhase(state, "PARKING_COAST");
}

/**
 * Resolve the trans-lunar phase once the TLI burn ends, whether by reaching
 * its target delta-v or by exhausting stage-2 propellant early. Analytic,
 * not integrated (LUNAR_MISSION_PLAN.md §3): the coast to the Moon is
 * evaluated in one shot via `evaluateTransfer`/`findSoiEncounter`, not
 * stepped through RK4.
 */
function resolveTliBurnout(state: FlightState): void {
  enterPhase(state, "TRANS_LUNAR");

  const deltaVSpentMs = norm(state.velocity) - (state.tliIgnitionSpeedMs ?? norm(state.velocity));
  const elements = orbitalElements(state.position, state.velocity);
  const apogeeAfterBurnM =
    elements.bound && elements.apogeeAltitudeKm !== null
      ? EARTH_RADIUS + elements.apogeeAltitudeKm * 1000
      : Number.POSITIVE_INFINITY;

  let soiEntryRelativePosition: Vec3 | null = null;
  let soiEntryRelativeVelocity: Vec3 | null = null;
  if (Number.isFinite(apogeeAfterBurnM)) {
    // Phase the Moon from the vehicle's actual post-burn state, not the
    // pre-burn ignition point: the burn takes on the order of a minute or
    // more, during which the vehicle sweeps several degrees around its
    // orbit. At the lunar distance that is tens of thousands of km — using
    // the ignition point here previously missed the SOI outright. The
    // post-burn position is close to the transfer orbit's actual periapsis
    // for a short tangential burn, which is the standard patched-conic
    // approximation (LUNAR_MISSION_PLAN.md §4.3.5).
    const requirement = transferRequirement(norm(state.position));
    const epoch = phasedMoonEpoch(state.position, state.t, requirement.timeOfFlightS);
    const encounter = findSoiEncounter(state.position, state.velocity, state.t, epoch);
    if (encounter) {
      soiEntryRelativePosition = encounter.relativePosition;
      soiEntryRelativeVelocity = encounter.relativeVelocity;
    }
  }

  const transfer = evaluateTransfer({
    parkingRadiusM: state.tliIgnitionRadiusM ?? norm(state.position),
    deltaVAvailableMs: deltaVSpentMs,
    deltaVRequiredMs: state.tliDeltaVRequiredMs ?? 0,
    apogeeAfterBurnM,
    soiEntryRelativePosition,
    soiEntryRelativeVelocity,
  });

  state.lunarTransfer = transfer;
  state.terminalOutcomeOverride = transfer.classification;
  addEvent(
    state,
    transfer.classification,
    `Trans-lunar burn spent ${deltaVSpentMs.toFixed(0)} m/s of ${(state.tliDeltaVRequiredMs ?? 0).toFixed(0)} m/s required` +
      (transfer.periseleneRadiusM !== null ? `; periselene ${(transfer.periseleneRadiusM / 1000).toFixed(0)} km` : ""),
  );
  state.phase = "COMPLETE";
}

// ---------------------------------------------------------------------------
// stepFlight
// ---------------------------------------------------------------------------

type StepEvent =
  | "burnout"
  | "separation"
  | "ignition"
  | "fairing"
  | "impact"
  | "apogee_cutoff"
  | "perigee_cutoff"
  | "tli_delta_v_cutoff";

interface StepHorizon {
  dtEvent: number;
  event: StepEvent | null;
}

/** Find the earliest event inside the next `remaining` seconds. */
function findStepHorizon(state: FlightState, remaining: number): StepHorizon {
  let dtEvent = remaining;
  let event: StepEvent | null = null;
  const consider = (candidate: number, kind: StepEvent) => {
    if (candidate < dtEvent - 1e-12) {
      dtEvent = Math.max(candidate, 0);
      event = kind;
    }
  };

  // Propellant exhaustion (estimated from the current burn rate).
  const active = activeEngine(state);
  const prop = activePropellantKg(state);
  if (active && prop > 0) {
    const burnRate = state.throttle * active.count * active.engine.massFlowKgS;
    if (burnRate > 0 && prop / burnRate < dtEvent) {
      consider(prop / burnRate, "burnout");
    }
  }

  // Phase timers.
  if (state.phase === "BURNOUT_DELAY" && state.phaseTimeS < BURNOUT_DELAY_S) {
    consider(BURNOUT_DELAY_S - state.phaseTimeS, "separation");
  }
  if (state.phase === "IGNITION_DELAY" && state.phaseTimeS < IGNITION_DELAY_S) {
    consider(IGNITION_DELAY_S - state.phaseTimeS, "ignition");
  }

  // Altitude crossings, estimated from radial velocity.
  const r = norm(state.position);
  const altitudeKm = (r - EARTH_RADIUS) / 1000;
  const radialVelocity = dot(state.velocity, state.position) / r;
  if (radialVelocity > 1e-6) {
    if (!state.fairingJettisoned && altitudeKm < FAIRING_JETTISON_ALTITUDE_KM) {
      consider((FAIRING_JETTISON_ALTITUDE_KM - altitudeKm) * 1000 / radialVelocity, "fairing");
    }
  } else if (radialVelocity < -1e-6 && altitudeKm > 0 && state.maxAltitudeKm > 0.05) {
    consider((altitudeKm * 1000) / -radialVelocity, "impact");
  }

  // Guidance cutoffs, estimated from element rates over the last step.
  if (state.phase === "ASCENT_2") {
    const elements = orbitalElements(state.position, state.velocity);
    const perigee = elements.perigeeAltitudeKm;
    const apogee = elements.apogeeAltitudeKm;
    if (perigee >= state.guidance.targetPerigeeKm) {
      // Direct insertion: perigee already in the target band.
      consider(0, "perigee_cutoff");
    } else if (apogee !== null && apogee >= state.guidance.ascentApogeeCapKm) {
      // Apogee cap reached with perigee still short: coast, then circularize.
      consider(0, "apogee_cutoff");
    }
  }
  if (state.phase === "CIRCULARIZE") {
    const elements = orbitalElements(state.position, state.velocity);
    const perigee = elements.perigeeAltitudeKm;
    const apogee = elements.apogeeAltitudeKm;
    const reachedTarget = perigee >= state.guidance.targetPerigeeKm;
    const securedSustained =
      perigee >= SUSTAINED_PERIGEE_KM && apogee !== null && apogee >= state.guidance.targetApogeeKm + 60;
    if (reachedTarget || securedSustained) {
      consider(0, "perigee_cutoff");
    } else {
      const rate = perigeeRateKmS(state);
      if (rate > 1e-9) {
        consider((state.guidance.targetPerigeeKm - perigee) / rate, "perigee_cutoff");
      }
    }
  }
  if (state.phase === "TLI_BURN" && state.tliTargetSpeedMs !== null) {
    if (norm(state.velocity) >= state.tliTargetSpeedMs) {
      consider(0, "tli_delta_v_cutoff");
    }
  }

  return { dtEvent, event };
}

/** d(perigee)/dt estimate during circularization, km/s. */
function perigeeRateKmS(state: FlightState): number {
  const active = activeEngine(state);
  if (!active) {
    return 0;
  }
  const mass = currentMassKg(state);
  const sample = state.environment.atmosphere.sample(Math.max(0, (norm(state.position) - EARTH_RADIUS) / 1000));
  const accel = (state.throttle * active.count * thrustAtPressure(active.engine, sample.pressure)) / mass;
  const elements = orbitalElements(state.position, state.velocity);
  const rP = EARTH_RADIUS + elements.perigeeAltitudeKm * 1000;
  const v = norm(state.velocity);
  const dRpDv = (2 * rP * rP * v) / MU_EARTH;
  const tangential = dot(state.velocity, state.attitude) / Math.max(v, 1e-9);
  return (accel * Math.max(0, tangential) * dRpDv) / 1000;
}

function applyStepEvent(state: FlightState, event: StepEvent): void {
  switch (event) {
    case "burnout":
      applyBurnout(state);
      break;
    case "separation":
      enterPhase(state, "SEPARATION");
      separateStage1(state);
      enterPhase(state, "IGNITION_DELAY");
      break;
    case "ignition":
      applyIgnition(state);
      break;
    case "fairing":
      jettisonFairing(state);
      break;
    case "impact":
      fail(state, "impact", `Ground impact at T+${state.t.toFixed(1)} s.`);
      break;
    case "apogee_cutoff":
      addEvent(state, "stage2_cutoff", "Apogee target reached");
      enterPhase(state, "COAST");
      break;
    case "perigee_cutoff":
      addEvent(state, "orbit_cutoff", "Target corridor reached");
      finalizeOrbit(state);
      break;
    case "tli_delta_v_cutoff":
      addEvent(state, "tli_cutoff", "Trans-lunar injection delta-v target reached");
      resolveTliBurnout(state);
      break;
  }
}

export function stepFlight(state: FlightState, dt: number = FIXED_TIMESTEP_S): void {
  if (isTerminalPhase(state.phase)) {
    return;
  }

  // Guidance at the step boundary: rate-limited attitude, capped throttle.
  updateGuidance(state, dt);
  handlePhaseTriggers(state);
  if (isTerminalPhase(state.phase)) {
    return;
  }

  if (state.phase === "PAD") {
    // Landed state: held by the normal force, rotating with Earth.
    state.t += dt;
    state.phaseTimeS += dt;
    state.stepCount += 1;
    return;
  }

  if (state.phase === "PARKING_COAST") {
    // Analytic, not integrated (LUNAR_MISSION_PLAN.md §4.1): the whole
    // coast to the TLI ignition point happens in one Kepler jump rather
    // than tens of thousands of RK4 substeps.
    const { position, velocity } = propagateKepler(state.position, state.velocity, PARKING_COAST_DURATION_S);
    state.position = position;
    state.velocity = velocity;
    state.t += PARKING_COAST_DURATION_S;
    state.phaseTimeS += PARKING_COAST_DURATION_S;
    state.stepCount += 1;

    const ignitionRadiusM = norm(state.position);
    const requirement = transferRequirement(ignitionRadiusM);
    const localCircularMs = Math.sqrt(MU_EARTH / ignitionRadiusM);
    state.tliIgnitionTimeS = state.t;
    state.tliIgnitionRadiusM = ignitionRadiusM;
    state.tliIgnitionSpeedMs = norm(state.velocity);
    state.tliDeltaVRequiredMs = requirement.deltaVRequiredMs;
    state.tliTargetSpeedMs = localCircularMs + requirement.deltaVRequiredMs;
    normalize(state.attitude, state.velocity);

    addEvent(
      state,
      "tli_ignition",
      `Trans-lunar injection burn begins, targeting ${requirement.deltaVRequiredMs.toFixed(0)} m/s`,
    );
    enterPhase(state, "TLI_BURN");
    return;
  }

  // Event-splitting integration loop. Detached stages are advanced by the
  // same dtEvent sub-steps as the active stack, not by the full requested
  // dt: a stage that separates mid-step exists for only the remainder of
  // this call, and integrating it over the whole dt would double-count the
  // pre-separation portion as extra gravity/drag drift on a body that did
  // not yet exist.
  let remaining = dt;
  let guard = 0;
  while (remaining > 1e-9 && guard < 8) {
    guard += 1;
    const { dtEvent, event } = findStepHorizon(state, remaining);
    rk4Step(state, dtEvent);
    for (const stage of state.detachedStages) {
      if (!stage.landed) {
        integrateDetachedStage(state, stage, dtEvent);
      }
    }
    state.t += dtEvent;
    state.phaseTimeS += dtEvent;
    remaining -= dtEvent;
    if (event !== null) {
      applyStepEvent(state, event);
      if (isTerminalPhase(state.phase)) {
        break;
      }
    } else {
      break;
    }
  }
  state.stepCount += 1;

  checkInFlightFailures(state);

  // Max-Q event marker.
  const altitudeKm = (norm(state.position) - EARTH_RADIUS) / 1000;
  const vRel = relativeVelocity(SCRATCH.vRel, state, state.position, state.velocity);
  const q = 0.5 * state.environment.atmosphere.density(Math.max(0, altitudeKm)) * norm(vRel) ** 2;
  if (state.maxQPa > 0 && q < state.maxQPa * 0.999 && !state.maxQRecorded && altitudeKm > 5) {
    state.maxQRecorded = true;
    addEvent(state, "max_q", `Max-Q ${(state.maxQPa / 1000).toFixed(1)} kPa`);
  }
}

function integrateDetachedStage(state: FlightState, stage: DetachedStage, dt: number): void {
  const r = norm(stage.position);
  const altitudeKm = (r - EARTH_RADIUS) / 1000;
  if (altitudeKm <= 0) {
    stage.landed = true;
    return;
  }
  const sample = state.environment.atmosphere.sample(Math.max(0, altitudeKm));
  const gravityScale = -MU_EARTH / (r * r * r);
  const vRel = SCRATCH.vRel;
  atmosphereVelocity(SCRATCH.coRot, stage.position);
  sub(vRel, stage.velocity, SCRATCH.coRot);
  const vRelMag = norm(vRel);
  const dragAccel = (0.5 * sample.density * stage.dragAreaM2 * vRelMag) / stage.massKg;

  // Simple explicit Euler is adequate for debris tracking.
  for (let i = 0; i < 3; i++) {
    stage.velocity[i] += (gravityScale * stage.position[i] - dragAccel * vRel[i]) * dt;
  }
  for (let i = 0; i < 3; i++) {
    stage.position[i] += stage.velocity[i] * dt;
  }
  if (norm(stage.position) - EARTH_RADIUS <= 0) {
    stage.landed = true;
  }
}

// ---------------------------------------------------------------------------
// runFlight
// ---------------------------------------------------------------------------

export interface Telemetry {
  sampleCount: number;
  tS: Float64Array;
  altitudeKm: Float64Array;
  speedMs: Float64Array;
  airspeedMs: Float64Array;
  dynamicPressurePa: Float64Array;
  properAccelG: Float64Array;
  propellantKg: Float64Array;
  massKg: Float64Array;
  throttle: Float64Array;
  aoaDeg: Float64Array;
  apogeeKm: Float64Array;
  perigeeKm: Float64Array;
  phase: Uint8Array;
  /** ECI position samples for trails (every sample). */
  posX: Float64Array;
  posY: Float64Array;
  posZ: Float64Array;
  /** ECI velocity samples, m/s — the tangents for Hermite interpolation. */
  velX: Float64Array;
  velY: Float64Array;
  velZ: Float64Array;
  /** Commanded body axis (nose direction) in ECI, unit vector. */
  attX: Float64Array;
  attY: Float64Array;
  attZ: Float64Array;
  /** Center of mass of the attached stack, m from the nose (moves as propellant burns). */
  comFromNoseM: Float64Array;
  /** Length of the attached stack, m (shortens at staging). */
  attachedLengthM: Float64Array;
  /** Spent stage-1 ECI position (NaN before separation / when absent). */
  spentX: Float64Array;
  spentY: Float64Array;
  spentZ: Float64Array;
}

function compactTelemetry(telemetry: Telemetry): Telemetry {
  const n = telemetry.sampleCount;
  if (n === telemetry.tS.length) {
    return telemetry;
  }
  const f64 = (a: Float64Array) => a.subarray(0, n).slice();
  const u8 = (a: Uint8Array) => a.subarray(0, n).slice();
  return {
    sampleCount: n,
    tS: f64(telemetry.tS),
    altitudeKm: f64(telemetry.altitudeKm),
    speedMs: f64(telemetry.speedMs),
    airspeedMs: f64(telemetry.airspeedMs),
    dynamicPressurePa: f64(telemetry.dynamicPressurePa),
    properAccelG: f64(telemetry.properAccelG),
    propellantKg: f64(telemetry.propellantKg),
    massKg: f64(telemetry.massKg),
    throttle: f64(telemetry.throttle),
    aoaDeg: f64(telemetry.aoaDeg),
    apogeeKm: f64(telemetry.apogeeKm),
    perigeeKm: f64(telemetry.perigeeKm),
    phase: u8(telemetry.phase),
    posX: f64(telemetry.posX),
    posY: f64(telemetry.posY),
    posZ: f64(telemetry.posZ),
    velX: f64(telemetry.velX),
    velY: f64(telemetry.velY),
    velZ: f64(telemetry.velZ),
    attX: f64(telemetry.attX),
    attY: f64(telemetry.attY),
    attZ: f64(telemetry.attZ),
    comFromNoseM: f64(telemetry.comFromNoseM),
    attachedLengthM: f64(telemetry.attachedLengthM),
    spentX: f64(telemetry.spentX),
    spentY: f64(telemetry.spentY),
    spentZ: f64(telemetry.spentZ),
  };
}

const PHASE_INDEX: Record<FlightPhase, number> = {
  PAD: 0,
  ASCENT_1: 1,
  BURNOUT_DELAY: 2,
  SEPARATION: 3,
  IGNITION_DELAY: 4,
  ASCENT_2: 5,
  COAST: 6,
  CIRCULARIZE: 7,
  // COMPLETE and FAILED keep their original indices (8, 9) below: a
  // hardcoded, positionally-matched PHASE_NAMES array in ui/telemetry.ts
  // reads this same enumeration, and renumbering them would silently
  // mislabel phases there. New phases are appended after it instead.
  COMPLETE: 8,
  FAILED: 9,
  PARKING_COAST: 10,
  TLI_BURN: 11,
  TRANS_LUNAR: 12,
};

export type FlightOutcome =
  | "target_orbit"
  | "sustained_orbit"
  | "low_perigee"
  | "unbound_trajectory"
  | "insufficient_orbital_energy"
  | "impact"
  | "invalid_build"
  | "insufficient_liftoff_thrust"
  | "acceleration_limit"
  | "dynamic_pressure_limit"
  | "aerodynamic_instability"
  | "slenderness_limit"
  | "vacuum_engine_low_ignition"
  | "timeout"
  // Lunar-mission terminal states (LUNAR_MISSION_PLAN.md §2.3). Every one
  // of these is reached only after a sustained parking orbit was already
  // confirmed — see finalizeOrbit's SUSTAINED_PERIGEE_KM gate.
  | "lunar_arrival"
  | "lunar_impact"
  | "lunar_miss"
  | "tli_shortfall"
  | "earth_escape";

export interface FlightResult {
  outcome: FlightOutcome;
  /** True when a sustained bound orbit (perigee ≥ 150 km) was achieved. */
  orbitAchieved: boolean;
  /** True when the orbit sits inside the target corridor. */
  targetOrbitAchieved: boolean;
  failureCode: string | null;
  failureDetail: string | null;
  events: FlightEvent[];
  telemetry: Telemetry;
  finalElements: OrbitalElements | null;
  maxQPa: number;
  maxG: number;
  /** Upper-stage propellant remaining at cutoff, kg. */
  stage2PropellantRemainingKg: number;
  finalState: FlightState;
  modelVersion: string;
  catalogVersion: string;
  guidanceVersion: string;
  seed: number;
  evidence: FlightEvidence;
  assessment: FlightAssessment;
  /** Set once a trans-lunar injection was attempted; null for any flight that never reached a sustained parking orbit. */
  lunarTransfer: TransferResult | null;
}

export function runFlight(input: FlightInput): FlightResult {
  const guidance = input.guidance ?? defaultGuidanceCoefficients();
  const perturbations = input.perturbations ?? NO_PERTURBATIONS;
  const seed = input.seed ?? 0;
  const state = createFlight(input.config, input.environment, seed, guidance, perturbations);
  const maxTimeS = input.maxTimeS ?? MAX_SIM_TIME_S;
  const dt = input.timestepS ?? FIXED_TIMESTEP_S;
  const recordTelemetry = input.recordTelemetry ?? true;

  const maxSamples = recordTelemetry ? Math.ceil(maxTimeS / dt) + 2 : 0;
  const telemetry: Telemetry = {
    sampleCount: 0,
    tS: new Float64Array(maxSamples),
    altitudeKm: new Float64Array(maxSamples),
    speedMs: new Float64Array(maxSamples),
    airspeedMs: new Float64Array(maxSamples),
    dynamicPressurePa: new Float64Array(maxSamples),
    properAccelG: new Float64Array(maxSamples),
    propellantKg: new Float64Array(maxSamples),
    massKg: new Float64Array(maxSamples),
    throttle: new Float64Array(maxSamples),
    aoaDeg: new Float64Array(maxSamples),
    apogeeKm: new Float64Array(maxSamples),
    perigeeKm: new Float64Array(maxSamples),
    phase: new Uint8Array(maxSamples),
    posX: new Float64Array(maxSamples),
    posY: new Float64Array(maxSamples),
    posZ: new Float64Array(maxSamples),
    velX: new Float64Array(maxSamples),
    velY: new Float64Array(maxSamples),
    velZ: new Float64Array(maxSamples),
    attX: new Float64Array(maxSamples),
    attY: new Float64Array(maxSamples),
    attZ: new Float64Array(maxSamples),
    comFromNoseM: new Float64Array(maxSamples),
    attachedLengthM: new Float64Array(maxSamples),
    spentX: new Float64Array(maxSamples).fill(Number.NaN),
    spentY: new Float64Array(maxSamples).fill(Number.NaN),
    spentZ: new Float64Array(maxSamples).fill(Number.NaN),
  };

  const record = () => {
    if (!recordTelemetry) {
      return;
    }
    const i = telemetry.sampleCount;
    if (i >= maxSamples) {
      return;
    }
    const r = norm(state.position);
    const vRel = relativeVelocity(SCRATCH.vRel, state, state.position, state.velocity);
    const airspeed = norm(vRel);
    const altitudeKm = (r - EARTH_RADIUS) / 1000;
    const density = state.environment.atmosphere.density(Math.max(0, altitudeKm));
    const elements = orbitalElements(state.position, state.velocity);
    telemetry.tS[i] = state.t;
    telemetry.altitudeKm[i] = altitudeKm;
    telemetry.speedMs[i] = norm(state.velocity);
    telemetry.airspeedMs[i] = airspeed;
    telemetry.dynamicPressurePa[i] = 0.5 * density * airspeed * airspeed;
    telemetry.properAccelG[i] = properAccelerationG(state);
    telemetry.propellantKg[i] = state.stage1PropellantKg + state.stage2PropellantKg;
    telemetry.massKg[i] = currentMassKg(state);
    telemetry.throttle[i] = state.throttle;
    telemetry.aoaDeg[i] =
      airspeed > MIN_AIRSPEED_FOR_AOA_MS
        ? (angleBetween(state.attitude, vRel) * 180) / Math.PI
        : Number.NaN; // undefined at negligible airspeed
    telemetry.apogeeKm[i] = elements.apogeeAltitudeKm ?? Number.NaN;
    telemetry.perigeeKm[i] = elements.perigeeAltitudeKm;
    telemetry.phase[i] = PHASE_INDEX[state.phase];
    telemetry.posX[i] = state.position[0];
    telemetry.posY[i] = state.position[1];
    telemetry.posZ[i] = state.position[2];
    telemetry.velX[i] = state.velocity[0];
    telemetry.velY[i] = state.velocity[1];
    telemetry.velZ[i] = state.velocity[2];
    telemetry.attX[i] = state.attitude[0];
    telemetry.attY[i] = state.attitude[1];
    telemetry.attZ[i] = state.attitude[2];
    telemetry.comFromNoseM[i] = currentCenterOfMassM(state);
    telemetry.attachedLengthM[i] = attachedLengthM(state);
    const spent = state.detachedStages[0];
    if (spent) {
      telemetry.spentX[i] = spent.position[0];
      telemetry.spentY[i] = spent.position[1];
      telemetry.spentZ[i] = spent.position[2];
    }
    telemetry.sampleCount += 1;
  };

  record();
  while (!isTerminalPhase(state.phase) && state.t < maxTimeS) {
    stepFlight(state, dt);
    record();
    if (state.phase === "PAD" && state.t >= PAD_TIMEOUT_S) {
      fail(
        state,
        "insufficient_liftoff_thrust",
        `Liftoff thrust-to-weight ratio ${state.rocket.liftoffTwr.toFixed(2)} is below 1: the vehicle cannot leave the pad.`,
      );
    }
  }
  if (state.phase !== "COMPLETE" && state.phase !== "FAILED") {
    fail(state, "timeout", `Simulation exceeded ${maxTimeS} s without reaching a terminal state.`);
  }

  const elements = state.phase === "COMPLETE" ? orbitalElements(state.position, state.velocity) : null;

  let outcome: FlightOutcome;
  let orbitAchieved: boolean;
  let targetOrbitAchieved: boolean;

  if (state.terminalOutcomeOverride !== null) {
    // A lunar-mission terminal state. `elements` at this point describes
    // the post-TLI-burn trans-lunar trajectory, not a parking orbit, so
    // orbit/target achievement are measured against the parking orbit
    // finalizeOrbit already confirmed sustained before allowing TLI.
    outcome = state.terminalOutcomeOverride;
    const parking = state.parkingElements!;
    orbitAchieved = true;
    targetOrbitAchieved =
      parking.perigeeAltitudeKm >= TARGET_PERIGEE_RANGE_KM[0] &&
      parking.perigeeAltitudeKm <= TARGET_PERIGEE_RANGE_KM[1] &&
      parking.apogeeAltitudeKm !== null &&
      parking.apogeeAltitudeKm >= TARGET_APOGEE_RANGE_KM[0] &&
      parking.apogeeAltitudeKm <= TARGET_APOGEE_RANGE_KM[1];
  } else if (state.phase === "COMPLETE" && elements) {
    orbitAchieved = elements.bound && !elements.intersectsGround && elements.perigeeAltitudeKm >= SUSTAINED_PERIGEE_KM;
    targetOrbitAchieved =
      orbitAchieved &&
      elements.perigeeAltitudeKm >= TARGET_PERIGEE_RANGE_KM[0] &&
      elements.perigeeAltitudeKm <= TARGET_PERIGEE_RANGE_KM[1] &&
      elements.apogeeAltitudeKm !== null &&
      elements.apogeeAltitudeKm >= TARGET_APOGEE_RANGE_KM[0] &&
      elements.apogeeAltitudeKm <= TARGET_APOGEE_RANGE_KM[1];
    if (targetOrbitAchieved) {
      outcome = "target_orbit";
    } else if (orbitAchieved) {
      outcome = "sustained_orbit";
    } else {
      outcome = "low_perigee";
    }
  } else {
    outcome = (state.failureCode ?? "timeout") as FlightOutcome;
    orbitAchieved = false;
    targetOrbitAchieved = false;
  }

  const evidence: FlightEvidence = {
    maxQPa: state.maxQPa,
    maxG: state.maxG,
    terminalTimeS: state.t,
    perigeeKm: elements?.perigeeAltitudeKm ?? null,
    source: "observed",
  };
  const assessment = evaluateFlightOutcome(state.rocket, outcome, evidence);

  return {
    outcome,
    orbitAchieved,
    targetOrbitAchieved,
    failureCode: state.failureCode,
    failureDetail: state.failureDetail,
    events: state.events,
    telemetry: compactTelemetry(telemetry),
    finalElements: elements,
    maxQPa: state.maxQPa,
    maxG: state.maxG,
    stage2PropellantRemainingKg: state.stage2PropellantKg,
    finalState: state,
    modelVersion: MODEL_VERSION,
    catalogVersion: CATALOG_VERSION,
    guidanceVersion: guidance.version,
    seed,
    evidence,
    assessment,
    lunarTransfer: state.lunarTransfer,
  };
}
