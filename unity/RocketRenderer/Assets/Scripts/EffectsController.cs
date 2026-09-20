using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace Apogee.RocketRenderer
{
    /// <summary>
    /// Every visual effect, driven by telemetry rather than by a timeline.
    ///
    /// Nothing here decides when something happens: throttle, Mach, dynamic
    /// pressure, altitude and the frame's event list say so. That is what keeps
    /// the effects honest when the player scrubs — the flame is bright because
    /// the recorded throttle at that instant was high, not because a clip is
    /// playing.
    ///
    /// Three rules hold across all of them:
    ///  * `discontinuity` (a seek or a restart) clears every particle and trail;
    ///  * above 10x playback, emission stops — particles read as streaks and
    ///    cost frames for nothing;
    ///  * while paused, the effects freeze rather than drifting on.
    ///
    /// Floating origin: the vehicle sits at the origin and the world moves down
    /// past it. Anything that must hang in the air where it was made — the
    /// contrail, the pad smoke, a fuel leak — is emitted in local space under
    /// <see cref="groundRoot"/>, which tracks ground level each frame. A
    /// particle left at a fixed local height under that root therefore stays at
    /// the altitude it was born at, which is exactly what a trail should do.
    /// World-space simulation would instead glue it to the camera and look wrong.
    ///
    /// These are built-in ParticleSystems rather than VFX Graph assets, because
    /// a .vfx asset only exists once it has been authored in the editor and this
    /// project is built from source. Swapping an emitter for a VFX Graph asset
    /// later is local to this file.
    ///
    /// Budget: this targets a WebGL build, so emission rates — not just max
    /// particle counts — are held down, per-engine rates fall as engine count
    /// rises (<see cref="PerEngineScale"/>), and every one-shot effect is a
    /// burst system that costs nothing until its event fires.
    /// </summary>
    public class EffectsController : MonoBehaviour
    {
        /// <summary>Emission stops above this playback speed.</summary>
        public const float MaxEmissionPlaybackSpeed = 10f;

        /// <summary>Scale height used for the pressure ratio that widens the plume.</summary>
        private const float ScaleHeightM = 7200f;

        /// <summary>Shock diamonds only form in over-expanded flow, low down.</summary>
        private const float DiamondFadeAltitudeM = 26_000f;
        private const int DiamondCount = 4;

        /// <summary>Contrail band: thin, cold air, above the weather.</summary>
        private const float ContrailStartM = 7_000f;
        private const float ContrailEndM = 38_000f;

        /// <summary>
        /// One engine's flame: a white-hot core inside a wider orange plume,
        /// with a chain of shock diamonds hanging below the nozzle.
        /// </summary>
        private class EnginePlume
        {
            public ParticleSystem Core;
            public ParticleSystem Flame;
            public Transform Diamonds;
            public bool IsStage1;
        }

        private RocketBuilder rocket;
        private Transform plumeRoot;
        private Transform groundRoot;

        private EnginePlume[] engines = new EnginePlume[0];
        private Material diamondMaterial;

        private ParticleSystem padSmoke;
        private ParticleSystem groundDust;
        private ParticleSystem sparks;
        private ParticleSystem heatShimmer;
        private ParticleSystem contrail;
        private ParticleSystem stagingBurst;
        private ParticleSystem separationMotors;
        private ParticleSystem separationIce;
        private ParticleSystem shockRing;
        private ParticleSystem fuelLeak;
        private ParticleSystem explosionFlash;
        private ParticleSystem explosionFragments;
        private ParticleSystem explosionSmoke;

        private Light engineLight;
        private Light flashLight;
        private Transform vaporCone;
        private Material vaporMaterial;

        private Volume postVolume;
        private Bloom bloom;
        private ChromaticAberration chromatic;
        private LensDistortion lensDistortion;
        private ColorAdjustments colorAdjustments;

        /// <summary>Seconds of chromatic pulse left from a max-Q crossing.</summary>
        private float chromaticPulse;

        /// <summary>Seconds left on the ignition / staging light flash.</summary>
        private float flashPulse;

        /// <summary>
        /// Set by `stage1_burnout`, cleared by `stage2_ignition`: the coast where
        /// the first stage is dead and the second has not lit. Belt and braces —
        /// the sim's own throttle already falls to zero here — but it guarantees
        /// the plume goes out *before* the stages part and comes back after.
        /// </summary>
        private bool plumeSuppressed;

        /// <summary>Latched by a `failed` event and cleared by a seek.</summary>
        private bool failed;
        private bool exploded;

        /// <summary>Per-engine sputter phase, so a dying engine stutters alone.</summary>
        private float[] sputterSeeds = new float[0];

        public void Build(RocketBuilder builder, Transform vehicleRoot, Transform worldRoot)
        {
            rocket = builder;

            plumeRoot = new GameObject("Plumes").transform;
            plumeRoot.SetParent(vehicleRoot, false);

            // Tracks ground level under the vehicle. Everything that must stay
            // where it was made hangs off this: as the rocket climbs, this root
            // moves down, carrying old particles with it.
            groundRoot = new GameObject("GroundRoot").transform;
            groundRoot.SetParent(worldRoot, false);

            engineLight = new GameObject("EngineLight").AddComponent<Light>();
            engineLight.transform.SetParent(vehicleRoot, false);
            engineLight.type = LightType.Point;
            engineLight.color = new Color(1f, 0.69f, 0.4f);
            engineLight.range = 400f;
            engineLight.intensity = 0f;

            // A second light purely for ignition and staging: a hard, short
            // flash reads as the shock of the engines catching.
            flashLight = new GameObject("FlashLight").AddComponent<Light>();
            flashLight.transform.SetParent(vehicleRoot, false);
            flashLight.type = LightType.Point;
            flashLight.color = new Color(1f, 0.87f, 0.66f);
            flashLight.range = 1_200f;
            flashLight.intensity = 0f;

            diamondMaterial = AdditiveMeshMaterial(new Color(0.62f, 0.78f, 1f, 0f));

            padSmoke = BuildPadSmoke(groundRoot);
            groundDust = BuildGroundDust(groundRoot);
            sparks = BuildSparks(groundRoot);
            contrail = BuildContrail(groundRoot);
            fuelLeak = BuildFuelLeak(groundRoot);

            heatShimmer = BuildHeatShimmer(vehicleRoot);
            stagingBurst = BuildStagingBurst(vehicleRoot);
            separationMotors = BuildSeparationMotors(vehicleRoot);
            separationIce = BuildSeparationIce(vehicleRoot);
            shockRing = BuildShockRing(vehicleRoot);
            explosionFlash = BuildExplosionFlash(vehicleRoot);
            explosionFragments = BuildExplosionFragments(vehicleRoot);
            explosionSmoke = BuildExplosionSmoke(vehicleRoot);

            BuildVaporCone(vehicleRoot);
            BuildPostProcessing();
        }

        /// <summary>Rebuild the per-engine plumes for a newly built vehicle.</summary>
        public void RebuildPlumes()
        {
            for (int i = plumeRoot.childCount - 1; i >= 0; i--)
            {
                Destroy(plumeRoot.GetChild(i).gameObject);
            }
            if (rocket == null || rocket.Geometry == null)
            {
                engines = new EnginePlume[0];
                sputterSeeds = new float[0];
                return;
            }

            Vector3[] positions = rocket.Stage1NozzlePositions;
            float perEngine = PerEngineScale(positions.Length);

            engines = new EnginePlume[positions.Length + 1];
            for (int i = 0; i < positions.Length; i++)
            {
                engines[i] = BuildEnginePlume(
                    $"Stage1Engine{i}",
                    rocket.Geometry.stage1NozzleDiameter,
                    positions[i],
                    true,
                    perEngine);
            }
            // The last entry is the upper stage's single, smaller plume.
            engines[positions.Length] = BuildEnginePlume(
                "Stage2Engine",
                rocket.Geometry.stage2NozzleDiameter,
                rocket.Stage2NozzlePosition,
                false,
                1f);

            sputterSeeds = new float[engines.Length];
            for (int i = 0; i < sputterSeeds.Length; i++)
            {
                // A fixed per-engine offset keeps each one stuttering out of
                // step with its neighbours, and keeps it identical on a replay.
                sputterSeeds[i] = i * 13.37f;
            }

            if (vaporCone != null)
            {
                float d = rocket.Geometry.diameter;
                vaporCone.localScale = new Vector3(d * 1.9f, d * 1.1f, d * 1.9f);
            }
        }

        /// <summary>
        /// Emission scale per engine. Nine engines must not cost nine times one
        /// engine, and at that count no one can pick out an individual plume.
        /// </summary>
        private static float PerEngineScale(int engineCount)
        {
            return Mathf.Clamp(3f / Mathf.Max(1, engineCount), 0.4f, 1f);
        }

        public void Apply(RenderFrameDto frame)
        {
            if (frame.discontinuity)
            {
                ClearAll();
            }

            float altitude = Mathf.Max(0f, frame.altitude);

            // Keep the ground-anchored root at ground level: the origin is the
            // centre of mass, so the pad is that much further down again.
            if (groundRoot != null)
            {
                groundRoot.localPosition = new Vector3(0f, -(altitude + frame.comFromBase), 0f);
            }

            ApplyEvents(frame, altitude);

            bool live = frame.playing && frame.playbackSpeed <= MaxEmissionPlaybackSpeed;
            bool emitting = live && frame.throttle > 0.02f && !plumeSuppressed;

            // Ambient pressure ratio: the plume widens as the air thins.
            float pressureRatio = Mathf.Exp(-altitude / ScaleHeightM);
            float spread = Mathf.Lerp(2.5f, 1f, pressureRatio);

            ApplyPlumes(frame, emitting, spread, altitude);
            ApplyPadEffects(frame, live, altitude);
            ApplyHeatShimmer(frame, emitting, altitude);
            ApplyContrail(frame, live, altitude);
            ApplyLights(frame, altitude);
            ApplyVaporCone(frame, altitude);
            ApplyFailure(frame, live, altitude);
            ApplyPostProcessing(frame, altitude);
            SetPaused(!frame.playing);
        }

        // -- individual effects ------------------------------------------------

        /// <summary>
        /// The flame itself. Length and brightness track throttle; width tracks
        /// falling ambient pressure; the shock diamonds only show while the
        /// nozzle is over-expanded, which is to say low down and at high power.
        /// </summary>
        private void ApplyPlumes(RenderFrameDto frame, bool emitting, float spread, float altitude)
        {
            if (rocket == null || rocket.Geometry == null)
            {
                return;
            }
            // A flicker keeps the flame alive without an animation curve.
            float flicker = 0.92f + 0.08f * Mathf.PerlinNoise(frame.t * 9f, 0f);
            float diameter = rocket.Geometry.diameter;

            for (int i = 0; i < engines.Length; i++)
            {
                EnginePlume engine = engines[i];
                if (engine == null)
                {
                    continue;
                }
                bool stageLive = engine.IsStage1 ? frame.stage == 1 : frame.stage == 2;
                bool active = emitting && stageLive;

                // A failing engine coughs: the plume drops out in bursts, and
                // each engine does it on its own beat so the stack looks lopsided.
                float sputter = 1f;
                if (failed && active)
                {
                    float seed = i < sputterSeeds.Length ? sputterSeeds[i] : 0f;
                    sputter = Mathf.PerlinNoise(frame.t * 7f + seed, seed);
                    sputter = Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(0.25f, 0.65f, sputter));
                }

                float power = frame.throttle * sputter;
                bool burning = active && power > 0.02f;

                var coreEmission = engine.Core.emission;
                var flameEmission = engine.Flame.emission;
                coreEmission.enabled = burning;
                flameEmission.enabled = burning;

                if (engine.Diamonds != null)
                {
                    // Diamonds need a genuinely supersonic, over-expanded exhaust:
                    // high throttle, thick air, first stage.
                    float atmosphere = 1f - Mathf.Clamp01(altitude / DiamondFadeAltitudeM);
                    float strength = burning && engine.IsStage1
                        ? Mathf.Clamp01((power - 0.55f) / 0.45f) * atmosphere
                        : 0f;
                    engine.Diamonds.gameObject.SetActive(strength > 0.02f);
                    engine.Diamonds.localScale = new Vector3(1f, Mathf.Lerp(0.7f, 1.25f, power), 1f);
                    if (diamondMaterial != null && strength > 0.02f)
                    {
                        Color color = diamondMaterial.color;
                        color.a = 0.75f * strength * flicker;
                        SetMaterialColor(diamondMaterial, color);
                    }
                }

                if (!burning)
                {
                    continue;
                }

                float scale = engine.IsStage1 ? 1f : 0.62f;

                // Core: short, fast, white-hot, tight to the nozzle.
                var coreMain = engine.Core.main;
                coreMain.startLifetimeMultiplier = scale * (0.05f + 0.10f * power) * flicker;
                coreMain.startSizeMultiplier = scale * diameter * 0.15f * flicker;

                // Flame: the long orange body, widening as the air thins.
                var flameMain = engine.Flame.main;
                flameMain.startLifetimeMultiplier = scale * (0.10f + 0.30f * power) * flicker;
                flameMain.startSizeMultiplier = scale * diameter * 0.24f * spread * flicker;

                var shape = engine.Flame.shape;
                shape.angle = Mathf.Lerp(3f, 17f, 1f - Mathf.Exp(-altitude / 20_000f));
            }
        }

        /// <summary>
        /// The pad: steam and smoke rolling sideways off the deflector, a dust
        /// ring thrown out at ignition, and sparks off the flame trench. All of
        /// it fades out as the vehicle climbs away, with the smoke lingering
        /// longest because a real pad keeps smoking after the rocket has gone.
        /// </summary>
        private void ApplyPadEffects(RenderFrameDto frame, bool live, float altitude)
        {
            // Smoke hangs around well after liftoff; the exhaust stops feeding
            // it much sooner. Two different falloffs, deliberately.
            float blast = 1f - Mathf.Clamp01(altitude / 420f);
            float lingering = 1f - Mathf.Clamp01(altitude / 2_600f);

            if (padSmoke != null)
            {
                var emission = padSmoke.emission;
                bool active = live && lingering > 0.01f && (frame.throttle > 0.02f || blast > 0.01f);
                emission.enabled = active;
                // Fed hard by the exhaust while it is close, then left to smoulder.
                emission.rateOverTimeMultiplier =
                    260f * lingering * (0.25f + 0.75f * blast * frame.throttle);
            }

            if (sparks != null)
            {
                var emission = sparks.emission;
                bool active = live && blast > 0.02f && frame.throttle > 0.05f;
                emission.enabled = active;
                emission.rateOverTimeMultiplier = 140f * blast * frame.throttle;
                // Sparks are thrown from the base of the flame, not the pad deck.
                sparks.transform.localPosition = new Vector3(0f, Mathf.Min(altitude, 40f), 0f);
            }
        }

        /// <summary>
        /// Heat haze behind the nozzles. Deliberately faint and slow: the note
        /// on this one was that it must not read as water, so it is a wide, very
        /// low-alpha, noise-driven wobble rather than anything with an edge.
        /// </summary>
        private void ApplyHeatShimmer(RenderFrameDto frame, bool emitting, float altitude)
        {
            if (heatShimmer == null || rocket == null || rocket.Geometry == null)
            {
                return;
            }
            // Needs dense air to refract through: strongest on the pad, gone by
            // the time the sky goes dark.
            float density = 1f - Mathf.Clamp01(altitude / 18_000f);
            float strength = emitting ? frame.throttle * density : 0f;

            var emission = heatShimmer.emission;
            emission.enabled = strength > 0.03f;
            emission.rateOverTimeMultiplier = 26f * strength;

            var main = heatShimmer.main;
            main.startSizeMultiplier = rocket.Geometry.diameter * (1.6f + 1.2f * strength);
            main.startColor = new Color(1f, 0.93f, 0.85f, 0.05f + 0.06f * strength);

            heatShimmer.transform.localPosition =
                new Vector3(0f, -(frame.comFromBase + rocket.Geometry.diameter * 2.2f), 0f);
        }

        /// <summary>
        /// The vapour trail. Emitted into the ground-anchored root so each puff
        /// stays at the altitude it was made at and the trail falls away behind
        /// the vehicle instead of following it.
        /// </summary>
        private void ApplyContrail(RenderFrameDto frame, bool live, float altitude)
        {
            if (contrail == null)
            {
                return;
            }
            float band = Mathf.Clamp01((altitude - ContrailStartM) / 4_000f)
                * (1f - Mathf.Clamp01((altitude - ContrailEndM) / 9_000f));
            bool active = live && frame.throttle > 0.05f && band > 0.02f && !plumeSuppressed;

            var emission = contrail.emission;
            emission.enabled = active;
            emission.rateOverTimeMultiplier = 34f * band;

            // Emit at the engine's height above ground, in the root's local space.
            contrail.transform.localPosition = new Vector3(0f, altitude, 0f);

            var main = contrail.main;
            main.startColor = new Color(1f, 1f, 1f, 0.16f * band);
        }

        /// <summary>
        /// The exhaust as a light source. The point light under the engines is
        /// what actually puts orange on the pad and the underside of the stack;
        /// it is pointless once there is nothing nearby to light, so it falls
        /// off with altitude. The flash light is the separate ignition kick.
        /// </summary>
        private void ApplyLights(RenderFrameDto frame, float altitude)
        {
            if (engineLight != null)
            {
                float proximity = 1f - Mathf.Clamp01(altitude / 8_000f);
                float power = plumeSuppressed ? 0f : frame.throttle;
                engineLight.intensity = power * (0.6f + 3.2f * proximity);
                engineLight.range = Mathf.Lerp(220f, 620f, power);
                // Hotter and whiter at full power, sullen orange at low throttle.
                engineLight.color = Color.Lerp(
                    new Color(1f, 0.55f, 0.24f),
                    new Color(1f, 0.82f, 0.58f),
                    power);
                engineLight.transform.localPosition =
                    new Vector3(0f, -(frame.comFromBase + 4f), 0f);
            }

            if (flashLight != null)
            {
                flashPulse = Mathf.Max(0f, flashPulse - Time.unscaledDeltaTime * 3.2f);
                // Squared falloff makes it a snap rather than a fade.
                flashLight.intensity = 26f * flashPulse * flashPulse;
                flashLight.enabled = flashPulse > 0.01f;
                flashLight.transform.localPosition =
                    new Vector3(0f, -(frame.comFromBase + 2f), 0f);
            }
        }

        private void ApplyVaporCone(RenderFrameDto frame, float altitude)
        {
            if (vaporCone == null)
            {
                return;
            }
            // Transonic condensation: a narrow Mach window, in thick enough air.
            float machWindow = 1f - Mathf.Clamp01(Mathf.Abs(frame.mach - 1.02f) / 0.2f);
            float altitudeWindow =
                Mathf.Clamp01((altitude - 2_000f) / 3_000f) * (1f - Mathf.Clamp01((altitude - 14_000f) / 4_000f));
            // Dynamic pressure is what actually drives the condensation, so a
            // gentle transonic pass through thin air stays dry.
            float loading = Mathf.Clamp01(frame.q / 18_000f);
            float strength = machWindow * altitudeWindow * loading;

            vaporCone.gameObject.SetActive(strength > 0.02f);
            if (strength > 0.02f)
            {
                vaporCone.localPosition = new Vector3(0f, -frame.comFromBase * 0.15f, 0f);
                if (vaporMaterial != null)
                {
                    Color color = vaporMaterial.color;
                    color.a = 0.5f * strength;
                    SetMaterialColor(vaporMaterial, color);
                }
            }
        }

        /// <summary>
        /// Event-driven one-shots. Every one of these is a burst system, so it
        /// costs nothing on the frames where its event did not fire.
        /// </summary>
        private void ApplyEvents(RenderFrameDto frame, float altitude)
        {
            if (frame.HasEvent("liftoff"))
            {
                flashPulse = 1f;
                if (groundDust != null)
                {
                    groundDust.Play();
                }
                if (sparks != null)
                {
                    sparks.Emit(90);
                }
            }

            // The plume must be out before the stages part and back after the
            // upper stage catches — never burning across the separation itself.
            if (frame.HasEvent("stage1_burnout"))
            {
                plumeSuppressed = true;
            }
            if (frame.HasEvent("stage2_ignition"))
            {
                plumeSuppressed = false;
                flashPulse = 0.85f;
            }
            if (frame.HasEvent("circularization_ignition"))
            {
                plumeSuppressed = false;
                flashPulse = 0.5f;
            }

            if (frame.HasEvent("separation"))
            {
                float y = -frame.comFromBase;
                PlayAt(stagingBurst, y);
                PlayAt(separationMotors, y);
                PlayAt(separationIce, y);
            }

            if (frame.HasEvent("fairing_jettison"))
            {
                PlayAt(separationIce, -frame.comFromBase * 0.2f);
            }

            if (frame.HasEvent("max_q"))
            {
                if (shockRing != null)
                {
                    shockRing.Play();
                }
                chromaticPulse = 0.6f;
            }

            if (frame.HasEvent("failed"))
            {
                failed = true;
                // A failure already at the ground is an impact: it explodes now.
                // A failure up high is a sick vehicle that explodes when it
                // arrives. Only the event id crosses the wire, so altitude is
                // what separates the two.
                if (altitude < 500f)
                {
                    Explode(frame);
                }
            }

            // A vehicle that failed aloft detonates when it reaches the ground.
            if (failed && !exploded && altitude < 120f)
            {
                Explode(frame);
            }
        }

        /// <summary>
        /// Post-failure distress: a fuel leak streaming from the breach, trailing
        /// away behind the vehicle. The engine sputter and the lopsided thrust
        /// are handled per-engine in <see cref="ApplyPlumes"/>.
        /// </summary>
        private void ApplyFailure(RenderFrameDto frame, bool live, float altitude)
        {
            if (fuelLeak == null)
            {
                return;
            }
            bool active = live && failed && !exploded && altitude > 30f;
            var emission = fuelLeak.emission;
            emission.enabled = active;
            if (active)
            {
                fuelLeak.transform.localPosition =
                    new Vector3(0f, altitude + frame.comFromBase * 0.35f, 0f);
            }
        }

        private void Explode(RenderFrameDto frame)
        {
            if (exploded)
            {
                return;
            }
            exploded = true;
            float y = -frame.comFromBase * 0.4f;
            PlayAt(explosionFlash, y);
            PlayAt(explosionFragments, y);
            PlayAt(explosionSmoke, y);
            if (shockRing != null)
            {
                shockRing.Play();
            }
            flashPulse = 1.6f;
            chromaticPulse = 1.4f;
        }

        private static void PlayAt(ParticleSystem system, float localY)
        {
            if (system == null)
            {
                return;
            }
            Vector3 position = system.transform.localPosition;
            position.y = localY;
            system.transform.localPosition = position;
            system.Play();
        }

        private void ApplyPostProcessing(RenderFrameDto frame, float altitude)
        {
            chromaticPulse = Mathf.Max(0f, chromaticPulse - Time.unscaledDeltaTime);

            if (chromatic != null)
            {
                chromatic.intensity.value = 0.05f + 0.55f * chromaticPulse;
            }
            if (bloom != null)
            {
                // Only flame and lights should bloom, so the threshold sits well
                // above the brightest surface in the scene.
                bloom.threshold.value = 1.1f;
                bloom.intensity.value = 0.65f + 0.75f * frame.throttle + 0.9f * chromaticPulse;
            }
            if (lensDistortion != null)
            {
                // A barrel pull under load — the lens complaining about the ride.
                float load = Mathf.Clamp01(frame.q / 42_000f) * Mathf.Clamp01(frame.throttle);
                lensDistortion.intensity.value = -0.09f * load - 0.16f * chromaticPulse;
            }
            if (colorAdjustments != null)
            {
                // Lift exposure a little as the sky darkens, so orbit does not
                // read as a black frame with a grey rocket in it.
                float space = Mathf.Clamp01((altitude - 60_000f) / 60_000f);
                colorAdjustments.postExposure.value = 0.15f * space + 0.35f * chromaticPulse;
            }
        }

        private void SetPaused(bool paused)
        {
            foreach (ParticleSystem system in AllSystems())
            {
                if (system == null)
                {
                    continue;
                }
                if (paused && system.isPlaying)
                {
                    system.Pause(true);
                }
                else if (!paused && system.isPaused)
                {
                    system.Play(true);
                }
            }
        }

        /// <summary>
        /// Wipe every particle and trail. Called on a seek or a restart: without
        /// it, scrubbing back leaves a plume hanging in the sky.
        /// </summary>
        public void ClearAll()
        {
            foreach (ParticleSystem system in AllSystems())
            {
                if (system != null)
                {
                    system.Clear(true);
                }
            }
            chromaticPulse = 0f;
            flashPulse = 0f;
            plumeSuppressed = false;
            failed = false;
            exploded = false;
        }

        private IEnumerable<ParticleSystem> AllSystems()
        {
            for (int i = 0; i < engines.Length; i++)
            {
                if (engines[i] == null)
                {
                    continue;
                }
                yield return engines[i].Core;
                yield return engines[i].Flame;
            }
            yield return padSmoke;
            yield return groundDust;
            yield return sparks;
            yield return heatShimmer;
            yield return contrail;
            yield return stagingBurst;
            yield return separationMotors;
            yield return separationIce;
            yield return shockRing;
            yield return fuelLeak;
            yield return explosionFlash;
            yield return explosionFragments;
            yield return explosionSmoke;
        }

        // -- construction -------------------------------------------------------

        private EnginePlume BuildEnginePlume(
            string name,
            float nozzleDiameter,
            Vector3 localPosition,
            bool isStage1,
            float emissionScale)
        {
            var root = new GameObject(name).transform;
            root.SetParent(plumeRoot, false);
            root.localPosition = localPosition;

            var plume = new EnginePlume
            {
                IsStage1 = isStage1,
                Core = BuildFlameCore(root, nozzleDiameter, emissionScale),
                Flame = BuildFlameBody(root, nozzleDiameter, emissionScale),
                Diamonds = BuildDiamondChain(root, nozzleDiameter),
            };
            return plume;
        }

        /// <summary>The white-hot throat: short, fast and nearly colourless.</summary>
        private static ParticleSystem BuildFlameCore(
            Transform parent, float nozzleDiameter, float emissionScale)
        {
            var go = new GameObject("Core");
            go.transform.SetParent(parent, false);
            var system = go.AddComponent<ParticleSystem>();

            var main = system.main;
            main.startSpeed = 190f;
            main.startLifetime = 0.12f;
            main.startSize = Mathf.Max(0.35f, nozzleDiameter * 0.5f);
            main.startColor = new ParticleSystem.MinMaxGradient(
                new Color(1f, 1f, 0.97f),
                new Color(1f, 0.93f, 0.7f));
            main.maxParticles = 90;
            main.simulationSpace = ParticleSystemSimulationSpace.Local;
            main.gravityModifier = 0f;

            var emission = system.emission;
            emission.rateOverTime = 260f * emissionScale;

            var shape = system.shape;
            shape.shapeType = ParticleSystemShapeType.Cone;
            shape.angle = 1.5f;
            shape.radius = Mathf.Max(0.12f, nozzleDiameter * 0.22f);
            // The cone emits along its +Z; the plume goes down the rocket's -Y.
            shape.rotation = new Vector3(90f, 0f, 0f);

            var sizeOverLifetime = system.sizeOverLifetime;
            sizeOverLifetime.enabled = true;
            sizeOverLifetime.size = new ParticleSystem.MinMaxCurve(
                1f, AnimationCurve.EaseInOut(0f, 1f, 1f, 0.35f));

            var colorOverLifetime = system.colorOverLifetime;
            colorOverLifetime.enabled = true;
            colorOverLifetime.color = CoreGradient();

            var renderer = go.GetComponent<ParticleSystemRenderer>();
            renderer.renderMode = ParticleSystemRenderMode.Stretch;
            renderer.lengthScale = 2.4f;
            renderer.sharedMaterial = EarthView.UnlitAdditive(Color.white);
            return system;
        }

        /// <summary>The orange body of the flame, well outside the core.</summary>
        private static ParticleSystem BuildFlameBody(
            Transform parent, float nozzleDiameter, float emissionScale)
        {
            var go = new GameObject("Flame");
            go.transform.SetParent(parent, false);
            var system = go.AddComponent<ParticleSystem>();

            var main = system.main;
            main.startSpeed = 130f;
            main.startLifetime = 0.3f;
            main.startSize = Mathf.Max(0.5f, nozzleDiameter * 0.85f);
            main.startColor = new ParticleSystem.MinMaxGradient(
                new Color(1f, 0.85f, 0.5f),
                new Color(1f, 0.38f, 0.1f));
            main.maxParticles = 160;
            main.simulationSpace = ParticleSystemSimulationSpace.Local;
            main.gravityModifier = 0f;

            var emission = system.emission;
            emission.rateOverTime = 300f * emissionScale;

            var shape = system.shape;
            shape.shapeType = ParticleSystemShapeType.Cone;
            shape.angle = 4f;
            shape.radius = Mathf.Max(0.2f, nozzleDiameter * 0.38f);
            shape.rotation = new Vector3(90f, 0f, 0f);

            var sizeOverLifetime = system.sizeOverLifetime;
            sizeOverLifetime.enabled = true;
            sizeOverLifetime.size = new ParticleSystem.MinMaxCurve(
                1f, AnimationCurve.EaseInOut(0f, 0.45f, 1f, 2.4f));

            var colorOverLifetime = system.colorOverLifetime;
            colorOverLifetime.enabled = true;
            colorOverLifetime.color = FlameGradient();

            var renderer = go.GetComponent<ParticleSystemRenderer>();
            renderer.renderMode = ParticleSystemRenderMode.Stretch;
            renderer.lengthScale = 3.6f;
            renderer.sharedMaterial = EarthView.UnlitAdditive(Color.white);
            return system;
        }

        /// <summary>
        /// Mach diamonds as a chain of small octahedra down the plume axis.
        /// Built as one mesh so the whole chain is a single draw call, and shaped
        /// rather than billboarded so it still reads as a diamond from the side.
        /// </summary>
        private Transform BuildDiamondChain(Transform parent, float nozzleDiameter)
        {
            var go = new GameObject("ShockDiamonds");
            go.transform.SetParent(parent, false);

            float radius = Mathf.Max(0.18f, nozzleDiameter * 0.3f);
            float spacing = Mathf.Max(1.4f, nozzleDiameter * 2.1f);

            var filter = go.AddComponent<MeshFilter>();
            filter.sharedMesh = DiamondChainMesh(DiamondCount, spacing, radius);

            var renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = diamondMaterial;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;

            go.SetActive(false);
            return go.transform;
        }

        /// <summary>
        /// A run of octahedra along -Y, each a little smaller and dimmer than the
        /// last, which is how a real over-expanded plume's shock train decays.
        /// </summary>
        private static Mesh DiamondChainMesh(int count, float spacing, float radius)
        {
            var vertices = new List<Vector3>(count * 6);
            var triangles = new List<int>(count * 24);

            for (int i = 0; i < count; i++)
            {
                float decay = Mathf.Pow(0.78f, i);
                float r = radius * decay;
                float halfHeight = spacing * 0.42f * decay;
                float centre = -spacing * (i + 0.75f);
                int b = vertices.Count;

                vertices.Add(new Vector3(0f, centre + halfHeight, 0f)); // top
                vertices.Add(new Vector3(r, centre, 0f));
                vertices.Add(new Vector3(0f, centre, r));
                vertices.Add(new Vector3(-r, centre, 0f));
                vertices.Add(new Vector3(0f, centre, -r));
                vertices.Add(new Vector3(0f, centre - halfHeight, 0f)); // bottom

                for (int e = 0; e < 4; e++)
                {
                    int current = b + 1 + e;
                    int next = b + 1 + ((e + 1) % 4);
                    triangles.Add(b);
                    triangles.Add(next);
                    triangles.Add(current);
                    triangles.Add(b + 5);
                    triangles.Add(current);
                    triangles.Add(next);
                }
            }

            var mesh = new Mesh { name = "ShockDiamondChain" };
            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        /// <summary>
        /// Pad smoke: thrown outward along the deck rather than up, because that
        /// is what a flame deflector does with an exhaust column.
        /// </summary>
        private static ParticleSystem BuildPadSmoke(Transform parent)
        {
            var go = new GameObject("PadSmoke");
            go.transform.SetParent(parent, false);
            var system = go.AddComponent<ParticleSystem>();

            var main = system.main;
            main.startSpeed = new ParticleSystem.MinMaxCurve(28f, 62f);
            main.startLifetime = new ParticleSystem.MinMaxCurve(4f, 7.5f);
            main.startSize = new ParticleSystem.MinMaxCurve(18f, 34f);
            main.startColor = new Color(0.9f, 0.9f, 0.92f, 0.34f);
            main.maxParticles = 900;
            main.gravityModifier = -0.015f;
            main.startRotation = new ParticleSystem.MinMaxCurve(0f, Mathf.PI * 2f);

            var emission = system.emission;
            emission.rateOverTime = 260f;

            // A flat ring on the deck: the column has already hit the pad and
            // turned, so the smoke starts by going sideways.
            var shape = system.shape;
            shape.shapeType = ParticleSystemShapeType.Donut;
            shape.radius = 26f;
            shape.donutRadius = 10f;
            shape.rotation = new Vector3(90f, 0f, 0f);

            var velocity = system.velocityOverLifetime;
            velocity.enabled = true;
            velocity.space = ParticleSystemSimulationSpace.Local;
            velocity.radial = new ParticleSystem.MinMaxCurve(26f, 54f);
            velocity.y = new ParticleSystem.MinMaxCurve(3f, 11f);

            var limit = system.limitVelocityOverLifetime;
            limit.enabled = true;
            limit.dampen = 0.06f;

            var rotation = system.rotationOverLifetime;
            rotation.enabled = true;
            rotation.z = new ParticleSystem.MinMaxCurve(-0.5f, 0.5f);

            var sizeOverLifetime = system.sizeOverLifetime;
            sizeOverLifetime.enabled = true;
            sizeOverLifetime.size = new ParticleSystem.MinMaxCurve(
                1f, AnimationCurve.EaseInOut(0f, 0.4f, 1f, 3.2f));

            var colorOverLifetime = system.colorOverLifetime;
            colorOverLifetime.enabled = true;
            colorOverLifetime.color = SmokeGradient(new Color(0.95f, 0.95f, 0.97f));

            var renderer = go.GetComponent<ParticleSystemRenderer>();
            renderer.sharedMaterial = EarthView.UnlitAdditive(new Color(1f, 1f, 1f, 0.3f));
            renderer.sortMode = ParticleSystemSortMode.Distance;
            return system;
        }

        /// <summary>The dust ring thrown out along the ground at ignition.</summary>
        private static ParticleSystem BuildGroundDust(Transform parent)
        {
            var go = new GameObject("GroundDust");
            go.transform.SetParent(parent, false);
            var system = go.AddComponent<ParticleSystem>();

            var main = system.main;
            main.loop = false;
            main.playOnAwake = false;
            main.duration = 1.2f;
            main.startSpeed = new ParticleSystem.MinMaxCurve(80f, 190f);
            main.startLifetime = new ParticleSystem.MinMaxCurve(2.5f, 4.5f);
            main.startSize = new ParticleSystem.MinMaxCurve(14f, 30f);
            main.startColor = new ParticleSystem.MinMaxGradient(
                new Color(0.76f, 0.68f, 0.56f, 0.5f),
                new Color(0.55f, 0.48f, 0.4f, 0.45f));
            main.maxParticles = 300;
            main.gravityModifier = 0.04f;

            var emission = system.emission;
            emission.rateOverTime = 0f;
            emission.SetBursts(new[] { new ParticleSystem.Burst(0f, 180) });

            // A thin, flat ring hugging the deck — it expands outward, not up.
            var shape = system.shape;
            shape.shapeType = ParticleSystemShapeType.Circle;
            shape.radius = 18f;
            shape.radiusThickness = 0.15f;
            shape.rotation = new Vector3(90f, 0f, 0f);

            var velocity = system.velocityOverLifetime;
            velocity.enabled = true;
            velocity.space = ParticleSystemSimulationSpace.Local;
            velocity.y = new ParticleSystem.MinMaxCurve(1f, 7f);

            var limit = system.limitVelocityOverLifetime;
            limit.enabled = true;
            limit.dampen = 0.12f;

            var sizeOverLifetime = system.sizeOverLifetime;
            sizeOverLifetime.enabled = true;
            sizeOverLifetime.size = new ParticleSystem.MinMaxCurve(
                1f, AnimationCurve.EaseInOut(0f, 0.5f, 1f, 2.6f));

            var colorOverLifetime = system.colorOverLifetime;
            colorOverLifetime.enabled = true;
            colorOverLifetime.color = SmokeGradient(new Color(0.72f, 0.64f, 0.52f));

            go.GetComponent<ParticleSystemRenderer>().sharedMaterial =
                EarthView.UnlitAdditive(new Color(1f, 0.94f, 0.84f, 0.3f));
            return system;
        }

        /// <summary>Sparks off the trench: small, bright, gravity-bound.</summary>
        private static ParticleSystem BuildSparks(Transform parent)
        {
            var go = new GameObject("Sparks");
            go.transform.SetParent(parent, false);
            var system = go.AddComponent<ParticleSystem>();

            var main = system.main;
            main.startSpeed = new ParticleSystem.MinMaxCurve(45f, 130f);
            main.startLifetime = new ParticleSystem.MinMaxCurve(0.6f, 1.8f);
            main.startSize = new ParticleSystem.MinMaxCurve(0.6f, 1.8f);
            main.startColor = new ParticleSystem.MinMaxGradient(
                new Color(1f, 0.95f, 0.72f),
                new Color(1f, 0.6f, 0.2f));
            main.maxParticles = 160;
            main.gravityModifier = 1.1f;

            var emission = system.emission;
            emission.rateOverTime = 120f;

            var shape = system.shape;
            shape.shapeType = ParticleSystemShapeType.Cone;
            shape.angle = 62f;
            shape.radius = 8f;
            shape.rotation = new Vector3(-90f, 0f, 0f);

            var colorOverLifetime = system.colorOverLifetime;
            colorOverLifetime.enabled = true;
            colorOverLifetime.color = FadeOutGradient(new Color(1f, 0.72f, 0.3f));

            var renderer = go.GetComponent<ParticleSystemRenderer>();
            renderer.renderMode = ParticleSystemRenderMode.Stretch;
            renderer.lengthScale = 4.5f;
            renderer.sharedMaterial = EarthView.UnlitAdditive(Color.white);
            return system;
        }

        /// <summary>
        /// Heat haze: wide, almost transparent, and driven entirely by the noise
        /// module so it wobbles instead of drifting.
        /// </summary>
        private static ParticleSystem BuildHeatShimmer(Transform parent)
        {
            var go = new GameObject("HeatShimmer");
            go.transform.SetParent(parent, false);
            var system = go.AddComponent<ParticleSystem>();

            var main = system.main;
            main.startSpeed = new ParticleSystem.MinMaxCurve(6f, 18f);
            main.startLifetime = new ParticleSystem.MinMaxCurve(0.7f, 1.4f);
            main.startSize = 8f;
            main.startColor = new Color(1f, 0.93f, 0.85f, 0.07f);
            main.maxParticles = 60;
            main.gravityModifier = -0.04f;
            main.startRotation = new ParticleSystem.MinMaxCurve(0f, Mathf.PI * 2f);

            var emission = system.emission;
            emission.rateOverTime = 26f;

            var shape = system.shape;
            shape.shapeType = ParticleSystemShapeType.Cone;
            shape.angle = 24f;
            shape.radius = 3f;
            shape.rotation = new Vector3(90f, 0f, 0f);

            // The wobble. Low frequency and high damping keep it as a shimmer
            // rather than the rolling boil that reads as water.
            var noise = system.noise;
            noise.enabled = true;
            noise.strength = 5.5f;
            noise.frequency = 0.35f;
            noise.scrollSpeed = 1.6f;
            noise.damping = true;

            var sizeOverLifetime = system.sizeOverLifetime;
            sizeOverLifetime.enabled = true;
            sizeOverLifetime.size = new ParticleSystem.MinMaxCurve(
                1f, AnimationCurve.EaseInOut(0f, 0.6f, 1f, 1.9f));

            var colorOverLifetime = system.colorOverLifetime;
            colorOverLifetime.enabled = true;
            colorOverLifetime.color = FadeInOutGradient(new Color(1f, 0.96f, 0.9f));

            go.GetComponent<ParticleSystemRenderer>().sharedMaterial =
                EarthView.UnlitAdditive(new Color(1f, 1f, 1f, 0.09f));
            return system;
        }

        /// <summary>
        /// The contrail. Emitted with no speed into the ground-anchored root, so
        /// every puff simply stays where it was born.
        /// </summary>
        private static ParticleSystem BuildContrail(Transform parent)
        {
            var go = new GameObject("Contrail");
            go.transform.SetParent(parent, false);
            var system = go.AddComponent<ParticleSystem>();

            var main = system.main;
            main.startSpeed = new ParticleSystem.MinMaxCurve(1f, 5f);
            main.startLifetime = new ParticleSystem.MinMaxCurve(9f, 16f);
            main.startSize = new ParticleSystem.MinMaxCurve(22f, 46f);
            main.startColor = new Color(1f, 1f, 1f, 0.16f);
            main.maxParticles = 260;
            main.gravityModifier = 0f;
            main.simulationSpace = ParticleSystemSimulationSpace.Local;
            main.startRotation = new ParticleSystem.MinMaxCurve(0f, Mathf.PI * 2f);

            var emission = system.emission;
            emission.rateOverTime = 34f;

            var shape = system.shape;
            shape.shapeType = ParticleSystemShapeType.Sphere;
            shape.radius = 6f;

            var sizeOverLifetime = system.sizeOverLifetime;
            sizeOverLifetime.enabled = true;
            sizeOverLifetime.size = new ParticleSystem.MinMaxCurve(
                1f, AnimationCurve.EaseInOut(0f, 0.35f, 1f, 2.4f));

            var colorOverLifetime = system.colorOverLifetime;
            colorOverLifetime.enabled = true;
            colorOverLifetime.color = FadeInOutGradient(Color.white);

            var renderer = go.GetComponent<ParticleSystemRenderer>();
            renderer.sharedMaterial = EarthView.UnlitAdditive(new Color(1f, 1f, 1f, 0.2f));
            renderer.sortMode = ParticleSystemSortMode.Distance;
            return system;
        }

        /// <summary>Propellant venting from a breached tank after a failure.</summary>
        private static ParticleSystem BuildFuelLeak(Transform parent)
        {
            var go = new GameObject("FuelLeak");
            go.transform.SetParent(parent, false);
            var system = go.AddComponent<ParticleSystem>();

            var main = system.main;
            main.startSpeed = new ParticleSystem.MinMaxCurve(8f, 26f);
            main.startLifetime = new ParticleSystem.MinMaxCurve(3.5f, 7f);
            main.startSize = new ParticleSystem.MinMaxCurve(4f, 11f);
            main.startColor = new Color(0.86f, 0.92f, 1f, 0.32f);
            main.maxParticles = 120;
            main.gravityModifier = 0.02f;
            main.simulationSpace = ParticleSystemSimulationSpace.Local;

            var emission = system.emission;
            emission.rateOverTime = 45f;

            var shape = system.shape;
            shape.shapeType = ParticleSystemShapeType.Cone;
            shape.angle = 28f;
            shape.radius = 2f;
            shape.rotation = new Vector3(60f, 0f, 0f);

            var sizeOverLifetime = system.sizeOverLifetime;
            sizeOverLifetime.enabled = true;
            sizeOverLifetime.size = new ParticleSystem.MinMaxCurve(
                1f, AnimationCurve.EaseInOut(0f, 0.5f, 1f, 2.2f));

            var colorOverLifetime = system.colorOverLifetime;
            colorOverLifetime.enabled = true;
            colorOverLifetime.color = FadeOutGradient(new Color(0.88f, 0.94f, 1f));

            go.GetComponent<ParticleSystemRenderer>().sharedMaterial =
                EarthView.UnlitAdditive(new Color(1f, 1f, 1f, 0.28f));
            return system;
        }

        private static ParticleSystem BuildStagingBurst(Transform parent)
        {
            var go = new GameObject("StagingBurst");
            go.transform.SetParent(parent, false);
            var system = go.AddComponent<ParticleSystem>();

            var main = system.main;
            main.loop = false;
            main.playOnAwake = false;
            main.duration = 0.4f;
            main.startSpeed = new ParticleSystem.MinMaxCurve(20f, 90f);
            main.startLifetime = 2.2f;
            main.startSize = 5f;
            main.startColor = new Color(1f, 0.85f, 0.6f);
            main.maxParticles = 220;

            var emission = system.emission;
            emission.rateOverTime = 0f;
            emission.SetBursts(new[] { new ParticleSystem.Burst(0f, 160) });

            var shape = system.shape;
            shape.shapeType = ParticleSystemShapeType.Sphere;
            shape.radius = 3f;

            var colorOverLifetime = system.colorOverLifetime;
            colorOverLifetime.enabled = true;
            colorOverLifetime.color = FadeOutGradient(new Color(1f, 0.8f, 0.55f));

            go.GetComponent<ParticleSystemRenderer>().sharedMaterial =
                EarthView.UnlitAdditive(Color.white);
            return system;
        }

        /// <summary>
        /// The retro-rockets that push the stages apart: four short, hard jets
        /// fired sideways-and-down, quite distinct from the debris cloud.
        /// </summary>
        private static ParticleSystem BuildSeparationMotors(Transform parent)
        {
            var go = new GameObject("SeparationMotors");
            go.transform.SetParent(parent, false);
            var system = go.AddComponent<ParticleSystem>();

            var main = system.main;
            main.loop = false;
            main.playOnAwake = false;
            main.duration = 0.5f;
            main.startSpeed = new ParticleSystem.MinMaxCurve(60f, 140f);
            main.startLifetime = new ParticleSystem.MinMaxCurve(0.4f, 0.9f);
            main.startSize = new ParticleSystem.MinMaxCurve(2f, 5f);
            main.startColor = new Color(1f, 0.95f, 0.85f, 0.9f);
            main.maxParticles = 120;

            var emission = system.emission;
            emission.rateOverTime = 0f;
            emission.SetBursts(new[]
            {
                new ParticleSystem.Burst(0f, 60),
                new ParticleSystem.Burst(0.12f, 40),
            });

            var shape = system.shape;
            shape.shapeType = ParticleSystemShapeType.Cone;
            shape.angle = 78f;
            shape.radius = 2.2f;
            shape.rotation = new Vector3(90f, 0f, 0f);

            var colorOverLifetime = system.colorOverLifetime;
            colorOverLifetime.enabled = true;
            colorOverLifetime.color = FadeOutGradient(new Color(1f, 0.93f, 0.8f));

            var renderer = go.GetComponent<ParticleSystemRenderer>();
            renderer.renderMode = ParticleSystemRenderMode.Stretch;
            renderer.lengthScale = 3f;
            renderer.sharedMaterial = EarthView.UnlitAdditive(Color.white);
            return system;
        }

        /// <summary>
        /// Ice and frost shaken off the interstage at separation: slow, tumbling,
        /// and lit rather than glowing, so it reads as debris and not as fire.
        /// </summary>
        private static ParticleSystem BuildSeparationIce(Transform parent)
        {
            var go = new GameObject("SeparationIce");
            go.transform.SetParent(parent, false);
            var system = go.AddComponent<ParticleSystem>();

            var main = system.main;
            main.loop = false;
            main.playOnAwake = false;
            main.duration = 0.6f;
            main.startSpeed = new ParticleSystem.MinMaxCurve(3f, 26f);
            main.startLifetime = new ParticleSystem.MinMaxCurve(3f, 8f);
            main.startSize = new ParticleSystem.MinMaxCurve(0.4f, 1.6f);
            main.startColor = new ParticleSystem.MinMaxGradient(
                new Color(0.92f, 0.96f, 1f, 0.9f),
                new Color(0.7f, 0.78f, 0.88f, 0.75f));
            main.maxParticles = 140;
            main.gravityModifier = 0f;

            var emission = system.emission;
            emission.rateOverTime = 0f;
            emission.SetBursts(new[] { new ParticleSystem.Burst(0f, 110) });

            var shape = system.shape;
            shape.shapeType = ParticleSystemShapeType.Sphere;
            shape.radius = 4f;

            var rotation = system.rotationOverLifetime;
            rotation.enabled = true;
            rotation.z = new ParticleSystem.MinMaxCurve(-3f, 3f);

            var colorOverLifetime = system.colorOverLifetime;
            colorOverLifetime.enabled = true;
            colorOverLifetime.color = FadeOutGradient(new Color(0.9f, 0.95f, 1f));

            go.GetComponent<ParticleSystemRenderer>().sharedMaterial =
                EarthView.UnlitAdditive(new Color(1f, 1f, 1f, 0.7f));
            return system;
        }

        private static ParticleSystem BuildShockRing(Transform parent)
        {
            var go = new GameObject("MaxQShockRing");
            go.transform.SetParent(parent, false);
            var system = go.AddComponent<ParticleSystem>();

            var main = system.main;
            main.loop = false;
            main.playOnAwake = false;
            main.duration = 0.8f;
            main.startSpeed = 260f;
            main.startLifetime = 0.8f;
            main.startSize = 9f;
            main.startColor = new Color(1f, 0.61f, 0.33f, 0.8f);
            main.maxParticles = 160;

            var emission = system.emission;
            emission.rateOverTime = 0f;
            emission.SetBursts(new[] { new ParticleSystem.Burst(0f, 140) });

            var shape = system.shape;
            shape.shapeType = ParticleSystemShapeType.Circle;
            shape.radius = 4f;
            shape.radiusThickness = 0f;
            // The ring expands around the body, not along it.
            shape.rotation = new Vector3(90f, 0f, 0f);

            var colorOverLifetime = system.colorOverLifetime;
            colorOverLifetime.enabled = true;
            colorOverLifetime.color = FadeOutGradient(new Color(1f, 0.61f, 0.33f));

            go.GetComponent<ParticleSystemRenderer>().sharedMaterial =
                EarthView.UnlitAdditive(Color.white);
            return system;
        }

        /// <summary>The white core of the detonation: very bright, very short.</summary>
        private static ParticleSystem BuildExplosionFlash(Transform parent)
        {
            var go = new GameObject("ExplosionFlash");
            go.transform.SetParent(parent, false);
            var system = go.AddComponent<ParticleSystem>();

            var main = system.main;
            main.loop = false;
            main.playOnAwake = false;
            main.duration = 0.4f;
            main.startSpeed = new ParticleSystem.MinMaxCurve(10f, 60f);
            main.startLifetime = new ParticleSystem.MinMaxCurve(0.25f, 0.5f);
            main.startSize = new ParticleSystem.MinMaxCurve(30f, 70f);
            main.startColor = new Color(1f, 0.97f, 0.88f);
            main.maxParticles = 60;

            var emission = system.emission;
            emission.rateOverTime = 0f;
            emission.SetBursts(new[] { new ParticleSystem.Burst(0f, 40) });

            var shape = system.shape;
            shape.shapeType = ParticleSystemShapeType.Sphere;
            shape.radius = 6f;

            var sizeOverLifetime = system.sizeOverLifetime;
            sizeOverLifetime.enabled = true;
            sizeOverLifetime.size = new ParticleSystem.MinMaxCurve(
                1f, AnimationCurve.EaseInOut(0f, 0.4f, 1f, 2.2f));

            var colorOverLifetime = system.colorOverLifetime;
            colorOverLifetime.enabled = true;
            colorOverLifetime.color = FadeOutGradient(new Color(1f, 0.93f, 0.78f));

            go.GetComponent<ParticleSystemRenderer>().sharedMaterial =
                EarthView.UnlitAdditive(Color.white);
            return system;
        }

        /// <summary>Burning fragments thrown clear of the breakup.</summary>
        private static ParticleSystem BuildExplosionFragments(Transform parent)
        {
            var go = new GameObject("ExplosionFragments");
            go.transform.SetParent(parent, false);
            var system = go.AddComponent<ParticleSystem>();

            var main = system.main;
            main.loop = false;
            main.playOnAwake = false;
            main.duration = 0.6f;
            main.startSpeed = new ParticleSystem.MinMaxCurve(70f, 260f);
            main.startLifetime = new ParticleSystem.MinMaxCurve(1.5f, 4f);
            main.startSize = new ParticleSystem.MinMaxCurve(1.5f, 5f);
            main.startColor = new ParticleSystem.MinMaxGradient(
                new Color(1f, 0.9f, 0.6f),
                new Color(1f, 0.42f, 0.12f));
            main.maxParticles = 200;
            main.gravityModifier = 0.55f;

            var emission = system.emission;
            emission.rateOverTime = 0f;
            emission.SetBursts(new[] { new ParticleSystem.Burst(0f, 170) });

            var shape = system.shape;
            shape.shapeType = ParticleSystemShapeType.Sphere;
            shape.radius = 4f;

            var colorOverLifetime = system.colorOverLifetime;
            colorOverLifetime.enabled = true;
            colorOverLifetime.color = FadeOutGradient(new Color(1f, 0.6f, 0.22f));

            var renderer = go.GetComponent<ParticleSystemRenderer>();
            renderer.renderMode = ParticleSystemRenderMode.Stretch;
            renderer.lengthScale = 3.2f;
            renderer.sharedMaterial = EarthView.UnlitAdditive(Color.white);
            return system;
        }

        /// <summary>The black column that rolls up after the flash has gone.</summary>
        private static ParticleSystem BuildExplosionSmoke(Transform parent)
        {
            var go = new GameObject("ExplosionSmoke");
            go.transform.SetParent(parent, false);
            var system = go.AddComponent<ParticleSystem>();

            var main = system.main;
            main.loop = false;
            main.playOnAwake = false;
            main.duration = 1.4f;
            main.startSpeed = new ParticleSystem.MinMaxCurve(12f, 55f);
            main.startLifetime = new ParticleSystem.MinMaxCurve(4f, 9f);
            main.startSize = new ParticleSystem.MinMaxCurve(24f, 60f);
            main.startColor = new ParticleSystem.MinMaxGradient(
                new Color(0.26f, 0.23f, 0.21f, 0.75f),
                new Color(0.1f, 0.09f, 0.08f, 0.8f));
            main.maxParticles = 150;
            main.gravityModifier = -0.05f;
            main.startRotation = new ParticleSystem.MinMaxCurve(0f, Mathf.PI * 2f);

            var emission = system.emission;
            emission.rateOverTime = 0f;
            emission.SetBursts(new[]
            {
                new ParticleSystem.Burst(0f, 70),
                new ParticleSystem.Burst(0.35f, 50),
            });

            var shape = system.shape;
            shape.shapeType = ParticleSystemShapeType.Sphere;
            shape.radius = 8f;

            var rotation = system.rotationOverLifetime;
            rotation.enabled = true;
            rotation.z = new ParticleSystem.MinMaxCurve(-0.6f, 0.6f);

            var sizeOverLifetime = system.sizeOverLifetime;
            sizeOverLifetime.enabled = true;
            sizeOverLifetime.size = new ParticleSystem.MinMaxCurve(
                1f, AnimationCurve.EaseInOut(0f, 0.5f, 1f, 3f));

            var colorOverLifetime = system.colorOverLifetime;
            colorOverLifetime.enabled = true;
            colorOverLifetime.color = SmokeGradient(new Color(0.2f, 0.18f, 0.17f));

            // Smoke is the one thing here that must not glow, so it blends
            // normally rather than additively.
            var renderer = go.GetComponent<ParticleSystemRenderer>();
            renderer.sharedMaterial = UnlitAlpha(new Color(0.22f, 0.2f, 0.19f, 0.8f));
            renderer.sortMode = ParticleSystemSortMode.Distance;
            return system;
        }

        private void BuildVaporCone(Transform parent)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            go.name = "VaporCone";
            Destroy(go.GetComponent<Collider>());
            go.transform.SetParent(parent, false);
            vaporMaterial = EarthView.UnlitAdditive(new Color(0.85f, 0.93f, 1f, 0f));
            var renderer = go.GetComponent<MeshRenderer>();
            renderer.sharedMaterial = vaporMaterial;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            go.SetActive(false);
            vaporCone = go.transform;

            if (rocket != null && rocket.Geometry != null)
            {
                float d = rocket.Geometry.diameter;
                vaporCone.localScale = new Vector3(d * 1.9f, d * 1.1f, d * 1.9f);
            }
        }

        private void BuildPostProcessing()
        {
            var go = new GameObject("PostProcessing");
            go.transform.SetParent(transform, false);
            postVolume = go.AddComponent<Volume>();
            postVolume.isGlobal = true;

            var profile = ScriptableObject.CreateInstance<VolumeProfile>();
            postVolume.sharedProfile = profile;

            bloom = profile.Add<Bloom>(true);
            bloom.threshold.overrideState = true;
            bloom.intensity.overrideState = true;
            bloom.scatter.overrideState = true;
            bloom.threshold.value = 1.1f;
            bloom.intensity.value = 0.7f;
            bloom.scatter.value = 0.72f;

            var tonemapping = profile.Add<Tonemapping>(true);
            tonemapping.mode.overrideState = true;
            tonemapping.mode.value = TonemappingMode.ACES;

            var vignette = profile.Add<Vignette>(true);
            vignette.intensity.overrideState = true;
            vignette.intensity.value = 0.28f;

            chromatic = profile.Add<ChromaticAberration>(true);
            chromatic.intensity.overrideState = true;
            chromatic.intensity.value = 0.05f;

            lensDistortion = profile.Add<LensDistortion>(true);
            lensDistortion.intensity.overrideState = true;
            lensDistortion.intensity.value = 0f;

            colorAdjustments = profile.Add<ColorAdjustments>(true);
            colorAdjustments.postExposure.overrideState = true;
            colorAdjustments.contrast.overrideState = true;
            colorAdjustments.postExposure.value = 0f;
            colorAdjustments.contrast.value = 12f;
        }

        // -- materials and gradients ---------------------------------------------

        /// <summary>Additive, depth-tested but not depth-writing, for meshes.</summary>
        private static Material AdditiveMeshMaterial(Color color)
        {
            Material material = Shaders.Create(
                color,
                "Universal Render Pipeline/Unlit",
                "Universal Render Pipeline/Particles/Unlit",
                "Unlit/Color");
            if (material == null)
            {
                return null;
            }
            if (material.HasProperty("_Surface"))
            {
                material.SetFloat("_Surface", 1f);
            }
            if (material.HasProperty("_Blend"))
            {
                material.SetFloat("_Blend", 1f);
            }
            if (material.HasProperty("_SrcBlend"))
            {
                material.SetFloat("_SrcBlend", (float)UnityEngine.Rendering.BlendMode.SrcAlpha);
            }
            if (material.HasProperty("_DstBlend"))
            {
                material.SetFloat("_DstBlend", (float)UnityEngine.Rendering.BlendMode.One);
            }
            if (material.HasProperty("_ZWrite"))
            {
                material.SetFloat("_ZWrite", 0f);
            }
            material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            material.renderQueue = 3100;
            return material;
        }

        /// <summary>Ordinary alpha blending — for the one effect that must not glow.</summary>
        private static Material UnlitAlpha(Color color)
        {
            Material material = Shaders.Create(
                color,
                "Universal Render Pipeline/Particles/Unlit",
                "Particles/Standard Unlit",
                "Sprites/Default");
            if (material == null)
            {
                return null;
            }
            if (material.HasProperty("_Surface"))
            {
                material.SetFloat("_Surface", 1f);
            }
            if (material.HasProperty("_Blend"))
            {
                material.SetFloat("_Blend", 0f); // alpha
            }
            if (material.HasProperty("_SrcBlend"))
            {
                material.SetFloat("_SrcBlend", (float)UnityEngine.Rendering.BlendMode.SrcAlpha);
            }
            if (material.HasProperty("_DstBlend"))
            {
                material.SetFloat("_DstBlend", (float)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
            }
            if (material.HasProperty("_ZWrite"))
            {
                material.SetFloat("_ZWrite", 0f);
            }
            material.renderQueue = 3050;
            return material;
        }

        private static void SetMaterialColor(Material material, Color color)
        {
            Shaders.Tint(material, color);
        }

        private static ParticleSystem.MinMaxGradient CoreGradient()
        {
            var gradient = new Gradient();
            gradient.SetKeys(
                new[]
                {
                    new GradientColorKey(Color.white, 0f),
                    new GradientColorKey(new Color(1f, 0.95f, 0.78f), 0.6f),
                    new GradientColorKey(new Color(1f, 0.72f, 0.36f), 1f),
                },
                new[]
                {
                    new GradientAlphaKey(1f, 0f),
                    new GradientAlphaKey(0.85f, 0.55f),
                    new GradientAlphaKey(0f, 1f),
                });
            return new ParticleSystem.MinMaxGradient(gradient);
        }

        private static ParticleSystem.MinMaxGradient FlameGradient()
        {
            var gradient = new Gradient();
            gradient.SetKeys(
                new[]
                {
                    new GradientColorKey(new Color(1f, 0.98f, 0.85f), 0f),
                    new GradientColorKey(new Color(1f, 0.55f, 0.18f), 0.45f),
                    new GradientColorKey(new Color(0.35f, 0.12f, 0.06f), 1f),
                },
                new[]
                {
                    new GradientAlphaKey(1f, 0f),
                    new GradientAlphaKey(0.75f, 0.5f),
                    new GradientAlphaKey(0f, 1f),
                });
            return new ParticleSystem.MinMaxGradient(gradient);
        }

        private static ParticleSystem.MinMaxGradient SmokeGradient(Color color)
        {
            var gradient = new Gradient();
            gradient.SetKeys(
                new[]
                {
                    new GradientColorKey(color, 0f),
                    new GradientColorKey(color * 0.85f, 1f),
                },
                new[]
                {
                    new GradientAlphaKey(0f, 0f),
                    new GradientAlphaKey(1f, 0.12f),
                    new GradientAlphaKey(0.7f, 0.55f),
                    new GradientAlphaKey(0f, 1f),
                });
            return new ParticleSystem.MinMaxGradient(gradient);
        }

        private static ParticleSystem.MinMaxGradient FadeInOutGradient(Color color)
        {
            var gradient = new Gradient();
            gradient.SetKeys(
                new[] { new GradientColorKey(color, 0f), new GradientColorKey(color, 1f) },
                new[]
                {
                    new GradientAlphaKey(0f, 0f),
                    new GradientAlphaKey(1f, 0.2f),
                    new GradientAlphaKey(0f, 1f),
                });
            return new ParticleSystem.MinMaxGradient(gradient);
        }

        private static ParticleSystem.MinMaxGradient FadeOutGradient(Color color)
        {
            var gradient = new Gradient();
            gradient.SetKeys(
                new[] { new GradientColorKey(color, 0f), new GradientColorKey(color, 1f) },
                new[] { new GradientAlphaKey(1f, 0f), new GradientAlphaKey(0f, 1f) });
            return new ParticleSystem.MinMaxGradient(gradient);
        }
    }
}
