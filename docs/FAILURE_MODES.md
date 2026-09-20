# Rocket Failure Scenarios (checked against sources and the prototype)

Failure modes for the five derived values:

1. Liftoff thrust-to-weight ratio (TWR)
2. Total delta-v
3. Drag area (Cd x A)
4. Center of mass vs. center of pressure (margin)
5. Peak g-load

Every entry carries a status:

- **Real:** a documented rocketry or ballistics phenomenon.
- **Tradeoff:** real physics, but a design choice rather than a natural failure.
- **Game rule:** a threshold or outcome we chose. Tune it.
- **Unverified:** plausible, but not checked against a source or the sim.

---

## How the numbers connect

- **Peak g is thrust divided by burnout mass, per stage.** At fixed thrust this equals liftoff TWR times that stage's mass ratio. Adding propellant to a stage does not change it, because TWR falls and the mass ratio rises by the same amount. Adding engines or removing burnout mass does raise it. Real launchers manage this by throttling. The Space Shuttle limited acceleration to 3 g.
- **Peak g can only be below liftoff TWR if the engines throttle down.** Without throttling it is always at least liftoff TWR.
- **Show one delta-v number and compare it to the matching requirement.** Rocket-equation delta-v is compared to about 9.3 to 9.5 km/s, the LEO requirement that already includes losses. If the UI shows usable delta-v after losses instead, compare it to about 7.4 to 7.8 km/s. Never mix the two.
- **Typical loss budget to LEO:** gravity 1.0 to 1.5 km/s, drag 0.1 to 0.15 km/s, plus small steering losses. The total is about 9 to 10 km/s including 1.5 to 2 km/s of losses.
- **Reference build caveat:** the prototype's 4.5 g peak came from a throttle limiter. Without it, stage 1 reaches about 4.9 g and stage 2 about 9 to 10.5 g.

---

## Table 1. One factor collapses

| Factor | Too low | Too high |
|---|---|---|
| Liftoff TWR | Below 1 it never leaves the pad (**Real**). From 1.0 to about 1.15 it is marginal: high gravity loss and no engine-out margin (**Real**, warn and fail levels are a **Game rule**). Saturn V lifted off at about 1.2, and Falcon 9 works out to about 1.4. | Not a natural failure (**Tradeoff**). It reaches high speed in thick air, so q rises unless the engines throttle down. Fail only if q or g exceed limits and the build has no throttle-down. |
| Total delta-v | Short of the requirement, so it flies a suborbital arc (**Real**). | Not a failure by itself (**Real**). A bigger tank pulls TWR down or adds mass, with diminishing returns from the fixed structural fraction. |
| Drag area (Cd x A) | A narrow rocket needs a long thin tank, which bends under q times angle of attack (**Real**). The slenderness limit is a **Game rule**, about 20. | More drag loss (**Real**, but small: 0.1 to 0.15 km/s in the literature, 0.03 km/s in our prototype). |
| CP vs CM margin | **Guided rocket:** a negative margin is not a failure by itself. Real launch vehicles are typically aerodynamically unstable and rely on thrust vectoring. It fails only when the destabilizing torque exceeds gimbal authority. In our sim, 1 diameter ahead still reached orbit and 3.7 diameters ahead tumbled (**Real**). **Unguided rocket:** a negative margin tumbles, and near zero is sensitive to gusts (**Real**). | Fin-stabilized rockets weathercock, meaning they turn into the wind and drift (**Real**). On guided vehicles, pure angle-of-attack feedback also turns the vehicle into the wind and pulls it off trajectory. The effect is drift, not breakup. Treating it as a failure is a **Game rule**. |
| Peak g | Not independent. "Too low" really means low TWR. | Above the payload's rated limit, the payload is at risk (**Real** constraint). The rating value and the "payload lost" outcome are a **Game rule**. Make the rating a payload property. |

## Table 2. Combinations that fail

