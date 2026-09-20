# Rocket Performance Outcome System — Follow-on Implementation Plan

## 1. Purpose and starting point

This plan turns `IMPLEMENT.MD`'s flyable Gate E prototype into the completed core learning loop. It turns the five player-facing performance values and the scenario research in `FAILURE_MODES.md` into a deterministic outcome-evaluation system.

The player-facing loop becomes:

**Build → inspect five performance values → launch → receive the physical flight result → understand the supported diagnosis → change one relevant lever → relaunch → compare the two runs.**

A debrief alone is a report, not a completed learning loop. Gate H therefore requires a player to preserve a baseline, make a controlled edit, and see whether the relevant measured result changed. Payload analysis and Monte Carlo are advanced tools; neither may change the launch-objective verdict.

The new system must answer three different questions without conflating them:

1. **What physically happened?** Examples: never left the pad, exceeded the structural load limit, reached a low-perigee orbit, reached the target orbit.
2. **Which performance values were healthy, marginal, or outside a limit?** TWR, ideal delta-v, drag area, stability margin, and measured peak g.
3. **What recognizable design pattern best explains the result?** Examples: Firecracker, Grinder, Pencil, or Everything Sags.

The existing `FlightOutcome` remains the authoritative physical result. Named scenarios are diagnoses layered on top of it. Multiple diagnoses may match one flight, but the debrief chooses one primary diagnosis and retains the others as contributing factors.

This separation is required because the scenarios in `FAILURE_MODES.md` overlap. A heavy payload can simultaneously create low TWR, low delta-v, and an upper-stage shortfall. Replacing the physical outcome with one nickname would discard useful evidence and make Monte Carlo counts misleading.

## 2. Current implementation and gaps

The project already provides most of the raw foundation:

- `web/src/domain/derive.ts` calculates liftoff TWR, total ideal delta-v, CdA, liftoff static margin, slenderness, masses, and stage data.
- `web/src/sim/ascent/flight.ts` records telemetry and terminates on hard failures. It currently returns one of 14 `FlightOutcome` values plus max-Q, peak g, orbital elements, events, and a failure detail.
- `web/src/sim/ascent/robustness.ts` counts raw flight outcomes over perturbed runs.
- `web/src/workers/protocol.ts` serializes the flight result across the worker boundary.
- `web/src/persistence/storage.ts` stores the raw outcome and a few summary measurements.
- `web/src/ui/screens/DebriefScreen.tsx` maps every raw outcome directly to hard-coded title and suggestion text.

The gaps are:

1. The five values are split between preflight derivation and postflight simulation. There is no shared performance snapshot.
2. The solver stops on the first terminal failure and does not retain all contributing conditions.
3. Peak g and max-Q are aggregate values. Per-stage peak g, upper-stage ignition TWR, minimum atmospheric stability margin, and `q × angle of attack` are not retained.
4. Batch flights use `recordTelemetry: false`, so an evaluator that scans telemetry would silently lose diagnoses during robustness analysis.
5. Thresholds are distributed across `derive.ts`, `flight.ts`, and UI copy instead of one versioned ruleset.
6. The current stability rule treats a margin below one caliber as an immediate game-rule failure. `FAILURE_MODES.md` notes that a guided rocket can tolerate a negative static margin until aerodynamic torque exceeds control authority. The first evaluator must preserve the existing flight rule but label it as a simplified stability limit; the current model cannot honestly claim “Control saturation.”
7. Raw outcome presentation, diagnosis, suggested fixes, and evidence formatting are coupled inside a React component.
8. Saved summaries and worker messages have no evaluator version, metric assessment, primary diagnosis, or contributing diagnoses.
9. The current plan does not preserve an experiment baseline, classify the number of build edits, or define an honest fallback when browser storage is unavailable.

## 3. Product behavior

### 3.1 Assembly screen

Start with a concise launch-objective card: target perigee 180–220 km, target apogee 180–250 km, sustained-orbit floor 150 km, and the current hard load limits. Provide a reference build and one-click reset so players always have a recoverable baseline.

