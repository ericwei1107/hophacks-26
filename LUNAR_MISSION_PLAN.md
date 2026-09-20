# Lunar Mission — Implementation Plan

**Status:** draft for review
**Relationship to existing plans:** this is Amendment A to `OUTCOME_SYSTEM_PLAN.md`. That plan's architecture — flight evidence → pure evaluator → scenario matcher → structured debrief — is kept intact. This document retargets its destination from low Earth orbit to the Moon, adds the trans-lunar phase to the solver, adds the Moon to the renderer, and revises every delta-v threshold. Where the two documents disagree, this one wins; where this one is silent, `OUTCOME_SYSTEM_PLAN.md` still applies.

**Decisions taken before drafting:**

| Question | Decision |
|---|---|
| Mission end state | TLI and arrival at the Moon (flyby or impact). No lunar orbit insertion, no landing. |
| Cruise fidelity | Patched conic, analytic. No new integrator for the coast. |
| Moon rendering | True-radius bodies, compressed range, labelled as compressed. |
| Plan scope | Extend the outcome plan and retarget it; repurpose `sim/orbital/*` rather than delete it. |

---

## 1. The blocking finding: no default build can reach the Moon

**Status: implemented (Step L1, complete).** The numbers below through §1's original analysis are the pre-implementation estimate; the boxed note at the end of this section reports what calibration against the actual solver required.

This has to be settled before any of the rest is worth building.

A trans-lunar mission needs roughly **12.4–12.7 km/s** of ideal rocket-equation delta-v (§3.2 derives it). I evaluated the current mass model in `domain/derive.ts` across the whole configuration space in `CONFIG_RANGES`:

| Build | Ideal delta-v | Verdict |
|---|---:|---|
| `referenceConfig()` — 5 t payload, 3.7 m, 200 t + 60 t, 4 boosters | **10.36 km/s** | 2.1 km/s short |
| Best build anywhere in the slider ranges (500 kg payload, 400 t stage 1, 6 engines) | **13.63 km/s** | reaches it, but only in one corner |
| Best build at the default 5 t payload | **11.70 km/s** | **unreachable** |

So with the Moon as the default destination and no other change, the reference build fails, and no build carrying the default payload can succeed at all. Every flight would diagnose as Firecracker or Thin Margin, and the five performance values would stop teaching anything — the player would have no reachable healthy region to steer toward.

Two remedies were measured. **Raising the tank ceilings does not work:** stage-1 thrust is capped at 9 × 950 kN, so an 800 t stage 1 lifts off at TWR 0.77. Tank ceilings and engine thrust would both have to move, and the result still only reaches ~12.6 km/s.

**The working remedy is a high-Isp upper stage.** Adding a fourth engine to the catalog — a cryogenic vacuum stage at Isp 440 s (RL10/J-2 class, against the current 345 s) — moves the reference build from 10.36 to 11.88 km/s and opens a real design space:

| Design space, 5 t payload, flyable builds only | Reach 12.5 km/s |
|---|---:|
| Current `vacuum` engine (Isp 345 s) | ~0% |
| New cryogenic engine (Isp 440 s) | **~15%** |

Fifteen percent is a good target size: the Moon is reachable by deliberate design and not by accident, which is exactly the lesson the failure-mode catalog exists to teach. Choosing the cryogenic stage becomes the single most consequential build decision, and choosing the old `vacuum` engine becomes a legible, diagnosable mistake — it makes the "Weak upper stage" entry in `FAILURE_MODES.md` a first-class scenario instead of an unverified one.

**Recommended engine seed** (`domain/engines.ts`, bump `CATALOG_VERSION`):

```ts
{
  id: "cryogenic",
  name: "H-1 Cryogenic upper stage (fictional)",
  seaLevelRated: false,
  seaLevelIspS: 120,
  vacuumIspS: 440,
  dryMassKg: 1_800,
  nozzleDiameterM: 2.2,
  minThrottle: 0.15,
  referenceThrustN: 450_000,
  referenceAtSeaLevel: false,
}
```

Thrust is the parameter to calibrate, not Isp. At 450 kN the reference stack ignites stage 2 at TWR ≈ 0.67 and reaches ≈ 4.3 g at stage-2 burnout — inside the 5 g payload rating but close enough that adding propellant pushes a player into Overpowered Stack. At 180 kN (a literal RL10) stage-2 TWR falls to 0.27, which the current guidance coefficients were never tuned for and which would force a guidance recalibration. **Start at 450 kN.**

Do not change the existing `vacuum` engine's numbers. Keeping it intact preserves the Python-parity fixtures, the baseline snapshot, and every existing solver test, and it gives the catalog a deliberately inadequate upper stage to learn from.

