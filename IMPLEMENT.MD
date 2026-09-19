# Rocket Design Game — Technical Implementation Plan

## 1. Product and architecture

Build a browser-based teaching game with the loop:

**Assemble → inspect predicted performance → launch under autopilot → diagnose the outcome → improve the build.**

After a successful launch, players can analyze whether their payload survives a longer orbital mission. This mode will integrate the existing spacecraft simulation, including stationkeeping, collision avoidance, disposal, weather uncertainty, Monte Carlo analysis, and parameter sensitivity.

### Decisions established

- Browser-only runtime; no Python server or required installation.
- Vite, TypeScript, React, React Three Fiber, and Three.js.
- Custom numerical flight solver; no rigid-body engine in the initial implementation.
- Fixed autopilot with an automatic **4.5 g throttle cap** and a **5 g failure limit**.
- Static stability-margin checks rather than simulated aerodynamic tumbling.
- Nominal launch near the equator, due east, targeting approximately 200 km.
- Optional orbital analysis evaluates the **actual launched payload**.
- Full phased delivery, with a playable game before advanced effects and robustness tools.
- The documented PyBullet results are approximate calibration targets; its source is unavailable.
- Implementation takes place in Cursor, following the process requirement in `MAIN_PLAN.md`.

### Separation of responsibilities

| Subsystem | Responsibility |
|---|---|
| Domain model | Rocket configuration, engine catalog, geometry, mass accounting, validation |
| Shared physics | Constants, propulsion equations, atmosphere, orbital mechanics |
| Ascent simulation | Integration, guidance, staging, failure detection, telemetry |
| Orbital mission analysis | Port of the existing spacecraft simulation |
| Analysis workers | Flight runs, Monte Carlo batches, sensitivity analysis |
| Presentation | Builder, 3D scenes, cameras, telemetry, charts, debrief |
| Persistence | Local builds, settings, versioned run summaries |

Physics must not depend on React, Three.js, the DOM, or network access. Rendering consumes simulation results; it never determines outcomes.