Continue showing the five performance values as engineering measurements. Add a band and threshold explanation to each value, but do not predict a named failure outcome before launch. Each hint describes the measurement's consequence, never a named predicted scenario.

Preflight states are:

- **Within range:** no known concern from this value.
- **Marginal:** near a warning threshold.
- **Outside limit:** violates a hard game rule or build constraint.
- **Context only:** the raw value has no honest universal pass/fail threshold.
- **Measured in flight:** unavailable until simulation, used for peak g.

CdA is initially **context only**. Absolute drag area cannot be classified honestly without mass, trajectory, atmospheric density, and angle of attack. The UI may explain its direction of effect, but it must not call a large CdA a failure by itself.

### 3.2 Flight screen

The solver remains authoritative. A diagnosis never changes the trajectory, causes a failure, or overrides an orbit calculation.

Record metric threshold crossings as events only when they matter to the debrief, such as:

- TWR failed to exceed 1 on the pad.
- Dynamic pressure crossed the warning level and then the hard limit.
- Proper acceleration crossed the payload rating.
- Minimum atmospheric stability margin occurred.
- Stage 2 ignited with its minimum observed TWR.

### 3.3 Debrief screen

Present information in this order:

1. Physical result: target orbit, sustained off-target orbit, suborbital flight, vehicle loss, pad failure, invalid build, or indeterminate result.
2. Primary diagnosis: the most causal supported scenario, or the raw physical cause when no named scenario is justified.
3. Evidence: measured values, their thresholds, stage and event time, and the raw `FlightOutcome`.
4. Contributing diagnoses: other matched patterns, clearly labeled as contributing rather than separate outcomes.
5. Suggested levers: changes tied to the evidence, each phrased as a tradeoff rather than a guaranteed fix.
6. Five-value scorecard: predicted value, measured value where applicable, band, and threshold source.
7. **Try one change:** retain the debriefed run as a pinned baseline and return to Assembly with the recommended editable control focused. The player can decline the suggestion and edit freely.
8. **Comparison after relaunch:** classify the diff as `one_relevant_change`, `multiple_changes`, `no_change`, or `incompatible_baseline`. Only `one_relevant_change` may make causal wording about the recommended experiment. Other classifications show measured correlation only.

Example:

> **INSUFFICIENT ORBITAL ENERGY**  
> Primary diagnosis: **Firecracker**  
> Liftoff TWR was 1.82, while ideal delta-v was 8.91 km/s against a 9.30 km/s minimum. The rocket climbed aggressively, exhausted stage 2, and reentered at T+412 s. Reduce engine mass or add usable propellant without pushing TWR below the healthy range.

## 4. Outcome data model

Add `web/src/sim/outcomes/types.ts` with plain serializable types.

```ts
export type PerformanceMetricId =
  | "liftoff_twr"
  | "ideal_delta_v"
  | "drag_area"
  | "static_margin"
  | "peak_g";

export type MetricBand =
  | "within_range"
  | "marginal"
  | "outside_limit"
  | "context_only"
  | "not_measured";

export interface MetricAssessment {
  id: PerformanceMetricId;
  value: number | null;
  unit: "ratio" | "m/s" | "m^2" | "calibers" | "g";
  band: MetricBand;
  warnThreshold: number | null;
  failThreshold: number | null;
  direction: "minimum" | "maximum" | "context";
  source: "derived" | "measured";
  evidence: string;
}

export type MissionResultClass =
  | "target_orbit"
  | "sustained_orbit"
  | "suborbital"
  | "vehicle_loss"
  | "pad_failure"
  | "invalid_build"
  | "indeterminate";

export type ScenarioId =
  | "firecracker"
  | "overpowered_stack"
  | "fuel_hog"
  | "grinder"
  | "thin_margin"
  | "max_q_overload"
  | "pencil"
  | "control_saturation"
  | "unguided_tumbler"
  | "wind_drift"
  | "everything_sags"
  | "weak_upper_stage";

export type DiagnosisSupport = "confirmed" | "experimental" | "deferred";

export interface ScenarioDiagnosis {
  id: ScenarioId;
  support: DiagnosisSupport;
  severity: "info" | "warning" | "failure";
  title: string;
  summary: string;
  matchedSignals: string[];
  suggestedLevers: string[];
  eventTimeS: number | null;
}

export interface FlightAssessment {
  evaluatorVersion: string;
  missionResult: MissionResultClass;
  rawOutcome: FlightOutcome;
  metrics: Record<PerformanceMetricId, MetricAssessment>;
  primaryDiagnosis: ScenarioDiagnosis | null;
  contributingDiagnoses: ScenarioDiagnosis[];
  unmatchedSignals: string[];
}
```

