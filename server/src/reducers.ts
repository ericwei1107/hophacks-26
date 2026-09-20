/**
 * Mission/weather/trajectory ingestion reducers, plus module lifecycle
 * hooks. These are thin, validated writes — the analysis logic (emissions
 * scoring, regulatory compliance) lives in logic.ts.
 */
import { t } from "spacetimedb/server";
import { spacetimedb } from "./schema";
import { seedLaunchCatalog } from "./catalog_seed";

export const init = spacetimedb.init((ctx) => {
  seedLaunchCatalog(ctx);
});

export const client_connected = spacetimedb.clientConnected((ctx) => {
  console.log(`client connected: ${ctx.sender.toHexString()}`);
});

export const client_disconnected = spacetimedb.clientDisconnected((ctx) => {
  console.log(`client disconnected: ${ctx.sender.toHexString()}`);
});

export const create_mission = spacetimedb.reducer(
  {
    seed: t.i64(),
    massKg: t.f64(),
    fuelKg: t.f64(),
    lifespanYears: t.f64(),
    targetAltitudeKm: t.f64(),
    targetInclinationDeg: t.f64(),
    crossSectionAreaM2: t.f64(),
    dragCoefficient: t.f64(),
    ispS: t.f64(),
    modelVersion: t.string(),
  },
  (ctx, args) => {
    if (args.massKg <= 0 || args.fuelKg < 0) {
      throw new Error("massKg must be positive and fuelKg must be non-negative.");
    }
    ctx.db.mission.insert({
      id: 0n,
      createdBy: ctx.sender,
      createdAt: ctx.timestamp,
      ...args,
    });
  },
);

export const record_weather_snapshot = spacetimedb.reducer(
  {
    missionId: t.u64(),
    kp: t.option(t.f64()),
    f107: t.option(t.f64()),
    solarWindSpeedKmS: t.option(t.f64()),
    solarWindDensity: t.option(t.f64()),
    solarWindTemperatureK: t.option(t.f64()),
    source: t.string(),
    retrievedAt: t.string(),
  },
  (ctx, args) => {
    if (ctx.db.mission.id.find(args.missionId) === null) {
      throw new Error(`Unknown missionId ${args.missionId}.`);
    }
    const row = {
      missionId: args.missionId,
      kp: args.kp,
      f107: args.f107,
      solarWindSpeedKmS: args.solarWindSpeedKmS,
      solarWindDensity: args.solarWindDensity,
      solarWindTemperatureK: args.solarWindTemperatureK,
      source: args.source,
      retrievedAt: args.retrievedAt,
    };
    if (ctx.db.weatherSnapshot.missionId.find(args.missionId) !== null) {
      ctx.db.weatherSnapshot.missionId.update(row);
    } else {
      ctx.db.weatherSnapshot.insert(row);
    }
  },
);

export const record_trajectory_result = spacetimedb.reducer(
  {
    missionId: t.u64(),
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
  },
  (ctx, args) => {
    if (ctx.db.mission.id.find(args.missionId) === null) {
      throw new Error(`Unknown missionId ${args.missionId}.`);
    }
    if (args.passes + args.failures !== args.totalRuns) {
      throw new Error("passes + failures must equal totalRuns.");
    }
    const row = { ...args, computedAt: ctx.timestamp };
    if (ctx.db.trajectoryResult.missionId.find(args.missionId) !== null) {
      ctx.db.trajectoryResult.missionId.update(row);
    } else {
      ctx.db.trajectoryResult.insert(row);
    }
  },
);