| Name | Signature | What happens | Why | Status |
|---|---|---|---|---|
| Firecracker | High TWR, low delta-v | Violent climb, then it runs dry and falls back | Many engines on a small tank: all power, no fuel. This is the sounding-rocket profile. | Real |
| Overpowered stack | High TWR, high delta-v, peak g over the limit | Reaches orbit but exceeds the payload limit near burnout | Peak g is thrust over burnout mass. Real launchers throttle or shut engines down, so it is a failure only in builds with no throttle limit. | Real (failure is a game option) |
| Fuel hog | High delta-v, low TWR | Great numbers on paper, but it sits on the pad or crawls | The big tank adds mass and pulls TWR down. | Real |
| Grinder | Low TWR, delta-v fine on paper | Suborbital | Slow climb means large gravity loss. Loss as a share of delta-v is about g divided by thrust acceleration. Healthy builds lose 1.0 to 1.5 km/s. | Real |
| Thin margin | Delta-v barely above the requirement | Falls short by a few hundred m/s | Gravity, drag and steering losses eat the surplus. | Real |
| Max-Q overload | High TWR with no throttle-down, or a large angle of attack at high q | Structural breakup around a minute in | The load is mainly q times angle of attack (bending), driven by wind and steering, plus q itself. Real vehicles throttle down before max-Q and use load relief. | Real |
| Pencil | Low drag area, big tank | Bends at max-Q | Narrow means long, and long thin bodies flex. | Real mechanism, limit is a Game rule |
| Control saturation | Large negative margin, guided | Loss of control | The aerodynamic torque exceeds the gimbal's authority, so the angle of attack grows without bound. Sim: it happened at 3.7 diameters ahead, not at 1. | Real |
| Unguided tumbler | Negative margin, no active control | Tumbles and breaks up | Nothing opposes the destabilizing torque. Only for a fin-stabilized mode. | Real |
| Wind drift | Very large margin, strong wind | Drifts off the planned trajectory | The rocket turns into the wind and the pitch program no longer tracks. This is drift, not breakup. | Game rule |
| Everything sags | Low TWR and low delta-v together | Fails several checks at once | One heavy payload lowers both. | Real |
| Weak upper stage | Good liftoff TWR, tiny upper engine | Can't climb or hold altitude after staging | Liftoff TWR hides upper-stage TWR. It fails when it ignites low and slow. An upper-stage TWR under 1 is not automatically a failure. | Unverified |

## Table 3. Which lever moves which number

| Lever (increased) | TWR | Delta-v | Drag area | Margin | Peak g |
|---|---|---|---|---|---|
| Payload mass | down | down | no change | up (mass high in the stack) | down (heavier at burnout) |
| Stage 1 tank | down | up, then flattens | no change (length grows) | down (propellant sits low). Sim: 2.0 diameters at liftoff, 4.1 at burnout. | about unchanged (slightly down as dry mass rises) |
| Engine count | up | no change today, down if engines get mass | no change | no change today, down if engines get mass | up |
| Fairing diameter | no change | slightly down (drag loss) | up | depends | no change |
| Fin size | no change | no change today (should cost mass) | no change today (should add drag) | up | no change |
| Upper stage tank | slightly down | up | no change | up slightly (mass high in the stack) | about unchanged |

The "Everything sags" row comes straight from the payload line: it lowers TWR and delta-v together.

---

## Suggested starting thresholds (all Game rules, tune against test builds)

| Check | Warn | Fail |
|---|---|---|
| Liftoff TWR | below 1.15 | below 1.0 |
| Rocket-equation delta-v | below about 9.5 km/s | below about 9.3 km/s |
| Peak g | above the payload rating (default about 4 to 5 g, Shuttle used 3 g) | above the rating with no throttle limit |
| Slenderness (length / diameter) | above about 15 | above about 20, or a failed bending check |
| Margin, guided | negative | destabilizing torque exceeds gimbal authority |
| Margin, unguided | below 1 diameter | negative |
| q times angle of attack | above about 70% of the structural limit | above the limit |

## Removed or downgraded from the earlier draft