Keep `FlightOutcome` unchanged during the first implementation. This avoids breaking solver tests, payload handoff behavior, and existing stored summaries while the diagnosis layer is introduced.

## 5. Versioned rules and thresholds

Add `web/src/sim/outcomes/rules.ts`. It owns every evaluator threshold and exports an `OUTCOME_EVALUATOR_VERSION`. Simulation safety constants may remain in `flight.ts`, but the evaluator must import the same values or receive them through a shared `gameRules.ts` module. Never duplicate values in UI copy.

Initial rules from the current plans:

| Signal | Marginal | Outside limit | Notes |
|---|---:|---:|---|
| Liftoff TWR | `< 1.15` | `≤ 1.0` | Minimum threshold |
| Ideal delta-v | `< 9,500 m/s` | `< 9,300 m/s` | Compare ideal rocket-equation delta-v to a requirement that includes losses |
| Peak proper acceleration | `> payload rating` | `> 5.0 g` after throttle authority is exhausted | Maximum threshold; initial fixed payload rating is 5 g |
| Liftoff static margin | calibration required | `< 1 caliber` | Preserve the established simplified game rule; do not describe it as measured control saturation |
| Slenderness | `> 15` | `> 20` | Supporting signal for Pencil, not one of the five scorecard rows |
| Dynamic pressure | `> 31.5 kPa` | `> 45 kPa` | 70% warning and current hard structural rule |
| `q × |AoA|` | calibration required | calibration required | Do not ship a fabricated threshold |

Do not assign a universal low/high band to CdA. Add these supporting context values instead:

- Wet-mass ballistic coefficient: `wetMassKg / dragAreaM2`.
- Slenderness: `totalLengthM / diameterM`.
- Measured drag loss if later instrumented by integrating drag acceleration.

The five-value scorecard still reports raw CdA. Scenario rules may combine it with slenderness, mass, and measured flight loads.

Thresholds such as “high TWR” are not fixed by `FAILURE_MODES.md`. Calibrate them with a parameter sweep before activation. Store the chosen value in the versioned rules file with a comment naming the calibration fixture set.

## 6. Simulation evidence to retain

Add a compact `FlightEvidence` accumulator to `FlightState` and update it on every solver step, regardless of `recordTelemetry`. Do not derive diagnoses by scanning telemetry arrays.

```ts
export interface FlightEvidence {
  stage1PeakG: number;
  stage2PeakG: number;
  minAtmosphericMarginCalibers: number | null;
  minAtmosphericMarginTimeS: number | null;
  maxQAlphaPaRad: number;
  maxQAlphaTimeS: number | null;
  stage2IgnitionAltitudeKm: number | null;
  stage2IgnitionTwr: number | null;
  stage2MinimumTwr: number | null;
  maxAltitudeKm: number;
  propellantExhaustedStage: 1 | 2 | null;
  throttleLimited: boolean;
  minimumThrottleReached: boolean;
}
```

Rules for collection:

