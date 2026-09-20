using UnityEngine;

namespace Apogee.RocketRenderer
{
    /// <summary>
    /// The launch site: coastal terrain, the pad, its tower and tank farm.
    ///
    /// The site is fixed to the ground, not to the rocket. Unity's 32-bit
    /// transforms cannot hang a pad off a 6371 km Earth without metre-scale
    /// jitter, so instead it is placed each frame from the rocket's own
    /// sub-point: the frame's latitude and longitude say how far the vehicle
    /// has drifted from the pad, and that offset is exact to the centimetre.
    ///
    /// Frame: x east, y up, z north — the renderer's own axes. Metres.
    /// </summary>
    public class LaunchSiteView : MonoBehaviour
    {
        /// <summary>Radius of the far terrain disc, m. Beyond it the globe takes over.</summary>
        public const float TerrainRadiusM = 40_000f;
        /// <summary>Radius of the detailed pad-area disc, m.</summary>
        public const float NearRadiusM = 640f;
        /// <summary>The coastline runs north-south this far east of the pad, m.</summary>
        public const float CoastEastM = 8_000f;
        /// <summary>The site is hidden once the vehicle is this far away, m.</summary>
        private const float HideBeyondM = 300_000f;

        private static readonly Color32 Scrub = new Color32(94, 107, 66, 255);
        private static readonly Color32 ScrubDark = new Color32(58, 72, 40, 255);
        private static readonly Color32 Sand = new Color32(183, 169, 124, 255);
        private static readonly Color32 OceanShallow = new Color32(31, 111, 152, 255);
        private static readonly Color32 OceanDeep = new Color32(15, 74, 120, 255);
        private static readonly Color32 Concrete = new Color32(141, 143, 144, 255);
        private static readonly Color32 Asphalt = new Color32(76, 79, 82, 255);

        private Transform structures;
        private Transform deck;
        private float rocketRadius = 1.85f;
        private float rocketLength = 60f;

        /// <summary>Offset from the rocket to the pad, in the renderer's local frame, for one frame.</summary>
        public static Vector3 SiteOffset(RenderFrameDto frame)
        {
            float lat = frame.latDeg * Mathf.Deg2Rad;
            float lon = frame.lonDeg * Mathf.Deg2Rad;
            float east = -EarthView.EarthRadiusM * lon * Mathf.Cos(lat);
            float north = -EarthView.EarthRadiusM * lat;
            float d2 = east * east + north * north;
            // The ground curves away under a vehicle that has flown downrange.
            float drop = d2 / (2f * EarthView.EarthRadiusM);
            float altitude = Mathf.Max(0f, frame.altitude);
            return new Vector3(east, -(altitude + frame.comFromBase) - drop, north);
        }

        public void Build()
        {
            var far = new GameObject("Terrain");
            far.transform.SetParent(transform, false);
            far.transform.localPosition = new Vector3(0f, -0.6f, 0f);
            far.AddComponent<MeshFilter>().sharedMesh = ProceduralMeshes.Disc(TerrainRadiusM, 0f, 96);
            far.AddComponent<MeshRenderer>().sharedMaterial =
                ProceduralMeshes.TransparentLitMaterial(Color.white, BuildTerrainTexture());

            var near = new GameObject("PadArea");
            near.transform.SetParent(transform, false);
            near.transform.localPosition = new Vector3(0f, -0.25f, 0f);
            near.AddComponent<MeshFilter>().sharedMesh = ProceduralMeshes.Disc(NearRadiusM, 0f, 64);
            near.AddComponent<MeshRenderer>().sharedMaterial =
                ProceduralMeshes.TransparentLitMaterial(Color.white, BuildNearTexture());
            near.GetComponent<MeshRenderer>().sharedMaterial.renderQueue = 3001;

            structures = new GameObject("Structures").transform;
            structures.SetParent(transform, false);
            BuildStructures();
        }

