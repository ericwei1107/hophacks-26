using UnityEngine;

namespace Apogee.RocketRenderer
{
    /// <summary>
    /// Meshes and textures built from code, shared by the vehicle, the Earth
    /// and the launch site. Nothing here is authored in the editor, which is
    /// what keeps the whole Unity side reviewable as text.
    ///
    /// The shapes mirror the three.js view in web/src/ui/components: the same
    /// bell and ogive profiles, the same panel seams, the same noise.
    /// </summary>
    public static class ProceduralMeshes
    {
        // -- profiles ------------------------------------------------------------

        /// <summary>A parabolic engine bell hanging from its throat at y = 0 down to y = -length.</summary>
        public static Vector2[] BellProfile(float throatRadius, float exitRadius, float length, int steps = 16)
        {
            var pts = new Vector2[steps + 1];
            for (int i = 0; i <= steps; i++)
            {
                float t = i / (float)steps;
                float r = throatRadius + (exitRadius - throatRadius) * (1f - Mathf.Pow(1f - t, 1.9f));
                pts[i] = new Vector2(r, -t * length);
            }
            return pts;
        }

        /// <summary>A tangent-ogive nose standing on y = 0, radius at the base, a point at y = length.</summary>
        public static Vector2[] OgiveProfile(float radius, float length, int steps = 26)
        {
            float rho = (radius * radius + length * length) / (2f * radius);
            var pts = new Vector2[steps + 1];
            for (int i = 0; i <= steps; i++)
            {
                float h = (i / (float)steps) * length;
                float x = Mathf.Max(0f, Mathf.Sqrt(Mathf.Max(0f, rho * rho - h * h)) + radius - rho);
                pts[i] = new Vector2(i == steps ? 0f : x, h);
            }
            return pts;
        }

        /// <summary>The flame shape used by the plume glow: unit radius at the exit tapering to a point at y = -1.</summary>
        public static Vector2[] FlameProfile(int steps = 18)
        {
            var pts = new Vector2[steps + 1];
            for (int i = 0; i <= steps; i++)
            {
                float t = i / (float)steps;
                float r = i == steps ? 0f : (0.62f + 0.55f * t) * Mathf.Pow(1f - t, 0.42f);
                pts[i] = new Vector2(Mathf.Max(r, 0.001f), -t);
            }
            return pts;
        }

        // -- meshes ----------------------------------------------------------------

