using UnityEngine;

namespace Apogee.RocketRenderer
{
    /// <summary>
    /// Builds the vehicle from the <see cref="RocketGeometryDto"/> the sim sent.
    ///
    /// Nothing here recomputes a dimension. Every length, diameter and engine
    /// count comes from the sim, which derived them from the player's build —
    /// so the thing on screen is the thing the physics flew.
    ///
    /// The root's local origin is the base of the full stack, with +Y toward
    /// the nose. <see cref="FlightView"/> is what slides the root so the center
    /// of mass sits at the world origin.
    ///
    /// The parts mirror the three.js RocketMesh: an ogive fairing with a split
    /// line, panelled tanks with weld seams and a raceway, a truss interstage
    /// with the upper stage's bell hanging inside it, a checkered engine skirt
    /// and one parabolic bell per engine. <see cref="BuildBooster"/> builds the
    /// stage-1 section on its own, for the spent booster after separation.
    /// </summary>
    public class RocketBuilder : MonoBehaviour
    {
        private static readonly Color BodyColor = new Color(0.93f, 0.91f, 0.87f);
        private static readonly Color Stage1Color = new Color(0.89f, 0.87f, 0.82f);
        private static readonly Color Stage2Color = new Color(0.87f, 0.90f, 0.92f);
        private static readonly Color DarkColor = new Color(0.14f, 0.15f, 0.18f);
        private static readonly Color BellColor = new Color(0.54f, 0.56f, 0.59f);
        private static readonly Color TrussColor = new Color(0.24f, 0.26f, 0.29f);
        private static readonly Color FinColor = new Color(1.0f, 0.54f, 0.27f);
        private static readonly Color AccentColor = new Color(1.0f, 0.61f, 0.33f);

        /// <summary>Fin planform, as fractions of the root chord. Visual only.</summary>
        private const float FinTipChordFraction = 0.35f;
        private const float FinSweepFraction = 0.33f;

        /// <summary>Size of one tile of the panel texture on the tank skin, m.</summary>
        private const float PanelTileM = 1.9f;

        private static Texture2D panelTexture;
        private static Texture2D checkerTexture;

        private RocketGeometryDto geometry;
        private Transform stage1Group;
        private Transform stage2Group;
        private Transform payloadGroup;

        /// <summary>The geometry currently built, or null before the first SetRocket.</summary>
        public RocketGeometryDto Geometry => geometry;

        /// <summary>Nozzle exit positions, in the root's local space, for the plume.</summary>
        public Vector3[] Stage1NozzlePositions { get; private set; } = new Vector3[0];

        public Vector3 Stage2NozzlePosition { get; private set; }

        /// <summary>Where the vehicle's sections sit, m above the base of the full stack.</summary>
        public struct Layout
        {
            public float radius;
            public float stage1BayLength;
            public float stage1TankLength;
            public float interstageLength;
            public float stage1TopY;
            public float stage2Base;
            public float stage2BayLength;
            public float stage2TankLength;
            public float fairingBase;
            public float fairingBarrel;
            public float fairingCone;
            public float stage1NozzleRadius;
            public float stage1BellLength;
            public float stage1ThroatY;
            public float stage2NozzleRadius;
            public float stage2BellLength;
            public float stage2ThroatY;
        }

