# Hybrid renderer refactor — notes

Goal: keep the React / three.js app (build screen, HUD, charts) and replace only
the **launch view renderer** with a Unity WebGPU build, with the existing
three.js launch view kept as an automatic fallback. The TypeScript flight sim
stays the single source of truth; Unity never simulates anything.

---

## Phase 0 — audit

### Where things live (before the refactor)

| Concern | Location |
|---|---|
| Flight simulation (integrator, guidance, events) | `web/src/sim/ascent/flight.ts`, `guidance.ts`, `robustness.ts` |
| Physics primitives | `web/src/sim/physics/` (`vec3`, `orbital`, `atmosphere`, `constants`) |
| Orbital / mission analysis | `web/src/sim/orbital/` |
| Rocket geometry + masses from the player's build | `web/src/domain/derive.ts` (`deriveRocket`) |
| Player-facing config + reference build | `web/src/domain/config.ts` |
| Sim ⇄ worker boundary | `web/src/workers/{protocol,serialize,client,sim.worker}.ts` |
| Build screen | `web/src/ui/screens/AssemblyScreen.tsx` |
| **Launch view (the thing being replaced)** | `web/src/ui/screens/FlightScreen.tsx` + `web/src/ui/components/FlightScene.tsx` (with `Earth`, `RocketMesh`, `Trajectory`) |
| HUD, timeline, playback controls | `web/src/ui/screens/FlightScreen.tsx` (HTML/React, overlaid on the canvas) |
| Telemetry chart | `web/src/ui/components/TelemetryChart.tsx` |
| Playback position | `web/src/ui/playbackClock.ts` (a mutable module singleton, deliberately outside React state) |
| Telemetry sampling for playback | `web/src/ui/telemetry.ts` (`sampleTelemetry`) |

### Deviations from the instruction document (and why)

1. **No pnpm/npm workspaces.** The instructions describe `apps/web`,
   `packages/sim` and `packages/protocol`. This repo is a single Vite app under
   `web/`, and the instructions say to adapt names to the existing repo. Splitting
   into workspaces would mean rewriting `package.json`, the tsconfig project
   references, the Vite worker build and every import path — churn with no
   behavioural payoff for a hackathon codebase. Instead:
   - `packages/sim` → **already satisfied**: `web/src/sim/**` and
     `web/src/domain/**` import nothing from the DOM, React or three.js. This is
     now enforced automatically by `web/src/sim/__tests__/purity.test.ts`, which
     fails the build if such an import is ever added.
   - `packages/protocol` → `web/src/protocol/`, a DOM-free module with its own
     unit tests, importing only from `sim/` and `domain/`.
   - `src/renderers/` and `src/playback/` are created exactly as specified,
     under `web/src/`.
2. **Camera modes.** The instructions name three modes (`chase`, `wide`,
   `orbit`). The shipped UI exposes four (`overhead`, `chase`, `ground`,
   `orbit`) and "the app must work exactly as before", so the renderer interface
   carries all four. `overhead` is this app's name for the instructions'
   `wide` shot; `ground` is an extra pad-level camera. Unity's `CameraDirector`
   implements all four.
3. **Shuriken particle systems instead of VFX Graph.** VFX Graph effects are
   `.vfx` assets that only exist once authored in the Unity editor, and cannot be
   produced from a text editor. Every effect in section 6.4 is therefore built
   from code with built-in `ParticleSystem` components (`EffectsController.cs`),
   which is fully editor-free and still GPU-instanced. Swapping individual
   emitters for VFX Graph assets later is a local change inside
   `EffectsController`. The build still targets WebGPU as specified.
4. **The Unity scene is built from code.** `SceneBootstrap.cs` constructs the
   camera stack, lights, Earth, ground disc and rocket at runtime, so the only
   committed scene asset is an almost-empty `Main.unity`. This keeps the whole
   Unity side reviewable as text.

### Baseline snapshot

