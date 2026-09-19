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
    /// Primitives for now. Swapping in authored prefabs is a change to
    /// <see cref="Build"/> alone.
    /// </summary>
    public class RocketBuilder : MonoBehaviour
    {
        private static readonly Color BodyColor = new Color(0.91f, 0.89f, 0.85f);
        private static readonly Color Stage1Color = new Color(0.84f, 0.83f, 0.79f);
        private static readonly Color Stage2Color = new Color(0.78f, 0.83f, 0.85f);
        private static readonly Color EngineColor = new Color(0.23f, 0.25f, 0.29f);
        private static readonly Color FinColor = new Color(1.0f, 0.61f, 0.33f);

        /// <summary>Fin planform, as fractions of the root chord. Visual only.</summary>
        private const float FinTipChordFraction = 0.35f;
        private const float FinSweepFraction = 0.33f;

        private RocketGeometryDto geometry;
        private Transform stage1Group;
        private Transform stage2Group;
        private Transform payloadGroup;
        private Transform stage1Nozzles;

        /// <summary>The geometry currently built, or null before the first SetRocket.</summary>
        public RocketGeometryDto Geometry => geometry;

        /// <summary>Nozzle exit positions, in the root's local space, for the plume.</summary>
        public Vector3[] Stage1NozzlePositions { get; private set; } = new Vector3[0];

        public Vector3 Stage2NozzlePosition { get; private set; }

        public void Build(RocketGeometryDto dto)
        {
            geometry = dto;
            Clear();

            float radius = dto.diameter * 0.5f;

            // --- stage 1: engine bay, tank and interstage, from the base up ---
            stage1Group = NewGroup("Stage1");
            float engineBay = Mathf.Min(0.5f * dto.diameter, dto.stage1.length * 0.35f);
            float interstage = Mathf.Min(0.3f * dto.diameter, dto.stage1.length * 0.2f);
            float stage1Tank = Mathf.Max(0.1f, dto.stage1.length - engineBay - interstage);

            AddCylinder(stage1Group, "Stage1EngineBay", radius * 0.85f, engineBay, engineBay * 0.5f, EngineColor);
            AddCylinder(stage1Group, "Stage1Tank", radius, stage1Tank, engineBay + stage1Tank * 0.5f, Stage1Color);
            AddCylinder(
                stage1Group,
                "Interstage",
                radius * 0.98f,
                interstage,
                engineBay + stage1Tank + interstage * 0.5f,
                EngineColor);

            stage1Nozzles = NewGroup("Stage1Nozzles");
            stage1Nozzles.SetParent(stage1Group, false);
            Stage1NozzlePositions = BuildNozzles(
                stage1Nozzles,
                dto.stage1.engineCount,
                dto.stage1NozzleDiameter,
                radius,
                0f);

            if (dto.fins != null && dto.fins.span > 0.01f)
            {
                BuildFins(stage1Group, dto, radius);
            }

            // --- stage 2 ---
            stage2Group = NewGroup("Stage2");
            float stage2Bay = Mathf.Min(0.5f * dto.diameter, dto.stage2.length * 0.3f);
            float stage2Tank = Mathf.Max(0.1f, dto.stage2.length - stage2Bay);
            AddCylinder(
                stage2Group,
                "Stage2EngineBay",
                radius * 0.85f,
                stage2Bay,
                dto.stage2.@base + stage2Bay * 0.5f,
                EngineColor);
            AddCylinder(
                stage2Group,
                "Stage2Tank",
                radius,
                stage2Tank,
                dto.stage2.@base + stage2Bay + stage2Tank * 0.5f,
                Stage2Color);
            Vector3[] stage2Nozzle = BuildNozzles(
                stage2Group,
                1,
                dto.stage2NozzleDiameter,
                radius,
                dto.stage2.@base);
            Stage2NozzlePosition = stage2Nozzle.Length > 0 ? stage2Nozzle[0] : Vector3.zero;

            // --- fairing: a cylinder with a cone on top ---
            payloadGroup = NewGroup("Payload");
            float coneLength = Mathf.Min(dto.payload.length * 0.35f, 1.2f * radius);
            float barrel = Mathf.Max(0.1f, dto.payload.length - coneLength);
            AddCylinder(payloadGroup, "Fairing", radius, barrel, dto.payload.@base + barrel * 0.5f, BodyColor);
            AddCone(
                payloadGroup,
                "NoseCone",
                radius,
                coneLength,
                dto.payload.@base + barrel,
                BodyColor);
        }

        /// <summary>Stage 1 leaves at separation; the frame's `stage` field says when.</summary>
        public void SetStage1Visible(bool visible)
        {
            if (stage1Group != null && stage1Group.gameObject.activeSelf != visible)
            {
                stage1Group.gameObject.SetActive(visible);
            }
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
            stage1Nozzles = null;
        }

        private Transform NewGroup(string name)
        {
            var go = new GameObject(name);
            go.transform.SetParent(transform, false);
            return go.transform;
        }

        private static Material NewMaterial(Color color)
        {
            // URP's lit shader; falls back to the built-in one in a bare project.
            Shader shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            var material = new Material(shader);
            material.color = color;
            if (material.HasProperty("_Smoothness"))
            {
                material.SetFloat("_Smoothness", 0.35f);
            }
            return material;
        }

        private static void AddCylinder(
            Transform parent,
            string name,
            float radius,
            float length,
            float centerY,
            Color color)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            go.name = name;
            Destroy(go.GetComponent<Collider>()); // nothing here is ever simulated
            go.transform.SetParent(parent, false);
            // Unity's cylinder is 2 units tall with a radius of 0.5.
            go.transform.localScale = new Vector3(radius * 2f, length * 0.5f, radius * 2f);
            go.transform.localPosition = new Vector3(0f, centerY, 0f);
            go.GetComponent<MeshRenderer>().sharedMaterial = NewMaterial(color);
        }

        private static void AddCone(
            Transform parent,
            string name,
            float radius,
            float length,
            float baseY,
            Color color)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = new Vector3(0f, baseY, 0f);
            go.AddComponent<MeshFilter>().sharedMesh = BuildConeMesh(radius, length, 24);
            go.AddComponent<MeshRenderer>().sharedMaterial = NewMaterial(color);
        }

        /// <summary>A closed cone standing on the XZ plane, apex at +Y.</summary>
        private static Mesh BuildConeMesh(float radius, float height, int segments)
        {
            var vertices = new Vector3[segments * 3];
            var triangles = new int[segments * 3];
            for (int i = 0; i < segments; i++)
            {
                float a0 = (i / (float)segments) * Mathf.PI * 2f;
                float a1 = ((i + 1) / (float)segments) * Mathf.PI * 2f;
                vertices[i * 3 + 0] = new Vector3(Mathf.Cos(a0) * radius, 0f, Mathf.Sin(a0) * radius);
                vertices[i * 3 + 1] = new Vector3(Mathf.Cos(a1) * radius, 0f, Mathf.Sin(a1) * radius);
                vertices[i * 3 + 2] = new Vector3(0f, height, 0f);
                triangles[i * 3 + 0] = i * 3 + 0;
                triangles[i * 3 + 1] = i * 3 + 2;
                triangles[i * 3 + 2] = i * 3 + 1;
            }
            var mesh = new Mesh { name = "Cone" };
            mesh.vertices = vertices;
            mesh.triangles = triangles;
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        /// <summary>
        /// Engine bells arranged in a ring inside the body, or one on the axis.
        /// Returns their exit-plane positions so the plume knows where to start.
        /// </summary>
        private static Vector3[] BuildNozzles(
            Transform parent,
            int count,
            float nozzleDiameter,
            float bodyRadius,
            float baseY)
        {
            count = Mathf.Max(1, count);
            float nozzleRadius = Mathf.Max(0.05f, nozzleDiameter * 0.5f);
            float ring = count <= 1 ? 0f : Mathf.Max(0f, bodyRadius - nozzleRadius);
            float bellLength = nozzleRadius * 1.6f;

            var positions = new Vector3[count];
            for (int i = 0; i < count; i++)
            {
                float angle = (i / (float)count) * Mathf.PI * 2f;
                var local = new Vector3(Mathf.Cos(angle) * ring, baseY, Mathf.Sin(angle) * ring);
                positions[i] = local;

                var go = new GameObject($"Nozzle{i}");
                go.transform.SetParent(parent, false);
                go.transform.localPosition = local + new Vector3(0f, bellLength * 0.5f, 0f);
                // The cone mesh points at +Y; a bell flares downward.
                go.transform.localRotation = Quaternion.Euler(180f, 0f, 0f);
                go.AddComponent<MeshFilter>().sharedMesh = BuildConeMesh(nozzleRadius, bellLength, 16);
                var renderer = go.AddComponent<MeshRenderer>();
                renderer.sharedMaterial = NewMaterial(EngineColor);
            }
            return positions;
        }

        private static void BuildFins(Transform parent, RocketGeometryDto dto, float bodyRadius)
        {
            float root = dto.fins.length;
            float tip = root * FinTipChordFraction;
            float sweep = root * FinSweepFraction;
            float span = dto.fins.span;
            Mesh mesh = BuildFinMesh(root, tip, sweep, span);
            Material material = NewMaterial(FinColor);

            for (int i = 0; i < 4; i++)
            {
                var go = new GameObject($"Fin{i}");
                go.transform.SetParent(parent, false);
                go.transform.localRotation = Quaternion.Euler(0f, i * 90f, 0f);
                go.transform.localPosition = Vector3.zero;
                go.AddComponent<MeshFilter>().sharedMesh = mesh;
                var renderer = go.AddComponent<MeshRenderer>();
                renderer.sharedMaterial = material;
            }
        }

        /// <summary>
        /// A flat trapezoidal fin in the XY plane, rooted on the body surface at
        /// the base of the stack and swept back as it extends outward.
        /// </summary>
        private static Mesh BuildFinMesh(float rootChord, float tipChord, float sweep, float span)
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
    }
}