- Attribute peak g by active flight phase, not by telemetry index.
- Evaluate static margin only while stage 1 is attached and dynamic pressure exceeds 500 Pa.
- Calculate `q × |AoA|` in pascal-radians. Keep display conversion separate.
- Capture upper-stage TWR at ignition and its minimum during powered stage-2 flight using local gravity and ambient thrust.
- Set `throttleLimited` whenever the 4.5 g cap reduces commanded throttle.
- Set `minimumThrottleReached` when the active engine reaches its permitted minimum throttle.
- Preserve all values when telemetry recording is disabled.
- Include event time for extrema where a player-facing explanation may cite it.

Loss-budget instrumentation is useful but not required for the first evaluator. If added later, integrate drag acceleration and publish the exact definition. Do not infer “gravity loss” as an unexplained remainder and present it as measured fact.

## 7. Scenario rule matrix

Add declarative rules in `web/src/sim/outcomes/scenarios.ts`. Each rule receives the derived rocket, raw flight result, and `FlightEvidence`; it either returns a diagnosis with concrete matched signals or returns `null`.

### 7.1 Supported in the first release

| Scenario | Preview signature | Confirmation after flight | Primary when |
|---|---|---|---|
| Firecracker | Calibrated high TWR and delta-v `< 9.3 km/s` | Stage 2 exhausts and the result is suborbital or `insufficient_orbital_energy` | No earlier structural or acceleration failure occurred |
| Overpowered stack | Predicted minimum-throttle acceleration threatens the 5 g limit | Raw outcome is `acceleration_limit`, minimum throttle was reached, and peak g exceeded 5 | Acceleration was the terminal cause |
| Fuel hog | Delta-v `≥ 9.5 km/s` with TWR `< 1.15` | Raw outcome is `insufficient_liftoff_thrust` | The large fuel load leaves the otherwise energetic design unable to lift off |
| Grinder | TWR from `1.0` to `< 1.15` and delta-v `≥ 9.3 km/s` | Suborbital result or stage-2 exhaustion | It launched, so Fuel Hog did not remain on the pad |
| Thin margin | Delta-v from `9.3` to `< 9.5 km/s` | `insufficient_orbital_energy`, low perigee, or suborbital result | TWR is not also in the Grinder band |
| Max-Q overload | High TWR or high measured `q × |AoA|` | Raw outcome is `dynamic_pressure_limit` | Dynamic pressure is the terminal cause |
| Pencil | Slenderness above 20 with small diameter/CdA | Raw outcome is `slenderness_limit`, or a later calibrated bending-load failure | Slenderness is the terminal cause |
| Everything sags | TWR `< 1.15` and delta-v `< 9.3 km/s` | Pad failure or insufficient orbital energy | Both deficiencies are present; this outranks single-factor Fuel Hog or Thin Margin |

### 7.2 Experimental and deferred scenarios

| Scenario | Initial disposition | Requirement before activation |
|---|---|---|
| Weak upper stage | Experimental; may appear only as a contributing observation | Create repeatable fixtures showing altitude/vertical-speed collapse after stage-2 ignition, then define a rule using stage-2 ignition TWR and trajectory evidence. TWR below 1 alone is insufficient. |
| Control saturation | Deferred | Add an explicit aerodynamic-moment versus gimbal-control-authority model. Static margin alone cannot prove saturation. |
| Unguided tumbler | Deferred and hidden | Add an unguided vehicle mode. The current game always uses active guidance. |
| Wind drift | Deferred | Add crossrange/ground-track error and a calibrated relationship between wind, stability, and guidance response. Drift must not be reported as breakup. |

Deferred rules remain represented in the type union and rule catalog with `enabled: false` plus a reason. They do not appear in a player's debrief and do not count in robustness results until their required physics exists.

## 8. Primary-diagnosis selection

Add `evaluateFlightOutcome()` in `web/src/sim/outcomes/evaluate.ts`. It produces all metric assessments, matches all enabled scenario rules, and selects one primary diagnosis deterministically.

Selection order:

1. Invalid input and timeout remain raw outcomes; do not apply a design nickname.
2. A diagnosis directly confirmed by the terminal `FlightOutcome` outranks an inferred combination.
3. A terminal safety failure outranks a performance shortfall that would have happened later. For example, Max-Q Overload is primary even if the same build also had low delta-v.
4. Among diagnoses tied to the same terminal outcome, a rule requiring more independent matched signals outranks a broader rule.
5. `Everything Sags` outranks its single-factor subsets when both low TWR and low delta-v are present.
6. Event time breaks remaining causal ties: the earlier observed limit crossing wins.
7. A fixed `priority` and then `ScenarioId` provide a stable final tie-breaker. Object iteration order must never affect the result.
8. Successful target or sustained orbits have no failure diagnosis unless an established game rule such as payload acceleration was actually violated. Warnings remain contributing observations.

The evaluator must never change `orbitAchieved`, `targetOrbitAchieved`, orbital elements, or the raw terminal outcome.

In the first release, the existing `aerodynamic_instability` outcome falls back to a plain **Static stability limit** explanation. It is not renamed Control Saturation. Replacing the one-caliber failure rule is part of Step 18 and requires new physics plus recalibration of the existing scenario suite.

## 9. Deterministic explanations

Add `web/src/sim/outcomes/explanations.ts`. Explanations are functions over structured evidence, not free-form strings embedded in rule conditions or React components.

Every primary explanation must contain:

- What happened.
- The measured value and unit.
- The relevant warning or failure threshold.
- The stage and event time when available.
- One or more build levers that can change the value.
- A tradeoff attached to each suggested lever.

Example lever copy:

- “Add a first-stage engine to raise liftoff TWR; this also raises burnout acceleration and may increase max-Q.”
- “Increase body diameter to reduce slenderness; this increases CdA and can increase drag loss.”
- “Add upper-stage propellant to increase ideal delta-v; this also lowers liftoff TWR and lengthens the stack.”
- “Increase fin span to move CP aft; fins add dry mass and should eventually add drag.”

Do not claim that one adjustment guarantees success. Do not recommend changing a value that was already within range unless the explanation states the secondary tradeoff being targeted.

## 10. Integration changes

### Solver and domain

| File | Change |
|---|---|
| `web/src/sim/rules/gameRules.ts` | Centralize current game thresholds shared by simulation and evaluation |
| `web/src/domain/derive.ts` | Add context metrics and any preflight acceleration estimate needed by Overpowered Stack |
| `web/src/sim/ascent/flight.ts` | Accumulate `FlightEvidence`; return it in `FlightResult` |
| `web/src/sim/outcomes/types.ts` | Add metric, diagnosis, and assessment contracts |
| `web/src/sim/outcomes/rules.ts` | Add versioned evaluator thresholds |
| `web/src/sim/outcomes/scenarios.ts` | Implement declarative scenario matchers |
| `web/src/sim/outcomes/evaluate.ts` | Evaluate metrics, collect diagnoses, and choose the primary diagnosis |
| `web/src/sim/outcomes/explanations.ts` | Generate evidence-backed player copy |
| `web/src/sim/outcomes/catalog.ts` | Own each enabled diagnosis's versioned `recommendedExperiment` mapping from diagnosis to editable control, direction, metric, and explanation key |

Call the evaluator once at the end of `runFlight`, after raw orbit classification. Return its `FlightAssessment` beside the existing fields.

### Worker, storage, and analysis

| File | Change |
|---|---|
| `web/src/workers/protocol.ts` | Add `evidence` and `assessment` to `SerializableFlightResult` |
| `web/src/workers/serialize.ts` | Preserve the new plain-data objects across the worker boundary |
| `web/src/persistence/storage.ts` | Store evaluator version, compact assessment summary, baseline lineage, diff classification, mission result, primary diagnosis ID, contributing IDs, and five metric bands |
| `web/src/sim/ascent/robustness.ts` | Keep raw outcome counts and add diagnosis incidence counts plus primary-diagnosis counts |
| `web/src/ui/store.ts` | Persist the new summary without recomputing outcomes in React |