> **Implemented, with one correction to the estimate above.** The 450 kN cryogenic seed shipped exactly as specified. But the "12.8–13.0 km/s, pick any TWR/slenderness-healthy candidate" framing in the paragraph this replaces was wrong in a way only flying the actual solver exposed: **the fixed guidance — not propellant capacity or TWR — is the binding constraint on how much delta-v a build can usefully carry.**
>
> Sweeping the design space for builds that both (a) clear a target delta-v and (b) actually fly to `target_orbit` under the existing fixed autopilot (never `sustained_orbit` with an overshot apogee, which is what most "more delta-v" builds produced instead) found a narrow band: only configurations landing at **12.48–12.50 km/s** reliably hit the tight parking corridor. Builds pushed to 12.6+ km/s consistently overshot the ascent-phase apogee cap (`ascentApogeeCapKm = 202`) and landed in `sustained_orbit` with apogee 260–1,200 km instead — the guidance has no apogee-limiting feedback during active vacuum burns (a preexisting gap; `apogeePitchGainDegPerKm` and `apogeePitchBiasMaxDeg` are declared in `guidance.ts` but never read). More engines also didn't help by itself: `stage1EngineCount` above 5 shortens the time the vehicle spends in the dense atmosphere before crossing into unconstrained vacuum-prograde guidance, which is what causes the overshoot, not raw TWR.
>
> **Shipped `referenceConfig()`:** 3.7 m / 5 t payload / 260 t stage-1 propellant / 5 boosters / 70 t cryogenic upper stage — **12,501 m/s** ideal delta-v, liftoff TWR 1.33, static margin 1.84 calibers, slenderness 11.8. It reaches `target_orbit` exactly, deterministically, under the unmodified autopilot.
>
> This also means the §2.2 warn/fail thresholds below need one adjustment: **the effective ceiling for "flies cleanly to a tight parking orbit" is close to the 12.4 km/s floor itself**, not comfortably above it. Practically, this reference build sits in a similar proportional position to the old LEO reference (which cleared its 9.5 km/s warn line by ~9%) only if the warn threshold is read as ~12.5 km/s, not 12.7. Retuning the ascent guidance to add real apogee feedback (closing the `apogeePitchGainDegPerKm` gap) would open this back up in Step L7/L8 — filed as a note there rather than solved now, since it changes ascent behavior for every non-lunar build too and deserves its own review.
>
> Full detail, including the fixture matrix and the specific overshoot mechanism, belongs in a follow-up note once Step L7 (calibration) is reached; this box is the pointer for whoever picks that up.

> **This section is the plan's main open decision, now resolved.** The cryogenic engine shipped and a real reference build clears the requirement. The remaining open question is whether to also fix the ascent guidance's missing apogee feedback (Step L7/L8) so the design space above 12.5 km/s becomes usable, rather than leaving it a guidance-imposed ceiling.

---

## 2. Mission definition

### 2.1 Phases

The flight gains three phases after the existing `CIRCULARIZE`:

```
PAD → ASCENT_1 → BURNOUT_DELAY → SEPARATION → IGNITION_DELAY → ASCENT_2
    → COAST → CIRCULARIZE → PARKING_COAST → TLI_BURN → TRANS_LUNAR → COMPLETE
```

- **`PARKING_COAST`** — unpowered coast in the 180–220 km parking orbit to the trans-lunar injection point. Propagated analytically (§4.1), not integrated.
- **`TLI_BURN`** — the upper stage restarts and burns its remaining propellant toward the transfer. Integrated by the existing RK4 at the fixed 0.05 s step, because this burn is where peak g, propellant exhaustion, and throttle limiting actually happen, and the evaluator must measure them rather than assume them.
- **`TRANS_LUNAR`** — the coast to the Moon, evaluated as a patched conic (§4.2). Not integrated.

The parking orbit stays exactly as it is today. The existing 180–220 km corridor and the `SUSTAINED_PERIGEE_KM` rule keep their current meaning; they become an intermediate milestone rather than the mission.

### 2.2 The delta-v requirement, derived

Stated so the number in the rules file is traceable rather than asserted:

| Term | Value | Source |
|---|---:|---|
| Ideal delta-v to LEO, losses included | 9.3–9.5 km/s | `FAILURE_MODES.md` §"How the numbers connect" |
| Circular velocity at 200 km | 7.789 km/s | `sqrt(μ/r)`, r = 6,571 km |
| Perigee velocity of a transfer ellipse with apogee at 384,400 km | 10.921 km/s | vis-viva, a = 195,486 km |
| **TLI delta-v** | **3.132 km/s** | difference of the two |
| **Total requirement** | **12.43 – 12.63 km/s** | sum |

Thresholds, all game rules, to live in `sim/outcomes/rules.ts`:

| Check | Warn | Fail |
|---|---|---|
| Ideal delta-v (lunar) | below 12.7 km/s | below 12.4 km/s |

Everything else in the `OUTCOME_SYSTEM_PLAN.md` threshold table is unchanged: TWR 1.15/1.0, peak g 5.0, slenderness 15/20, dynamic pressure 31.5/45 kPa. Those are ascent physics and the destination does not touch them.