        public static Layout LayoutFor(RocketGeometryDto dto)
        {
            var l = new Layout { radius = dto.diameter * 0.5f };
            l.stage1BayLength = Mathf.Min(0.5f * dto.diameter, dto.stage1.length * 0.35f);
            l.interstageLength = Mathf.Min(0.3f * dto.diameter, dto.stage1.length * 0.2f);
            l.stage1TankLength = Mathf.Max(0.1f, dto.stage1.length - l.stage1BayLength - l.interstageLength);
            l.stage1TopY = dto.stage1.length;
            l.stage2Base = dto.stage2.@base;
            l.stage2BayLength = Mathf.Min(0.5f * dto.diameter, dto.stage2.length * 0.3f);
            l.stage2TankLength = Mathf.Max(0.1f, dto.stage2.length - l.stage2BayLength);
            l.fairingBase = dto.payload.@base;
            l.fairingCone = Mathf.Min(dto.payload.length * 0.5f, 1.7f * l.radius);
            l.fairingBarrel = Mathf.Max(0.05f, dto.payload.length - l.fairingCone);

            l.stage1NozzleRadius = Mathf.Max(0.05f, dto.stage1NozzleDiameter * 0.5f);
            l.stage1BellLength = l.stage1NozzleRadius * 2.2f;
            l.stage1ThroatY = l.stage1BayLength * 0.35f;

            l.stage2NozzleRadius = Mathf.Max(0.05f, dto.stage2NozzleDiameter * 0.5f);
            l.stage2ThroatY = l.stage2Base + l.stage2BayLength * 0.6f;
            float interstageBottom = l.stage1TopY - l.interstageLength;
            l.stage2BellLength = Mathf.Max(0.2f, Mathf.Min(l.stage2NozzleRadius * 2.2f, l.stage2ThroatY - interstageBottom - 0.15f));
            return l;
        }

        public void Build(RocketGeometryDto dto)
        {
            geometry = dto;
            Clear();
            Layout l = LayoutFor(dto);

            // --- stage 1: engine bay, tank and interstage, from the base up ---
            stage1Group = NewGroup(transform, "Stage1");
            Stage1NozzlePositions = BuildStage1(stage1Group, dto, l);

            // --- stage 2 ---
            stage2Group = NewGroup(transform, "Stage2");
            AddCylinder(stage2Group, "Stage2EngineBay", l.radius * 0.97f, l.stage2BayLength, l.stage2Base + l.stage2BayLength * 0.5f, DarkMaterial());
            AddTank(stage2Group, "Stage2Tank", l.radius, l.stage2TankLength, l.stage2Base + l.stage2BayLength, Stage2Color);
            AddRing(stage2Group, "Stage2Seam", l.radius, 0.025f, l.stage2Base + l.stage2BayLength, DarkMaterial());
            AddRaceway(stage2Group, l.radius, l.stage2Base + l.stage2BayLength, l.stage2TankLength, 0.7f);
            Stage2NozzlePosition = AddBell(stage2Group, "Stage2Bell", Vector3.zero, l.stage2ThroatY, l.stage2BellLength, l.stage2NozzleRadius * 0.38f, l.stage2NozzleRadius);

            // --- fairing: a barrel with an ogive on top, and the payload adapter band ---
            payloadGroup = NewGroup(transform, "Payload");
            AddCylinder(payloadGroup, "AdapterBand", l.radius * 1.004f, 0.16f, l.fairingBase - 0.08f, AccentMaterial());
            AddRing(payloadGroup, "FairingSeam", l.radius, 0.03f, l.fairingBase, DarkMaterial());
            AddTank(payloadGroup, "Fairing", l.radius, l.fairingBarrel, l.fairingBase, BodyColor);
            AddLathe(
                payloadGroup,
                "NoseCone",
                ProceduralMeshes.OgiveProfile(l.radius, l.fairingCone),
                l.fairingBase + l.fairingBarrel,
                PaintedMaterial(BodyColor, l.radius, l.fairingCone),
                false);
            for (int i = 0; i < 2; i++)
            {
                float a = i * Mathf.PI;
                var split = GameObject.CreatePrimitive(PrimitiveType.Cube);
                split.name = "FairingSplit";
                Destroy(split.GetComponent<Collider>());
                split.transform.SetParent(payloadGroup, false);
                split.transform.localPosition = new Vector3(Mathf.Cos(a) * (l.radius + 0.005f), l.fairingBase + l.fairingBarrel * 0.5f, Mathf.Sin(a) * (l.radius + 0.005f));
                split.transform.localRotation = Quaternion.Euler(0f, -a * Mathf.Rad2Deg, 0f);
                split.transform.localScale = new Vector3(0.02f, l.fairingBarrel, 0.05f);
                split.GetComponent<MeshRenderer>().sharedMaterial = DarkMaterial();
            }
        }

