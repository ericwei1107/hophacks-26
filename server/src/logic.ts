/**
 * Server-side analysis reducers — the actual "server logic" connecting the
 * mission, weather, emissions-catalog, and debris-regulation tables. Both
 * reducers here port a Python rule directly rather than just storing a
 * client-computed number, so the result is reproducible from the stored
 * rows alone.
 */
import { t } from "spacetimedb/server";
import { spacetimedb } from "./schema";
import type { CatalogSeedRow } from "./catalog_seed";

/** Post-mission de-orbit screening limit — regulations.py::DEORBIT_LIMIT_YEARS. */
const DEORBIT_LIMIT_YEARS = 5;

/**
 * Picks the launch-catalog analog whose reference altitude is closest to
 * the mission's target altitude, then scales its per-launch totals by the
 * mission's share of that vehicle's payload capacity — the same two-step
 * shape as emissions.py's `find_analog_launches` + `_scale_totals`, just
 * against the condensed seed table (see catalog_seed.ts) instead of the
 * full IGEL archive.
 */
export const estimate_emissions = spacetimedb.reducer(
  { missionId: t.u64() },
  (ctx, { missionId }) => {
    const mission = ctx.db.mission.id.find(missionId);
    if (mission === null) {
      throw new Error(`Unknown missionId ${missionId}.`);
    }

    let best: CatalogSeedRow | null = null;
    let bestDistanceKm = Infinity;
    for (const entry of ctx.db.launchCatalogEntry.iter()) {
      const distanceKm = Math.abs(entry.meanAltitudeKm - mission.targetAltitudeKm);
      if (distanceKm < bestDistanceKm) {
        best = entry;
        bestDistanceKm = distanceKm;
      }
    }
    if (best === null) {
      throw new Error("Launch catalog is empty; cannot estimate emissions.");
    }

    const wetMassKg = mission.massKg + Math.max(mission.fuelKg, 0);
    const payloadShare = Math.min(1, wetMassKg / best.payloadCapacityKg);

    const row = {
      missionId,
      analogVehicle: best.vehicle,
      co2eKg: best.co2eKgPerLaunch * payloadShare,
      noxKg: best.noxKgPerLaunch * payloadShare,
      blackCarbonKg: best.blackCarbonKgPerLaunch * payloadShare,
      altitudeLayer: best.altitudeLayer,
      payloadShare,
      estimatedAt: ctx.timestamp,
    };
    if (ctx.db.emissionsEstimate.missionId.find(missionId) !== null) {
      ctx.db.emissionsEstimate.missionId.update(row);
    } else {
      ctx.db.emissionsEstimate.insert(row);
    }
  },
);

/**
 * Five-year post-mission disposal screening rule —
 * regulations.py::evaluate_mission_compliance, where
 * `post_mission_decay_years` is taken directly from the mission's intended
 * lifespan (main.py: `"post_mission_decay_years": mission.lifespan`).
 * Also counts how many cached `debris_regulation` rows exist as of
 * evaluation time, so a stale/empty cache is visible on the row itself
 * rather than silently assumed complete.
 */
export const evaluate_compliance = spacetimedb.reducer(
  { missionId: t.u64() },
  (ctx, { missionId }) => {
    const mission = ctx.db.mission.id.find(missionId);
    if (mission === null) {
      throw new Error(`Unknown missionId ${missionId}.`);
    }

    const deorbitTimeYears = mission.lifespanYears;
    const compliant = deorbitTimeYears <= DEORBIT_LIMIT_YEARS;
    const reasonCode = compliant
      ? "within_5yr_disposal_limit"
      : "exceeds_5yr_disposal_limit";

    const row = {
      missionId,
      compliant,
      reasonCode,
      deorbitTimeYears,
      regulationsConsidered: Number(ctx.db.debrisRegulation.count()),
      evaluatedAt: ctx.timestamp,
    };
    if (ctx.db.regulatoryCompliance.missionId.find(missionId) !== null) {
      ctx.db.regulatoryCompliance.missionId.update(row);
    } else {
      ctx.db.regulatoryCompliance.insert(row);
    }
  },
);