`web/src/sim/ascent/__tests__/baseline.test.ts` runs the reference build
(`referenceConfig()`, `referenceSnapshot()` weather, seed 0) and snapshots the
orbit, peak loads, event sequence and staging times. Recorded values:

| Quantity | Value |
|---|---|
| Outcome | `target_orbit` |
| Perigee × apogee | 200.101 km × 224.038 km |
| Max-Q | 34.307 kPa at T+65.95 s |
| Peak g | 4.5031 g |
| Stage-1 burnout / separation / stage-2 ignition | T+147.405 s / T+148.405 s / T+149.405 s |
| Stage-2 propellant remaining | 3820.694 kg |
| Flight duration | 433.504 s (8672 telemetry samples) |

Every later phase must leave these unchanged.

---

## Phase 1 — the sim stays the source of truth

`web/src/sim/**` and `web/src/domain/**` already imported nothing from the DOM,
React or three.js, so there was nothing to move. That property is now enforced
rather than assumed: `web/src/sim/__tests__/purity.test.ts` walks `src/sim`,
`src/domain` and `src/protocol` and fails the build if any of them ever imports
three.js, React, zustand, or anything from `src/ui` or `src/renderers`.

**What the sim now records.** The launch view used to reconstruct the vehicle's
orientation from the difference between two position samples, which is an
approximation of something the integrator already knows exactly. The
integrator's own state is now recorded instead. `Telemetry` gained:

| Field | Why |
|---|---|
| `velX/Y/Z` | Velocity tangents for Hermite interpolation, and the air-relative velocity a renderer needs |
| `attX/Y/Z` | The commanded body axis — the real attitude, instead of a finite difference |
| `comFromNoseM` | The center of mass, which moves as propellant burns |
| `attachedLengthM` | The height of the still-attached stack, which shortens at staging |

These are recordings, not new physics: the baseline snapshot is unchanged.

**Sampling** moved to `web/src/sim/trajectory.ts`. `createTrajectory(telemetry)`
returns a `Trajectory` with `sampleAt(t)`, which interpolates position with
cubic Hermite against the logged velocity and attitude spherically.
`web/src/ui/telemetry.ts` re-exports it, so nothing else had to change.

## Phase 2 — `web/src/protocol`

| File | Contents |
|---|---|
| `types.ts` | `RocketGeometry`, `RenderFrame`, `PlaybackState`, and `nonFiniteFields` |
| `convert.ts` | The axis and quaternion conversions, the local basis, the sub-point, the Earth mesh orientation |
| `geometry.ts` | `toRocketGeometry(derived)` — base-relative geometry from the same `DerivedRocket` the physics uses |
| `renderFrame.ts` | `toRenderFrame(sample, geometry, playbackState)` |

**The handedness flip.** East-north-up to renderer axes is `(E, N, U) → (E, U, N)`,
which is a *reflection*: it changes handedness. A rotation therefore cannot
just be relabelled — conjugating by a reflection maps the axis the same way and
negates the angle, so `(qx, qy, qz, qw) → (−qx, −qz, −qy, qw)`. The property
test in `convert.test.ts` checks the thing that actually matters over 500 random
vector/quaternion pairs: rotating then converting equals converting then
rotating.

**Nothing Earth-centered crosses the boundary.** The Earth's center is
`(0, −(r + comFromBase), 0)` — exact by construction, not a large subtraction —
and its orientation arrives as `earthQuat`. The local origin is the vehicle's
center of mass, and the `comFromBase` term is what stands the base of the stack
on the ground at altitude 0.

**One addition to the documented type:** `inertialQuat`. The three.js view draws
the trajectory trail, the ground track and the max-Q marker, all of which are
Earth-centered geometry. Rather than send Earth-scale coordinates every frame,
that geometry is converted into renderer axes *once* when the flight loads, and
`inertialQuat` orients the group that holds it. It is the same trick
`earthQuat` uses. Unity ignores it.