        /// <summary>
        /// The stage-1 section alone — interstage, tank, skirt, bells and fins —
        /// built into `parent` with the base of the stack at y = 0. Used for the
        /// spent booster so it is the same hardware that just fell away.
        /// </summary>
        public static void BuildBooster(Transform parent, RocketGeometryDto dto)
        {
            BuildStage1(parent, dto, LayoutFor(dto));
        }

        /// <summary>Stage 1 leaves at separation; the frame's `stage` field says when.</summary>
        public void SetStage1Visible(bool visible)
        {
            if (stage1Group != null && stage1Group.gameObject.activeSelf != visible)
            {
                stage1Group.gameObject.SetActive(visible);
            }
        }

        private static Vector3[] BuildStage1(Transform group, RocketGeometryDto dto, Layout l)
        {
            // Engine skirt: black and white quarters over a heat shield.
            AddCylinder(group, "Stage1Skirt", l.radius * 0.985f, l.stage1BayLength, l.stage1BayLength * 0.5f, CheckerMaterial());
            AddCylinder(group, "HeatShield", l.radius * 0.985f, 0.04f, 0.02f, DarkMaterial());

            AddTank(group, "Stage1Tank", l.radius, l.stage1TankLength, l.stage1BayLength, Stage1Color);
            AddRing(group, "Stage1SeamLow", l.radius, 0.03f, l.stage1BayLength, DarkMaterial());
            AddRing(group, "Stage1SeamMid", l.radius, 0.02f, l.stage1BayLength + l.stage1TankLength * 0.46f, DarkMaterial());
            AddRing(group, "Stage1SeamHigh", l.radius, 0.025f, l.stage1BayLength + l.stage1TankLength, DarkMaterial());
            AddRaceway(group, l.radius, l.stage1BayLength, l.stage1TankLength, 0.7f);
            AddRaceway(group, l.radius, l.stage1BayLength, l.stage1TankLength * 0.7f, Mathf.PI + 0.9f);

            // Interstage: an open truss, so the upper stage's bell shows through it.
            float interstageBottom = l.stage1BayLength + l.stage1TankLength;
            BuildTruss(group, l.radius, interstageBottom, l.interstageLength);
            AddRing(group, "InterstageAccent", l.radius * 1.002f, 0.04f, interstageBottom + l.interstageLength - 0.02f, AccentMaterial());

            // Engine bells.
            int count = Mathf.Max(1, dto.stage1.engineCount);
            Vector3[] slots = EngineSlots(count, l.radius, l.stage1NozzleRadius);
            var exits = new Vector3[slots.Length];
            for (int i = 0; i < slots.Length; i++)
            {
                exits[i] = AddBell(group, $"Stage1Bell{i}", slots[i], l.stage1ThroatY, l.stage1BellLength, l.stage1NozzleRadius * 0.42f, l.stage1NozzleRadius);
            }

            if (dto.fins != null && dto.fins.span > 0.01f)
            {
                BuildFins(group, dto, l.radius);
            }
            return exits;
        }

        /// <summary>
        /// Engine positions on the base plate: one on the axis, up to six in a
        /// ring, and seven or nine as a ring plus a centre engine. Matches the
        /// three.js layout so both views fire from the same places.
        /// </summary>
        public static Vector3[] EngineSlots(int count, float bodyRadius, float nozzleRadius)
        {
            if (count <= 1)
            {
                return new[] { Vector3.zero };
            }
            bool withCenter = count == 7 || count == 9;
            int ringCount = withCenter ? count - 1 : count;
            float ring = Mathf.Max(0f, bodyRadius - nozzleRadius * 1.02f);
            var slots = new Vector3[count];
            for (int i = 0; i < ringCount; i++)
            {
                float a = (i / (float)ringCount) * Mathf.PI * 2f;
                slots[i] = new Vector3(Mathf.Cos(a) * ring, 0f, Mathf.Sin(a) * ring);
            }
            if (withCenter)
            {
                slots[count - 1] = Vector3.zero;
            }
            return slots;
        }

