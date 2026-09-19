# Rocket Design Game: Project Plan

A teaching game where the player builds a rocket and the sim flies it with a fixed autopilot. The only question is: **does my build work?**

There are no global controls. Pitch program, throttle, target orbit and disposal reserve are all gone.

---

## 1. What the player configures

| Part | Inputs |
|---|---|
| Payload | Mass |
| Fairing | Diameter (1 to 5 m), which sets the diameter of the whole stack |
| First stage | Tank size, engine count, engine type |
| Upper stage | Tank size, engine type (vacuum or sea-level) |
| Fins | Size |

Dry mass comes from tank size using a fixed structural mass fraction, so the player never sets it.

## 2. What the autopilot does

- Flies a standard gravity turn at full throttle.
- Stages when stage 1 runs out of fuel. Separation is about 1 s after burnout with a small push (about 1 m/s). The upper stage ignites about 1 s later so its exhaust clears the stage below.
- Targets a fixed orbit of about 200 km.

## 3. Derived values (shown to the player)

1. Liftoff thrust-to-weight ratio
2. Total delta-v
3. Drag area (Cd x A), which replaced the plain drag coefficient
4. Center of mass vs. center of pressure
5. Peak g-load

## 4. Viability checks (pass/fail)

- Liftoff thrust-to-weight above 1, and peak g under a limit (about 5 g).
- Center of pressure behind center of mass, so the rocket is stable.
- Enough delta-v to reach orbit, with an allowance for gravity and drag losses.
- Structure survives max-Q.
- Upper stage engine suits where it ignites (a vacuum engine wants roughly 60 km or higher).
- Slenderness (length / diameter) under about 15 to 20.
- Perigee above 150 km at upper stage burnout.

When a check fails, the telemetry names the cause and the fix, for example: "Unstable: center of pressure 0.4 m ahead of center of mass. Increase fin size."

## 5. Simulation model

- **3D, Earth-centered frame.** Gravity points at Earth's center and falls off with distance squared.
- **Launch:** near the equator, due east, so Earth's rotation helps. Airspeed is velocity minus the rotating atmosphere's velocity.
- **Attitude:** the autopilot commands a pointing direction and thrust acts along it. Angle of attack is the angle between that direction and the airflow.
- **Fuel and inclination** are calculated by us. Fuel is propellant mass minus what has burned. Inclination comes from position and velocity at burnout.
- **Lifespan is removed.**
- **Drag:** fixed Cd of 0.3 and area from the fairing diameter, so `CdA = 0.3 x pi x (d/2)^2`.
- **Tank length** comes from propellant volume divided by area. This makes diameter a real tradeoff: wide costs drag, narrow gets long and fails the slenderness check.
- **Stability:** either add a normal-force term (`CN_alpha` about 2 per radian) or use a pass/fail margin check ("center of pressure behind center of mass by at least one body diameter").
- **Skipped on purpose:** Mach-dependent Cd, detailed aerodynamics, CFD.

## 6. Tech stack

The whole game runs in the browser, so players need no install and there is no Python server.

| Layer | Choice |
|---|---|
| Build tool | Vite |
| Rendering | three.js |
| UI framework | react-three-fiber (with drei) for the build screen and part pickers |
| Glow | Postprocessing bloom (`UnrealBloomPass`, or the `postprocessing` package for selective bloom) |
| Trails | `Line2` and `LineMaterial` for thick lines that can bloom |
| Exhaust and debris | three.quarks |
| Labels and HUD | `CSS2DRenderer` for HTML labels pinned to 3D points |
| Flight sim | JavaScript, our own integrator |
| Orbit math | Our own two-body code (satellite.js is an option) |

Optional extras: `three-globe` for a data-style Earth, `troika-three-text` for text inside the scene, `lil-gui` or `Tweakpane` for quick dev sliders, `Howler.js` for engine and staging sound.

### Physics notes

- We apply our own gravity, thrust and drag, so a full physics engine adds little. A small integrator is enough.
- If we want rigid-body tumbling and stage separation, `Rapier` or `cannon-es` both run in the browser.
- Rapier uses 32-bit floats. Keep the authoritative position and velocity in JavaScript numbers (64-bit) or use a local frame, because Earth-scale coordinates lose precision.
- Rules that carry over from the PyBullet prototype:
  - Turn off any built-in gravity and apply our own toward Earth's center.
  - Apply our own drag, with built-in damping set to zero.
  - Apply drag at the center of pressure so the torque gives weathervaning or tumbling.
  - Update rotational inertia as fuel burns, or the rocket tumbles as if it were still full.
