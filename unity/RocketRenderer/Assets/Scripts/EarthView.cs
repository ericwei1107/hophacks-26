using UnityEngine;

namespace Apogee.RocketRenderer
{
    /// <summary>
    /// The Earth, its atmosphere shell, the stars and the launch site.
    ///
    /// Mesh convention, stated once and relied on everywhere: local +Y is the
    /// north pole, and longitude 0 on the equator lies on local +X. The sim
    /// builds `earthQuat` against exactly that convention, so this component
    /// only applies it. Unity's sphere primitive already has +Y at the poles;
    /// the corrective rotation below is where to fix it if the mesh is ever
    /// swapped for an imported globe with a different convention.
    ///
    /// The globe is painted from code (ellipse continents with organic edges,
    /// textured with noise) and lit by the scene's sun, so it has a day side
    /// and a terminator. Everything here is drawn by the far camera except
    /// the launch site, which sits next to the vehicle and is drawn by the
    /// near camera.
    /// </summary>
    public class EarthView : MonoBehaviour
    {
        public const float EarthRadiusM = 6_371_000f;

        /// <summary>
        /// Applied to the globe mesh itself, not to the frame's rotation. Identity
        /// for Unity's sphere primitive; change it here if the mesh differs.
        /// </summary>
        private static readonly Quaternion MeshCorrection = Quaternion.identity;

        /// <summary>
        /// Where longitude 0 falls on the sphere primitive's U axis. The launch
        /// site is painted as a coast at longitude 0; if the pad does not sit on
        /// that coast at T+0 with the sea to the east, adjust this (or mirror U).
        /// </summary>
        private const float AlbedoLongitudeOffsetU = 0.5f;

        /// <summary>Stars appear from here and the sky is black by the top value.</summary>
        private const float StarFadeStartM = 18_000f;
        private const float SkyBlackM = 70_000f;

        private Transform globe;
        private Transform atmosphere;
        private Material atmosphereMaterial;
        private ParticleSystem stars;

        /// <summary>The pad and its surroundings, or null before BuildLaunchSite.</summary>
        public LaunchSiteView Site { get; private set; }