        private void Clear()
        {
            for (int i = transform.childCount - 1; i >= 0; i--)
            {
                Destroy(transform.GetChild(i).gameObject);
            }
            stage1Group = null;
            stage2Group = null;
            payloadGroup = null;
        }

        private static Transform NewGroup(Transform parent, string name)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            return go.transform;
        }

        // -- materials -------------------------------------------------------------

        private static Texture2D Panels()
        {
            if (panelTexture == null)
            {
                panelTexture = ProceduralMeshes.PanelTexture();
            }
            return panelTexture;
        }

        private static Material PaintedMaterial(Color color, float radius, float length)
        {
            float repeatX = Mathf.Max(1f, Mathf.Round(2f * Mathf.PI * radius / PanelTileM));
            float repeatY = Mathf.Max(0.25f, length / PanelTileM);
            return ProceduralMeshes.LitMaterial(color, 0.45f, 0.1f, Panels(), new Vector2(repeatX, repeatY));
        }

        private static Material DarkMaterial() => ProceduralMeshes.LitMaterial(DarkColor, 0.4f, 0.4f);

        private static Material AccentMaterial() => ProceduralMeshes.LitMaterial(AccentColor, 0.5f, 0.2f);

        private static Material BellMaterial() => ProceduralMeshes.DoubleSided(ProceduralMeshes.LitMaterial(BellColor, 0.7f, 0.9f));

        private static Material CheckerMaterial()
        {
            if (checkerTexture == null)
            {
                checkerTexture = ProceduralMeshes.CheckerTexture();
            }
            return ProceduralMeshes.LitMaterial(Color.white, 0.4f, 0.25f, checkerTexture, Vector2.one);
        }

        // -- parts -----------------------------------------------------------------

