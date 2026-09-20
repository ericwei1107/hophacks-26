# SpacetimeDB integration

Adds a real backend for the mission-design domain (emissions, orbital-debris
regulatory screening, trajectory/physics parameters) that was previously
Python-only and disconnected from the browser app — see
`docs/python-ts-fixture-parity.md` for that prior state. This does **not**
change the ascent-game's offline-first design (`persistence/storage.ts` +
`localStorage` stays the source of truth the UI reads from); SpacetimeDB is
an additive, best-effort sync layer.

## Why SpacetimeDB (not Postgres/Supabase/Neon)

SpacetimeDB modules bundle the database *and* server logic in one process:
reducers are the only way to write, so validation and derived-data rules
(the analog-launch emissions match, the five-year disposal compliance
check) live next to the data instead of in a separate API layer, and
clients get real-time row subscriptions for free. It also ships a
TypeScript module runtime (`spacetimedb/server`, running on V8) alongside
Rust/C#/C++, so the module is written in the same language as the rest of
`web/`, with no new toolchain for day-to-day development.

## Layout

```
server/                     SpacetimeDB module (published as its own database)
  src/schema.ts              Table definitions
  src/reducers.ts            Mission/weather/trajectory ingestion + module lifecycle
  src/logic.ts                Server-side analysis: emissions scoring, compliance rule
  src/procedures.ts           sync_debris_rules — live Federal Register fetch + cache
  src/catalog_seed.ts          Condensed placeholder analog-launch dataset (see below)
  src/index.ts                 Module entry point

web/src/module_bindings/     Generated TypeScript client (see "What's not done" below)
web/src/persistence/
  spacetime.ts                Connects, calls reducers, never throws into the UI
web/src/ui/screens/
  DebriefScreen.tsx            Fires syncMissionToSpacetime() after a Monte Carlo run
```

## Data model

Every per-mission table is keyed by `missionId` (the `mission` table's
primary key), so a mission's inputs and every derived analysis join
without a separate relations layer:

| Table | Written by | Mirrors |
|---|---|---|
| `mission` | `create_mission` reducer | `design.py::SpacecraftMission` |
| `weather_snapshot` | `record_weather_snapshot` reducer | `environment.py::SpaceWeather` |
| `trajectory_result` | `record_trajectory_result` reducer | `simulate.py::MonteCarloSummary` (baseline run) |
| `launch_catalog_entry` | seeded once at module `init` | `emissions.py`'s IGEL-derived catalog (condensed) |
| `emissions_estimate` | `estimate_emissions` reducer (server logic) | `emissions.py::estimate_mission_footprint` |
| `debris_regulation` | `sync_debris_rules` procedure (live fetch) | `regulations.py::get_latest_debris_rules` |
| `regulatory_compliance` | `evaluate_compliance` reducer (server logic) | `regulations.py::evaluate_mission_compliance` |

`estimate_emissions` and `evaluate_compliance` are genuine server-side
logic, not just writes: they read other tables and compute a result from
stored rows, so the answer is reproducible from the database alone. See
the doc comments in `server/src/logic.ts` for exactly which Python
function each one ports.

## Running it locally

1. Install the SpacetimeDB CLI (not an npm package — a separate binary):
   see https://spacetimedb.com/install. Not installed in this environment;
   this integration was built and type-checked against the real
   `spacetimedb` npm package (`server/`, `web/`) but not published or run
   end-to-end here.
2. `spacetime start` — runs a local instance.
3. `spacetime publish apogee-launch-lab --project-path server`
4. `spacetime generate --lang typescript --out-dir web/src/module_bindings --project-path server`
   — **this overwrites the placeholder** described below with the real
   client.
5. `npm --prefix web run dev`, with `VITE_SPACETIMEDB_URI` /
   `VITE_SPACETIMEDB_NAME` env vars if not using the defaults
   (`ws://localhost:3000` / `apogee-launch-lab`).

## What's not done, and why

- **`web/src/module_bindings/index.ts` is a hand-written placeholder, not
  the real generated client.** SpacetimeDB's own docs are explicit that
  `DbConnectionBuilder`/`DbConnectionImpl` are never hand-constructed —
  `spacetime generate` reads the *published* module's compiled type
  metadata (BSATN wire types assigned at publish time) and emits the real
  bindings. Faking that serialization layer by hand would be guessing at
  wire-format details with no way to verify them without a running
  server, so instead the placeholder throws a clear, actionable error
  (`DbConnection.builder().build()`) if used before real codegen runs.
  Everything importing from it (`persistence/spacetime.ts`) is written
  against the exact shape real codegen produces for this schema, so
  running step 4 above is the only thing left to do — no calling code
  changes.
- **`launch_catalog_entry` is seeded with illustrative placeholder
  numbers**, not the real IGEL 2024 per-vehicle totals — see the comment
  in `catalog_seed.ts` for the path to replace it with a real export from
  `emissions.py`. The scoring logic itself (nearest-altitude analog match,
  payload-share scaling) is real and matches the Python shape; only the
  seed data is a stand-in.
- Nothing was actually published to a running SpacetimeDB instance (no
  CLI in this sandbox) — verified instead by installing the real
  `spacetimedb` npm package and type-checking `server/` and `web/`
  against it (`npx tsc --noEmit` / `npx tsc -b --force`, both clean), plus
  running the existing web test suite (217 tests, all passing).
