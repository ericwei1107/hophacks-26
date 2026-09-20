# Improving Python ↔ TypeScript connectivity (fixture-parity pipeline)

This is a standalone instruction set, separate from `MAIN_PLAN.md` /
`docs/refactor-notes.md`. It only covers how the Python reference model and
the TypeScript mission sim stay in sync — not the renderer, UI, or the
CLI-only Python modules (`emissions.py`, `regulations.py`, `insights.py`,
`explanations.py`), which have no TypeScript counterpart today and are out of
scope here.

## Current state (as of this writing)

- **Source of truth:** `design.py`, `environment.py`, `simulate.py` at repo
  root.
- **Port:** `web/src/sim/orbital/{simulate,types,monteCarlo}.ts` — a hand
  written TypeScript reimplementation, not a transpilation.
- **Bridge:** `export_fixtures.py` runs the Python model and writes
  `fixtures/*.json`. `web/src/sim/orbital/__tests__/parity.test.ts` imports
  those JSON files directly (via relative path) and asserts the TS port
  reproduces the same outputs within `1e-12` relative tolerance.
- **Nothing wires these together automatically.** Fixture regeneration is a
  manual `python export_fixtures.py` step. There is no CI (`find . -iname
  "*.yml"` returns nothing), no pre-commit hook, and no script that fails a
  build when the checked-in fixtures are stale relative to the Python source.

The risk this creates: someone edits `simulate.py`, doesn't re-run
`export_fixtures.py`, and the TS parity tests keep passing against
**stale** fixtures — silently certifying parity that no longer holds.

## Instructions

### 1. Make fixture staleness a CI failure, not a trust exercise

Add a workflow (`.github/workflows/parity.yml`) that:

1. Installs Python deps (`pip install -r requirements.txt`) and Node deps
   (`npm --prefix web ci`).
2. Runs `python export_fixtures.py`.
3. Runs `git diff --exit-code -- fixtures/` — fail the build if regeneration
   changed anything the committed fixtures didn't already have. This is the
   actual drift check; everything else in this document is secondary to it.
4. Runs `npm --prefix web test` (which includes `parity.test.ts`) and
   `pytest`.

This single step catches the most common failure mode: Python sim logic
changed, fixtures weren't regenerated, TS silently parities against old
numbers.

### 2. Wire regeneration into one command

Add a root `Makefile` (or `package.json` script at repo root, whichever this
team already reaches for) with a single entry point:

```
sync-fixtures:
	python export_fixtures.py
	npm --prefix web test -- parity
```

Document this one command in `web/README.md` or the repo root README as
"run this after touching `design.py`, `environment.py`, or `simulate.py`."
Right now that instruction only lives in `export_fixtures.py`'s docstring
and in scattered comments — nobody will find it there.

### 3. Version the contract, and check the version

`export_fixtures.py` already writes a `model_version` field into every
fixture's envelope (`MODEL_VERSION = "1.0.0"`), but `parity.test.ts` never
reads it. Add a check at fixture-load time:

```ts
const EXPECTED_MODEL_VERSION = "1.0.0";

function loadFixture<T extends { model_version: string }>(data: unknown): T {
  const fixture = data as T;
  if (fixture.model_version !== EXPECTED_MODEL_VERSION) {
    throw new Error(
      `fixture model_version ${fixture.model_version} != expected ${EXPECTED_MODEL_VERSION}; ` +
        `regenerate with 'python export_fixtures.py' or bump EXPECTED_MODEL_VERSION`,
    );
  }
  return fixture;
}
```

Bump `MODEL_VERSION` in `export_fixtures.py` whenever the exported shape
(not just the values) changes — new field, renamed field, restructured
envelope. This turns a shape mismatch into one clear error message instead
of a confusing `undefined` deep in a scalar comparison.

### 4. Stop hand-syncing the type definitions

`web/src/sim/orbital/types.ts` (`SpacecraftMission`, `SpaceWeather`,
`SimulationResult`) is manually kept in sync with the Python dataclasses in
`design.py` / `environment.py` / `simulate.py`. Nothing enforces this today
— a renamed or added Python field won't break TS compilation, it'll just be
silently absent from the port until a parity test happens to notice a value
mismatch (and won't notice a Python field that TS never reads at all).

Two options, in order of effort:

- **Cheap:** add one test that walks `Object.keys()` of a decoded fixture's
  `mission` / `weather` / `expected` objects and asserts they're a subset of
  (or equal to) the TS interface's known keys, using a small runtime schema
  (zod) instead of a bare `as T` cast in `loadFixture`. This catches added
  or renamed Python fields immediately, in the same test run that already
  exists.
- **Stronger:** generate `types.ts` (or a zod schema that the hand-written
  interfaces are checked against) directly from the Python side — e.g. emit
  JSON Schema from the dataclasses in `export_fixtures.py`'s envelope step,
  and run `json-schema-to-zod` or similar in a `pretest` script. Only worth
  it if the schema keeps changing; for a small, largely-frozen mission model
  the cheap option is proportionate.

### 5. Make the fixture import path resilient

`parity.test.ts` currently imports fixtures with
`../../../../../fixtures/*.json` (five `../` segments). This works but
breaks silently-into-"file not found" the moment anything moves. Centralize
it:

```ts
// web/src/sim/orbital/__tests__/fixtures.ts
export { default as correctionsJson } from "../../../../../fixtures/corrections.json";
export { default as missionsJson } from "../../../../../fixtures/missions.json";
// ...
```

One file owns the relative path; every test imports from it. If the fixture
directory ever moves, there's exactly one line to fix instead of five
scattered imports.

### 6. Keep the scope boundary explicit

`emissions.py`, `regulations.py`, `insights.py`, and `explanations.py` call
external services (Federal Register, an LLM) and have no TypeScript port or
fixture coverage. That's a legitimate scope decision, not an oversight — but
nothing currently says so. Add one line to this document's top (done above)
or to `export_fixtures.py`'s module docstring, so a future contributor
doesn't assume parity coverage exists where it doesn't.

## Why this ordering

Step 1 (CI drift check) is the only item that actually prevents the failure
mode described above; it should land first even on its own. Steps 2-5 make
the workflow easier to use correctly and catch a wider class of drift
(shape, not just values), but a CI gate on `git diff --exit-code -- fixtures/`
is the floor.