A minimum-energy transfer takes **≈ 5.0 days** (half the period of that ellipse). Real missions flew ~3 days by spending extra delta-v for a higher-energy transfer. Surplus delta-v therefore buys a shorter trip, which is worth showing in the debrief — it turns leftover propellant into a visible reward instead of a rounding error.

### 2.3 Arrival, and what counts as success

The autopilot chooses the TLI epoch that phases correctly for the energy the vehicle actually has. This is what a real mission planner does — the launch window is selected to match the achievable transfer — and it keeps failure attribution on the five player-facing values instead of inventing a phasing puzzle the player has no control over.

What remains variable is arrival *quality*, driven by insertion-state dispersion, which the robustness system already perturbs. Classification at the lunar sphere of influence (66,100 km):

| Arrival | Rule |
|---|---|
| `lunar_arrival` | periselene above the surface and inside the aim corridor |
| `lunar_impact` | periselene radius below 1,737.4 km |
| `lunar_miss` | closest approach outside the sphere of influence |
| `tli_shortfall` | insufficient remaining delta-v to raise apogee to the lunar distance |
| `earth_escape` | excess energy leaves the vehicle unbound with no lunar encounter |

The aim corridor is a game rule to calibrate in Step L7; start at 100–10,000 km periselene.

---

## 3. What is simulated and what is asserted

`FAILURE_MODES.md` and `OUTCOME_SYSTEM_PLAN.md` are both strict that the game must not name a mechanism it does not model. That rule carries over verbatim.

| Quantity | Treatment |
|---|---|
| Ascent through cutoff | Integrated, unchanged |
| Parking coast | Analytic Kepler propagation — exact for a two-body coast, no fidelity lost |
| TLI burn | Integrated, RK4, fixed 0.05 s step |
| Trans-lunar coast | Patched conic: Earth two-body to the lunar sphere of influence, then Moon two-body inside it |
| Lunar gravity during the Earth leg | Not modelled — the patched-conic approximation. Say so in the debrief |
| Solar perturbation, lunar eccentricity and inclination | Not modelled. Moon on a circular, coplanar ephemeris |
| Mid-course correction | Not modelled. No TCM budget is charged or offered |

The Moon's orbit being circular and coplanar is the largest simplification. It is acceptable for a design game and it must be stated in the debrief copy, not buried.

---

## 4. New simulation modules

### 4.1 `sim/physics/kepler.ts` — **implemented**

`propagateKepler(position, velocity, dtS, mu?) → {position, velocity}`, universal-variable formulation (Curtis §3.5) with Stumpff functions and Newton iteration on the universal anomaly. Handles a negative `dtS` (backward propagation) for free, which the round-trip test exercises directly.

Tested: dt=0 identity, full-period circular round-trip, energy/angular-momentum conservation over an elliptical coast, forward-then-backward round-trip, and agreement with a hand-rolled RK4 integration over a 600 s drag-free vacuum coast (within 1 m position, 1 mm/s velocity). 5 tests, `sim/physics/__tests__/kepler.test.ts`.

### 4.2 `sim/lunar/moon.ts` — **implemented**

Constants exactly as specified (`MU_MOON`, `MOON_RADIUS_M`, `MOON_ORBIT_RADIUS_M`, `MOON_SOI_RADIUS_M`, `MOON_SIDEREAL_PERIOD_DAYS`), plus the exported `MOON_ANGULAR_RATE_RAD_S` that `coast.ts` shares rather than re-deriving. `moonPositionEci`/`moonVelocityEci`/`moonState(tSinceLiftoffS, epochPhaseRad)` give the circular, equatorial ephemeris. `moonEpochPhaseRad(seed)` is a stable hash for a *default* epoch — but see §4.3.5 below: the actual epoch used per flight is **not** this seed hash, it's phased to guarantee a geometrically correct encounter (a deliberate refinement over the original sketch). 6 tests, `sim/lunar/__tests__/moon.test.ts`.

### 4.3 `sim/lunar/transfer.ts` — **implemented, API differs from the original sketch**

Two functions instead of one, because the original single `TransferResult`-producing function conflated "what does a nominal transfer require" (needed *before* the burn, to drive the TLI cutoff condition) with "what actually happened" (needed *after*, to classify the result) — the sketch's shape only supported the second.

```ts
export function transferRequirement(parkingRadiusM, targetApogeeM?): { deltaVRequiredMs, timeOfFlightS }
export function evaluateTransfer(input: {
  parkingRadiusM: number;
  deltaVAvailableMs: number;
  deltaVRequiredMs: number;
  apogeeAfterBurnM: number;
  soiEntryRelativePosition: Vec3 | null;
  soiEntryRelativeVelocity: Vec3 | null;
}): TransferResult   // { deltaVAvailableMs, deltaVRequiredMs, achievedApogeeM, timeOfFlightS, periseleneRadiusM, classification }
export function estimatePeriselene(relativePosition, relativeVelocity): number
```