Bump the local run-summary key to `apogee.runs.v2`, or add a safe decoder that upgrades v1 records with `assessment: null`. Store an `assessmentVersion` alongside the model, catalog, and guidance versions. Missing or incompatible assessments must show raw metrics and **Re-evaluate this build**, never a diagnosis calculated under unknown rules.

Run-history writes must return success or failure. If storage is unavailable or full, retain the baseline in memory for the session, state that it will not survive reload, and disable reload-dependent comparison rather than silently losing it.

Robustness output must distinguish:

- Probability of reaching orbit.
- Raw terminal-outcome counts.
- Primary-diagnosis counts, which are mutually exclusive.
- Diagnosis incidence counts, which may overlap.

Only primary-diagnosis counts may be displayed as mutually exclusive categories. Incidence percentages must retain the existing overlap warning.

### UI

| File | Change |
|---|---|
| `web/src/ui/screens/AssemblyScreen.tsx` | Render the five metric bands and threshold help from shared assessment data |
| `web/src/ui/screens/DebriefScreen.tsx` | Replace `OUTCOME_PRESENTATION` with the structured assessment and explanation output |
| `web/src/ui/screens/FlightScreen.tsx` | Optionally mark relevant warning/limit events on the timeline |
| `web/src/ui/components/PerformanceScorecard.tsx` | New reusable five-value scorecard |
| `web/src/ui/components/DiagnosisCard.tsx` | New primary/contributing diagnosis presentation |
| `web/src/ui/components/RunComparison.tsx` | New baseline, edit classification, and before/after measurement comparison |

The UI must not contain its own physics thresholds, diagnosis-to-control mappings, or scenario IDs inferred from strings. A missing, invalid, or disabled assessment falls back to the existing raw-outcome debrief with an explicit diagnosis-unavailable state.

## 11. Implementation sequence

### Step 12 — Freeze the vocabulary and shared game rules

1. Add the outcome types and evaluator version.
2. Move duplicated game thresholds into a dependency-neutral shared module.
3. Define labels and units for all five metrics.
4. Mark unsupported scenario rules disabled with explicit reasons.
5. Add a small decoder for versioned stored assessments.
6. Define the assessment catalog as the shipped source of truth, plus a rule-change log that says whether prior runs remain comparable or require rerun.

**Completion gate:** every outcome, metric band, scenario, threshold, recommended experiment, and compatibility policy has one machine-readable definition and no React dependency.

### Step 13 — Instrument the flight solver

1. Add `FlightEvidence` to the state and result.
2. Record per-stage peak g, minimum atmospheric margin, max `q × |AoA|`, throttle-limit state, and upper-stage ignition evidence.
3. Verify evidence collection with and without telemetry recording.
4. Add event timestamps for relevant extrema and threshold crossings without emitting duplicates.

**Completion gate:** a nominal flight and every existing failure fixture return finite, deterministic evidence in both normal and batch modes.

### Step 14 — Build the pure evaluator

1. Implement five metric assessors.
2. Implement the eight supported scenario matchers.
3. Implement deterministic precedence and fallback to raw outcomes.
4. Generate structured explanations and suggested levers.
5. Return the assessment from `runFlight` without changing the existing raw outcome.

**Completion gate:** the evaluator is a pure function whose output depends only on versioned rules, the derived rocket, raw result, and evidence.

### Step 15 — Calibrate scenario thresholds

1. Add a development-only parameter sweep over valid rocket configurations.
2. Record the distribution of TWR, ideal delta-v, CdA, slenderness, margin, peak g, max-Q, and raw outcomes.
3. Select a “high TWR” boundary that separates the intended Firecracker/Max-Q builds from normal viable builds.
4. Find at least one stable fixture for every supported named scenario.
5. Verify nearby perturbations do not make category selection oscillate due only to floating-point noise.
6. Record calibrated thresholds and fixture names beside the rule definitions.
7. Re-measure every claim in `FAILURE_MODES.md` against the current derivation and solver before it becomes player copy; correct or mark prototype-era claims historical.

