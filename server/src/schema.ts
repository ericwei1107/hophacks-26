/**
 * Table definitions for the mission/emissions/debris-compliance domain.
 *
 * Mirrors the Python reference model (design.py, environment.py,
 * simulate.py, emissions.py, regulations.py) — see
 * docs/spacetimedb-integration.md for the field-by-field mapping. Every
 * per-mission table is keyed by `missionId` (the `mission` table's
 * primary key) so a mission's weather input, trajectory result, emissions
 * estimate, and regulatory compliance stay joined without a separate
 * foreign-key layer.
 */
import { schema, table, t } from "spacetimedb/server";

export const mission = table(
  { name: "mission", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    createdBy: t.identity(),
    createdAt: t.timestamp(),
    seed: t.i64(),
    /** Dry mass, kg — SpacecraftMission.mass. */
    massKg: t.f64(),
    /** Loaded propellant, kg — SpacecraftMission.fuel. */
    fuelKg: t.f64(),
    /** Mission duration, years — SpacecraftMission.lifespan. */
    lifespanYears: t.f64(),
    targetAltitudeKm: t.f64(),
    targetInclinationDeg: t.f64(),
    crossSectionAreaM2: t.f64(),
    dragCoefficient: t.f64(),
    ispS: t.f64(),
    modelVersion: t.string(),
  },
);

export const weatherSnapshot = table(
  { name: "weather_snapshot", public: true },
  {
    /** One snapshot per mission; FK to mission.id. */
    missionId: t.u64().primaryKey(),
    kp: t.option(t.f64()),
    f107: t.option(t.f64()),
    solarWindSpeedKmS: t.option(t.f64()),
    solarWindDensity: t.option(t.f64()),
    solarWindTemperatureK: t.option(t.f64()),
    source: t.string(),
    /** ISO retrieval timestamp from the client's WeatherSnapshot. */
    retrievedAt: t.string(),
  },
);

export const trajectoryResult = table(
  { name: "trajectory_result", public: true },
  {
    /** One Monte Carlo result per mission; FK to mission.id. */
    missionId: t.u64().primaryKey(),
    totalRuns: t.u32(),
    passes: t.u32(),
    failures: t.u32(),
    probabilityPass: t.f64(),
    probabilityFail: t.f64(),
    baselinePassed: t.bool(),
    baselineFailureReasons: t.array(t.string()),
    availableDeltaVMs: t.f64(),
    requiredDeltaVMs: t.f64(),
    propellantRemainingKg: t.f64(),
    finalAltitudeKm: t.f64(),
    computedAt: t.timestamp(),
  },
);

/** Static analog-launch reference set, seeded once at module init (see reducers.ts). */
export const launchCatalogEntry = table(
  { name: "launch_catalog_entry", public: true },
  {
    vehicle: t.string().primaryKey(),
    meanAltitudeKm: t.f64(),
    co2eKgPerLaunch: t.f64(),
    noxKgPerLaunch: t.f64(),
    blackCarbonKgPerLaunch: t.f64(),
    payloadCapacityKg: t.f64(),
    altitudeLayer: t.string(),
  },
);

export const emissionsEstimate = table(
  { name: "emissions_estimate", public: true },
  {
    /** One footprint per mission; FK to mission.id. */
    missionId: t.u64().primaryKey(),
    analogVehicle: t.string(),
    co2eKg: t.f64(),
    noxKg: t.f64(),
    blackCarbonKg: t.f64(),
    altitudeLayer: t.string(),
    payloadShare: t.f64(),
    estimatedAt: t.timestamp(),
  },
);

/** Cached Federal Register orbital-debris documents, refreshed by the sync_debris_rules procedure. */
export const debrisRegulation = table(
  { name: "debris_regulation", public: true },
  {
    htmlUrl: t.string().primaryKey(),
    title: t.string(),
    publicationDate: t.string(),
    abstract: t.string(),
    syncedAt: t.timestamp(),
  },
);

export const regulatoryCompliance = table(
  { name: "regulatory_compliance", public: true },
  {
    /** One compliance verdict per mission; FK to mission.id. */
    missionId: t.u64().primaryKey(),
    compliant: t.bool(),
    reasonCode: t.string(),
    deorbitTimeYears: t.f64(),
    regulationsConsidered: t.u32(),
    evaluatedAt: t.timestamp(),
  },
);

export const spacetimedb = schema({
  mission,
  weatherSnapshot,
  trajectoryResult,
  launchCatalogEntry,
  emissionsEstimate,
  debrisRegulation,
  regulatoryCompliance,
});