`transferRequirement(EARTH_RADIUS + 200_000)` returns 3,132 m/s / 5.02 days, matching the §2.2 hand arithmetic to within the test's tolerance. `evaluateTransfer` classifies via three ordered checks — a >2% delta-v shortfall is `tli_shortfall`; wildly excess apogee (>3 SOI radii past the Moon's orbit) is `earth_escape`; otherwise it either has no SOI encounter (`lunar_miss`) or classifies the encounter by periselene against the Moon's radius and the aim corridor (`lunar_impact` / `lunar_arrival` / `lunar_miss`). 9 tests, `sim/lunar/__tests__/transfer.test.ts`.

### 4.3.5 `sim/lunar/coast.ts` — **new module, not in the original plan**

The plan didn't specify how a post-burn Earth-centered state actually gets tested against a *moving* Moon for SOI entry — that turned out to need its own module.

- `findSoiEncounter(vehiclePositionEci, vehicleVelocityEci, ignitionAbsoluteTimeS, moonEpochPhaseRad)`: coarse-steps the vehicle forward via `propagateKepler` (30 min cadence, up to 10 days), checking distance to the Moon's ephemeris position at each candidate time; on a crossing, bisects (40 iterations) to refine. Returns `null` if the vehicle never enters the SOI — this is what backs `lunar_miss` and `tli_shortfall` for badly-aimed or underpowered transfers.
- `phasedMoonEpoch(ignitionPositionEci, ignitionAbsoluteTimeS, nominalTimeOfFlightS)`: implements the "autopilot chooses the TLI epoch that phases correctly" simplification from §2.3 concretely. It places the Moon, at the nominal transfer's time of flight, along the transfer orbit's apogee direction (diametrically opposite the injection point — standard Hohmann geometry). A build with the *intended* delta-v and burn geometry gets a genuine encounter; deviations in achieved energy or direction are what produce a miss, impact, or arrival spread. This is the piece that makes the Moon's position per-flight, not merely per-seed as the original moon.ts sketch implied.

