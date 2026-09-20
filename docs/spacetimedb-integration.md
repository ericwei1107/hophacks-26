# SpacetimeDB integration

Adds a real backend for the mission-design domain (emissions, orbital-debris
regulatory screening, trajectory/physics parameters) that was previously
Python-only and disconnected from the browser app — see
`docs/python-ts-fixture-parity.md` for that prior state. This does **not**
change the ascent-game's offline-first design (`persistence/storage.ts` +
`localStorage` stays the source of truth the UI reads from); SpacetimeDB is
an additive, best-effort sync layer.

**Status: built, published to a local instance, and exercised end to end**
(CLI installed, module published, every reducer/procedure called and its
output verified with `spacetime sql`, plus a live run through
`syncMissionToSpacetime` from the actual TypeScript client). Not yet wired
to a persistent or hosted instance — see "Running it" below.

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

web/src/module_bindings/     Generated TypeScript client — real output of
                              `spacetime generate`, not hand-written (see below)
web/src/persistence/
  spacetime.ts                Connects, subscribes, calls reducers, never throws into the UI
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

## Verified locally

Installed the SpacetimeDB CLI (`curl -sSf https://install.spacetimedb.com | sh`,
v2.10.1 — matches the `spacetimedb` npm package version this was built
against), ran `spacetime start --in-memory` locally, and confirmed:

- `spacetime publish apogee-launch-lab -p server` creates all 7 tables and
  runs `init` (seeds `launch_catalog_entry` — `spacetime sql apogee-launch-lab
  "SELECT * FROM launch_catalog_entry"` shows the 3 placeholder rows).
- `create_mission` → `estimate_emissions` → correct analog match and
  payload-share math (verified the arithmetic by hand against the SQL
  output for two different mission masses, including the `min(1, ...)`
  clamp when payload share would exceed capacity).
- `evaluate_compliance` → correct compliant/non-compliant verdict from
  `lifespan_years`, and `regulations_considered` updates from 0 → 5 after
  running `sync_debris_rules`.
- `sync_debris_rules` performs a **real** live HTTP call from inside the
  module to the Federal Register API and caches real, current results
  (titles/dates/abstracts — not fixtures).
- `record_trajectory_result`'s validation (`passes + failures ==
  totalRuns`) correctly rejects bad input and rolls back atomically (no
  row written), and accepts valid input.
- `spacetime generate --lang typescript --out-dir web/src/module_bindings
  -p server` produced the real client — replacing what had been a
  hand-written placeholder — and `persistence/spacetime.ts` needed only
  two small fixes against the real output (see "Fixes made against the
  real client" below); the reducer/table names and shapes I'd guessed at
  matched.
- Ran `syncMissionToSpacetime` for real from a Vitest-hosted Node process
  (Node 24's native `WebSocket`) against the live local instance: connect
  → subscribe → `create_mission` → awaited insert → weather/trajectory
  writes → emissions + compliance reducers, all in ~500ms, then confirmed
  every resulting row via `spacetime sql`.

## Fixes made against the real client

The hand-written placeholder guessed right on the overall shape
(`DbConnection.builder()`, `conn.reducers.createMission(...)`,
`conn.db.mission.onInsert(...)`), but real codegen differs in a few ways
now reflected in `persistence/spacetime.ts`:

- **No named row/arg types are exported.** `Mission`, `CreateMissionArgs`
  etc. don't exist as exports; the real bindings only export runtime
  values (`tables`, `reducers`, `DbConnection`). Types are now derived
  structurally, e.g. `Parameters<Reducers["createMission"]>[0]` and a
  `RowOf<...>` helper against `Tables["mission"]["onInsert"]`.
- **Procedures always take a params object**, even with zero params:
  `conn.procedures.syncDebrisRules({})`, not `syncDebrisRules()`.
- **Subscriptions are required, not optional.** `onInsert`/`onUpdate`
  callbacks only fire for rows covered by an active subscription — the
  placeholder didn't need this to type-check, but without it
  `awaitMissionInsert` would hang forever waiting for an insert event
  that never arrives. `connectSpacetime()` now subscribes to all six
  tables and only resolves once the subscription is applied.
- **The generated `index.ts` doesn't type-check under this repo's
  `exactOptionalPropertyTypes: true`** (a constraint-object type mismatch
  in generated code, not in anything hand-written here). Tried isolating
  it via TS project references first; that hit a separate, harder
  blocker (`TS2883`: SpacetimeDB's deeply-generic inferred types aren't
  portable for declaration-emit, which `composite` projects require).
  Disabled the flag project-wide in `web/tsconfig.app.json` instead, with
  a comment explaining why — the narrower fix wasn't available.

## Running it

1. `spacetime start` (a local instance was used for verification here;
   not left running for the repo — no state persists between sessions
   without `--data-dir` instead of `--in-memory`).
2. `spacetime publish apogee-launch-lab -p server`
3. `spacetime generate --lang typescript --out-dir web/src/module_bindings -p server`
   (only needed again after changing `server/src/schema.ts` or the
   reducer/procedure signatures — the committed bindings already match
   the current schema).
4. `npm --prefix web run dev`, with `VITE_SPACETIMEDB_URI` /
   `VITE_SPACETIMEDB_NAME` env vars if not using the defaults
   (`ws://localhost:3000` / `apogee-launch-lab`).
5. For a persistent/deployed instance instead of local: `spacetime login`,
   then `spacetime publish apogee-launch-lab -p server -s maincloud` (or
   self-host `spacetime start` with `--data-dir` on a real server).

## What's still a placeholder

`launch_catalog_entry` is seeded with illustrative numbers, not the real
IGEL 2024 per-vehicle totals — see the comment in `catalog_seed.ts` for
the path to replace it with a real export from `emissions.py`. The scoring
logic itself (nearest-altitude analog match, payload-share scaling,
verified above) is real; only the seed data is a stand-in.
