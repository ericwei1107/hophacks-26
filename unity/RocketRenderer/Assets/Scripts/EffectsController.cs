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
    /// These are built-in ParticleSystems rather than VFX Graph assets, because
    /// a .vfx asset only exists once it has been authored in the editor and this
    /// project is built from source. Swapping an emitter for a VFX Graph asset
    /// later is local to this file.
    /// </summary>
    public class EffectsController : MonoBehaviour
    {
        /// <summary>Emission stops above this playback speed.</summary>
        public const float MaxEmissionPlaybackSpeed = 10f;

        /// <summary>Scale height used for the pressure ratio that widens the plume.</summary>
        private const float ScaleHeightM = 7200f;

        private RocketBuilder rocket;
        private Transform plumeRoot;
        private ParticleSystem[] plumes = new ParticleSystem[0];
        private ParticleSystem padSmoke;
        private ParticleSystem stagingBurst;
        private ParticleSystem shockRing;
        private Light engineLight;
        private Transform vaporCone;
        private Material vaporMaterial;
        private Volume postVolume;
        private Bloom bloom;
        private ChromaticAberration chromatic;

        /// <summary>Seconds of chromatic pulse left from a max-Q crossing.</summary>
        private float chromaticPulse;

        public void Build(RocketBuilder builder, Transform vehicleRoot, Transform worldRoot)
        {
            rocket = builder;

            plumeRoot = new GameObject("Plumes").transform;
            plumeRoot.SetParent(vehicleRoot, false);

            engineLight = new GameObject("EngineLight").AddComponent<Light>();
            engineLight.transform.SetParent(vehicleRoot, false);
            engineLight.type = LightType.Point;
            engineLight.color = new Color(1f, 0.69f, 0.4f);
            engineLight.range = 400f;
            engineLight.intensity = 0f;

            padSmoke = BuildSmoke(worldRoot);
            stagingBurst = BuildStagingBurst(vehicleRoot);
            shockRing = BuildShockRing(vehicleRoot);
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
                plumes = new ParticleSystem[0];
                return;
            }

            Vector3[] positions = rocket.Stage1NozzlePositions;
            plumes = new ParticleSystem[positions.Length + 1];
            for (int i = 0; i < positions.Length; i++)
            {
                plumes[i] = BuildPlume(plumeRoot, $"Stage1Plume{i}", rocket.Geometry.stage1NozzleDiameter);
                plumes[i].transform.localPosition = positions[i];
            }
            // The last entry is the upper stage's single, smaller plume.
            plumes[positions.Length] = BuildPlume(
                plumeRoot,
                "Stage2Plume",
                rocket.Geometry.stage2NozzleDiameter);
            plumes[positions.Length].transform.localPosition = rocket.Stage2NozzlePosition;
        }

        public void Apply(RenderFrameDto frame)
        {
            if (frame.discontinuity)
            {
                ClearAll();
            }

            bool emitting = frame.playing
                && frame.throttle > 0.02f
                && frame.playbackSpeed <= MaxEmissionPlaybackSpeed;
            float altitude = Mathf.Max(0f, frame.altitude);
            // Ambient pressure ratio: the plume widens as the air thins.
            float pressureRatio = Mathf.Exp(-altitude / ScaleHeightM);
            float spread = Mathf.Lerp(2.5f, 1f, pressureRatio);

            ApplyPlumes(frame, emitting, spread);
            ApplyPadSmoke(frame, altitude);
            ApplyEngineLight(frame, altitude);
            ApplyVaporCone(frame, altitude);
            ApplyEvents(frame);
            ApplyPostProcessing(frame);
            SetPaused(!frame.playing);
        }

        // -- individual effects ------------------------------------------------

        private void ApplyPlumes(RenderFrameDto frame, bool emitting, float spread)
        {
            if (rocket == null || rocket.Geometry == null)
            {
                return;
            }
            int stage1Count = rocket.Stage1NozzlePositions.Length;
            // A flicker keeps the flame alive without an animation curve.
            float flicker = 0.92f + 0.08f * Mathf.PerlinNoise(frame.t * 9f, 0f);

            for (int i = 0; i < plumes.Length; i++)
            {
                ParticleSystem plume = plumes[i];
                if (plume == null)
                {
                    continue;
                }
                bool isStage1 = i < stage1Count;
                bool active = emitting && (isStage1 ? frame.stage == 1 : frame.stage == 2);
                var emission = plume.emission;
                emission.enabled = active;
                if (!active)
                {
                    continue;
                }

                var main = plume.main;
                // Length with throttle, width with falling ambient pressure.
                float length = (isStage1 ? 1f : 0.6f) * (6f + 26f * frame.throttle) * flicker;
                main.startLifetime = length / Mathf.Max(1f, main.startSpeed.constant);
                main.startSizeMultiplier =
                    (isStage1 ? 1f : 0.7f) * rocket.Geometry.diameter * 0.22f * spread * flicker;

                var shape = plume.shape;
                shape.angle = Mathf.Lerp(3f, 16f, 1f - Mathf.Exp(-frame.altitude / 20_000f));
            }
        }

        private void ApplyPadSmoke(RenderFrameDto frame, float altitude)
        {
            if (padSmoke == null)
            {
                return;
            }
            // Launch steam only exists while the exhaust is still hitting the pad.
            float closeness = 1f - Mathf.Clamp01(altitude / 300f);
            bool active = frame.playing
                && frame.throttle > 0.02f
                && closeness > 0.01f
                && frame.playbackSpeed <= MaxEmissionPlaybackSpeed;

            padSmoke.transform.localPosition =
                new Vector3(0f, -(altitude + frame.comFromBase), 0f);
            var emission = padSmoke.emission;
            emission.enabled = active;
            emission.rateOverTimeMultiplier = 900f * closeness * frame.throttle;
        }

        private void ApplyEngineLight(RenderFrameDto frame, float altitude)
        {
            if (engineLight == null)
            {
                return;
            }
            // Lights the pad and the vehicle low down; pointless in vacuum.
            float proximity = 1f - Mathf.Clamp01(altitude / 8_000f);
            engineLight.intensity = frame.throttle * (0.6f + 2.4f * proximity);
            engineLight.transform.localPosition =
                new Vector3(0f, -(frame.comFromBase + 4f), 0f);
        }

        private void ApplyVaporCone(RenderFrameDto frame, float altitude)
        {
            if (vaporCone == null)
            {
                return;
            }
            // Transonic condensation: a narrow Mach window, in thick enough air.
            float machWindow = 1f - Mathf.Clamp01(Mathf.Abs(frame.mach - 1.02f) / 0.18f);
            float altitudeWindow =
                Mathf.Clamp01((altitude - 2_000f) / 3_000f) * (1f - Mathf.Clamp01((altitude - 12_000f) / 3_000f));
            float strength = machWindow * altitudeWindow;
            vaporCone.gameObject.SetActive(strength > 0.02f);
            if (vaporMaterial != null)
            {
                Color color = vaporMaterial.color;
                color.a = 0.45f * strength;
                vaporMaterial.color = color;
            }
        }

        private void ApplyEvents(RenderFrameDto frame)
        {
            if (frame.HasEvent("max_q"))
            {
                if (shockRing != null)
                {
                    shockRing.Play();
                }
                chromaticPulse = 0.6f;
            }
            if (frame.HasEvent("separation") && stagingBurst != null)
            {
                stagingBurst.transform.localPosition =
                    new Vector3(0f, -frame.comFromBase, 0f);
                stagingBurst.Play();
            }
        }

        private void ApplyPostProcessing(RenderFrameDto frame)
        {
            if (chromatic != null)
            {
                chromaticPulse = Mathf.Max(0f, chromaticPulse - Time.unscaledDeltaTime);
                chromatic.intensity.value = 0.05f + 0.5f * chromaticPulse;
            }
            if (bloom != null)
            {
                // Only flame and lights should bloom, so the threshold sits well
                // above the brightest surface in the scene.
                bloom.threshold.value = 1.15f;
                bloom.intensity.value = 0.6f + 0.5f * frame.throttle;
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
        }

        private System.Collections.Generic.IEnumerable<ParticleSystem> AllSystems()
        {
            for (int i = 0; i < plumes.Length; i++)
            {
                yield return plumes[i];
            }
            yield return padSmoke;
            yield return stagingBurst;
            yield return shockRing;
        }

        // -- construction -------------------------------------------------------

        private static ParticleSystem BuildPlume(Transform parent, string name, float nozzleDiameter)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var system = go.AddComponent<ParticleSystem>();

            var main = system.main;
            main.startSpeed = 140f;
            main.startLifetime = 0.25f;
            main.startSize = Mathf.Max(0.5f, nozzleDiameter * 0.8f);
            main.startColor = new ParticleSystem.MinMaxGradient(
                new Color(1f, 0.96f, 0.78f),
                new Color(1f, 0.42f, 0.13f));
            main.maxParticles = 600;
            main.simulationSpace = ParticleSystemSimulationSpace.Local;
            main.gravityModifier = 0f;

            var emission = system.emission;
            emission.rateOverTime = 420f;

            var shape = system.shape;
            shape.shapeType = ParticleSystemShapeType.Cone;
            shape.angle = 4f;
            shape.radius = Mathf.Max(0.2f, nozzleDiameter * 0.35f);
            // The cone emits along its +Z; the plume goes down the rocket's -Y.
            shape.rotation = new Vector3(90f, 0f, 0f);

            var sizeOverLifetime = system.sizeOverLifetime;
            sizeOverLifetime.enabled = true;
            sizeOverLifetime.size = new ParticleSystem.MinMaxCurve(
                1f,
                AnimationCurve.EaseInOut(0f, 0.5f, 1f, 2.2f));

            var colorOverLifetime = system.colorOverLifetime;
            colorOverLifetime.enabled = true;
            colorOverLifetime.color = FlameGradient();

            var renderer = go.GetComponent<ParticleSystemRenderer>();
            renderer.renderMode = ParticleSystemRenderMode.Stretch;
            renderer.lengthScale = 3.5f;
            renderer.sharedMaterial = EarthView.UnlitAdditive(Color.white);
            return system;
        }

        private static ParticleSystem BuildSmoke(Transform parent)
        {
            var go = new GameObject("PadSmoke");
            go.transform.SetParent(parent, false);
            var system = go.AddComponent<ParticleSystem>();

            var main = system.main;
            main.startSpeed = 35f;
            main.startLifetime = 4.5f;
            main.startSize = 22f;
            main.startColor = new Color(0.9f, 0.9f, 0.92f, 0.5f);
            main.maxParticles = 1200;
            main.gravityModifier = -0.02f;

            var emission = system.emission;
            emission.rateOverTime = 900f;

            var shape = system.shape;
            shape.shapeType = ParticleSystemShapeType.Hemisphere;
            shape.radius = 30f;

            var sizeOverLifetime = system.sizeOverLifetime;
            sizeOverLifetime.enabled = true;
            sizeOverLifetime.size = new ParticleSystem.MinMaxCurve(
                1f,
                AnimationCurve.EaseInOut(0f, 0.4f, 1f, 3f));

            var colorOverLifetime = system.colorOverLifetime;
            colorOverLifetime.enabled = true;
            colorOverLifetime.color = FadeOutGradient(new Color(0.95f, 0.95f, 0.97f));

            go.GetComponent<ParticleSystemRenderer>().sharedMaterial =
                EarthView.UnlitAdditive(new Color(1f, 1f, 1f, 0.35f));
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
            main.maxParticles = 300;

            var emission = system.emission;
            emission.rateOverTime = 0f;
            emission.SetBursts(new[] { new ParticleSystem.Burst(0f, 220) });

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
            main.maxParticles = 200;

            var emission = system.emission;
            emission.rateOverTime = 0f;
            emission.SetBursts(new[] { new ParticleSystem.Burst(0f, 160) });

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

        private void BuildVaporCone(Transform parent)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            go.name = "VaporCone";
            Destroy(go.GetComponent<Collider>());
            go.transform.SetParent(parent, false);
            vaporMaterial = EarthView.UnlitAdditive(new Color(0.85f, 0.93f, 1f, 0f));
            go.GetComponent<MeshRenderer>().sharedMaterial = vaporMaterial;
            go.SetActive(false);
            vaporCone = go.transform;

            if (rocket != null && rocket.Geometry != null)
            {
                float d = rocket.Geometry.diameter;
                vaporCone.localScale = new Vector3(d * 1.6f, d * 1.2f, d * 1.6f);
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
            bloom.threshold.value = 1.15f;
            bloom.intensity.value = 0.7f;

            var tonemapping = profile.Add<Tonemapping>(true);
            tonemapping.mode.overrideState = true;
            tonemapping.mode.value = TonemappingMode.ACES;

            var vignette = profile.Add<Vignette>(true);
            vignette.intensity.overrideState = true;
            vignette.intensity.value = 0.28f;

            chromatic = profile.Add<ChromaticAberration>(true);
            chromatic.intensity.overrideState = true;
            chromatic.intensity.value = 0.05f;
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