        /// <summary>
        /// A surface of revolution around +Y. `profile` is (radius, height).
        /// Double-sided when asked, with separate vertices per side so the
        /// normals stay clean: bells are seen from inside as well as outside.
        /// </summary>
        public static Mesh Lathe(Vector2[] profile, int segments, bool doubleSided = false)
        {
            int rings = profile.Length;
            int ringVerts = segments + 1;
            int sideVerts = rings * ringVerts;
            int sides = doubleSided ? 2 : 1;
            var vertices = new Vector3[sideVerts * sides];
            var uv = new Vector2[sideVerts * sides];
            var triangles = new int[(rings - 1) * segments * 6 * sides];

            for (int side = 0; side < sides; side++)
            {
                int vBase = side * sideVerts;
                for (int i = 0; i < rings; i++)
                {
                    for (int s = 0; s <= segments; s++)
                    {
                        float a = (s / (float)segments) * Mathf.PI * 2f;
                        int v = vBase + i * ringVerts + s;
                        vertices[v] = new Vector3(Mathf.Cos(a) * profile[i].x, profile[i].y, Mathf.Sin(a) * profile[i].x);
                        uv[v] = new Vector2(s / (float)segments, i / (float)(rings - 1));
                    }
                }
                int tBase = side * (rings - 1) * segments * 6;
                int t = tBase;
                for (int i = 0; i < rings - 1; i++)
                {
                    for (int s = 0; s < segments; s++)
                    {
                        int a = vBase + i * ringVerts + s;
                        int b = a + 1;
                        int c = a + ringVerts;
                        int d = c + 1;
                        if (side == 0)
                        {
                            triangles[t++] = a; triangles[t++] = c; triangles[t++] = b;
                            triangles[t++] = b; triangles[t++] = c; triangles[t++] = d;
                        }
                        else
                        {
                            triangles[t++] = a; triangles[t++] = b; triangles[t++] = c;
                            triangles[t++] = b; triangles[t++] = d; triangles[t++] = c;
                        }
                    }
                }
            }

            var mesh = new Mesh { name = "Lathe" };
            mesh.vertices = vertices;
            mesh.uv = uv;
            mesh.triangles = triangles;
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        /// <summary>A torus in the XZ plane, centred on the origin.</summary>
        public static Mesh Torus(float radius, float tube, int segments, int tubeSides)
        {
            int ringVerts = tubeSides + 1;
            int segVerts = segments + 1;
            var vertices = new Vector3[segVerts * ringVerts];
            var uv = new Vector2[vertices.Length];
            var triangles = new int[segments * tubeSides * 6];
            for (int s = 0; s <= segments; s++)
            {
                float a = (s / (float)segments) * Mathf.PI * 2f;
                var center = new Vector3(Mathf.Cos(a) * radius, 0f, Mathf.Sin(a) * radius);
                var radial = new Vector3(Mathf.Cos(a), 0f, Mathf.Sin(a));
                for (int k = 0; k <= tubeSides; k++)
                {
                    float b = (k / (float)tubeSides) * Mathf.PI * 2f;
                    int v = s * ringVerts + k;
                    vertices[v] = center + radial * (Mathf.Cos(b) * tube) + Vector3.up * (Mathf.Sin(b) * tube);
                    uv[v] = new Vector2(s / (float)segments, k / (float)tubeSides);
                }
            }
            int t = 0;
            for (int s = 0; s < segments; s++)
            {
                for (int k = 0; k < tubeSides; k++)
                {
                    int a = s * ringVerts + k;
                    int b = a + 1;
                    int c = a + ringVerts;
                    int d = c + 1;
                    triangles[t++] = a; triangles[t++] = b; triangles[t++] = c;
                    triangles[t++] = b; triangles[t++] = d; triangles[t++] = c;
                }
            }
            var mesh = new Mesh { name = "Torus" };
            mesh.vertices = vertices;
            mesh.uv = uv;
            mesh.triangles = triangles;
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        /// <summary>
        /// A flat disc (or ring, with an inner radius) in the XZ plane facing +Y,
        /// with planar UVs over its bounding square so a square texture maps
        /// straight onto it: north is +V, east is +U.
        /// </summary>
        public static Mesh Disc(float outerRadius, float innerRadius, int segments)
        {
            int ringVerts = segments + 1;
            var vertices = new Vector3[ringVerts * 2];
            var uv = new Vector2[vertices.Length];
            var triangles = new int[segments * 6];
            for (int s = 0; s <= segments; s++)
            {
                float a = (s / (float)segments) * Mathf.PI * 2f;
                var dir = new Vector3(Mathf.Cos(a), 0f, Mathf.Sin(a));
                vertices[s] = dir * innerRadius;
                vertices[ringVerts + s] = dir * outerRadius;
                uv[s] = new Vector2(0.5f + 0.5f * dir.x * innerRadius / outerRadius, 0.5f + 0.5f * dir.z * innerRadius / outerRadius);
                uv[ringVerts + s] = new Vector2(0.5f + 0.5f * dir.x, 0.5f + 0.5f * dir.z);
            }
            int t = 0;
            for (int s = 0; s < segments; s++)
            {
                int a = s;
                int b = s + 1;
                int c = ringVerts + s;
                int d = c + 1;
                // Wound so the face points +Y.
                triangles[t++] = a; triangles[t++] = c; triangles[t++] = b;
                triangles[t++] = b; triangles[t++] = c; triangles[t++] = d;
            }
            var mesh = new Mesh { name = "Disc" };
            mesh.vertices = vertices;
            mesh.uv = uv;
            mesh.triangles = triangles;
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        /// <summary>A flat trapezoidal fin in the XY plane, rooted on the axis, double-sided.</summary>
        public static Mesh Fin(float rootChord, float tipChord, float sweep, float span)
        {
            var vertices = new Vector3[]
            {
                new Vector3(0f, rootChord, 0f),          // root leading edge
                new Vector3(0f, 0f, 0f),                 // root trailing edge
                new Vector3(span, sweep, 0f),            // tip trailing edge
                new Vector3(span, sweep + tipChord, 0f), // tip leading edge
            };
            var triangles = new int[] { 0, 1, 2, 0, 2, 3, 2, 1, 0, 3, 2, 0 };
            var mesh = new Mesh { name = "Fin" };
            mesh.vertices = vertices;
            mesh.triangles = triangles;
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        // -- textures --------------------------------------------------------------

        /// <summary>Tileable greyscale value noise.</summary>
        public static Texture2D NoiseTexture(int size, int seed, int octaves = 4)
        {
            var tex = new Texture2D(size, size, TextureFormat.RGBA32, true) { wrapMode = TextureWrapMode.Repeat };
            var pixels = new Color32[size * size];
            var rng = new System.Random(seed);
            var lattices = new float[octaves][];
            var counts = new int[octaves];
            for (int o = 0; o < octaves; o++)
            {
                int n = 6 << o;
                counts[o] = n;
                lattices[o] = new float[n * n];
                for (int i = 0; i < n * n; i++)
                {
                    lattices[o][i] = (float)rng.NextDouble();
                }
            }
            for (int y = 0; y < size; y++)
            {
                for (int x = 0; x < size; x++)
                {
                    float value = 0f;
                    float amplitude = 0.5f;
                    float total = 0f;
                    for (int o = 0; o < octaves; o++)
                    {
                        int n = counts[o];
                        float fx = (x / (float)size) * n;
                        float fy = (y / (float)size) * n;
                        int x0 = Mathf.FloorToInt(fx);
                        int y0 = Mathf.FloorToInt(fy);
                        float tx = Mathf.SmoothStep(0f, 1f, fx - x0);
                        float ty = Mathf.SmoothStep(0f, 1f, fy - y0);
                        int x1 = (x0 + 1) % n;
                        int y1 = (y0 + 1) % n;
                        float[] v = lattices[o];
                        float v00 = v[y0 * n + x0];
                        float v10 = v[y0 * n + x1];
                        float v01 = v[y1 * n + x0];
                        float v11 = v[y1 * n + x1];
                        float s = (v00 * (1f - tx) + v10 * tx) * (1f - ty) + (v01 * (1f - tx) + v11 * tx) * ty;
                        value += s * amplitude;
                        total += amplitude;
                        amplitude *= 0.5f;
                    }
                    byte g = (byte)Mathf.RoundToInt(255f * value / total);
                    pixels[y * size + x] = new Color32(g, g, g, 255);
                }
            }
            tex.SetPixels32(pixels);
            tex.Apply(true);
            return tex;
        }

        /// <summary>White tank skin with vertical panel joints, weld seams and speckle; tiles.</summary>
        public static Texture2D PanelTexture(int size = 256)
        {
            var tex = new Texture2D(size, size, TextureFormat.RGBA32, true) { wrapMode = TextureWrapMode.Repeat };
            var pixels = new Color32[size * size];
            var rng = new System.Random(7);
            for (int i = 0; i < pixels.Length; i++)
            {
                float speckle = 1f - (float)rng.NextDouble() * 0.05f;
                byte g = (byte)(255f * speckle);
                pixels[i] = new Color32(g, g, g, 255);
            }
            int quarter = size / 4;
            int half = size / 2;
            for (int y = 0; y < size; y++)
            {
                for (int x = 0; x < size; x++)
                {
                    bool joint = x % quarter == 0;
                    bool seam = y % half < 2;
                    if (joint || seam)
                    {
                        byte g = (byte)(seam ? 200 : 214);
                        pixels[y * size + x] = new Color32(g, g, g, 255);
                    }
                    else if (y % half == 4 && x % 8 == 4)
                    {
                        pixels[y * size + x] = new Color32(215, 215, 215, 255); // rivets
                    }
                }
            }
            tex.SetPixels32(pixels);
            tex.Apply(true);
            return tex;
        }

        /// <summary>Four alternating black and white quarters around the circumference.</summary>
        public static Texture2D CheckerTexture()
        {
            var tex = new Texture2D(4, 1, TextureFormat.RGBA32, false)
            {
                wrapMode = TextureWrapMode.Repeat,
                filterMode = FilterMode.Point,
            };
            tex.SetPixels32(new[]
            {
                new Color32(20, 23, 28, 255),
                new Color32(233, 229, 220, 255),
                new Color32(20, 23, 28, 255),
                new Color32(233, 229, 220, 255),
            });
            tex.Apply(false);
            return tex;
        }

        /// <summary>A URP Lit material, with the built-in Standard shader as a fallback.</summary>
        public static Material LitMaterial(Color color, float smoothness = 0.35f, float metallic = 0f, Texture2D map = null, Vector2? tiling = null)
        {
            Shader shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            var material = new Material(shader) { color = color };
            if (material.HasProperty("_Smoothness"))
            {
                material.SetFloat("_Smoothness", smoothness);
            }
            if (material.HasProperty("_Glossiness"))
            {
                material.SetFloat("_Glossiness", smoothness);
            }
            if (material.HasProperty("_Metallic"))
            {
                material.SetFloat("_Metallic", metallic);
            }
            if (map != null)
            {
                material.mainTexture = map;
                if (tiling.HasValue)
                {
                    material.mainTextureScale = tiling.Value;
                }
            }
            return material;
        }

        /// <summary>Alpha-blended URP Lit material, for the terrain's fading rim.</summary>
        public static Material TransparentLitMaterial(Color color, Texture2D map)
        {
            Material material = LitMaterial(color, 0.1f, 0f, map);
            material.SetFloat("_Surface", 1f);
            material.SetFloat("_Blend", 0f);
            material.SetFloat("_SrcBlend", (float)UnityEngine.Rendering.BlendMode.SrcAlpha);
            material.SetFloat("_DstBlend", (float)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
            material.SetFloat("_ZWrite", 0f);
            material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            material.SetOverrideTag("RenderType", "Transparent");
            material.renderQueue = 3000;
            return material;
        }

        /// <summary>A double-sided variant, for fairing halves and open bells.</summary>
        public static Material DoubleSided(Material material)
        {
            if (material.HasProperty("_Cull"))
            {
                material.SetFloat("_Cull", (float)UnityEngine.Rendering.CullMode.Off);
            }
            return material;
        }
    }
}
