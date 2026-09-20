/**
 * Optional SpacetimeDB sync layer for completed payload-mission analyses.
 *
 * This is additive, not a replacement for `persistence/storage.ts`:
 * localStorage stays the source of truth the UI reads from, and every
 * function here is best-effort — a missing/unreachable SpacetimeDB
 * instance (e.g. `spacetime start` not running, or client bindings not
 * yet generated — see `module_bindings/index.ts`) must never break the
 * debrief screen. Callers should fire-and-forget with `.catch(() => {})`
 * or rely on `syncMissionToSpacetime`'s own internal try/catch.
 *
 * Server-side logic (emissions analog scoring, the five-year disposal
 * compliance rule) lives in `server/src/logic.ts`, not here — this file
 * only shapes client data into reducer calls and reads results back.
 */
import type { MonteCarloSummary, SpacecraftMission } from "../sim/orbital/types";
import type { WeatherSnapshot } from "../sim/orbital/weather";
import { DbConnection } from "../module_bindings";

// The generated bindings (module_bindings/index.ts) don't export named row
// or reducer-arg types — table/reducer shapes are inline object literals —
// so these are derived structurally from DbConnection itself instead.
type Reducers = InstanceType<typeof DbConnection>["reducers"];
type Tables = InstanceType<typeof DbConnection>["db"];
type CreateMissionArgs = Parameters<Reducers["createMission"]>[0];
type RowOf<OnInsert> = OnInsert extends (cb: (ctx: infer _Ctx, row: infer Row) => void) => void ? Row : never;
type Mission = RowOf<Tables["mission"]["onInsert"]>;

const DEFAULT_URI = import.meta.env.VITE_SPACETIMEDB_URI ?? "ws://localhost:3000";
const DEFAULT_DB_NAME = import.meta.env.VITE_SPACETIMEDB_NAME ?? "apogee-launch-lab";

/**
 * Every table this client reads. `onInsert`/`onUpdate`/`onDelete` callbacks
 * only fire for rows covered by an active subscription — without this, a
 * reducer call still succeeds server-side, but the client never observes
 * the resulting row and `awaitMissionInsert` below would hang forever.
 */
const SUBSCRIBED_TABLES = [
  "SELECT * FROM mission",
  "SELECT * FROM weather_snapshot",
  "SELECT * FROM trajectory_result",
  "SELECT * FROM emissions_estimate",
  "SELECT * FROM regulatory_compliance",
  "SELECT * FROM debris_regulation",
];

let connection: DbConnection | null = null;
let connecting: Promise<DbConnection> | null = null;

/** Lazily connects once per session; safe to call repeatedly. Resolves only once the initial subscription has been applied. */
export function connectSpacetime(): Promise<DbConnection> {
  if (connection) {
    return Promise.resolve(connection);
  }
  if (connecting) {
    return connecting;
  }
  connecting = new Promise<DbConnection>((resolve, reject) => {
    DbConnection.builder()
      .withUri(DEFAULT_URI)
      .withDatabaseName(DEFAULT_DB_NAME)
      .onConnect((conn) => {
        connection = conn;
        conn
          .subscriptionBuilder()
          .onApplied(() => resolve(conn))
          .onError((ctx) => reject(ctx.event ?? new Error("SpacetimeDB subscription failed")))
          .subscribe(SUBSCRIBED_TABLES);
      })
      .onConnectError((_ctx, error) => {
        connecting = null;
        reject(error);
      })
      .onDisconnect(() => {
        connection = null;
      })
      .build();
  });
  return connecting;
}

function missionArgsFromMission(mission: SpacecraftMission, seed: number, modelVersion: string): CreateMissionArgs {
  return {
    seed: BigInt(Math.trunc(seed)),
    massKg: mission.mass,
    fuelKg: mission.fuel,
    lifespanYears: mission.lifespan,
    targetAltitudeKm: mission.target_altitude,
    targetInclinationDeg: mission.target_inclination,
    crossSectionAreaM2: mission.cross_section_area,
    dragCoefficient: mission.drag_coefficient,
    ispS: mission.isp,
    modelVersion,
  };
}

/**
 * Waits for the `mission` row this connection's own `create_mission` call
 * produced (matched by seed, since reducers don't return values directly —
 * the client observes the resulting insert instead).
 */
function awaitMissionInsert(conn: DbConnection, seed: bigint): Promise<Mission> {
  return new Promise((resolve) => {
    const handler = (_ctx: unknown, row: Mission) => {
      if (row.seed === seed) {
        conn.db.mission.removeOnInsert(handler);
        resolve(row);
      }
    };
    conn.db.mission.onInsert(handler);
  });
}

export interface MissionAnalysisSnapshot {
  mission: SpacecraftMission;
  weather: WeatherSnapshot;
  monteCarlo: MonteCarloSummary;
  seed: number;
  modelVersion: string;
}

/**
 * Pushes a completed payload-mission analysis (mission params, weather
 * input, Monte Carlo result) to SpacetimeDB, then triggers the two
 * server-side analyses (emissions estimate, regulatory compliance) that
 * only need the stored mission row. Never throws — failures are logged
 * and swallowed so this can be called fire-and-forget from the UI.
 */
export async function syncMissionToSpacetime(snapshot: MissionAnalysisSnapshot): Promise<void> {
  try {
    const conn = await connectSpacetime();
    const args = missionArgsFromMission(snapshot.mission, snapshot.seed, snapshot.modelVersion);
    const insertedPromise = awaitMissionInsert(conn, args.seed);
    await conn.reducers.createMission(args);
    const mission = await insertedPromise;

    const w = snapshot.weather.weather;
    await conn.reducers.recordWeatherSnapshot({
      missionId: mission.id,
      kp: w.kp ?? undefined,
      f107: w.f107 ?? undefined,
      solarWindSpeedKmS: w.solar_wind_speed ?? undefined,
      solarWindDensity: w.solar_wind_density ?? undefined,
      solarWindTemperatureK: w.solar_wind_temperature ?? undefined,
      source: snapshot.weather.source,
      retrievedAt: snapshot.weather.retrievedAt,
    });

    const mc = snapshot.monteCarlo;
    await conn.reducers.recordTrajectoryResult({
      missionId: mission.id,
      totalRuns: mc.total_runs,
      passes: mc.passes,
      failures: mc.failures,
      probabilityPass: mc.probability_pass,
      probabilityFail: mc.probability_fail,
      baselinePassed: mc.baseline.passed,
      baselineFailureReasons: mc.baseline.failure_reasons,
      availableDeltaVMs: mc.baseline.available_delta_v,
      requiredDeltaVMs: mc.baseline.required_delta_v,
      propellantRemainingKg: mc.baseline.propellant_remaining,
      finalAltitudeKm: mc.baseline.final_altitude,
    });

    await Promise.all([
      conn.reducers.estimateEmissions({ missionId: mission.id }),
      conn.reducers.evaluateCompliance({ missionId: mission.id }),
    ]);
  } catch (error) {
    console.warn("SpacetimeDB sync skipped:", error instanceof Error ? error.message : error);
  }
}

/** Triggers the server-side Federal Register cache refresh (see server/src/procedures.ts). */
export async function syncDebrisRules(): Promise<number | null> {
  try {
    const conn = await connectSpacetime();
    return await conn.procedures.syncDebrisRules({});
  } catch (error) {
    console.warn("Debris-rule sync skipped:", error instanceof Error ? error.message : error);
    return null;
  }
}