        /// <summary>Re-fit the pad to a new vehicle: the trench hole and the tower height follow it.</summary>
        public void Configure(RocketGeometryDto geometry)
        {
            rocketRadius = Mathf.Max(0.5f, geometry.diameter * 0.5f);
            rocketLength = Mathf.Max(10f, geometry.totalLength);
            if (structures != null)
            {
                for (int i = structures.childCount - 1; i >= 0; i--)
                {
                    Destroy(structures.GetChild(i).gameObject);
                }
                BuildStructures();
            }
        }

        public void Apply(RenderFrameDto frame)
        {
            Vector3 offset = SiteOffset(frame);
            float horizontal = Mathf.Sqrt(offset.x * offset.x + offset.z * offset.z);
            bool visible = horizontal < HideBeyondM && Mathf.Max(0f, frame.altitude) < 400_000f;
            if (gameObject.activeSelf != visible)
            {
                gameObject.SetActive(visible);
            }
            if (!visible)
            {
                return;
            }
            transform.localPosition = offset;
            // Tilt with the curve of the Earth, so downrange the pad still lies on the surface.
            Vector3 up = (offset - frame.earthCenterLocal).normalized;
            transform.localRotation = up.sqrMagnitude > 0.5f ? Quaternion.FromToRotation(Vector3.up, up) : Quaternion.identity;
        }

        // -- structures --------------------------------------------------------