- **"Kite" (high drag area, light rocket):** removed. Drag loss is small for heavy vehicles, and higher drag lowers speed, which lowers q. Keep it only as a minor effect for very light vehicles.
- **"Weathervane breaks the pitch program":** downgraded to "Wind drift," a game rule.
- **"CP ahead of CM always tumbles":** corrected to depend on guided or unguided mode.
- **Delta-v threshold "after losses":** corrected, see "How the numbers connect."

## Gaps to close

- **Fins are free.** They only move the margin, so a player just maxes them. Give them mass and a drag term.
- **Engines are free.** Dry mass comes from tank size alone. Add engine mass so engine count has a cost.
- **Stability only matters in air.** In the reference build the fins ride on stage 1 and drop at separation, but the sim kept the same center of pressure afterward. Check the margin only while dynamic pressure is meaningful.
- **Show per-stage TWR and peak g.** The five aggregate numbers hide the weak upper stage.
- **Guided or unguided:** decide whether the game has both modes, since the margin rule depends on it.
- **Prototype guidance wastes delta-v.** In the reference flight, ideal delta-v was 9,992 m/s. Speed gained was 7,336, gravity loss 1,306 and drag loss 30. That leaves about 1,320 m/s unexplained, which should be steering loss and looks high. Investigate the upper-stage guidance before trusting thresholds.
- **Drag loss looks low.** 0.03 km/s against 0.1 to 0.15 km/s in the literature. This is likely the fixed Cd of 0.3 on a heavy vehicle.

## What was tested and what was not

**Measured on the prototype flight data**
- Gravity loss 1,306 m/s, drag loss 30 m/s, max-Q 30.0 kPa at T+66 s.
- Stage 1 peak g: TWR 1.35 times mass ratio 3.30 gives 4.45 g, or 4.9 g with vacuum thrust.
- Stage 2 unthrottled: about 9.0 g with 1.5 t left, 10.5 g at full burnout.
- Margin: 2.0 diameters at liftoff, 4.1 at stage 1 burnout.

**Simulated with the gimbal autopilot**

| CP position | Margin at liftoff | Max angle of attack in air | Result |
|---|---|---|---|
| 9 m above base | +2.0 diameters | 0.7 degrees | Orbit, 181 by 240 km |
| 20 m above base | -1.0 diameters | 1.9 degrees | Orbit, 180 by 258 km |
| 30 m above base | -3.7 diameters | 180 degrees | No orbit, impact |

**Not simulated:** the failure combinations in Table 2 (Firecracker, Fuel hog and the rest) are checked against sources and arithmetic only.

## Sources and confidence

- Gravity loss and the LEO delta-v budget (9 to 10 km/s, losses 1.5 to 2 km/s): Wikipedia, "Gravity loss."
- Loss ranges (gravity 1000 to 1500 m/s, drag 100 to 150 m/s, LEO about 9.5 km/s total): "Multidisciplinary Design Optimization of Reusable Launch Vehicles" (arXiv 2009.01664).
- Launch vehicles are typically aerodynamically unstable and use thrust vectoring: NASA NTRS 20110015701, and the IEEE CSS Ares I-X overview.
- Pure angle-of-attack feedback turns the vehicle into the wind: NASA NESC Academy flight control lecture.
- Q-alpha as bending load, and load relief: US patent 6,666,410.
- Max-Q, throttling before max-Q, and about 0.3 atmospheres for Shuttle, Apollo and Falcon 9: Wikipedia, "Max q."
- Shuttle engines throttled to hold 3 g: NASA NTRS 19760020214.
- Saturn V liftoff TWR of 1.2: Saturn V study on generalstaff.org.
- Falcon 9 size (70 m by 3.7 m) and thrust and mass (7,607 kN, about 549 t): orbitalradar.com. TWR of 1.4 and slenderness of about 19 are our arithmetic from these.

Confidence: the aerodynamic stability, max-Q and loss-budget claims are well supported. The Saturn V and Falcon 9 figures come from an archived document and spec aggregators, so treat them as approximate. The "Weak upper stage" entry is unverified.