**Mach** is computed in the protocol from a US Standard Atmosphere speed of
sound (`speedOfSoundMs` in `sim/physics/atmosphere.ts`). The ascent solver never
reads it, so it cannot move a trajectory.

**The sun** is a fixed direction in the sim frame, about 35° above the horizon
at the launch site. A sun near the zenith leaves a vertical rocket's sides
nearly edge-on to it, which reads as a dark silhouette all the way up.

## Phase 3 — the renderer interface and playback

- `src/renderers/LaunchRenderer.ts` — the interface, plus `RendererCameraMode`.
- `src/playback/PlaybackController.ts` — owns the clock. Play, pause, seek,
  speed, restart; samples the trajectory each animation frame, builds the frame,
  sends it to the active renderer and notifies subscribers.
- `src/renderers/ThreeLaunchRenderer.ts` — mounts the existing scene in its own
  React root and writes incoming frames into a ref.
- `src/renderers/threeAxes.ts` — the bridge into a right-handed three.js scene.

**Why three.js needs one more axis map.** The frames are left-handed, because
Unity is. Dropping those coordinates into a three scene directly would draw a
mirror image — continents flipped, east on the wrong side. Mapping
`(x, y, z) → (x, y, −z)` makes the scene east / up / south, and composed with
the earlier east-north-up swap the round trip is a *proper* rotation. That is
why an ordinary equirectangular Earth texture lines up with no mirroring and no
offset (the old `offset.x = 0.28` fudge is gone, and the map's geography was
adjusted so the reference pad at 0°, 0° sits in the Gulf of Guinea rather than
on the edge of Africa).

Other changes that fell out of making the scene frame-driven:

- The pre-launch ignition hold moved from `FlightScene` into the controller, so
  both renderers see the same spool-up.
- `playbackClock.ts` is gone. The controller owns time outright; `Trajectory`
  reveals the trail from the frame it is drawing rather than from a module
  singleton.
- Stage 1 now disappears from the three.js view at separation, and the stack is
  repositioned from `attachedLength`, so staging reads correctly.
- Leftover debug instrumentation (per-frame `fetch` calls to a local logging
  endpoint in `FlightScene`, `FlightScreen` and `Earth`) was removed.
- The atmosphere shader was missing `#include <common>`, so it failed to compile
  and the limb glow never drew. Fixed.

## Phases 4, 6 and 7 — the Unity project

`unity/RocketRenderer/`. See its `README.md` for the build command and the
layout. The scene is generated by `BuildScript` and holds a single GameObject;
`SceneBootstrap` constructs the camera stack, lights, Earth, pad, vehicle and
effects at runtime, so the entire Unity side is reviewable as text.

`BuildScript.BuildWeb` applies every player setting itself — WebGPU (resolved by
name, so an editor without it fails loudly instead of quietly producing a
WebGL 2 build), compression disabled, product name — and builds into
`web/public/unity/`, which is gitignored.

## Phase 5 — web integration

- `UnityHost.ts` reads the Unity build's own generated `index.html` and takes
  the loader URL and config out of it. Build file names change with the Unity
  version and the compression setting; none of them are hard-coded here.
- `UnityLaunchRenderer.ts` sends one JSON frame per animation frame, skips
  re-sending an unchanged paused frame, and flattens the frame for
  `JsonUtility` (which cannot parse a nullable object, so the spent booster
  becomes a presence flag plus fields).
- `selectRenderer.ts` uses Unity only when WebGPU exists, `?renderer=three` was
  not passed, and a build is actually reachable. Anything else falls back to
  three.js with a notice. `?renderer=unity` forces the attempt and still falls
  back rather than leaving a blank screen.

## Phase 8 — verification

Everything below was run in this repo.

| Check | Result |
|---|---|
| Unit tests (`npm test`) | 170 passing, 19 files |
| Types (`npm run typecheck`) | clean |
| Lint (`npm run lint`) | clean |
| Production build (`npm run build`) | succeeds |
| End-to-end (`npx playwright test --project=chromium`) | 15 passing |
| Baseline snapshot | unchanged |

