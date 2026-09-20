using UnityEngine;

namespace Apogee.RocketRenderer
{
    /// <summary>
    /// The Earth, its atmosphere shell and the stars.
    ///
    /// Mesh convention, stated once and relied on everywhere: local +Y is the
    /// north pole, and longitude 0 on the equator lies on local +X. The sim
    /// builds `earthQuat` against exactly that convention, so this component
    /// only applies it. Unity's sphere primitive already has +Y at the poles;
    /// the corrective rotation below is where to fix it if the mesh is ever
    /// swapped for an imported globe with a different convention.
    ///
    /// Everything here is drawn by the far camera. The near camera never sees
    /// it, which is what keeps a 6371 km sphere from destroying depth
    /// precision around a 60 m rocket.
    /// </summary>
    public class EarthView : MonoBehaviour
    {
        public const float EarthRadiusM = 6_371_000f;

        /// <summary>
        /// Applied to the globe mesh itself, not to the frame's rotation. Identity
        /// for Unity's sphere primitive; change it here if the mesh differs.
        /// </summary>
        private static readonly Quaternion MeshCorrection = Quaternion.identity;

        /// <summary>Stars appear from here and the sky is black by the top value.</summary>
        private const float StarFadeStartM = 35_000f;
        private const float SkyBlackM = 110_000f;

        /// <summary>Distance haze at sea level, and the height it thins over.</summary>
        private const float GroundFogDensity = 0.00022f;
        private const float HazeScaleHeightM = 8_500f;

        private Transform globe;
        private Transform atmosphere;
        private Transform ground;
        private Material atmosphereMaterial;
        private Material groundMaterial;
        private ParticleSystem stars;

        public void Build(Transform starParent)
        {
            globe = BuildSphere("Globe", EarthRadiusM, new Color(0.09f, 0.35f, 0.55f), false);
            globe.SetParent(transform, false);
            globe.localRotation = MeshCorrection;

            atmosphere = BuildSphere(
                "Atmosphere",
                EarthRadiusM * 1.025f,
                new Color(0.35f, 0.72f, 1f, 0.35f),
                true);
            atmosphere.SetParent(transform, false);
            atmosphereMaterial = atmosphere.GetComponent<MeshRenderer>().sharedMaterial;

            stars = BuildStars(starParent);
        }

        /// <summary>
        /// A flat disc under the pad, tangent to the Earth. A 6371 km sphere is
        /// far too coarse to stand a 60 m rocket on, so close to the ground this
        /// is what the vehicle sits on; it fades out as the curve starts to show.
        /// </summary>
        public void BuildGroundDisc(Transform parent)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            go.name = "GroundDisc";
            Destroy(go.GetComponent<Collider>());
            go.transform.SetParent(parent, false);
            go.transform.localScale = new Vector3(4000f, 0.5f, 4000f);
            var renderer = go.GetComponent<MeshRenderer>();
            groundMaterial = NewMaterial(new Color(0.08f, 0.45f, 0.66f), false);
            renderer.sharedMaterial = groundMaterial;
            ground = go.transform;
        }

        /// <summary>
        /// Whether distance haze is configured. The fog itself is switched on
        /// and off per camera by <see cref="CameraDirector"/>, because Unity's
        /// fog is a global setting and the far camera must never see it: it
        /// draws the Earth from 6371 km away, and any density that reads as air
        /// over a few kilometres is completely opaque over a few thousand.
        /// </summary>
        public static bool HazeEnabled { get; private set; }

        /// <summary>
        /// Configure distance haze for the near camera. Density falls off with
        /// the same scale height the atmosphere itself uses, so the pad sits in
        /// visible air and orbit is perfectly clear, with everything in between
        /// thinning out on its own.
        /// </summary>
        public static void EnableHaze()
        {
            RenderSettings.fog = false; // the director turns it on per camera
            RenderSettings.fogMode = FogMode.ExponentialSquared;
            RenderSettings.fogColor = SkyColor(0f);
            RenderSettings.fogDensity = GroundFogDensity;
            HazeEnabled = true;
        }