        private static void AddCylinder(Transform parent, string name, float radius, float length, float centerY, Material material)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            go.name = name;
            Destroy(go.GetComponent<Collider>()); // nothing here is ever simulated
            go.transform.SetParent(parent, false);
            // Unity's cylinder is 2 units tall with a radius of 0.5.
            go.transform.localScale = new Vector3(radius * 2f, length * 0.5f, radius * 2f);
            go.transform.localPosition = new Vector3(0f, centerY, 0f);
            go.GetComponent<MeshRenderer>().sharedMaterial = material;
        }

        /// <summary>A tank section with the panel texture tiled to real-world size, standing on `baseY`.</summary>
        private static void AddTank(Transform parent, string name, float radius, float length, float baseY, Color color)
        {
            AddCylinder(parent, name, radius, length, baseY + length * 0.5f, PaintedMaterial(color, radius, length));
        }

        private static void AddRing(Transform parent, string name, float radius, float tube, float y, Material material)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = new Vector3(0f, y, 0f);
            go.AddComponent<MeshFilter>().sharedMesh = ProceduralMeshes.Torus(radius, tube, 48, 8);
            go.AddComponent<MeshRenderer>().sharedMaterial = material;
        }

        private static void AddLathe(Transform parent, string name, Vector2[] profile, float baseY, Material material, bool doubleSided)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = new Vector3(0f, baseY, 0f);
            go.AddComponent<MeshFilter>().sharedMesh = ProceduralMeshes.Lathe(profile, 40, doubleSided);
            go.AddComponent<MeshRenderer>().sharedMaterial = material;
        }

        /// <summary>A cable raceway running up the outside of a tank.</summary>
        private static void AddRaceway(Transform parent, float radius, float baseY, float length, float angle)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = "Raceway";
            Destroy(go.GetComponent<Collider>());
            go.transform.SetParent(parent, false);
            go.transform.localPosition = new Vector3(Mathf.Cos(angle) * (radius + 0.03f), baseY + length * 0.5f, Mathf.Sin(angle) * (radius + 0.03f));
            go.transform.localRotation = Quaternion.Euler(0f, -angle * Mathf.Rad2Deg, 0f);
            go.transform.localScale = new Vector3(0.09f, length, Mathf.Max(0.12f, radius * 0.08f));
            go.GetComponent<MeshRenderer>().sharedMaterial = DarkMaterial();
        }

        /// <summary>
        /// A parabolic bell hanging from its throat, with a turbopump block above.
        /// Returns the exit-plane position, where the plume starts.
        /// </summary>
        private static Vector3 AddBell(Transform parent, string name, Vector3 slot, float throatY, float length, float throatRadius, float exitRadius)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = new Vector3(slot.x, throatY, slot.z);
            go.AddComponent<MeshFilter>().sharedMesh = ProceduralMeshes.Lathe(ProceduralMeshes.BellProfile(throatRadius, exitRadius, length), 32, true);
            go.AddComponent<MeshRenderer>().sharedMaterial = BellMaterial();

            AddCylinder(go.transform, "Turbopump", throatRadius * 1.7f, 0.36f, 0.18f, DarkMaterial());
            var throat = new GameObject("Throat");
            throat.transform.SetParent(go.transform, false);
            throat.AddComponent<MeshFilter>().sharedMesh = ProceduralMeshes.Torus(throatRadius, throatRadius * 0.28f, 24, 6);
            throat.AddComponent<MeshRenderer>().sharedMaterial = DarkMaterial();

            return new Vector3(slot.x, throatY - length, slot.z);
        }

        private static void BuildTruss(Transform parent, float radius, float baseY, float length)
        {
            float strutR = Mathf.Max(0.03f, radius * 0.022f);
            Material material = ProceduralMeshes.LitMaterial(TrussColor, 0.45f, 0.6f);
            AddRing(parent, "TrussRingLow", radius * 0.975f, strutR * 1.4f, baseY + strutR, material);
            AddRing(parent, "TrussRingHigh", radius * 0.975f, strutR * 1.4f, baseY + length - strutR, material);
            for (int i = 0; i < 12; i++)
            {
                float a = (i / 12f) * Mathf.PI * 2f;
                var go = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                go.name = $"Strut{i}";
                Destroy(go.GetComponent<Collider>());
                go.transform.SetParent(parent, false);
                go.transform.localPosition = new Vector3(Mathf.Cos(a) * radius * 0.965f, baseY + length * 0.5f, Mathf.Sin(a) * radius * 0.965f);
                go.transform.localScale = new Vector3(strutR * 2f, length * 0.5f, strutR * 2f);
                go.GetComponent<MeshRenderer>().sharedMaterial = material;
            }
        }

        private static void BuildFins(Transform parent, RocketGeometryDto dto, float bodyRadius)
        {
            float root = dto.fins.length;
            float tip = root * FinTipChordFraction;
            float sweep = root * FinSweepFraction;
            float span = dto.fins.span;
            Mesh mesh = ProceduralMeshes.Fin(root, tip, sweep, span);
            Material material = ProceduralMeshes.LitMaterial(FinColor, 0.45f, 0.2f);

            for (int i = 0; i < 4; i++)
            {
                var go = new GameObject($"Fin{i}");
                go.transform.SetParent(parent, false);
                go.transform.localRotation = Quaternion.Euler(0f, i * 90f, 0f);
                go.transform.localPosition = go.transform.localRotation * new Vector3(bodyRadius - 0.05f, 0f, 0f);
                go.AddComponent<MeshFilter>().sharedMesh = mesh;
                var renderer = go.AddComponent<MeshRenderer>();
                renderer.sharedMaterial = material;
            }
        }
    }
}