Against the acceptance criteria in section 8 of the instructions:

1. **Determinism** — the Phase 0 snapshot is unchanged.
2. **Parity** — structural rather than measured: the HUD reads from
   `PlaybackController`, which is renderer-independent, and both renderers are
   handed the identical `RenderFrame`. It cannot be measured against a live
   Unity build here (see below).
3. **Coordinates** — covered by `protocol/__tests__/convert.test.ts` and
   `renderFrame.test.ts`: the conversion property over random inputs, upright on
   the pad at t = 0, the launch site directly under the rocket on the Earth
   mesh, and a sun above the horizon.
4. **Fallback** — three e2e cases: no build deployed, `?renderer=three`, and a
   build that is served but whose loader fails. All land on three.js with a
   notice. `UnityHost`'s timeout path is covered by unit test.
5. **Lazy load** — an e2e test asserts no request to `/unity/` until Launch.
6. **Scrub** — an e2e test drags the timeline back and forth and asserts the HUD
   tracks it with no console errors; `PlaybackController` tests assert exactly
   one discontinuity per seek and each event reported exactly once.
7. **Input** — an e2e test types into an HTML number input after the launch view
   has been on the page, including a real keystroke.
8. **Performance** — measured on the three.js path (below).
9. **No NaN** — `nonFiniteFields` is checked on every frame before it is sent;
   the controller logs once and holds the previous frame. `SimBridge` does the
   same check on the Unity side.

### Measured performance

three.js launch view, Chromium, 1920 × 1080, this machine (Apple silicon):

| Measurement | Value |
|---|---|
| Steady-state frame rate during ascent | **60 fps** (59.4 fps on the first 5 s window, 60.1 fps on the second) |
| Launch pressed → HUD visible | **~0.97 s** (includes the worker running the full flight) |
| Production bundle | 1.20 MB, 333 kB gzipped |

Headless Chromium falls back to a software rasterizer and reports about 10 fps;
that number says nothing about real hardware and is recorded only so it is not
mistaken for a regression later.

### What could not be verified here

**No Unity build was produced, and no Unity code was compiled.** This machine
has no Unity installation and no C# compiler, so:

- `unity/RocketRenderer/**` has never been compiled. Expect the first editor
  open to surface ordinary compile errors.
- The WebGPU player has never been built or run, so the download size, the load
  time, the VFX behaviour under WebGPU and the frame rate of the Unity path are
  all unmeasured. Section 9 of the instructions lists these as open risks and
  they remain open.
- Unity 6.6 (6000.6) is named in `ProjectVersion.txt` on the strength of the
  instruction document's own single news report. **Confirm WebGPU's supported
  status in Unity's documentation and release notes before relying on it.**

What *is* checked automatically is the seam most likely to break silently:
`renderers/__tests__/unityContract.test.ts` reads the actual C# source and
asserts that `RenderFrameDto` and `RocketGeometryDto` declare exactly the fields
the web app sends, that `SimBridge` implements every method the web app calls,
that the jslib exports only `RocketBridge_Ready` and `RocketBridge_Error`, and
that no Unity script references `Rigidbody`, `Physics.gravity`, `Time.time` or
`Time.deltaTime`. `JsonUtility` binds by name and leaves a mismatched field at
its default, so a rename would otherwise show up as a rocket that quietly stops
rotating, with nothing in the console.

### Next steps

1. Open `unity/RocketRenderer` in Unity 6.6+, fix whatever the first compile
   reports, and run `BuildScript.BuildWeb`.
2. Load the app with `?renderer=unity` and check the acceptance criteria that
   need a live player: parity of the HUD numbers against `?renderer=three`,
   effects clearing on scrub, typing while Unity has the canvas, and the frame
   rate and download size.
3. Record the measured Unity numbers in this file.
