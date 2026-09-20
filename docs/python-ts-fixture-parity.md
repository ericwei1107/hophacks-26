# Python ↔ TypeScript connectivity (fixture-parity pipeline)

Status: implemented. This is a standalone doc, separate from `MAIN_PLAN.md` /
`docs/refactor-notes.md`. It only covers how the Python reference model and
the TypeScript mission sim stay in sync — not the renderer, UI, or the
CLI-only Python modules (`emissions.py`, `regulations.py`, `insights.py`,
`explanations.py`), which have no TypeScript counterpart and are out of
scope here (see `export_fixtures.py`'s module docstring).

## Architecture

- **Source of truth:** `design.py`, `environment.py`, `simulate.py` at repo
  root.
- **Port:** `web/src/sim/orbital/{simulate,types,monteCarlo}.ts` — a hand
  written TypeScript reimplementation, not a transpilation.
- **Bridge:** `export_fixtures.py` runs the Python model and writes
  `fixtures/*.json`. `web/src/sim/orbital/__tests__/parity.test.ts` loads
  those fixtures (via `__tests__/fixtures.ts`) and asserts the TS port
  reproduces the same outputs within `1e-12` relative tolerance.

The risk this creates: someone edits `simulate.py`, doesn't re-run
`export_fixtures.py`, and the TS parity tests keep passing against
**stale** fixtures — silently certifying parity that no longer holds.

## What's in place

### 1. CI drift gate — `.github/workflows/python-ts-parity.yml`

Runs on every push/PR that touches the Python reference model, the
fixtures, or the TS orbital sim. Steps: install Python + Node deps, run
`pytest`, run `python scripts/check_fixture_drift.py`, run the TS parity +
shape tests, then the full web test suite.

**Important gotcha found while building this:** a naive
`python export_fixtures.py && git diff --exit-code -- fixtures/` is
flaky. Regenerating fixtures on a different Python patch version / libm
build changed values in the last bit or two with zero code changes
(observed: `237.40006869014277` vs `237.40006869014275`, a ~1e-16 relative
difference) — CI would fail on every run for no real reason. Do **not**
implement the gate as a raw text diff.

Instead, `scripts/check_fixture_drift.py` loads the committed fixtures and
a fresh in-memory export from `export_fixtures.py`'s own functions, and
walks both trees: numbers are compared with `math.isclose(rel_tol=1e-9)`
(matching the spirit of the TS parity tests' `1e-12`, slightly looser to
be safe across environments), everything else (keys, strings, bools, list
lengths) is compared exactly. It never writes to `fixtures/`. Verified it
both (a) stays quiet on the committed fixtures as-is and (b) fails loudly
on an injected value change and an injected key rename — see git history
of this script for how that was checked.

### 2. One command to regenerate — `Makefile`

```
make sync-fixtures    # regenerate fixtures/ from Python, replay TS parity + shape tests
make check-fixtures   # read-only: fail if committed fixtures drifted from the reference model
```

Run `sync-fixtures` after touching `design.py`, `environment.py`, or
`simulate.py`. `check-fixtures` is what CI runs; it's also useful locally
before opening a PR.

### 3. Fixture envelope version, checked on load — `web/src/sim/orbital/__tests__/fixtures.ts`

`export_fixtures.py` writes `model_version` (`MODEL_VERSION = "1.0.0"`)
into every fixture's envelope. `fixtures.ts` checks every fixture against
`EXPECTED_MODEL_VERSION` as soon as it's imported, and throws a specific
error naming the mismatch if Python and TS disagree on the fixture shape
version. Bump both constants together whenever the exported *shape*
changes (new/renamed/restructured field) — not for ordinary value changes.

### 4. Fixture-shape drift test — `web/src/sim/orbital/__tests__/fixtureShape.test.ts`

Catches an added, renamed, or removed Python field that a value-only
parity test wouldn't notice (it especially wouldn't notice a field TS never
reads at all). It compares `Object.keys()` of fixture objects
(`SpacecraftMission`, `SpaceWeather`, `SimulationResult`, `OperationalDraw`)
against key lists exported from `types.ts`.

Those key lists (`SPACECRAFT_MISSION_KEYS` etc.) are written as
`Object.keys({...} satisfies Record<keyof T, true>)`, so TypeScript itself
refuses to compile the file if the literal is missing a key the interface
requires or has one the interface doesn't — the key list can't quietly
drift from the interface it's supposed to mirror. No new runtime
dependency (zod) was added; this gets most of the value for a mission
model this size.

### 5. Centralized fixture imports — `web/src/sim/orbital/__tests__/fixtures.ts`

All five `fixtures/*.json` imports (and the version check) live in one
file now. `parity.test.ts` and `fixtureShape.test.ts` both import from
`./fixtures` instead of repeating `../../../../../fixtures/*.json`. If the
fixture directory ever moves, there's one import block to fix.

### 6. Scope boundary documented — `export_fixtures.py` module docstring

States explicitly that `emissions.py`, `regulations.py`, `insights.py`,
and `explanations.py` have no TS port or fixture coverage, and points here
and to `make sync-fixtures` / `make check-fixtures`.

## Verification performed

- `pytest -q`: 60 passed, 4 skipped (unchanged from before this work).
- `npm test` (web): 217 → 221 passed (added `fixtureShape.test.ts`'s 4
  cases; the pre-existing 217 still pass unmodified).
- `npx tsc -b --force`: clean.
- `make check-fixtures`: passes against the committed fixtures.
- Manually verified the drift checker fails on both an injected numeric
  change and an injected key rename, and passes once reverted.
