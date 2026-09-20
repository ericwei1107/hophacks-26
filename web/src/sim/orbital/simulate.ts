/**
 * TypeScript port of the preserved Python orbital mission model
 * (simulate.py), including the documented corrections. Parity with the
 * Python fixtures is verified in sim/orbital/__tests__/parity.test.ts.
 */

import {
  DAYS_PER_YEAR,
  EARTH_RADIUS,
  G0,
  MU_EARTH,
  SECONDS_PER_DAY,
} from "../physics/constants";
import {
  LEGACY_MISSION_RULES,
  type MissionRules,
  type OperationalDraw,
  type SimulationResult,
  type SpacecraftMission,
  type SpaceWeather,
} from "./types";

export const STORM_PROBABILITY = 0.12;
export const INSERTION_ALTITUDE_SIGMA_KM = 12.0;
export const INSERTION_INCLINATION_SIGMA_DEG = 0.7;
export const BAD_LAUNCH_PROBABILITY = 0.08;

export const DEFAULT_OPS: OperationalDraw = {
  insertion_altitude_error_km: 0.0,
  insertion_inclination_error_deg: 0.0,
  cam_scale: 1.0,
};

export function clip(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/** Missing, NaN, or infinite weather must never produce an invalid simulation. */
function finiteOr(value: number | null, fallback: number): number {
  if (value === null || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

export function orbitalVelocity(altitudeKm: number): number {
  const radius = EARTH_RADIUS + altitudeKm * 1000;
  return Math.sqrt(MU_EARTH / radius);
}

export function atmosphericRelativeVelocity(
  altitudeKm: number,
  inclinationDeg: number,
): number {
  const inertial = orbitalVelocity(altitudeKm);
  const radius = EARTH_RADIUS + altitudeKm * 1000;
  const coRotation = (465.0 * radius) / EARTH_RADIUS;
  const inclination = (inclinationDeg * Math.PI) / 180;
  const relativeSq =
    inertial ** 2 +
    coRotation ** 2 -
    2 * inertial * coRotation * Math.cos(inclination);
  return Math.sqrt(Math.max(relativeSq, 0.0));
}

export function estimateAtmosphericDensity(
  altitudeKm: number,
  weather: SpaceWeather,
  inclinationDeg = 0.0,
): number {
  if (!Number.isFinite(altitudeKm) || !Number.isFinite(inclinationDeg)) {
    return 1e-16;
  }
  const f107 = Math.max(finiteOr(weather.f107, 70.0), 60.0);
  const kp = Math.max(finiteOr(weather.kp, 0.0), 0.0);
  const speed = finiteOr(weather.solar_wind_speed, 400.0);
  const swDensity = finiteOr(weather.solar_wind_density, 5.0);
  const swTemp = finiteOr(weather.solar_wind_temperature, 1.0e5);

  // Thermosphere expands under solar EUV and geomagnetic heating.
  const scaleHeight = 42.0 + 0.07 * (f107 - 70.0) + 1.4 * kp;
  const baseDensity = 1.225e-12 * Math.exp(-(altitudeKm - 400.0) / scaleHeight);

  const solarFactor = (f107 / 150.0) ** 1.2;
  const geomagneticFactor = 1.0 + 0.05 * kp + 0.12 * Math.max(0.0, kp - 4.5) ** 1.3;
  const windFactor =
    1.0 +
    0.0004 * (speed - 400.0) +
    0.008 * (swDensity - 5.0) +
    0.04 * (swTemp / 1.0e5 - 1.0);
  const polarFactor =
    1.0 +
    (0.08 * Math.abs(Math.sin((inclinationDeg * Math.PI) / 180)) * Math.max(0.0, kp - 2.0)) / 4.0;

  return Math.max(
    1e-16,
    baseDensity *
      solarFactor *
      Math.max(0.25, geomagneticFactor) *
      Math.max(0.4, windFactor) *
      Math.max(1.0, polarFactor),
  );
}

export function estimateDragForce(
  mission: SpacecraftMission,
  weather: SpaceWeather,
  altitudeKm?: number,
): number {
  const altitude = altitudeKm ?? mission.target_altitude;
  const density = estimateAtmosphericDensity(altitude, weather, mission.target_inclination);
  const velocity = atmosphericRelativeVelocity(altitude, mission.target_inclination);
  return 0.5 * density * velocity ** 2 * mission.drag_coefficient * mission.cross_section_area;
}

export function averageSpacecraftMass(mission: SpacecraftMission): number {
  return Math.max(mission.mass + 0.5 * Math.max(mission.fuel, 0.0), 1e-9);
}

export function estimateDeltaVAvailable(mission: SpacecraftMission): number {
  if (mission.fuel <= 0 || mission.mass <= 0 || mission.isp <= 0) {
    return 0.0;
  }
  const initialMass = mission.mass + mission.fuel;
  return mission.isp * G0 * Math.log(initialMass / mission.mass);
}

/**
 * Minimum starting propellant: the load for which burning it all produces
 * exactly requiredDeltaV and ends at dry mass.
 */
export function estimatePropellantRequired(
  mission: SpacecraftMission,
  requiredDeltaV: number,
): number {
  if (requiredDeltaV <= 0) {
    return 0.0;
  }
  if (mission.isp <= 0 || mission.mass <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  const massRatio = Math.exp(requiredDeltaV / (mission.isp * G0));
  return mission.mass * (massRatio - 1);
}

/**
 * Propellant actually consumed producing requiredDeltaV starting from the
 * loaded tanks. Burning while heavier than the minimum-load case consumes
 * more than the minimum starting propellant.
 */
export function estimatePropellantConsumed(
  mission: SpacecraftMission,
  requiredDeltaV: number,
): number {
  if (requiredDeltaV <= 0) {
    return 0.0;
  }
  if (mission.isp <= 0 || mission.mass <= 0 || mission.fuel <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  const fullMass = mission.mass + mission.fuel;
  return fullMass * (1.0 - Math.exp(-requiredDeltaV / (mission.isp * G0)));
}

/**
 * Altitude lost to drag over durationS with no stationkeeping.
 *
 * This fallback approximates a mission that performs no stationkeeping at
 * all; it does not predict the exact moment propulsion runs out. Decay stops
 * at the reentry boundary: the final step is shortened so the trajectory
 * never produces an altitude below the boundary.
 */
export function estimateUnpoweredDecay(
  mission: SpacecraftMission,
  weather: SpaceWeather,
  durationS: number,
  spacecraftMass: number,
  rules: MissionRules = LEGACY_MISSION_RULES,
): number {
  let altitude = mission.target_altitude * 1000;
  const reentryM = rules.reentryAltitudeKm * 1000;
  const timestep = 7 * SECONDS_PER_DAY;
  const steps = Math.max(1, Math.ceil(durationS / timestep));
  let totalAltitudeLoss = 0.0;

  for (let i = 0; i < steps; i++) {
    if (altitude <= reentryM) {
      break;
    }
    const currentAltitudeKm = altitude / 1000;
    const radius = EARTH_RADIUS + altitude;
    const density = estimateAtmosphericDensity(
      currentAltitudeKm,
      weather,
      mission.target_inclination,
    );
    const velocity = atmosphericRelativeVelocity(currentAltitudeKm, mission.target_inclination);
    const dragForce =
      0.5 * density * velocity ** 2 * mission.drag_coefficient * mission.cross_section_area;
    const dragAcceleration = dragForce / spacecraftMass;
    const decayRate = (-2 * radius ** 2 * dragAcceleration * velocity) / MU_EARTH;
    const altitudeChange = decayRate * timestep;

    if (altitude + altitudeChange <= reentryM) {
      // Shortened final timestep: integrate only to the reentry boundary.
      const fraction = (altitude - reentryM) / -altitudeChange;
      totalAltitudeLoss += (Math.abs(altitudeChange) * fraction) / 1000;
      break;
    }

    totalAltitudeLoss += Math.abs(altitudeChange) / 1000;
    altitude += altitudeChange;
  }

  return totalAltitudeLoss;
}

/**
 * Stationkeeping holds the target orbit, so budget delta-v at that altitude.
 * Natural decay is only used later if the spacecraft cannot afford the budget.
 */
export function estimateStationkeepingDeltaV(
  mission: SpacecraftMission,
  weather: SpaceWeather,
): [totalDeltaV: number, inclinationDeltaV: number, density: number, dragForce: number] {
  const duration = mission.lifespan * DAYS_PER_YEAR * SECONDS_PER_DAY;
  const spacecraftMass = averageSpacecraftMass(mission);
  const density = estimateAtmosphericDensity(
    mission.target_altitude,
    weather,
    mission.target_inclination,
  );
  const velocity = atmosphericRelativeVelocity(mission.target_altitude, mission.target_inclination);
  const dragForce =
    0.5 * density * velocity ** 2 * mission.drag_coefficient * mission.cross_section_area;
  const dragAcceleration = dragForce / spacecraftMass;
  const totalDeltaV = dragAcceleration * duration;

  return [totalDeltaV, 0.0, density, dragForce];
}

export function estimateDisposalDeltaV(
  altitudeKm: number,
  rules: MissionRules = LEGACY_MISSION_RULES,
): number {
  const rApogee = EARTH_RADIUS + altitudeKm * 1000;
  const rPerigee = EARTH_RADIUS + rules.disposalPerigeeKm * 1000;
  if (rApogee <= rPerigee) {
    return 0.0;
  }
  const circularVelocity = Math.sqrt(MU_EARTH / rApogee);
  const transferA = 0.5 * (rApogee + rPerigee);
  const transferVelocity = Math.sqrt(MU_EARTH * (2.0 / rApogee - 1.0 / transferA));
  return Math.max(0.0, circularVelocity - transferVelocity);
}

export function estimateCollisionAvoidanceDeltaV(
  mission: SpacecraftMission,
  camScale = 1.0,
): number {
  // SATCAT cam_scale is crowding vs a quieter 400 km shell (1.0 = reference).
  // Inclination and area still change encounter geometry. Not Pc; no 750 km peak.
  const inclinationFactor =
    0.65 + 0.35 * Math.abs(Math.sin((mission.target_inclination * Math.PI) / 180));
  const areaFactor = mission.cross_section_area / 8.0;
  const annual = 7.5 * inclinationFactor * areaFactor;
  return Math.max(0.0, annual * mission.lifespan * Math.max(camScale, 0.4));
}

export function estimateInsertionDeltaV(
  mission: SpacecraftMission,
  ops: OperationalDraw,
): number {
  const radius = EARTH_RADIUS + mission.target_altitude * 1000;
  const velocity = orbitalVelocity(mission.target_altitude);
  const altitudeDv =
    (velocity * Math.abs(ops.insertion_altitude_error_km) * 1000.0) / radius;
  const inclinationDv =
    2.0 *
    velocity *
    Math.sin(((Math.abs(ops.insertion_inclination_error_deg) * Math.PI) / 180) / 2.0);
  return altitudeDv + inclinationDv;
}

export interface MissionDeltaVBudget {
  requiredDeltaV: number;
  dragDeltaV: number;
  camDeltaV: number;
  insertionDeltaV: number;
  disposalDeltaV: number;
  density: number;
  dragForce: number;
}

export function estimateMissionDeltaV(
  mission: SpacecraftMission,
  weather: SpaceWeather,
  ops: OperationalDraw = DEFAULT_OPS,
  rules: MissionRules = LEGACY_MISSION_RULES,
): MissionDeltaVBudget {
  const [dragDeltaV, , density, dragForce] = estimateStationkeepingDeltaV(mission, weather);
  const camDeltaV = estimateCollisionAvoidanceDeltaV(mission, ops.cam_scale);
  const insertionDeltaV = estimateInsertionDeltaV(mission, ops);
  const disposalDeltaV = estimateDisposalDeltaV(mission.target_altitude, rules);
  const requiredDeltaV = dragDeltaV + camDeltaV + insertionDeltaV + disposalDeltaV;
  return {
    requiredDeltaV,
    dragDeltaV,
    camDeltaV,
    insertionDeltaV,
    disposalDeltaV,
    density,
    dragForce,
  };
}

export function simulate(
  mission: SpacecraftMission,
  weather: SpaceWeather,
  ops: OperationalDraw = DEFAULT_OPS,
  rules: MissionRules = LEGACY_MISSION_RULES,
): SimulationResult {
  const failures: string[] = [];

  // Reject non-finite values and invalid physical inputs before calculation.
  if (!Number.isFinite(mission.mass) || mission.mass <= 0) {
    failures.push("invalid_mass");
  }
  if (!Number.isFinite(mission.fuel) || mission.fuel <= 0) {
    failures.push("no_fuel");
  }
  if (!Number.isFinite(mission.cross_section_area) || mission.cross_section_area <= 0) {
    failures.push("invalid_cross_section_area");
  }
  if (!Number.isFinite(mission.drag_coefficient) || mission.drag_coefficient <= 0) {
    failures.push("invalid_drag_coefficient");
  }
  if (!Number.isFinite(mission.isp) || mission.isp <= 0) {
    failures.push("invalid_isp");
  }
  if (!Number.isFinite(mission.lifespan) || mission.lifespan <= 0) {
    failures.push("invalid_lifespan");
  }
  if (!Number.isFinite(mission.target_altitude) || mission.target_altitude <= 0) {
    failures.push("invalid_target_altitude");
  }
  if (
    !Number.isFinite(mission.target_inclination) ||
    mission.target_inclination < 0.0 ||
    mission.target_inclination > 180.0
  ) {
    failures.push("invalid_target_inclination");
  }

  const emptyResult: SimulationResult = {
    passed: false,
    failure_reasons: failures,
    available_delta_v: 0.0,
    required_delta_v: 0.0,
    drag_delta_v: 0.0,
    collision_avoidance_delta_v: 0.0,
    insertion_delta_v: 0.0,
    disposal_delta_v: 0.0,
    propellant_required: 0.0,
    propellant_consumed: 0.0,
    propellant_remaining: 0.0,
    initial_altitude: 0.0,
    final_altitude: 0.0,
    orbital_decay: 0.0,
    average_density: 0.0,
    average_drag: 0.0,
  };

  if (failures.length > 0) {
    return emptyResult;
  }

  const budget = estimateMissionDeltaV(mission, weather, ops, rules);
  const availableDeltaV = estimateDeltaVAvailable(mission);
  const propellantRequired = estimatePropellantRequired(mission, budget.requiredDeltaV);
  const propellantConsumed = estimatePropellantConsumed(mission, budget.requiredDeltaV);
  const propellantRemaining = mission.fuel - propellantConsumed;
  const reserveRequired = mission.fuel * rules.propulsionReserveFraction;
  const operationsDeltaV = budget.dragDeltaV + budget.camDeltaV + budget.insertionDeltaV;

  if (operationsDeltaV > availableDeltaV) {
    failures.push("insufficient_delta_v");
  } else if (budget.requiredDeltaV > availableDeltaV) {
    failures.push("failed_disposal");
  }

  if (propellantRequired > mission.fuel) {
    failures.push("insufficient_propellant");
  } else if (propellantRemaining < reserveRequired) {
    failures.push("insufficient_propellant_reserve");
  }

  let finalAltitude: number;
  let orbitalDecay: number;
  if (availableDeltaV >= operationsDeltaV) {
    finalAltitude = mission.target_altitude;
    orbitalDecay = 0.0;
  } else {
    const duration = mission.lifespan * DAYS_PER_YEAR * SECONDS_PER_DAY;
    const naturalAltitudeLoss = estimateUnpoweredDecay(
      mission,
      weather,
      duration,
      averageSpacecraftMass(mission),
      rules,
    );
    finalAltitude = mission.target_altitude - naturalAltitudeLoss;
    orbitalDecay = naturalAltitudeLoss;

    if (finalAltitude < rules.minOperatingAltitudeKm) {
      failures.push("below_operating_altitude");
    }
    // Decay stops at the reentry boundary; reaching it means reentry.
    if (finalAltitude <= rules.reentryAltitudeKm + 1e-6) {
      failures.push("orbital_decay");
    }
  }

  return {
    passed: failures.length === 0,
    failure_reasons: failures,
    available_delta_v: availableDeltaV,
    required_delta_v: budget.requiredDeltaV,
    drag_delta_v: budget.dragDeltaV,
    collision_avoidance_delta_v: budget.camDeltaV,
    insertion_delta_v: budget.insertionDeltaV,
    disposal_delta_v: budget.disposalDeltaV,
    propellant_required: propellantRequired,
    propellant_consumed: propellantConsumed,
    propellant_remaining: propellantRemaining,
    initial_altitude: mission.target_altitude,
    final_altitude: finalAltitude,
    orbital_decay: orbitalDecay,
    average_density: budget.density,
    average_drag: budget.dragForce,
  };
}
