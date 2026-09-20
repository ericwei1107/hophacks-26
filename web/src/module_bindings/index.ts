/**
 * PLACEHOLDER — not the real generated client bindings.
 *
 * Real bindings are produced by the SpacetimeDB CLI, not hand-written:
 *
 *   spacetime generate --lang typescript --out-dir web/src/module_bindings --project-path server
 *
 * That command reads the compiled `server/` module (schema.ts + reducers.ts
 * + logic.ts + procedures.ts) and emits a `DbConnection` class wired to the
 * exact BSATN wire types SpacetimeDB assigned at publish time — data this
 * file cannot fabricate safely by hand. Running it overwrites this file
 * with the real thing; nothing else in `persistence/spacetime.ts` needs to
 * change, because the exported shape here (`DbConnection`, `Mission`,
 * `*Args`, …) matches what codegen produces for this schema.
 *
 * Until then, `DbConnection.builder().build()` below throws instead of
 * silently no-opping, so a misconfigured environment fails loudly.
 */

// ---- Row types (mirror server/src/schema.ts) --------------------------

export interface Mission {
  id: bigint;
  createdBy: unknown;
  createdAt: unknown;
  seed: bigint;
  massKg: number;
  fuelKg: number;
  lifespanYears: number;
  targetAltitudeKm: number;
  targetInclinationDeg: number;
  crossSectionAreaM2: number;
  dragCoefficient: number;
  ispS: number;
  modelVersion: string;
}

export interface WeatherSnapshotRow {
  missionId: bigint;
  kp: number | undefined;
  f107: number | undefined;
  solarWindSpeedKmS: number | undefined;
  solarWindDensity: number | undefined;
  solarWindTemperatureK: number | undefined;
  source: string;
  retrievedAt: string;
}

export interface TrajectoryResultRow {
  missionId: bigint;
  totalRuns: number;
  passes: number;
  failures: number;
  probabilityPass: number;
  probabilityFail: number;
  baselinePassed: boolean;
  baselineFailureReasons: string[];
  availableDeltaVMs: number;
  requiredDeltaVMs: number;
  propellantRemainingKg: number;
  finalAltitudeKm: number;
  computedAt: unknown;
}

export interface EmissionsEstimateRow {
  missionId: bigint;
  analogVehicle: string;
  co2eKg: number;
  noxKg: number;
  blackCarbonKg: number;
  altitudeLayer: string;
  payloadShare: number;
  estimatedAt: unknown;
}

export interface RegulatoryComplianceRow {
  missionId: bigint;
  compliant: boolean;
  reasonCode: string;
  deorbitTimeYears: number;
  regulationsConsidered: number;
  evaluatedAt: unknown;
}

export interface DebrisRegulationRow {
  htmlUrl: string;
  title: string;
  publicationDate: string;
  abstract: string;
  syncedAt: unknown;
}

// ---- Reducer argument types (mirror server/src/reducers.ts + logic.ts) --

export type CreateMissionArgs = Omit<Mission, "id" | "createdBy" | "createdAt">;
export type RecordWeatherSnapshotArgs = WeatherSnapshotRow;
export type RecordTrajectoryResultArgs = Omit<TrajectoryResultRow, "computedAt">;
export interface MissionIdArgs {
  missionId: bigint;
}

type RowCallback<Row> = (ctx: unknown, row: Row) => void;
type UpdateCallback<Row> = (ctx: unknown, oldRow: Row, newRow: Row) => void;

interface TableHandle<Row> {
  onInsert(cb: RowCallback<Row>): void;
  removeOnInsert(cb: RowCallback<Row>): void;
  onUpdate(cb: UpdateCallback<Row>): void;
  removeOnUpdate(cb: UpdateCallback<Row>): void;
  onDelete(cb: RowCallback<Row>): void;
  removeOnDelete(cb: RowCallback<Row>): void;
  iter(): Iterable<Row>;
}

export interface RemoteTables {
  mission: TableHandle<Mission>;
  weatherSnapshot: TableHandle<WeatherSnapshotRow>;
  trajectoryResult: TableHandle<TrajectoryResultRow>;
  emissionsEstimate: TableHandle<EmissionsEstimateRow>;
  debrisRegulation: TableHandle<DebrisRegulationRow>;
  regulatoryCompliance: TableHandle<RegulatoryComplianceRow>;
}

export interface RemoteReducers {
  createMission(args: CreateMissionArgs): Promise<void>;
  recordWeatherSnapshot(args: RecordWeatherSnapshotArgs): Promise<void>;
  recordTrajectoryResult(args: RecordTrajectoryResultArgs): Promise<void>;
  estimateEmissions(args: MissionIdArgs): Promise<void>;
  evaluateCompliance(args: MissionIdArgs): Promise<void>;
}

export interface RemoteProcedures {
  syncDebrisRules(): Promise<number>;
}

interface SubscriptionBuilder {
  subscribe(queries: unknown | unknown[]): { unsubscribe(): void };
}

const NOT_GENERATED_MESSAGE =
  "SpacetimeDB client bindings are a placeholder. Run " +
  "`spacetime generate --lang typescript --out-dir web/src/module_bindings --project-path server` " +
  "(with a `spacetime start` instance running) to replace web/src/module_bindings/index.ts " +
  "with the real generated client.";

export class DbConnection {
  db!: RemoteTables;
  reducers!: RemoteReducers;
  procedures!: RemoteProcedures;

  static builder(): {
    withUri(uri: string): ReturnType<typeof DbConnection.builder>;
    withDatabaseName(name: string): ReturnType<typeof DbConnection.builder>;
    withToken(token?: string): ReturnType<typeof DbConnection.builder>;
    onConnect(cb: (conn: DbConnection, identity: unknown, token: string) => void): ReturnType<typeof DbConnection.builder>;
    onConnectError(cb: (ctx: unknown, error: Error) => void): ReturnType<typeof DbConnection.builder>;
    onDisconnect(cb: (ctx: unknown, error?: Error) => void): ReturnType<typeof DbConnection.builder>;
    build(): DbConnection;
  } {
    const self = {
      withUri: () => self,
      withDatabaseName: () => self,
      withToken: () => self,
      onConnect: () => self,
      onConnectError: () => self,
      onDisconnect: () => self,
      build: (): DbConnection => {
        throw new Error(NOT_GENERATED_MESSAGE);
      },
    };
    return self;
  }

  subscriptionBuilder(): SubscriptionBuilder {
    throw new Error(NOT_GENERATED_MESSAGE);
  }

  disconnect(): void {
    /* no-op on the placeholder */
  }
}