Verified end-to-end: a nominal-energy, correctly-phased burn reaches the SOI within a day of the predicted time of flight and at a distance matching `MOON_SOI_RADIUS_M`; a 90°-mis-phased epoch produces no encounter; a 50%-shortfall burn produces no encounter (it doesn't reach lunar distance at all). 4 tests, `sim/lunar/__tests__/coast.test.ts`. A manual end-to-end probe (ignition → phased epoch → burn → SOI search → `evaluateTransfer`) confirms the full pipeline composes: a perfectly-aimed nominal burn lands a periselene of ~3 km — i.e., a near-direct hit, which is physically correct for zero targeting error and flags that the game will need *some* source of burn/aim dispersion (from off-nominal builds, not from added noise) to produce the intended spread of arrival/impact/miss outcomes across different player builds.

### 4.4 Changes to `sim/ascent/flight.ts`

- Add the three phases and their events (`parking_orbit`, `tli_ignition`, `tli_cutoff`, `soi_entry`, `periselene`).
- Extend `FlightEvidence` (from `OUTCOME_SYSTEM_PLAN.md` §6) with `tliIgnitionMassKg`, `tliBurnDurationS`, `tliPeakG`, `propellantAtTliKg`, `deltaVSpentOnTliMs`.
- Extend `FlightOutcome` with the five arrival values from §2.3. `OUTCOME_SYSTEM_PLAN.md` deliberately froze `FlightOutcome` — that freeze is lifted here, because the mission genuinely ends somewhere new, and a `MissionResultClass` layer alone cannot represent "arrived at the Moon". Every existing member keeps its meaning.
- `MAX_SIM_TIME_S` stays at 3,600 s for integrated time. Coast and cruise time are tracked separately and are not bounded by it.

### 4.5 `sim/orbital/*` — the consolation mission

The ported Python satellite model is not deleted. It becomes the **parking-orbit fallback**: a flight that reaches a sustained orbit but cannot complete TLI still has a spacecraft, and the existing three-year survival analysis is exactly the right report for it. This preserves `parity.test.ts` and the Python fixtures, and it gives `tli_shortfall` a meaningful outcome rather than a dead end.

For the lunar path, `sim/lunar/report.ts` produces the arrival report instead: periselene, arrival speed, trip time, propellant margin, and the transfer geometry.

---

## 5. Retargeting the failure modes

`FAILURE_MODES.md` Tables 1 and 3 are ascent physics and need no change. Table 2 changes only where the destination is part of the signature.

| Scenario | Change |
|---|---|
| Firecracker | Threshold moves to 12.4 km/s. Now much easier to trigger — calibration of "high TWR" matters far more than it did |
| Thin margin | **Becomes the signature lunar failure.** 12.4–12.7 km/s: reaches the parking orbit, starts TLI, runs dry partway through. "You made orbit but not the Moon" is the most legible lesson in the catalog |
| Fuel hog, Grinder, Everything sags | Mechanism unchanged; delta-v threshold retargeted |
| Max-Q overload, Pencil, Overpowered stack | Unchanged. Pure ascent physics |
| Weak upper stage | **Promoted from Unverified to supported.** The upper stage must now circularize *and* inject. Choosing the 345 s `vacuum` engine over the cryogenic one is a repeatable, measurable, diagnosable failure with a clear lever |
| Control saturation, Unguided tumbler, Wind drift | Still deferred, unchanged, for the reasons `OUTCOME_SYSTEM_PLAN.md` §7.2 gives |

Two new scenarios, both real:

| Scenario | Signature | Mechanism |
|---|---|---|
| **Stranded in parking orbit** | Sustained orbit achieved, remaining stage-2 delta-v below the TLI requirement | Confirmed by `tli_shortfall`. The consolation satellite mission runs |
| **Overshoot** | TLI delta-v applied beyond the transfer requirement | Confirmed by `earth_escape`. Surplus energy past the lunar distance leaves the vehicle unbound |

Do **not** add a scenario for arrival dispersion or trajectory correction. Neither mechanism is modelled.

---

## 6. Rendering the Moon

### 6.1 Range compression

The renderer contract (`protocol/types.ts`) forbids sending Earth-centered coordinates — Unity's 32-bit floats lose metre precision at orbital scale. The Moon has to arrive the same way everything else does: as a vector in the rocket's local frame.

At true scale the Moon is a 0.5° disc — correct, but invisible during ascent and undramatic during cruise. The chosen approach is **true body radii, compressed range**, applied as a single monotone map of radial distance from Earth's center:

```
f(r) = r                                  for r ≤ r₀   (ascent, unchanged)
f(r) = r₀ + (r − r₀) · k                  for r ≥ r₁   (far field, k ≈ 1/8)
smooth blend between r₀ and r₁
```

One map applied to *everything* in the far field — the Moon, the vehicle, the trail, the transfer arc — so the geometry stays internally consistent and only the scale bar changes. Bodies keep true radii. Below r₀ (roughly 2,000 km) nothing changes, so the ascent view is untouched.

The view must be labelled. "Range compressed 8×" on the cruise view, always visible, never a tooltip.

### 6.2 Contract and renderer changes

- `protocol/types.ts`: add `moon: { posLocal: Vec3; quat: Quat; radiusM: number } | null` to `RenderFrame`, and `rangeCompression: number`. Add both to `nonFiniteFields` validation.
- **`unityContract.test.ts` pins `Object.keys(frame)` against the C# `RenderFrameDto`** — the Unity DTO in `unity/RocketRenderer` must be updated in the same change or that test fails. The field is nullable so the Unity renderer may ignore it initially.
- `protocol/renderFrame.ts`: compute the Moon's local vector from the ephemeris, apply the compression map.
- `ui/components/Moon.tsx`: 1,737.4 km sphere, procedural canvas albedo in the style of `Earth.tsx` (maria, crater speckle, no atmosphere shell, no clouds), lit by the existing `SUN_DIRECTION_ECI`.
- `ui/components/FlightScene.tsx`: add the Moon, and a cruise camera mode that frames Earth and Moon together.
- `ui/components/Trajectory.tsx`: draw the transfer arc through the same compression map.

---

## 7. Implementation sequence

Each step ends in a state where the app builds, typechecks, and the suite passes.

### Step L1 — Reachability (blocking) — **done**
Added the cryogenic engine, bumped `CATALOG_VERSION` to 1.1.0, swept the design space, and committed a new `referenceConfig()` (see the boxed note in §1). Along the way, found and fixed a real pre-existing solver bug: `stepFlight` integrated newly-detached stages by the full requested `dt` instead of the remainder after their mid-step separation, double-counting pre-separation drift — masked by the old reference build's specific timing, exposed by the new one. Fixed by moving detached-stage integration inside the event-splitting loop. All existing scenario-test overrides that assumed the old 4-engine/200t-propellant reference had to be re-derived against the new reference's neighborhood (they encoded specific failure geometries — max-Q overload, low-altitude staging — that shift when the baseline TWR and mass change); each was re-probed empirically against the actual solver rather than guessed. `parity.test.ts` and 199 other tests pass; typecheck is clean.

**Gate met:** reference build ideal delta-v (12,501 m/s) clears the lunar floor (12,400 m/s) and reaches `target_orbit` deterministically under the unmodified guidance. The ~15% reachable-fraction target from the original estimate did not hold once flight-worthiness (not just delta-v) was the filter — see the §1 box; this is now a follow-up for Step L7, not a blocker.

### Step L2 — Lunar constants and transfer mathematics — **done**
`sim/lunar/moon.ts`, `sim/lunar/transfer.ts`, and `sim/lunar/coast.ts` (added — see §4.3.5) as pure modules with no solver dependency.

**Gate met:** `transferRequirement` from a 200 km circular orbit returns 3,132 m/s and a 5.02-day time of flight, matching §2.2. 19 tests across the three lunar-math modules.

### Step L3 — Kepler coast — **done**
`sim/physics/kepler.ts`, verified against a hand-rolled RK4 integration in vacuum.

**Gate met:** a 600 s drag-free propagation agrees with RK4 to within 1 m / 1 mm/s; a full-period round trip returns to the start to sub-millimeter precision.

### Step L4 — Solver phases — **done**
Added `PARKING_COAST`, `TLI_BURN`, `TRANS_LUNAR` to `FlightPhase`; five new `FlightOutcome` values (`lunar_arrival`, `lunar_impact`, `lunar_miss`, `tli_shortfall`, `earth_escape`); a `terminalOutcomeOverride` field on `FlightState` so the runFlight tail can classify a lunar terminal state without misreading the post-TLI trajectory as a parking orbit; and `lunarTransfer: TransferResult | null` on `FlightResult`. `finalizeOrbit` now routes any orbit with perigee ≥ `SUSTAINED_PERIGEE_KM` into `PARKING_COAST` instead of terminating — `low_perigee` is the only orbit-achieving outcome that still ends the flight directly, since it never counted as sustained.

This landed after the concurrent session's `sim/outcomes/evaluate.ts` work settled in the same file; every edit was made against a freshly re-read `flight.ts`, not anything cached from earlier in this session, and `Partial<Record<FlightOutcome, ...>>` usage throughout the codebase (confirmed via search before editing) meant the new outcome/phase values needed no exhaustiveness updates elsewhere — except one: `ui/telemetry.ts` has a hardcoded, positionally-matched `PHASE_NAMES` array reading the same `PHASE_INDEX` enumeration. Renumbering `COMPLETE`/`FAILED` to make room for the new phases would have silently mislabeled phases in that file. Fixed by keeping `COMPLETE: 8, FAILED: 9` exactly where they were and appending the three new phases at indices 10–12 instead of renumbering.

**Two bugs found and fixed while integrating, both real, both pre-existing-adjacent:**

1. **Cutoff-targeting bias.** The TLI burn's cutoff condition was originally `norm(velocity) - tliIgnitionSpeedMs >= deltaVRequiredMs` — but `deltaVRequiredMs` (from `transferRequirement`) is derived assuming departure from *local circular velocity*, while the actual parking orbit has small residual eccentricity (~0.24% for the reference build), so `tliIgnitionSpeedMs` sits a few m/s off circular. Adding the idealized delta-v onto the real (non-circular) ignition speed baked that offset into the cutoff, biasing the achieved apogee. Fixed by computing an absolute `tliTargetSpeedMs = localCircularVelocity(ignitionRadius) + deltaVRequiredMs` once at ignition and cutting off on that instead of a relative delta-v.
2. **Wrong epoch-phasing reference point.** `phasedMoonEpoch` (which places the Moon so a nominal burn actually encounters it) was first computed at *ignition*, using the pre-burn position. The reference build's TLI burn takes ~65–70 s, during which the vehicle sweeps several degrees around its orbit — enough to shift the true transfer orbit's periapsis direction by an angle that translates to tens of thousands of km of error at the Moon's distance (a first attempt missed the SOI by ~362,000 km; even after fix 1, residual epoch error alone would have caused a clean miss). Fixed by computing the phasing from the *post-burn* state instead, which is close to the actual periapsis for a short tangential burn — the correct patched-conic approximation.

**Calibration finding, not a bug:** even with both fixes, a burn that spends exactly its required delta-v still overshoots the target apogee by ~7% (measured: 410,958 km achieved vs. 384,400 km target), because the burn takes real time rather than being impulsive — the vehicle's radius rises measurably while still thrusting, and vis-viva's energy term is sensitive to that. This is honest simplified-physics behavior, not a solver defect, so the periselene aim corridor (`PERISELENE_AIM_MAX_ALT_M`) was widened from 10,000 km to 20,000 km altitude to absorb it rather than chasing an artificially tight burn-cutoff scheme. This value should be revisited in Step L7 once more builds have been flown through it.

New test file `sim/ascent/__tests__/lunar.test.ts` (7 tests) covers the full Step L4 gate plus phase ordering, telemetry-parity, propellant non-negativity, and parking-vs-final-elements separation. **206 tests pass project-wide, typecheck clean.**

**Gate met:** the reference build reaches `lunar_arrival` deterministically; evidence is identical with `recordTelemetry` true and false; a build with the old `vacuum` engine reaches `tli_shortfall`.

### Step L5 — Evaluator retarget — **done**
Retargeted `sim/outcomes/evaluate.ts`'s `ideal_delta_v` metric from the LEO thresholds (9,300/9,500) to the lunar ones (12,400/12,700), and added diagnoses for the two new scenarios: `tli_shortfall` → `weak_upper_stage` ("STRANDED IN PARKING ORBIT", recommending the cryogenic engine over `vacuum` — the promotion `FAILURE_MODES.md` called for), and `earth_escape` → `overshoot` ("TRANS-LUNAR OVERSHOOT", recommending less stage-2 propellant). `lunar_arrival`/`lunar_impact`/`lunar_miss` deliberately have no diagnosis entry: their cause is burn-aim dispersion, which this game doesn't model or let a player control, so recommending a build change would fabricate a lever that doesn't exist — the same restraint `OUTCOME_SYSTEM_PLAN.md` applies elsewhere. `ASSESSMENT_VERSION` bumped to `"2"`. No `MissionResultClass` extension: the concurrent session's actual evaluator (a slimmer v1 than `OUTCOME_SYSTEM_PLAN.md`'s original sketch) never introduced that type, so there was nothing to extend.

**Gate met:** 8 tests in `sim/outcomes/__tests__/evaluate.test.ts`, including one negative-diagnosis test per unmodelled outcome and one positive test per new scenario.

### Step L6 — Moon in the renderer — **done, narrower than originally scoped**
Added `moon: {posLocal, quat, radiusM}` and `rangeCompressionFactor` to `RenderFrame`, computed in `protocol/renderFrame.ts` from the seed-derived ephemeris (`moonEpochPhaseRad`) and a two-segment linear compression (`NEAR_FIELD_KM = 2,000`, `FAR_FIELD_FACTOR = 1/8`) — since the Moon's true distance is always ~384,400 km, compression is in practice always active; bodies keep true radii, only distance compresses. `PlaybackState` gained a required `seed` field to drive this (four call sites updated: `PlaybackController` and three test files). `ui/components/Moon.tsx` is a plain procedurally-textured sphere (maria + crater speckle, no atmosphere shell, no clouds, matching `Earth.tsx`'s style) wired into `FlightScene.tsx` alongside `Earth`, positioned every frame the same way `earthRef` already is.

**No Unity DTO change was needed.** `toUnityFrame` (`UnityLaunchRenderer.ts`) already selectively maps `RenderFrame` fields into the C# DTO shape by explicit object literal — it already omits `inertialQuat` ("Unity ignores it") — so the new `moon`/`rangeCompressionFactor` fields are simply left out the same way, and `unityContract.test.ts` (which diffs `toUnityFrame`'s output against the actual C# `RenderFrameDto` fields) passes with zero C# changes.

**Descoped from the original plan, and why:**
- **No cruise camera mode or transfer-arc trail.** The trans-lunar coast is resolved analytically in a single step (`resolveTliBurnout`) with no telemetry recorded for it — there is currently no sequence of samples to fly a camera through or draw a trail from. Building one would mean adding coast telemetry sampling first, which is new scope beyond the L6 sketch.
- **No compression label overlay.** `rangeCompressionFactor` is on every frame and any UI layer can read it; the on-screen "range compressed 8×" text itself wasn't added in this pass.
- **The Moon is visible from launch, always at true radius, and range-compressed by construction** — the core L6 promise ("never invisible") is met.
- **Not visually verified in a browser this session** — the Chrome extension bridge wasn't connected. Confirmed instead by: 26 dedicated tests (position sanity, seed-determinism, non-finite protection, compression bounds), a clean production build, and the unchanged Unity contract test. Worth a visual pass before shipping.

### Step L7 — Calibration — **done, with one honest negative finding**
The periselene aim corridor was recalibrated against the real reference build in Step L4 (100 km–20,000 km altitude, not the original 100 km–10,000 km guess) after discovering burns take real time and overshoot apogee by ~7% even at exact target delta-v. A further sweep around the reference build (payload, diameter, fin span, stage-1 propellant) found the natural periselene spread for near-nominal builds sits at 8,000–20,000 km altitude, all landing `lunar_arrival` — confirming the corridor is now sized to the actual dispersion, not guessed. Sweeping `payloadWetMassKg` also found the natural, continuous boundary between `tli_shortfall` and `lunar_miss` (5,800 kg → `lunar_miss`, a ~1.25% delta-v shortfall that doesn't trip the 2% `tli_shortfall` tolerance but still misses the SOI; 5,900 kg → `tli_shortfall` outright) — now a regression fixture in `lunar.test.ts`.

**Finding: `earth_escape` is not reachable through normal play under the current TLI cutoff design, and that's correct, not a bug.** The cutoff (`findStepHorizon`'s `tli_delta_v_cutoff`) self-targets `tliTargetSpeedMs` precisely and stops the instant it's reached, so a flight can undershoot (`tli_shortfall`, `lunar_miss`) but structurally cannot overshoot into `earth_escape` territory (apogee > lunar distance + 3 SOI radii) — every build tried (including deliberately excess-capability ones) either landed `lunar_arrival`/`lunar_miss` or failed earlier in ascent. `earth_escape` remains correctly defined and unit-tested (`evaluate.test.ts`, `transfer.test.ts`) for when the mechanism that could trigger it exists — same treatment `OUTCOME_SYSTEM_PLAN.md` gives `Control saturation`/`Unguided tumbler`: modeled and evaluated correctly, not force-fit into an artificial fixture. Similarly, no full-flight `lunar_impact` fixture was found in the time available (it needs a near-dead-center aim tighter than the natural spread produced) — it stays unit-tested only. `lunar_impact` unreachability was NOT verified as thoroughly as `earth_escape`'s; a longer sweep might find it.

**Gate met, with the above caveat:** every active scenario has a numeric threshold traceable to a real fixture, not a placeholder adjective, and the two exceptions are honestly disclosed rather than papered over with an artificial test.

### Step L8 — Carry-through and debrief — **done**
`SerializableFlightResult` (`workers/protocol.ts`) gained `parkingElements` and `lunarTransfer`; `serializeFlightResult` populates both. Found and fixed a real bug while wiring this through: `ui/store.ts`'s `RunSummary` construction, `persistence/report.ts`'s downloaded JSON, and `ui/screens/DebriefScreen.tsx`'s header/payload-handoff were all reading `flight.finalElements` for "the orbit reached" — which, for any lunar-outcome flight, is the trans-lunar trajectory (400,000+ km apogee), not the parking orbit. All three now read `parkingElements` (falling back to `finalElements` only for flights that never attempted TLI). `storage.ts`'s `RunSummary` gained an optional `lunarTransfer` field — optional so existing saved records don't need a migration. `DebriefScreen.tsx` gained a "Trans-lunar injection" section showing classification, delta-v spent vs. required, achieved apogee, time of flight, and periselene altitude when present, with per-classification explanatory copy and an explicit note that the Earth-Moon coast is analytic and doesn't model the Moon's own gravity on the way out. `robustness.ts`'s internal perigee-percentile stat was deliberately left reading `finalElements` — a tangential TLI burn barely moves perigee (confirmed: 200.006 km → 210.42 km in the reference flight), so the staleness there is real but minor, and it isn't shown in the UI.

**Gate met:** `lunar.test.ts`'s `recordTelemetry` parity test and the payload-handoff/store tests confirm a lunar arrival, a `tli_shortfall`, and the parking-orbit-sourced summary all agree; 217 tests pass project-wide, typecheck and production build are clean.

---

## 8. Testing

Beyond the matrix already in `OUTCOME_SYSTEM_PLAN.md` §12:

- **Transfer mathematics:** hand-computed Hohmann values; boundary cases at exactly the SOI radius and exactly the lunar surface radius; non-finite inputs produce an explicit invalid result rather than NaN.
- **Kepler propagation:** agreement with RK4 in vacuum; full-period round trip; a near-parabolic case.
- **Phase transitions:** propellant never goes negative across `TLI_BURN`; the burn ends on its exact cutoff boundary as the existing events do.
- **Evidence parity:** telemetry-on and telemetry-off runs produce identical evidence and assessment, now across the coast and TLI burn too.
- **Contract:** the Unity DTO and `RenderFrame` keys stay in lockstep.
- **Visual:** the compression label is present whenever compression is active; no frame containing a non-finite Moon vector is ever sent.
- **End to end:** build → launch → arrival debrief, and build → launch → `tli_shortfall` → satellite mission analysis.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| **The cryogenic engine is rejected and the Moon stays unreachable** | Blocking. Resolve at Step L1 before anything else is built. The fallback is a nearer destination, not an impossible requirement |
| Guidance was tuned for a 930 kN upper stage; a 450 kN cryogenic stage changes the circularization profile | Calibrate thrust in Step L1, before the guidance coefficients are touched. Retune only if stage-2 ignition TWR leaves the 0.6–1.5 band |
| Telemetry memory across a multi-day cruise | Coast is analytic and sampled at 10 s; cruise geometry is a conic, not a sample array |
| Monte Carlo cost with a longer mission | The added phases are analytic apart from the TLI burn, which is a few minutes of integration. Measure in Step L7 against the current robustness runtime |
| The 15% reachable fraction turns out to feel punishing in play | It is one number in the rules file. Tune the requirement or the engine, not the physics |
| Patched-conic arrival is sensitive near the SOI boundary | Classify `lunar_miss` with a margin band rather than an exact radius test, and never report a periselene the approximation cannot support |

---

## 10. Scope boundaries

**Included:** the cryogenic engine and reachability fix, the three new flight phases, patched-conic transfer and arrival, retargeted thresholds and two new scenarios, the Moon in the three.js renderer with labelled range compression, worker and storage carry-through, and the arrival debrief.

**Deferred:** lunar orbit insertion, powered descent and landing, mid-course corrections, free-return geometry, lunar eccentricity and inclination, solar perturbation, n-body integration of the cruise, the Unity Moon implementation beyond a nullable DTO field, and every scenario `OUTCOME_SYSTEM_PLAN.md` §7.2 already defers.
