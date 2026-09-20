/**
 * Condensed analog-launch reference set for the `estimate_emissions` reducer.
 *
 * IMPORTANT: these per-vehicle totals are illustrative placeholders (rough
 * order-of-magnitude), NOT the real IGEL 2024 figures. The Python reference
 * (emissions.py::estimate_mission_footprint) computes exact totals from the
 * full IGEL per-launch emission-profile CSVs inside a zip archive it
 * downloads at runtime — that archive can't be fetched/unzipped inside this
 * module's runtime today, so this table exists to keep `estimate_emissions`
 * exercising real server-side logic (analog selection + payload-share
 * scaling, mirroring emissions.py's `_orbit_score` / `_scale_totals`) while
 * a real dataset is wired in.
 *
 * To replace with real data: export a condensed
 * `{vehicle, mean_altitude_km, co2e_kg, nox_kg, black_carbon_kg,
 * payload_capacity_kg, altitude_layer}` row per vehicle from
 * `emissions.py` (e.g. a new `export_launch_catalog.py`, alongside
 * `export_fixtures.py`), and call `seed_launch_catalog_entry` once per row
 * from a client/admin script using the generated bindings instead of this
 * file.
 */
import type { ReducerCtx } from "spacetimedb/server";
import type { spacetimedb } from "./schema";

export interface CatalogSeedRow {
  vehicle: string;
  meanAltitudeKm: number;
  co2eKgPerLaunch: number;
  noxKgPerLaunch: number;
  blackCarbonKgPerLaunch: number;
  payloadCapacityKg: number;
  altitudeLayer: string;
}

export const CATALOG_SEED: CatalogSeedRow[] = [
  {
    vehicle: "Electron (placeholder)",
    meanAltitudeKm: 500,
    co2eKgPerLaunch: 24_000,
    noxKgPerLaunch: 60,
    blackCarbonKgPerLaunch: 150,
    payloadCapacityKg: 300,
    altitudeLayer: "stratosphere_15_50km",
  },
  {
    vehicle: "Falcon 9 (placeholder)",
    meanAltitudeKm: 550,
    co2eKgPerLaunch: 425_000,
    noxKgPerLaunch: 1_200,
    blackCarbonKgPerLaunch: 3_000,
    payloadCapacityKg: 17_000,
    altitudeLayer: "stratosphere_15_50km",
  },
  {
    vehicle: "Ariane-class (placeholder)",
    meanAltitudeKm: 800,
    co2eKgPerLaunch: 350_000,
    noxKgPerLaunch: 900,
    blackCarbonKgPerLaunch: 500,
    payloadCapacityKg: 21_000,
    altitudeLayer: "mesosphere_50_80km",
  },
];

export function seedLaunchCatalog(ctx: ReducerCtx<typeof spacetimedb.schemaType>): void {
  if (ctx.db.launchCatalogEntry.count() > 0n) {
    return;
  }
  for (const row of CATALOG_SEED) {
    ctx.db.launchCatalogEntry.insert(row);
  }
}