        private void BuildStructures()
        {
            float trenchR = rocketRadius * 2.2f + 3f;
            float towerHeight = Mathf.Max(60f, rocketLength * 1.15f);
            Material concrete = ProceduralMeshes.LitMaterial(new Color(0.6f, 0.61f, 0.62f), 0.1f);
            Material dark = ProceduralMeshes.LitMaterial(new Color(0.18f, 0.19f, 0.2f), 0.1f);
            Material steel = ProceduralMeshes.LitMaterial(new Color(0.23f, 0.25f, 0.28f), 0.3f, 0.5f);
            Material red = ProceduralMeshes.LitMaterial(new Color(0.75f, 0.22f, 0.17f), 0.3f, 0.4f);
            Material white = ProceduralMeshes.LitMaterial(new Color(0.93f, 0.93f, 0.91f), 0.4f, 0.2f);
            Material building = ProceduralMeshes.LitMaterial(new Color(0.76f, 0.77f, 0.78f), 0.2f);

            // Pad deck with the trench opening under the vehicle, and the trench itself.
            var deckGo = new GameObject("Deck");
            deckGo.transform.SetParent(structures, false);
            deckGo.AddComponent<MeshFilter>().sharedMesh = ProceduralMeshes.Disc(46f, trenchR, 64);
            deckGo.AddComponent<MeshRenderer>().sharedMaterial = concrete;
            deck = deckGo.transform;
            Box(structures, "TrenchFloor", new Vector3(0f, -7.6f, 0f), new Vector3(2f * trenchR, 0.2f, 80f), dark);
            Box(structures, "TrenchWallEast", new Vector3(trenchR + 0.6f, -3.75f, 0f), new Vector3(1.2f, 7.5f, 80f), dark);
            Box(structures, "TrenchWallWest", new Vector3(-(trenchR + 0.6f), -3.75f, 0f), new Vector3(1.2f, 7.5f, 80f), dark);
            var deflector = Box(structures, "FlameDeflector", new Vector3(0f, -6.2f, 0f), new Vector3(4.2f, 4.2f, 40f), steel);
            deflector.localRotation = Quaternion.Euler(0f, 0f, 45f);

            // Hold-down mount.
            float mountR = rocketRadius + 1.4f;
            for (int i = 0; i < 4; i++)
            {
                float a = (i / 4f) * Mathf.PI * 2f + Mathf.PI / 4f;
                Box(structures, $"HoldDown{i}", new Vector3(Mathf.Cos(a) * mountR, 1.2f, Mathf.Sin(a) * mountR), new Vector3(1.4f, 2.4f, 1.4f), steel);
            }
            var mountRing = new GameObject("MountRing");
            mountRing.transform.SetParent(structures, false);
            mountRing.transform.localPosition = new Vector3(0f, 0.35f, 0f);
            mountRing.AddComponent<MeshFilter>().sharedMesh = ProceduralMeshes.Torus(mountR, 0.55f, 40, 8);
            mountRing.AddComponent<MeshRenderer>().sharedMaterial = steel;

            // Fixed service tower, behind the pad so no camera looks through it at the vehicle.
            var tower = new GameObject("Tower").transform;
            tower.SetParent(structures, false);
            tower.localPosition = new Vector3(-34f, 0f, -22f);
            foreach (Vector2 corner in new[] { new Vector2(-3.5f, -3.5f), new Vector2(3.5f, -3.5f), new Vector2(-3.5f, 3.5f), new Vector2(3.5f, 3.5f) })
            {
                Box(tower, "Column", new Vector3(corner.x, towerHeight * 0.5f, corner.y), new Vector3(0.7f, towerHeight, 0.7f), steel);
            }
            int bays = Mathf.Max(4, Mathf.RoundToInt(towerHeight / 9f));
            for (int i = 0; i < bays; i++)
            {
                float y = ((i + 1) / (float)bays) * towerHeight - 1f;
                Material m = i % 4 == 3 ? red : steel;
                Box(tower, "Beam", new Vector3(0f, y, 0f), new Vector3(7.6f, 0.5f, 0.5f), m);
                Box(tower, "Beam", new Vector3(0f, y, 0f), new Vector3(0.5f, 0.5f, 7.6f), m);
                Box(tower, "Floor", new Vector3(0f, y, 0f), new Vector3(7.2f, 0.15f, 7.2f), steel);
            }
            Cylinder(tower, "LightningMast", new Vector3(0f, towerHeight + 14f, 0f), 0.25f, 28f, white);
            Box(tower, "Crane", new Vector3(9f, towerHeight + 1.5f, 0f), new Vector3(18f, 0.6f, 0.6f), red);

            // Swing arms from the tower to the vehicle.
            float armAngle = Mathf.Atan2(22f, 34f);
            float armLength = Mathf.Sqrt(34f * 34f + 22f * 22f) - rocketRadius - 4.5f;
            foreach (float h in new[] { towerHeight * 0.42f, towerHeight * 0.82f })
            {
                var arm = new GameObject("SwingArm").transform;
                arm.SetParent(structures, false);
                arm.localPosition = new Vector3(-34f, h, -22f);
                arm.localRotation = Quaternion.Euler(0f, -armAngle * Mathf.Rad2Deg, 0f);
                Box(arm, "Arm", new Vector3(armLength * 0.5f, 0f, 0f), new Vector3(armLength, 1.1f, 1.4f), steel);
                Box(arm, "Rail", new Vector3(armLength * 0.5f, -0.9f, 0f), new Vector3(armLength * 0.9f, 0.3f, 0.3f), red);
            }

            // Lightning masts around the pad.
            foreach (Vector2 p in new[] { new Vector2(130f, 130f), new Vector2(-130f, 130f), new Vector2(130f, -130f), new Vector2(-130f, -130f) })
            {
                float h = towerHeight * 1.25f;
                Cylinder(structures, "Mast", new Vector3(p.x, h * 0.5f, p.y), 0.75f, h, white);
            }

            // Water tower and tank farm.
            Cylinder(structures, "WaterTowerStem", new Vector3(118f, 24f, 70f), 3.4f, 48f, white);
            Sphere(structures, "WaterTower", new Vector3(118f, 54f, 70f), 9.5f, white);
            Sphere(structures, "LoxSphere", new Vector3(-150f, 12.5f, -70f), 12.5f, white);
            for (int i = 0; i < 3; i++)
            {
                var tank = Cylinder(structures, $"Tank{i}", new Vector3(-130f + i * 14f, 4f, 45f), 3.5f, 30f, white);
                tank.localRotation = Quaternion.Euler(0f, 0f, 90f);
            }

            // Buildings.
            Box(structures, "Hangar", new Vector3(-585f, 11f, 205f), new Vector3(110f, 22f, 70f), building);
            Box(structures, "Block", new Vector3(-420f, 5f, -165f), new Vector3(60f, 10f, 50f), building);
            Box(structures, "Shed", new Vector3(200f, 3f, -190f), new Vector3(40f, 6f, 40f), building);
        }