**Completion gate:** no active scenario depends on an uncalibrated adjective such as “high,” “large,” “tiny,” or “barely.”

### Step 16 — Carry assessments through workers and persistence

1. Extend worker serialization.
2. Store compact assessment summaries with evaluator versioning.
3. Add diagnosis counts to ascent robustness.
4. Ensure canceled and stale worker results cannot overwrite a newer assessment.
5. Handle legacy stored summaries safely.
6. Preserve an in-memory baseline and visible degraded-persistence state when local storage fails.

**Completion gate:** a normal flight, a telemetry-free batch flight, and a restored saved summary agree on the raw outcome and diagnosis IDs; an unavailable or incompatible assessment degrades to raw-result presentation without losing the current-session baseline.

### Step 17 — Build the scorecard and debrief experience

1. Add the assembly scorecard states without revealing a named scenario.
2. Replace the debrief’s hard-coded outcome map with structured presentation data.
3. Show primary and contributing diagnoses separately.
4. Show measured value, threshold, stage/time, and tradeoff-aware suggestions.
5. Extend robustness results with primary and overlapping diagnosis sections.
6. Include assessment data in downloaded JSON reports and saved-run comparisons.
7. Add **Try one change** from the debrief, return to Assembly with the baseline pinned and suggested control focused, and classify the next run's edit set before choosing causal wording.
8. Include an assessment trace in downloaded JSON: assessment/rule versions, matched evidence and provenance, baseline lineage, edit classification, and persistence/worker degradation state.

**Completion gate:** a player can launch a baseline, identify a relevant lever, make one controlled edit, relaunch, and see an honest before/after explanation. Advanced analysis remains visually and semantically separate from the launch verdict.

### Step 18 — Add physics needed by deferred categories

Treat each item as a separately reviewable feature after the first evaluator ships:

1. Add aerodynamic moment and gimbal-authority modeling, then activate Control Saturation.
2. Decide whether an unguided mode belongs in the product; only then activate Unguided Tumbler.
3. Add crossrange error and wind-response calibration, then activate Wind Drift.
4. Validate Weak Upper Stage against a fixture matrix and promote it from experimental only if it predicts a repeatable observed behavior.

**Completion gate:** a deferred category becomes active only when the simulator measures the causal mechanism named in its explanation.

## 12. Testing plan

### Unit tests

Add `web/src/sim/outcomes/__tests__/metrics.test.ts`:

- Exact boundary cases for TWR at 1.0 and 1.15.
- Exact boundary cases for ideal delta-v at 9,300 and 9,500 m/s.
- Peak-g behavior below, at, and above the payload rating and 5 g limit.
- Static-margin warning behavior for guided mode.
- CdA always remains context-only until combined with supporting evidence.
- Non-finite input produces an explicit invalid assessment rather than NaN output.

Add `web/src/sim/outcomes/__tests__/scenarios.test.ts`:

- One positive and at least two negative cases per active scenario.
- Overlap cases: Everything Sags versus Fuel Hog/Thin Margin; Max-Q Overload versus Firecracker; Grinder versus Thin Margin.
- Stable primary selection regardless of rule-array order.
- Deferred rules never appear in player-facing results.
- Suggestions reference only levers relevant to matched evidence.

### Solver integration tests

Extend `web/src/sim/ascent/__tests__/scenarios.test.ts` with calibrated configurations for:

1. Nominal target orbit with no failure diagnosis.
2. Firecracker.
3. Overpowered Stack.
4. Fuel Hog.
5. Grinder.
6. Thin Margin.
7. Max-Q Overload.
8. Pencil.
9. Everything Sags.

For each fixture, assert the raw `FlightOutcome`, mission result class, primary diagnosis, matched evidence, and relevant measured threshold. Do not assert only presentation text.

Add a paired test proving that `recordTelemetry: true` and `false` produce identical evidence and assessments.

### Serialization and persistence tests