- PyBullet stays as an offline reference to check the JavaScript numbers against.

## 7. Visual direction

A futuristic mission-control look, going for something that feels cool rather than like a standard flight sim.

- **Camera:** looks down at the rocket from about 60 degrees above the horizon, so it reads as top-down but still feels 3D. Altitude is shown by zooming out as the rocket climbs, from pad scale to a full globe in orbit.
- **Ground:** deep navy surface with a faint graticule and range rings around the pad.
- **Rocket:** crisp silhouette with fins as a cross, and a bright glow at the base.
- **Trail:** a glowing ribbon that fades with age, leaving a ground-track arc.
- **Events:** a pulsing ring at max-Q. At separation the marker splits, and the spent stage traces a dashed path to a predicted impact ellipse.
- **HUD:** thin cyan leader lines from the rocket to small floating readouts. Wide type with tabular numbers.
- **Orbit view:** dashed ellipse with perigee and apogee markers and a day/night terminator on the globe.
- **Palette:** ink navy, cyan for data and lines, orange kept for fire and warnings.
- **Inset:** a small side-profile view, since the rocket is still foreshortened at liftoff from this angle and the inset shows the build clearly.

### Rendering technique notes

- Use a **floating origin**: keep the rocket near (0, 0, 0) and move the world around it.
- Use a **logarithmic depth buffer** so a camera near the rocket can still see the horizon.
- Generate the rocket mesh from the player's config with primitives (cylinders, a cone, thin boxes for fins), so it updates live as sliders move.
- Camera modes: chase, ground, and orbit view, plus the 60 degree overhead mode above.

## 8. Reference build (from the PyBullet prototype)

A working set of numbers to test the JavaScript sim against.

| Item | Value |
|---|---|
| Diameter | 3.7 m |
| Stage 1 | 200 t propellant, 18 t dry, 3.8 MN sea-level thrust |
| Stage 2 | 60 t propellant, 4 t dry, 0.93 MN vacuum thrust |
| Payload | 5 t |
| Liftoff mass | 287 t |
| Liftoff thrust-to-weight | 1.35 |
| Total delta-v | about 10.4 km/s |
| Peak g | 4.5 |
| Max-Q | about 30 kPa at T+66 s |
| Stage 1 burnout | T+146 s |
| Orbit reached | about 181 x 240 km, 28.7 degree inclination |

The prototype launched from 28.5 degrees north. It only just reaches orbit, with about 1.5 t of upper stage propellant left.

## 9. Gotchas found so far

- PyBullet caps a body at 100 m/s by default. Creating bodies with `useMaximalCoordinates=True` removes the cap.
- In PyBullet, calling `changeDynamics` with only `localInertiaDiagonal` turns the mass into NaN. Pass `mass` in the same call.
- Full throttle gave about 10 g at upper stage burnout, which breaks the 5 g check. The prototype added a throttle limit at 4.5 g.
- The ascent is very sensitive to the pitch kick. It was tuned by hand to 4.5 degrees, and small changes went suborbital or too high.
- The sim must pick a fixed pitch program and guidance law that work across many builds, not just one.

## 10. Later, if there is time

- **Monte Carlo stress test:** a button that reruns the flight with small random changes to thrust, air density, wind and mass. It shows "reaches orbit 62% of the time" and teaches why real rockets carry extra delta-v. It only needs the flight function to accept perturbations.
- **Mach-dependent drag:** a small lookup table would show the drag spike near the speed of sound.
- **Fairing tradeoff:** a wider-fairing drag penalty on top of the slenderness limit.

## 11. Open items

- **Throttle limit:** keep full throttle (and fail builds that exceed the g limit), or add a 4.5 g throttle limit like the prototype.
- **Stability model:** normal-force term or pass/fail margin check.
- **React or plain three.js:** react-three-fiber is a good fit for the build screen, but is not required.
- **Physics:** our own integrator only, or Rapier / cannon-es for tumbling and separation.
- **Next step:** write the build-to-parameters function (diameter, length, mass, CdA from the slider values) as a spec for Cursor's agent.

## 12. Process note

The project has to be built in Cursor. Open the repo in Cursor and write the code there. Planning the design in chat is normal research. If it is unclear whether generating code elsewhere and pasting it in counts, ask the organizers to clarify.