        private static Transform Box(Transform parent, string name, Vector3 center, Vector3 size, Material material)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = name;
            Destroy(go.GetComponent<Collider>());
            go.transform.SetParent(parent, false);
            go.transform.localPosition = center;
            go.transform.localScale = size;
            go.GetComponent<MeshRenderer>().sharedMaterial = material;
            return go.transform;
        }

        private static Transform Cylinder(Transform parent, string name, Vector3 center, float radius, float length, Material material)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            go.name = name;
            Destroy(go.GetComponent<Collider>());
            go.transform.SetParent(parent, false);
            go.transform.localPosition = center;
            go.transform.localScale = new Vector3(radius * 2f, length * 0.5f, radius * 2f);
            go.GetComponent<MeshRenderer>().sharedMaterial = material;
            return go.transform;
        }

        private static Transform Sphere(Transform parent, string name, Vector3 center, float radius, Material material)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            go.name = name;
            Destroy(go.GetComponent<Collider>());
            go.transform.SetParent(parent, false);
            go.transform.localPosition = center;
            go.transform.localScale = Vector3.one * (radius * 2f);
            go.GetComponent<MeshRenderer>().sharedMaterial = material;
            return go.transform;
        }

        // -- textures ------------------------------------------------------------

        private static Color32 Lerp(Color32 a, Color32 b, float t)
        {
            return Color32.Lerp(a, b, Mathf.Clamp01(t));
        }

        private static Color32 Shade(Color32 c, float k)
        {
            return new Color32(
                (byte)Mathf.Clamp(Mathf.RoundToInt(c.r * k), 0, 255),
                (byte)Mathf.Clamp(Mathf.RoundToInt(c.g * k), 0, 255),
                (byte)Mathf.Clamp(Mathf.RoundToInt(c.b * k), 0, 255),
                c.a);
        }

        /// <summary>Blend `color` into the pixel at (x, y) with the given alpha, if inside the canvas.</summary>
        private static void Blend(Color32[] px, int size, int x, int y, Color32 color, float alpha)
        {
            if (x < 0 || y < 0 || x >= size || y >= size)
            {
                return;
            }
            int i = y * size + x;
            px[i] = Lerp(px[i], color, alpha);
        }

        private static void FillEllipse(Color32[] px, int size, float cx, float cy, float rx, float ry, Color32 color, float alpha)
        {
            int x0 = Mathf.Max(0, Mathf.FloorToInt(cx - rx));
            int x1 = Mathf.Min(size - 1, Mathf.CeilToInt(cx + rx));
            int y0 = Mathf.Max(0, Mathf.FloorToInt(cy - ry));
            int y1 = Mathf.Min(size - 1, Mathf.CeilToInt(cy + ry));
            for (int y = y0; y <= y1; y++)
            {
                float dy = (y - cy) / ry;
                for (int x = x0; x <= x1; x++)
                {
                    float dx = (x - cx) / rx;
                    if (dx * dx + dy * dy <= 1f)
                    {
                        Blend(px, size, x, y, color, alpha);
                    }
                }
            }
        }

        private static void Line(Color32[] px, int size, Vector2 a, Vector2 b, float width, Color32 color)
        {
            float length = Vector2.Distance(a, b);
            int steps = Mathf.Max(1, Mathf.CeilToInt(length));
            float r = Mathf.Max(0.5f, width * 0.5f);
            for (int s = 0; s <= steps; s++)
            {
                Vector2 p = Vector2.Lerp(a, b, s / (float)steps);
                FillEllipse(px, size, p.x, p.y, r, r, color, 1f);
            }
        }

        private static void FadeRim(Color32[] px, int size, float innerFraction)
        {
            float half = size * 0.5f;
            for (int y = 0; y < size; y++)
            {
                for (int x = 0; x < size; x++)
                {
                    float d = Mathf.Sqrt((x - half) * (x - half) + (y - half) * (y - half)) / half;
                    float a = 1f - Mathf.Clamp01((d - innerFraction) / (1f - innerFraction));
                    int i = y * size + x;
                    px[i].a = (byte)Mathf.RoundToInt(255f * a);
                }
            }
        }

        private static void Modulate(Color32[] px, int size, Texture2D noise, float strength, float scale)
        {
            Color32[] n = noise.GetPixels32();
            int ns = noise.width;
            for (int y = 0; y < size; y++)
            {
                for (int x = 0; x < size; x++)
                {
                    int nx = Mathf.FloorToInt(x / scale) % ns;
                    int ny = Mathf.FloorToInt(y / scale) % ns;
                    float v = n[ny * ns + nx].r / 255f;
                    px[y * size + x] = Shade(px[y * size + x], 1f - strength + 2f * strength * v);
                }
            }
        }

        private static float CoastX(float y, float coastX, float size)
        {
            return coastX
                + Mathf.Sin(y * 0.009f + 1.2f) * 0.012f * size
                + Mathf.Sin(y * 0.0346f + 0.4f) * 0.004f * size
                + Mathf.Sin(y * 0.082f) * 0.0015f * size;
        }

        private static Texture2D BuildTerrainTexture()
        {
            const int size = 1024;
            float pxPerM = size / (2f * TerrainRadiusM);
            var px = new Color32[size * size];
            var rng = new System.Random(4242);
            for (int i = 0; i < px.Length; i++)
            {
                px[i] = Scrub;
            }
            for (int i = 0; i < 420; i++)
            {
                bool dark = rng.NextDouble() > 0.5;
                Color32 c = dark ? ScrubDark : new Color32(140, 138, 96, 255);
                FillEllipse(px, size, (float)rng.NextDouble() * size, (float)rng.NextDouble() * size,
                    4f + (float)rng.NextDouble() * 30f, 3f + (float)rng.NextDouble() * 20f, c, 0.2f + (float)rng.NextDouble() * 0.35f);
            }
            Modulate(px, size, ProceduralMeshes.NoiseTexture(256, 17), 0.22f, 1f);

            // Coast: land west of it, ocean east.
            float coastX = size * 0.5f + CoastEastM * pxPerM;
            float beach = Mathf.Max(2f, 180f * pxPerM);
            for (int y = 0; y < size; y++)
            {
                float edge = CoastX(y, coastX, size);
                for (int x = 0; x < size; x++)
                {
                    if (x >= edge - beach && x < edge)
                    {
                        px[y * size + x] = Sand;
                    }
                    else if (x >= edge)
                    {
                        float depth = Mathf.Clamp01((x - edge) / (size * 0.35f));
                        px[y * size + x] = Lerp(OceanShallow, OceanDeep, depth);
                        if (x - edge < Mathf.Max(1f, 25f * pxPerM))
                        {
                            px[y * size + x] = Lerp(px[y * size + x], new Color32(255, 255, 255, 255), 0.35f);
                        }
                    }
                }
            }

            // Roads: crawlerway west, a north-south highway, a runway.
            float c = size * 0.5f;
            Line(px, size, new Vector2(c, c), new Vector2(c - 6500f * pxPerM, c - 400f * pxPerM), Mathf.Max(2f, 40f * pxPerM), Asphalt);
            Line(px, size, new Vector2(c - 6500f * pxPerM, c - 400f * pxPerM), new Vector2(c - 14000f * pxPerM, c + 2500f * pxPerM), Mathf.Max(2f, 40f * pxPerM), Asphalt);
            Line(px, size, new Vector2(c - 3200f * pxPerM, 0f), new Vector2(c - 3400f * pxPerM, size), Mathf.Max(2f, 22f * pxPerM), Asphalt);
            Line(px, size, new Vector2(c - 12000f * pxPerM, c - 5600f * pxPerM), new Vector2(c - 8800f * pxPerM, c - 5600f * pxPerM), Mathf.Max(2f, 60f * pxPerM), new Color32(108, 110, 112, 255));
            for (int i = 0; i < 26; i++)
            {
                float x = c - (4000f + (float)rng.NextDouble() * 9000f) * pxPerM;
                float y = c + ((float)rng.NextDouble() - 0.5f) * 12000f * pxPerM;
                FillEllipse(px, size, x, y, (30f + (float)rng.NextDouble() * 100f) * pxPerM, (20f + (float)rng.NextDouble() * 60f) * pxPerM, new Color32(150, 150, 150, 255), 0.7f);
            }

            FadeRim(px, size, 0.62f);
            var tex = new Texture2D(size, size, TextureFormat.RGBA32, true) { wrapMode = TextureWrapMode.Clamp };
            tex.SetPixels32(px);
            tex.Apply(true);
            return tex;
        }

        private static Texture2D BuildNearTexture()
        {
            const int size = 1024;
            float pxPerM = size / (2f * NearRadiusM);
            var px = new Color32[size * size];
            var rng = new System.Random(99);
            float c = size * 0.5f;
            for (int i = 0; i < px.Length; i++)
            {
                px[i] = Scrub;
            }
            for (int i = 0; i < 700; i++)
            {
                Color32 col = rng.NextDouble() > 0.5 ? ScrubDark : new Color32(150, 140, 100, 255);
                FillEllipse(px, size, (float)rng.NextDouble() * size, (float)rng.NextDouble() * size,
                    2f + (float)rng.NextDouble() * 12f, 1.5f + (float)rng.NextDouble() * 7f, col, 0.15f + (float)rng.NextDouble() * 0.35f);
            }
            Modulate(px, size, ProceduralMeshes.NoiseTexture(256, 31), 0.2f, 0.5f);

            // Cleared sand around the complex, the perimeter road, the crawlerway.
            FillEllipse(px, size, c, c, 380f * pxPerM, 330f * pxPerM, Sand, 0.85f);
            for (int i = 0; i < 360; i++)
            {
                float a = i * Mathf.Deg2Rad;
                FillEllipse(px, size, c + Mathf.Cos(a) * 260f * pxPerM, c + Mathf.Sin(a) * 260f * pxPerM, 7f * pxPerM, 7f * pxPerM, Asphalt, 1f);
            }
            Line(px, size, new Vector2(c, c), new Vector2(0f, c - 60f * pxPerM), 42f * pxPerM, new Color32(168, 155, 120, 255));
            Line(px, size, new Vector2(c + 260f * pxPerM, c), new Vector2(size, c + 120f * pxPerM), 8f * pxPerM, Asphalt);

            // Concrete apron with painted rings and scorch marks by the trench.
            FillEllipse(px, size, c, c, 130f * pxPerM, 130f * pxPerM, Concrete, 1f);
            FillEllipse(px, size, c, c, 62f * pxPerM, 62f * pxPerM, new Color32(127, 129, 131, 255), 1f);
            var paint = new Color32(255, 196, 80, 255);
            foreach (float r in new[] { 70f, 100f, 124f })
            {
                for (int i = 0; i < 720; i++)
                {
                    float a = i * 0.5f * Mathf.Deg2Rad;
                    Blend(px, size, Mathf.RoundToInt(c + Mathf.Cos(a) * r * pxPerM), Mathf.RoundToInt(c + Mathf.Sin(a) * r * pxPerM), paint, 0.9f);
                }
            }
            FillEllipse(px, size, c, c - 70f * pxPerM, 18f * pxPerM, 60f * pxPerM, new Color32(20, 18, 16, 255), 0.55f);
            FillEllipse(px, size, c, c + 70f * pxPerM, 18f * pxPerM, 60f * pxPerM, new Color32(20, 18, 16, 255), 0.55f);

            FadeRim(px, size, 0.66f);
            var tex = new Texture2D(size, size, TextureFormat.RGBA32, true) { wrapMode = TextureWrapMode.Clamp };
            tex.SetPixels32(px);
            tex.Apply(true);
            return tex;
        }
    }
}