Use React 19 with React Three Fiber 9 and pin compatible dependency versions in the lockfile. These major versions are explicitly paired by the [React Three Fiber project](https://github.com/pmndrs/react-three-fiber).

## 2. Preserve and integrate the existing implementation

### Preserve behavior before improving it

Keep the Python modules as executable reference implementations. Add browser equivalents with a documented mapping:

| Existing logic | Integration |
|---|---|
| `MissionConstraints`, `SpacecraftMission`, validation | Port the existing mission types and validators; add separate rocket-build types |
| `SpaceWeather` and NOAA fetching | Preserve weather fields and validation; add a browser fetch adapter and recorded snapshots |
| Rocket equation and propellant estimates | Shared propulsion utilities used by both ascent and orbital analysis |
| Orbital velocity and atmospheric-relative velocity | Preserve scalar helpers; add vector equivalents for ascent |
| Thermospheric density and drag | Preserve for orbital analysis and the upper-atmosphere portion of ascent |
| Stationkeeping, collision avoidance, insertion, disposal | Preserve all four orbital delta-v budget components |
| Failure reasons and baseline results | Preserve machine-readable codes and expose explanations in the interface |
| Monte Carlo and sensitivity analysis | Port the algorithms and extend the runner to accept ascent simulations |

The new ascent solver is necessary because the repository currently models orbital operations rather than launch trajectories. It should be added alongside the existing algorithms.

### Correct known problems explicitly

First establish reference fixtures, then make numerical corrections in separately reviewable changes:

- Declare the Python dependencies and remove the unconditional dependency on the missing `insights` module. Provide deterministic explanations without requiring an LLM.
- Reject non-finite values and invalid physical inputs before calculation.
- Require positive Monte Carlo and sensitivity run counts.
- Stop orbital decay at the reentry boundary and use a shortened final timestep; do not produce negative-altitude results.
- Distinguish **minimum starting propellant required** from **propellant actually consumed**. The existing exponential formula calculates the former; subtracting it from the loaded fuel does not generally calculate actual remaining fuel.
- Preserve the minimum-required-fuel calculation, add actual fuel consumption, and apply the reserve check to the corrected remaining fuel.
- Document that the existing unpowered-decay fallback approximates a mission without stationkeeping; it does not predict the exact moment propulsion runs out.

Maintain fixtures for both preserved behavior and intentional corrections. Do not silently change formulas while translating languages.

### Keep launch and orbital mission rules separate

The existing 220 km operating floor and 400–600 km input range belong to the original mission model. They must not automatically invalidate the game’s approximately 200 km launch.

Introduce explicit mission-rule parameters:

- Legacy Python/reference defaults remain unchanged.
- Game payload analysis uses a 150 km operating floor and a 120 km reentry boundary.
- The original 10% propulsion reserve remains an internal mission-analysis rule.
- Lifespan remains absent from the rocket builder; the optional payload analysis uses a fixed three-year mission.

## 3. Step-by-step implementation

### Step 1 — Establish the reference and project foundation

1. Add Python tests and a fixture exporter around the current simulation.
2. Record representative passing, marginal, and failing missions with fixed weather.
3. Export baseline results, individual delta-v components, failure codes, and explicit perturbed inputs.
4. Scaffold the TypeScript application with strict type checking, linting, Vitest, and Playwright.
5. Establish separate domain, simulation, worker, and presentation modules.
6. Add a model-version identifier to saved configurations and results.

Use the existing Earth radius, gravitational parameter, and standard gravity throughout. Convert kilometers, tonnes, years, and degrees only at explicit boundaries; the ascent solver uses meters, kilograms, seconds, and radians.

**Completion gate:** the browser-side mission implementation matches Python fixtures before the new ascent physics is introduced.

### Step 2 — Specify the build-to-parameters function

Implement one pure function:

`deriveRocket(config, catalog) → DerivedRocket`

Every displayed measurement and procedural mesh must come from this output.

The player configures only:

| Control | Initial range/default |
|---|---|
| Payload wet mass | 0.5–20 t; default 5 t |
| Fairing/body diameter | 1–5 m; default 3.7 m |
| Stage 1 propellant capacity | 20–400 t; default 200 t |
| Stage 1 engine count | 1–9; default 4 |
| Stage 1 engine type | Two sea-level engine options |
| Stage 2 propellant capacity | 5–120 t; default 60 t |
| Stage 2 engine type | Vacuum or sea-level |
| Fin span | 0–3 m; default 2 m |

Use fictional educational engines, clearly identified as such. Initial catalog:

| Engine | Vacuum thrust | Sea-level/vacuum Isp | Dry mass |
|---|---:|---:|---:|
| Booster | Derived from 950 kN sea-level thrust | 285 / 320 s | 900 kg |
| Sustainer | Derived from 475 kN sea-level thrust | 300 / 335 s | 600 kg |
| Vacuum upper-stage | 930 kN | 100 / 345 s | 1,000 kg |

Calculate mass flow from the reference thrust and Isp, then derive ambient-pressure thrust consistently. Do not independently interpolate incompatible thrust and fuel-consumption values. The relationship is `F = ṁ × g₀ × Isp`. [NASA’s specific-impulse reference](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/specific-impulse/)

Initial geometry and mass rules:

- Frontal area: `A = πd²/4`.
- Ascent drag area: `CdA = 0.3A`.
- Effective propellant density: 1,000 kg/m³ for the initial catalog.
- Usable tank volume fraction: 95%.
- Tank length: `propellantMass / (density × 0.95 × A)`.
- Tank structural mass: 7.2% of stage 1 propellant capacity and 5% of stage 2 capacity.
- Add engine masses explicitly.
- Fairing mass: `800 × (d / 3.7)² kg`.
- Four fins together: `200 × (span / 2)² kg`.
- Fairing length: `1.8d`; each engine bay: `0.5d`; interstage: `0.3d`.
- Fixed trapezoidal fin proportions: root chord `1.2d`, tip chord `0.4d`, sweep `0.4d`.

This yields approximately the documented 18 t and 4 t stage dry masses for the reference build, with fairing and fins accounted for separately. Its total mass will therefore differ slightly from the prototype’s simplified 287 t.

Derive:

- Component locations and lengths.
- Dry, wet, and current mass.
- Stage-specific mass ratios and ideal delta-v.
- Liftoff TWR.
- Center of mass and pressure.
- Slenderness and static margin.
- Engine packing and part compatibility.

Calculate each stage’s delta-v with its carried upper stack included. Discarded hardware must leave the mass budget at the corresponding staging event.

**Completion gate:** changing a slider updates geometry and engineering values from the same calculation.

### Step 3 — Implement the environment

The current density model is a thermospheric approximation and must not be extrapolated to sea level.

Use:

- A standard-atmosphere pressure/density table through 85 km.
- Log-density interpolation through a transition region to 150 km.
- The preserved weather-sensitive density function above 150 km.
- Continuous interpolation at the boundaries.

NASA’s atmosphere reference explains the pressure, temperature, and density relationships underpinning the lower-atmosphere model. [NASA atmosphere model](https://www.grc.nasa.gov/www/k-12/airplane/atmosmet.html)

For weather:

1. Ship a deterministic reference snapshot: Kp 3, F10.7 150, solar wind speed 400 km/s, density 5 particles/cm³, temperature 100,000 K.
2. Add optional live NOAA loading.
3. Select observations by timestamp and validity, rather than assuming array position identifies the latest usable value.
4. Store source timestamps, retrieval time, and freshness.
5. Use a five-second request timeout and fall back to the bundled snapshot.
6. Freeze one complete snapshot for a flight and all associated analyses.

Live NOAA access must be tested from the deployed browser origin. If CORS or connectivity prevents access, the game remains fully playable with a visibly labeled reference snapshot.

Solar wind is an input to the upper-atmosphere model. It must not be treated as wind blowing against the rocket near the launchpad.

### Step 4 — Implement the authoritative ascent solver

Use an Earth-centered inertial coordinate system:

- Earth’s rotation axis is `+Z`.
- Default launch position is on the equator.
- Initial velocity includes `ω × r`.
- Local east and up vectors define launch guidance.
- Atmospheric-relative velocity is `v − ω × r − localWind`.

Integrate:

- Position.
- Velocity.
- Active-stage propellant.
- Flight phase and event state.
- Detached-stage states.

Forces:

- Gravity: `−μr / |r|³`.
- Thrust along the autopilot’s commanded direction.
- Drag: `−½ρCdA|vRel|vRel`.

Use JavaScript numbers and `Float64Array` for authoritative values. Never round simulation state for rendering.

Use RK4 with a fixed 0.05-second timestep. Split a timestep at burnout, separation, ignition, cutoff, or ground contact. Fuel cannot become negative, and a partially completed burn must produce only the corresponding impulse.

Integrate attitude as a rate-limited commanded direction, not full rotational dynamics. Angle of attack is derived from attitude and airflow; it is undefined at negligible airspeed and should display accordingly.

Keep a landed state before liftoff. A vehicle with TWR ≤ 1 must not fall through Earth or be launched by an artificial velocity impulse.

**Completion gate:** headless runs produce deterministic flight results independently of the renderer.

### Step 5 — Add staging and fixed guidance

Implement explicit phases:

`PAD → ASCENT_1 → BURNOUT_DELAY → SEPARATION → IGNITION_DELAY → ASCENT_2 → COAST/CIRCULARIZE → COMPLETE`

Failure and abort are terminal states available from every relevant phase.

Staging:

- Stage 1 exhausts its propellant.
- Wait one second.
- Separate with approximately 1 m/s relative velocity.
- Apply opposite mass-weighted velocity changes so separation conserves momentum.
- Wait another second before upper-stage ignition.
- Track the spent stage independently under gravity and drag.
- Jettison the fairing automatically above 100 km, including its mass change.

Guidance:

- Start vertically and introduce a gradual eastward pitch kick.
- Use an airspeed-based gravity-turn schedule rather than a single time-based kick.
- Limit commanded angle of attack during meaningful aerodynamic loading.
- Above the dense atmosphere, use orbital-state feedback to target a 200 km apogee.
- Permit an automatic upper-stage coast and one restart for circularization.
- Estimate finite burn duration so the circularization burn begins before apogee.
- Use radial-position and radial-velocity feedback during the final burn.
- Cut off when the orbit meets the target corridor; do not burn all remaining fuel unnecessarily.

Both upper-stage engine choices support that automatic restart. There are no player-facing guidance or throttle controls.

Throttle:

- Command full throttle until the predicted proper acceleration reaches 4.5 g.
- Reduce thrust automatically within the engine’s permitted throttle range.
- Use minimum throttle fractions of 30% for Booster, 20% for Sustainer, and 10% for Vacuum.
- If minimum thrust cannot prevent exceeding 5 g, the build fails.
- Measure g-load from non-gravitational acceleration, so orbital free fall reads approximately zero.

Keep all guidance coefficients in one versioned configuration. Calibrate them against a fixed build matrix, not individual builds. The reference build and nearby viable variants must use identical guidance.

**Completion gate:** several builds reach orbit using the same autopilot, while underpowered or structurally unsuitable builds fail for understandable reasons.

### Step 6 — Implement stability, structural checks, and orbit classification

Use a documented educational static-stability model:

- Measure axial positions from the nose toward the tail.
- Compute center of mass from current component masses and fuel distribution.
- Estimate center of pressure from a nose contribution and four-fin normal-force contributions.
- Use a simplified Barrowman-style model with fixed geometry coefficients.
- Required margin: `(xCP − xCM) / diameter ≥ 1`.

Update the margin as fuel burns and attached parts change. Enforce aerodynamic instability only while dynamic pressure exceeds 500 Pa; finless upper stages must not fail a vacuum flight.

Initial game thresholds:

| Check | Rule |
|---|---|
| Liftoff | TWR > 1 |
| Acceleration | Peak proper acceleration ≤ 5 g |
| Stability | At least one caliber during significant aerodynamic loading |
| Slenderness | Warning above 15; structural limit above 20 |
| Dynamic pressure | Structural failure above 45 kPa |
| Vacuum engine | First ignition at or above 60 km |
| Sustained orbit | Bound trajectory with perigee ≥ 150 km |
| Target orbit | Perigee 180–220 km and apogee 180–250 km |

Distinguish **orbit achieved** from **target orbit achieved**. A safe bound orbit outside the corridor should not be mislabeled as a crash.

Compute orbital elements from position and velocity:

- Specific energy and angular momentum.
- Eccentricity.
- Perigee and apogee.
- Inclination.

Handle radial, circular, unbound, and ground-intersecting trajectories without NaNs or fabricated apogee values.

Preflight delta-v is an estimate with a labeled loss allowance. Actual orbital state determines success.

Allow physically assembled but poor designs to launch and demonstrate failure. Block malformed configurations and impossible component overlap.

### Step 7 — Connect the launched payload to the existing mission model

At successful insertion, create an immutable payload handoff from the flight result.

The configured payload mass is its total wet mass. Use one fixed educational spacecraft specification:

- Dry mass: 80% of payload wet mass.
- Onboard propellant: 20%.
- Specific impulse: 325 s.
- Cross-sectional area: `5 × (payloadWetMass / 1,000)^(2/3) m²`.
- Orbital drag coefficient: 2.2.
- Mission duration: three years.
- Initial inclination: derived from the achieved orbit.

These assumptions appear in the mission report. Payload propellant remains untouched during launch; leftover upper-stage fuel is displayed separately.

Adapt the slightly elliptical achieved orbit to the existing circular mission model:

1. Calculate the payload burn needed to circularize at achieved apogee.
2. Charge that burn against payload propellant.
3. If unaffordable, report an insertion-budget failure.
4. Otherwise pass the circularized altitude, remaining fuel, and actual inclination into the preserved mission functions.
5. Include the circularization cost in the overall insertion budget without charging it twice.

For Monte Carlo analysis, center insertion uncertainty on the achieved orbit. Preserve the existing operational-error distributions as additional uncertainty around that state.

Present:

- Baseline mission pass/fail.
- All four delta-v budget components.
- Available delta-v.
- Actual remaining propellant and reserve.
- Orbital-decay estimate.
- Failure modes and parameter sensitivity.

A successful launch can still have poor three-year survival at low altitude. Explain that result rather than changing the physics to guarantee a second success.

### Step 8 — Add worker execution and reproducible analysis

Run physics and batch analysis in dedicated Web Workers so expensive calculations do not block interaction. Workers communicate through messages and can transfer typed-array buffers. [MDN Web Workers documentation](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers)

Public simulation interfaces:

| Interface | Purpose |
|---|---|
| `deriveRocket(config)` | Geometry, masses, estimates, build checks |
| `createFlight(config, environment, seed)` | Immutable initial conditions |
| `stepFlight(state, dt)` | Deterministic state advancement |
| `runFlight(input)` | Complete headless run |
| `orbitalElements(position, velocity)` | Orbit classification |
| `analyzePayload(handoff, rules)` | Existing mission-model integration |
| `runMonteCarlo(request)` | Seeded batch analysis |
| `runSensitivity(request)` | One-parameter-at-a-time analysis |

Worker messages include run identifiers:

- Requests: initialize, advance, run batch, cancel.
- Responses: telemetry, event, progress, completed, failed.

Ignore stale messages from canceled or superseded runs. Process batches in bounded chunks so cancellation can be acknowledged promptly.

Reproducibility:

- Store build, weather snapshot, seed, catalog version, guidance version, and model version.
- Use a specified seeded PRNG and Gaussian transform in the browser.
- Do not assume Python and JavaScript produce identical draws from the same integer seed.
- For exact language-parity tests, replay explicit perturbation fixtures exported by Python.

Analysis sizes:

- Orbital analysis: preserve 10,000 overall runs and 1,000 runs for each of the existing 16 sensitivity parameters.
- Ascent robustness: 200 runs initially; optional 1,000-run analysis.
- Ascent sensitivity: 100 runs per perturbed parameter.

Initial ascent uncertainties use bounded draws for thrust, Isp, dry mass, loaded propellant, atmospheric density, and horizontal wind. Keep their distributions in versioned model data, distinct from the existing orbital uncertainty ranges.

Report confidence intervals and sample counts. Failure causes can overlap, so their percentages must not be presented as mutually exclusive slices of a pie chart.

### Step 9 — Build the first playable interface

Create three primary screens.

**Assembly**

- Large procedural rocket view with selectable components.
- HTML controls with units and keyboard-accessible numeric inputs.
- Side-profile inset showing the complete stack.
- Live TWR, ideal delta-v, CdA, stability margin, and slenderness.
- Center-of-mass and center-of-pressure markers.
- Clear launch action and reference-build reset.

**Flight**

- Default camera approximately 60° above the local horizon.
- Chase, ground, and orbit camera options.
- Altitude, speed, fuel, g-load, dynamic pressure, and mission time.
- Event timeline with burnout, separation, ignition, max-Q, and cutoff.
- Pause and 1×/5×/20× playback controls.
- No piloting controls.

**Debrief**

- Outcome and primary cause first.
- Measured value, threshold, event time, and suggested change.
- Synchronized plots for altitude, velocity, dynamic pressure, g-load, and fuel.
- Replay and return-to-build actions.
- Optional payload mission analysis and robustness analysis.

Use deterministic explanations tied to evidence. For example:

> “Stage 2 ignited at 47 km. This vacuum engine requires 60 km. Use a sea-level upper-stage engine or increase the first stage’s capability.”

Describe suggestions as engineering tradeoffs, not guaranteed fixes.

Persist the current build and the last ten run summaries locally. Editing a build invalidates its prior analysis until rerun.

**Completion gate:** a player can change a part, launch, understand the result, and try again.

### Step 10 — Apply the visual direction

Working title: **APOGEE / Launch Lab**.

Use an orbital mission-control aesthetic:

- Ink navy background: `#07111F`.
- Raised instrument surfaces: `#102033`.
- Cyan data and selection accents: `#63DDEB`.
- Orange exhaust and caution: `#FF9B54`.
- Off-white rocket surfaces and typography.
- Restrained green for success.
- Geometric interface type with monospaced, tabular telemetry.

Layout should emphasize the rocket and flight, with compact instrument panels rather than dense dashboard cards.

Rendering:

- Generate the rocket from the same dimensions used by physics.
- Use a floating origin for nearby objects.
- Render launchpad detail in a local scene and Earth in a separate scaled background layer.
- Transform coordinates in double precision before passing them to GPU buffers.
- Use logarithmic depth where compatible, but do not rely on it alone to solve Earth-scale precision. [Three.js renderer options](https://threejs.org/docs/pages/WebGLRenderer.html)
- Use a single WebGL renderer with a scissored side-profile view.
- Use projected HTML labels through Drei, with viewport clamping and occlusion handling.
- Update meshes through refs; keep high-frequency telemetry out of React’s component state. [React Three Fiber performance guidance](https://github.com/pmndrs/react-three-fiber/blob/master/docs/advanced/pitfalls.mdx)

Effects:

- Selective bloom for exhaust, active markers, and trajectories.
- Thick fading trajectory lines.
- Separate airborne trail and surface-projected ground track.
- Procedural graticule, launch range rings, and day/night terminator.
- Particle exhaust and separation debris using three.quarks. [three.quarks project](https://github.com/Alchemist0823/three.quarks)
- Max-Q event ring triggered from the simulation event.
- Dashed spent-stage prediction terminating at a calculated impact point.

Only show an impact ellipse after calculating dispersion from multiple perturbed trajectories. A decorative ellipse must not imply measured uncertainty.

Provide reduced-motion, low-effects, and mute settings. Bundle fonts and assets locally.

### Step 11 — Finish robustness, replay, and polish

- Add saved-run comparisons with build differences and outcome changes.
- Scrub recorded telemetry rather than reversing the integrator.
- Rebase all trail, debris, and camera coordinates consistently.
- Bound particle counts, trajectory buffers, and cached analyses.
- Dispose of replaced geometries and materials.
- Suspend unnecessary rendering while idle or hidden.
- Automatically lower pixel ratio, bloom, and particles when frame rate drops.
- Provide a readable non-3D error state if WebGL is unavailable.
- Allow copying a versioned build configuration and downloading a run report as JSON.

## 4. Verification and acceptance criteria

### Numerical verification

- TypeScript matches Python fixtures for preserved orbital calculations.
- Intentional corrections have explicit before/after fixtures.
- No-thrust, no-drag orbital propagation conserves energy and angular momentum within the selected numerical tolerance.
- A 0.025-second timestep agrees with 0.05 seconds to within 1% for peak-Q and peak-g, and within 1 km for orbital extrema on non-boundary cases.
- Burnout consumes exactly the available fuel.
- Staging conserves momentum and removes only detached mass.
- Engine cutoff and restart cannot create fuel or impulse.
- Ground impact and reentry terminate at their boundaries.
- Inclination follows the launch geometry and final state.
- Empty, malformed, stale, or unavailable weather never produces an invalid simulation.

### Calibration and gameplay verification

Maintain a fixed scenario suite:

1. Reference build.
2. Several nearby viable builds with different payloads and tank capacities.
3. Insufficient liftoff thrust.
4. Adequate liftoff thrust but insufficient orbital energy.
5. Excessive slenderness.
6. Insufficient fin stability.
7. Structural max-Q failure.
8. Vacuum engine igniting too low.
9. Acceleration above the limit despite minimum throttle.
10. Successful launch with an unsuccessful long-duration payload mission.

The reference should approximately reproduce the document’s liftoff TWR, stage-1 burn duration, peak-Q scale, and delta-v scale. Exact PyBullet timing and orbital elements are not acceptance requirements because its implementation is unavailable and its launch latitude differs.

Provide a test-only 28.5° launch site to compare the documented inclination. The game’s equatorial default should produce near-equatorial inclination.

### Browser and interaction verification

Test the complete build → launch → debrief → rebuild → payload-analysis flow.

Also cover:

- Refresh and local recovery.
- Worker cancellation and stale-result rejection.
- Repeated launches without accumulating GPU resources.
- Camera changes and playback speed without changing outcomes.
- Window resize, browser zoom, keyboard navigation, and reduced motion.
- Offline weather fallback.
- Current desktop Chromium, Firefox, and Safari.
- Basic tablet and narrow-screen usability.

Target 60 fps during normal desktop flight, with a 30 fps low-effects fallback. Numerical simulation results must remain identical across graphics settings.

### Delivery gates

| Gate | Required result |
|---|---|
| A — Preserved core | Browser mission model passes Python parity fixtures |
| B — Headless flight | Reference and failure scenarios produce valid deterministic outcomes |
| C — Flyable prototype | Assembly, flight, debrief, and rebuilding work end to end; follow `OUTCOME_SYSTEM_PLAN.md` Gate H before calling the teaching loop complete |
| D — Integrated analysis | Actual launched payload feeds the preserved mission model |
| E — Complete release | Robustness, sensitivity, replay, visual effects, accessibility, and browser checks pass |

Build and validate a static production bundle, including worker loading and asset paths. No accounts, database, backend, or external AI service are required.

## 5. Assumptions and boundaries

- This is an educational engineering model with explicit simplifications.
- The initial vehicle is always a two-stage, fixed-diameter rocket.
- Stability is evaluated, but physical tumbling and flexible-body dynamics are deferred.
- Cd remains fixed at 0.3 during ascent; Mach-dependent drag is deferred.
- Engine and structural parameters are fictional, versioned gameplay data calibrated against the reference scenario.
- The payload’s propulsion and geometry are fixed assumptions derived from its selected wet mass.
- Live weather is optional; deterministic reference weather is always available.
- Launch success and long-term mission success remain separate outcomes.
- Python remains part of the project as a reference and verification tool; its existing logic becomes functional browser code used by the game.
