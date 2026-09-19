/**
 * Conversions between simulation objects (which carry class instances) and
 * the plain-data shapes that cross the worker boundary.
 */

import type { RocketConfig } from "../domain/config";
import {
  defaultEnvironment,
  runFlight,
  type FlightEnvironment,
  type FlightResult,
} from "../sim/ascent/flight";
import type { GuidanceCoefficients } from "../sim/ascent/guidance";
import type { FlightPerturbations } from "../sim/ascent/flight";
import type { SerializableFlightResult, SerializedFlightInput } from "./protocol";

export type { SerializableFlightResult, SerializedFlightInput } from "./protocol";

export function serializeFlightInput(
  config: RocketConfig,
  environment: FlightEnvironment,
  seed: number,
  guidance?: GuidanceCoefficients,
  perturbations?: FlightPerturbations,
  maxTimeS?: number,
): SerializedFlightInput {
  return {
    config,
    weather: environment.weather,
    launchLatitudeDeg: environment.launchLatitudeDeg,
    launchLongitudeDeg: environment.launchLongitudeDeg,
    localWindEastMs: environment.localWindEastMs,
    localWindNorthMs: environment.localWindNorthMs,
    seed,
    ...(guidance !== undefined ? { guidance } : {}),
    ...(perturbations !== undefined ? { perturbations } : {}),
    ...(maxTimeS !== undefined ? { maxTimeS } : {}),
  };
}

export function deserializeEnvironment(input: SerializedFlightInput): FlightEnvironment {
  const base = defaultEnvironment(input.weather);
  return {
    ...base,
    launchLatitudeDeg: input.launchLatitudeDeg,
    launchLongitudeDeg: input.launchLongitudeDeg,
    localWindEastMs: input.localWindEastMs,
    localWindNorthMs: input.localWindNorthMs,
  };
}

export function serializeFlightResult(result: FlightResult): SerializableFlightResult {
  return {
    outcome: result.outcome,
    orbitAchieved: result.orbitAchieved,
    targetOrbitAchieved: result.targetOrbitAchieved,
    failureCode: result.failureCode,
    failureDetail: result.failureDetail,
    events: result.events,
    telemetry: result.telemetry,
    finalElements: result.finalElements,
    maxQPa: result.maxQPa,
    maxG: result.maxG,
    stage2PropellantRemainingKg: result.stage2PropellantRemainingKg,
    config: result.finalState.rocket.config,
    weather: result.finalState.environment.weather,
    seed: result.seed,
    modelVersion: result.modelVersion,
    catalogVersion: result.catalogVersion,
    guidanceVersion: result.guidanceVersion,
    totalTimeS: result.finalState.t,
  };
}

export function telemetryTransferBuffers(result: SerializableFlightResult): Transferable[] {
  const t = result.telemetry;
  return [
    t.tS, t.altitudeKm, t.speedMs, t.airspeedMs, t.dynamicPressurePa, t.properAccelG,
    t.propellantKg, t.massKg, t.throttle, t.aoaDeg, t.apogeeKm, t.perigeeKm,
    t.posX, t.posY, t.posZ, t.spentX, t.spentY, t.spentZ,
  ].map((a) => a.buffer);
}

/** Run a flight from a serialized input and return the serializable result. */
export function runSerializedFlight(input: SerializedFlightInput): SerializableFlightResult {
  const environment = deserializeEnvironment(input);
  const result = runFlight({
    config: input.config,
    environment,
    seed: input.seed,
    ...(input.guidance !== undefined ? { guidance: input.guidance } : {}),
    ...(input.perturbations !== undefined ? { perturbations: input.perturbations } : {}),
    ...(input.maxTimeS !== undefined ? { maxTimeS: input.maxTimeS } : {}),
  });
  return serializeFlightResult(result);
}