        public void Build(Transform starParent)
        {
            globe = BuildSphere("Globe", EarthRadiusM, Color.white, false);
            globe.SetParent(transform, false);
            globe.localRotation = MeshCorrection;
            Material globeMaterial = globe.GetComponent<MeshRenderer>().sharedMaterial;
            globeMaterial.mainTexture = BuildAlbedo();
            globeMaterial.mainTextureOffset = new Vector2(AlbedoLongitudeOffsetU - 0.5f, 0f);

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
        /// The launch site lives under `parent` (the world root, not the Earth),
        /// because it is placed rocket-relative each frame — see LaunchSiteView.
        /// </summary>
        public LaunchSiteView BuildLaunchSite(Transform parent)
        {
            var go = new GameObject("LaunchSite");
            go.transform.SetParent(parent, false);
            Site = go.AddComponent<LaunchSiteView>();
            Site.Build();
            return Site;
        }

        /// <summary>Place the globe and fade the sky, from one frame.</summary>
        public void Apply(RenderFrameDto frame)
        {
            transform.localPosition = frame.earthCenterLocal;
            transform.localRotation = frame.earthQuat;

            float altitude = Mathf.Max(0f, frame.altitude);

            if (Site != null)
            {
                Site.Apply(frame);
            }

            if (stars != null)
            {
                float starAlpha = Mathf.Clamp01((altitude - StarFadeStartM) / (SkyBlackM - StarFadeStartM));
                var main = stars.main;
                main.startColor = new Color(1f, 1f, 1f, starAlpha * starAlpha);
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
            float mix = 1f - Mathf.Clamp01((altitudeM - 8_000f) / (SkyBlackM - 8_000f));
            // Darkens from the zenith first, the way it really does.
            float zenithDark = 1f - 0.6f * Mathf.Clamp01((altitudeM - 3_000f) / 29_000f);
            return new Color(0.22f * mix * zenithDark, 0.38f * mix * zenithDark, 0.62f * mix, 1f);
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
            Shader shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            var material = new Material(shader) { color = color };
            if (transparent)
            {
                material.SetFloat("_Surface", 1f); // URP: transparent
                material.SetFloat("_Cull", 1f);    // draw the inside of the shell
                material.renderQueue = 3000;
            }
            return material;
        }

        // -- the globe's albedo ------------------------------------------------

        private static void FillEllipseDeg(Color32[] px, int w, int h, float lon, float lat, float wDeg, float hDeg, Color32 color)
        {
            float cx = ((lon + 180f) / 360f) * w;
            float cy = ((lat + 90f) / 180f) * h;
            float rx = (wDeg / 360f) * w;
            float ry = (hDeg / 180f) * h;
            for (int pass = 0; pass < 2; pass++)
            {
                // Second pass wraps across the dateline.
                float x0 = pass == 0 ? cx : (cx < w * 0.5f ? cx + w : cx - w);
                int xs = Mathf.Max(0, Mathf.FloorToInt(x0 - rx));
                int xe = Mathf.Min(w - 1, Mathf.CeilToInt(x0 + rx));
                int ys = Mathf.Max(0, Mathf.FloorToInt(cy - ry));
                int ye = Mathf.Min(h - 1, Mathf.CeilToInt(cy + ry));
                for (int y = ys; y <= ye; y++)
                {
                    float dy = (y - cy) / ry;
                    for (int x = xs; x <= xe; x++)
                    {
                        float dx = (x - x0) / rx;
                        if (dx * dx + dy * dy <= 1f)
                        {
                            px[y * w + x] = color;
                        }
                    }
                }
            }
        }

        /// <summary>An ellipse with an organic edge: the body plus jittered lobes around its rim.</summary>
        private static void Landmass(Color32[] px, int w, int h, System.Random rng, float lon, float lat, float wDeg, float hDeg, Color32 color)
        {
            FillEllipseDeg(px, w, h, lon, lat, wDeg, hDeg, color);
            for (int i = 0; i < 18; i++)
            {
                float a = (i / 18f) * Mathf.PI * 2f + (float)rng.NextDouble() * 0.3f;
                float lobeLon = lon + Mathf.Cos(a) * wDeg * (0.85f + (float)rng.NextDouble() * 0.25f);
                float lobeLat = lat + Mathf.Sin(a) * hDeg * (0.85f + (float)rng.NextDouble() * 0.25f);
                FillEllipseDeg(px, w, h, lobeLon, lobeLat, wDeg * (0.12f + (float)rng.NextDouble() * 0.2f), hDeg * (0.12f + (float)rng.NextDouble() * 0.2f), color);
            }
        }

        private static Texture2D BuildAlbedo()
        {
            const int w = 1024;
            const int h = 512;
            var px = new Color32[w * h];
            var rng = new System.Random(1969);

            // Ocean, lighter toward the poles.
            for (int y = 0; y < h; y++)
            {
                float lat = Mathf.Abs(y / (float)h - 0.5f) * 2f;
                Color32 ocean = Color32.Lerp(new Color32(13, 74, 124, 255), new Color32(93, 143, 179, 255), Mathf.Pow(lat, 3f));
                for (int x = 0; x < w; x++)
                {
                    px[y * w + x] = ocean;
                }
            }

            var shelf = new Color32(31, 122, 168, 255);
            var land = new Color32(79, 122, 58, 255);
            var desert = new Color32(194, 163, 107, 255);
            var highland = new Color32(111, 106, 82, 255);
            var forest = new Color32(47, 90, 42, 255);
            var ice = new Color32(233, 239, 243, 255);

            Landmass(px, w, h, rng, -100f, 45f, 56f, 30f, shelf);
            Landmass(px, w, h, rng, -58f, -12f, 25f, 32f, shelf);
            Landmass(px, w, h, rng, 22f, 8f, 29f, 36f, shelf);
            Landmass(px, w, h, rng, 75f, 50f, 78f, 30f, shelf);
            Landmass(px, w, h, rng, 135f, -25f, 25f, 16f, shelf);

            Landmass(px, w, h, rng, -100f, 45f, 50f, 26f, land); // N America
            Landmass(px, w, h, rng, -58f, -12f, 20f, 28f, land); // S America
            Landmass(px, w, h, rng, 22f, 8f, 24f, 32f, land);    // Africa
            Landmass(px, w, h, rng, 75f, 50f, 72f, 26f, land);   // Eurasia
            Landmass(px, w, h, rng, 135f, -25f, 20f, 12f, land); // Australia
            Landmass(px, w, h, rng, -42f, 72f, 12f, 8f, land);   // Greenland

            Landmass(px, w, h, rng, 25f, 22f, 16f, 9f, desert);  // Sahara
            Landmass(px, w, h, rng, -108f, 38f, 12f, 6f, desert);
            Landmass(px, w, h, rng, 45f, 24f, 10f, 6f, desert);
            Landmass(px, w, h, rng, 132f, -26f, 12f, 7f, desert);
            Landmass(px, w, h, rng, 88f, 32f, 16f, 5f, highland);
            Landmass(px, w, h, rng, -70f, -20f, 4f, 14f, highland);
            Landmass(px, w, h, rng, -62f, -5f, 14f, 8f, forest);
            Landmass(px, w, h, rng, 20f, 0f, 12f, 7f, forest);
            Landmass(px, w, h, rng, 100f, 60f, 60f, 10f, forest);

            // The launch coast: the pad (lon 0, lat 0) on land, sea to the east.
            FillEllipseDeg(px, w, h, -6f, 3f, 9f, 8f, land);
            FillEllipseDeg(px, w, h, 8.4f, -3f, 9f, 8f, new Color32(15, 77, 128, 255));
            FillEllipseDeg(px, w, h, 6f, -2.5f, 6f, 5f, shelf);

            // Ice caps with ragged edges.
            for (int y = 0; y < h; y++)
            {
                if (y < h * 0.07f || y > h * 0.93f)
                {
                    for (int x = 0; x < w; x++)
                    {
                        px[y * w + x] = ice;
                    }
                }
            }
            for (int i = 0; i < 60; i++)
            {
                float lon = (float)rng.NextDouble() * 360f - 180f;
                FillEllipseDeg(px, w, h, lon, 78f + (float)rng.NextDouble() * 6f, 6f + (float)rng.NextDouble() * 10f, 2f + (float)rng.NextDouble() * 3f, ice);
                FillEllipseDeg(px, w, h, lon, -(78f + (float)rng.NextDouble() * 6f), 6f + (float)rng.NextDouble() * 10f, 2f + (float)rng.NextDouble() * 3f, ice);
            }

            // Noise so nothing is a flat sheet of colour.
            Texture2D noise = ProceduralMeshes.NoiseTexture(256, 5);
            Color32[] n = noise.GetPixels32();
            for (int y = 0; y < h; y++)
            {
                for (int x = 0; x < w; x++)
                {
                    float fine = n[(y % 256) * 256 + (x % 256)].r / 255f;
                    float coarse = n[((y / 4) % 256) * 256 + ((x / 4) % 256)].r / 255f;
                    float k = (0.8f + 0.4f * fine) * (0.88f + 0.24f * coarse);
                    Color32 c = px[y * w + x];
                    px[y * w + x] = new Color32(
                        (byte)Mathf.Clamp(Mathf.RoundToInt(c.r * k), 0, 255),
                        (byte)Mathf.Clamp(Mathf.RoundToInt(c.g * k), 0, 255),
                        (byte)Mathf.Clamp(Mathf.RoundToInt(c.b * k), 0, 255),
                        255);
                }
            }

            var tex = new Texture2D(w, h, TextureFormat.RGBA32, true) { wrapMode = TextureWrapMode.Repeat };
            tex.SetPixels32(px);
            tex.Apply(true);
            return tex;
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
            Shader shader = Shader.Find("Universal Render Pipeline/Particles/Unlit")
                ?? Shader.Find("Particles/Standard Unlit")
                ?? Shader.Find("Sprites/Default");
            var material = new Material(shader) { color = color };
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