- Worker serialization round-trips the assessment without losing nulls or numeric precision.
- A v1 stored summary loads without throwing and is clearly marked as lacking an assessment.
- A v2 summary retains evaluator, model, catalog, and guidance versions.
- Editing a build invalidates prior analysis as before.

### UI and end-to-end tests

- Assembly shows all five rows with units and honest availability states.
- A target-orbit flight shows the physical result without a fabricated failure diagnosis.
- A multi-factor failure shows one primary diagnosis and at least one contributing diagnosis.
- Evidence and suggestion text use the same threshold values as the evaluator.
- Robustness results distinguish raw outcomes, primary diagnoses, and overlapping incidence.
- Keyboard and narrow-screen layouts preserve the reading order.
- Experiment-loop fixtures: baseline → suggested one-control edit → causal comparison for low liftoff TWR, acceleration limit, and insufficient orbital energy.
- Multi-control edit: comparison shows measured correlation and does not assert a causal recommendation result.
- No-change and incompatible-baseline states do not produce a comparison claim.
- Storage-unavailable state retains current-session comparison and explains that it will not survive reload.
- Missing or mismatched assessment versions fall back to raw metrics and require re-evaluation.
- A full-telemetry and telemetry-free batch run with identical input yield identical assessments; the batch evaluator uses fixed-size evidence and a documented time/memory budget.

## 13. Acceptance criteria

1. Every valid completed flight returns exactly five metric assessments and one `MissionResultClass`.
2. `FlightOutcome`, orbit flags, and orbital elements remain authoritative and unchanged by diagnosis evaluation.
3. Every active named scenario has a calibrated rocket fixture and deterministic positive/negative tests.
4. The evaluator returns at most one primary diagnosis and no duplicate contributing diagnoses.
5. A multi-factor build retains every matched diagnosis instead of discarding all but the first terminal failure.
6. Every primary diagnosis includes measured evidence, a threshold, an event time when available, and at least one tradeoff-aware lever.
7. Telemetry-free robustness runs produce the same diagnosis as full-telemetry runs for identical inputs.
8. Deferred categories never appear in player-facing results until their causal physics is implemented and tested.
9. CdA is never labeled pass/fail from raw area alone.
10. Existing payload handoff and mission analysis continue to depend on actual orbit achievement, not on a named diagnosis.
11. Old local summaries do not crash the app after the storage schema changes.
12. Production build, typecheck, unit tests, and the complete build-to-debrief Playwright flow pass.
13. The browser experiment-loop test passes: reference baseline → evidence and suggested lever → exactly one relevant edit → relaunch → causal comparison; a multi-control control case produces correlation-only language.
14. Saved run reports include enough versioned assessment trace to reproduce a reported diagnosis locally.

## 14. Scope boundaries

Included:

- Evaluation of the five performance values.
- Deterministic scenario matching and precedence.
- Structured evidence and explanations.
- Worker, persistence, robustness, report, and UI integration.
- Calibration fixtures for categories supported by the existing physics.

Deferred:

- Full rigid-body tumbling.
- Flexible-body structural simulation.
- A real gimbal actuator/control-authority model.
- Unguided vehicle mode.
- Crossrange guidance and wind-drift failure logic.
- Mach-dependent drag.
- User-selectable payload classes or g ratings. The initial payload rating remains the established 5 g game rule.

## 15. Delivery gates

| Gate | Required result |
|---|---|
| F — Outcome foundation | Versioned types, thresholds, and flight evidence exist with deterministic tests |
| G — Supported diagnosis | Eight supported scenarios classify calibrated flights without changing raw physics results |
| H — Core experiment loop | Workers, storage, scorecard, debrief, focused rebuild, versioned baseline comparison, robustness, and reports consume the structured assessment |
| I — Extended physics | Deferred categories activate only after their causal mechanisms are simulated and verified |

The first releasable increment is Gate H. It is the completion of the core gameplay loop; Gate E in `IMPLEMENT.MD` is a flyable prototype. Gate I is intentionally separate because labeling control saturation, tumbling, or wind drift without simulating those mechanisms would teach the wrong lesson.