        /// <summary>Place the globe and fade the sky, from one frame.</summary>
        public void Apply(RenderFrameDto frame)
        {
            transform.localPosition = frame.earthCenterLocal;
            transform.localRotation = frame.earthQuat;

            float altitude = Mathf.Max(0f, frame.altitude);

            if (HazeEnabled)
            {
                // Air thins exponentially, and so does what it does to the view.
                RenderSettings.fogDensity = GroundFogDensity * Mathf.Exp(-altitude / HazeScaleHeightM);
                // Haze is lit sky, so it has to track the sky's own colour or it
                // reads as grey smoke hanging in front of a black background.
                RenderSettings.fogColor = SkyColor(altitude);
            }

            if (ground != null)
            {
                // The disc sits on the surface: the frame's origin is the center
                // of mass, so the ground is that much further down than altitude.
                ground.localPosition = new Vector3(0f, -(altitude + frame.comFromBase), 0f);
                float fade = 1f - Mathf.Clamp01((altitude - 2_000f) / 30_000f);
                ground.gameObject.SetActive(fade > 0.01f);
                if (groundMaterial != null)
                {
                    Color color = groundMaterial.color;
                    color.a = fade;
                    groundMaterial.color = color;
                }
            }

            if (stars != null)
            {
                float starAlpha = Mathf.Clamp01((altitude - StarFadeStartM) / (SkyBlackM - StarFadeStartM));
                var main = stars.main;
                main.startColor = new Color(1f, 1f, 1f, starAlpha);
                stars.gameObject.SetActive(starAlpha > 0.01f);
            }

            if (atmosphereMaterial != null)
            {
                // The limb glow is only legible from outside the shell.
                float limb = Mathf.Clamp01((altitude - 60_000f) / 120_000f);
                Color color = atmosphereMaterial.color;
                color.a = 0.15f + 0.4f * limb;
                atmosphereMaterial.color = color;
            }
        }

        /// <summary>Sky colour for the far camera's background, by altitude.</summary>
        public static Color SkyColor(float altitudeM)
        {
            float mix = 1f - Mathf.Clamp01(altitudeM / SkyBlackM);
            return new Color(0.22f * mix, 0.38f * mix, 0.58f * mix, 1f);
        }

        private static Transform BuildSphere(string name, float radius, Color color, bool inward)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            go.name = name;
            Destroy(go.GetComponent<Collider>());
            go.transform.localScale = Vector3.one * (radius * 2f);
            go.GetComponent<MeshRenderer>().sharedMaterial = NewMaterial(color, inward);
            return go.transform;
        }

        private static Material NewMaterial(Color color, bool transparent)
        {
            Material material = Shaders.Create(
                color, "Universal Render Pipeline/Lit", "Standard");
            if (material == null)
            {
                return null;
            }
            if (transparent)
            {
                material.SetFloat("_Surface", 1f); // URP: transparent
                material.SetFloat("_Cull", 1f);    // draw the inside of the shell
                material.renderQueue = 3000;
            }
            return material;
        }

        /// <summary>
        /// Stars as a static particle burst on a large sphere, so there is no
        /// texture to ship and nothing to animate.
        /// </summary>
        private static ParticleSystem BuildStars(Transform parent)
        {
            var go = new GameObject("Stars");
            go.transform.SetParent(parent, false);
            var system = go.AddComponent<ParticleSystem>();

            var main = system.main;
            main.loop = false;
            main.playOnAwake = true;
            main.startLifetime = Mathf.Infinity;
            main.startSpeed = 0f;
            main.startSize = 6_000f;
            main.maxParticles = 1500;
            main.simulationSpace = ParticleSystemSimulationSpace.Local;
            main.scalingMode = ParticleSystemScalingMode.Local;

            var emission = system.emission;
            emission.rateOverTime = 0f;
            emission.SetBursts(new[] { new ParticleSystem.Burst(0f, 1500) });

            var shape = system.shape;
            shape.shapeType = ParticleSystemShapeType.Sphere;
            shape.radius = 2_000_000f;
            shape.radiusThickness = 0f;

            var renderer = go.GetComponent<ParticleSystemRenderer>();
            renderer.sharedMaterial = UnlitAdditive(Color.white);
            return system;
        }

        internal static Material UnlitAdditive(Color color)
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
            if (material.HasProperty("_Blend"))
            {
                material.SetFloat("_Blend", 1f); // additive
            }
            if (material.HasProperty("_Surface"))
            {
                material.SetFloat("_Surface", 1f);
            }
            material.renderQueue = 3000;
            return material;
        }
    }
}
