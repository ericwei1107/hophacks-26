using UnityEngine;
using UnityEngine.Rendering.Universal;

namespace Apogee.RocketRenderer
{
    /// <summary>
    /// Builds the whole scene from code.
    ///
    /// The committed scene asset holds one GameObject: this component and
    /// <see cref="SimBridge"/>. Everything else — the camera stack, the lights,
    /// the Earth, the pad, the vehicle and the effects — is constructed here at
    /// startup. That keeps the entire Unity side reviewable as text and avoids
    /// binary scene assets that can only be edited inside the editor.
    ///
    /// Hierarchy:
    ///   World          — the Earth, the launch site, the pad smoke
    ///   Vehicle        — the attitude pivot; the rocket hangs under it
    ///   SpentStage     — the discarded booster (the real stage-1 geometry), placed relative to the rocket
    ///   Cameras        — the far camera (Earth) and the near camera (vehicle)
    /// </summary>
    public class SceneBootstrap : MonoBehaviour
    {
        public bool Built { get; private set; }

        public RocketBuilder Rocket { get; private set; }
        public EarthView Earth { get; private set; }
        public EffectsController Effects { get; private set; }
        public CameraDirector Cameras { get; private set; }
        public FlightView Flight { get; private set; }

        private Transform attitudePivot;
        private Transform spentStage;
        /// <summary>The booster geometry under SpentStage, centred on the stage's own position.</summary>
        private Transform spentBooster;

        public void BuildScene()
        {
            if (Built)
            {
                return;
            }

            var world = new GameObject("World").transform;
            var vehicle = new GameObject("Vehicle").transform;
            attitudePivot = new GameObject("AttitudePivot").transform;
            attitudePivot.SetParent(vehicle, false);

            // --- cameras ----------------------------------------------------
            var cameraRoot = new GameObject("Cameras");
            Cameras = cameraRoot.AddComponent<CameraDirector>();

            // The far camera draws first: Earth, atmosphere and stars, at a
            // range where metres are meaningless.
            var farGo = new GameObject("FarCamera");
            farGo.transform.SetParent(cameraRoot.transform, false);
            Camera far = farGo.AddComponent<Camera>();
            far.nearClipPlane = 10_000f;
            far.farClipPlane = 1e9f;
            far.fieldOfView = 50f;
            far.clearFlags = CameraClearFlags.SolidColor;
            far.backgroundColor = EarthView.SkyColor(0f);
            far.depth = -1;

            // The near camera draws the rocket, the pad and the effects on top.
            var nearGo = new GameObject("NearCamera");
            nearGo.transform.SetParent(cameraRoot.transform, false);
            Camera near = nearGo.AddComponent<Camera>();
            near.nearClipPlane = 0.3f;
            near.farClipPlane = 50_000f;
            near.fieldOfView = 50f;
            near.clearFlags = CameraClearFlags.Depth;
            near.depth = 0;

            StackCameras(far, near);
            Cameras.FarCamera = far;
            Cameras.NearCamera = near;

            // --- lights ------------------------------------------------------
            var sunGo = new GameObject("Sun");
            sunGo.transform.SetParent(world, false);
            Light sun = sunGo.AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.color = new Color(1f, 0.96f, 0.89f);
            sun.intensity = 1.6f;
            sun.shadows = LightShadows.None; // shadows at this scale cost more than they show

            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = new Color(0.30f, 0.42f, 0.54f);
            RenderSettings.ambientEquatorColor = new Color(0.16f, 0.22f, 0.28f);
            RenderSettings.ambientGroundColor = new Color(0.04f, 0.07f, 0.10f);

            // --- world --------------------------------------------------------
            var earthGo = new GameObject("Earth");
            earthGo.transform.SetParent(world, false);
            Earth = earthGo.AddComponent<EarthView>();
            Earth.Build(world);
            Earth.BuildLaunchSite(world);

            // --- vehicle -------------------------------------------------------
            var rocketGo = new GameObject("Rocket");
            rocketGo.transform.SetParent(attitudePivot, false);
            Rocket = rocketGo.AddComponent<RocketBuilder>();

            spentStage = BuildSpentStage(vehicle);

            // --- effects --------------------------------------------------------
            var effectsGo = new GameObject("Effects");
            effectsGo.transform.SetParent(world, false);
            Effects = effectsGo.AddComponent<EffectsController>();
            Effects.Build(Rocket, attitudePivot, world);

            // --- the thing that applies frames -----------------------------------
            Flight = gameObject.AddComponent<FlightView>();
            Flight.Rocket = Rocket;
            Flight.Earth = Earth;
            Flight.Effects = Effects;
            Flight.Cameras = Cameras;
            Flight.Sun = sun;
            Flight.Initialise(attitudePivot, spentStage);

            Built = true;
        }

        public void ApplyRocket(RocketGeometryDto geometry)
        {
            if (!Built)
            {
                BuildScene();
            }
            Rocket.Build(geometry);
            Effects.RebuildPlumes();
            Effects.ClearAll();
            RebuildSpentStage(geometry);
            Earth.Site?.Configure(geometry);
        }

        public void ApplyFrame(RenderFrameDto frame)
        {
            if (!Built)
            {
                BuildScene();
            }
            Flight.Apply(frame);
        }

        public void ResetFlight()
        {
            Effects?.ClearAll();
            Cameras?.Reset();
        }

        /// <summary>
        /// URP camera stacking: the near camera becomes an overlay on the far
        /// one, so the two depth buffers stay separate and the Earth cannot
        /// z-fight with the pad.
        /// </summary>
        private static void StackCameras(Camera baseCamera, Camera overlay)
        {
            var baseData = baseCamera.GetUniversalAdditionalCameraData();
            var overlayData = overlay.GetUniversalAdditionalCameraData();
            if (baseData == null || overlayData == null)
            {
                // Not URP: the depth ordering above still renders correctly.
                return;
            }
            baseData.renderType = CameraRenderType.Base;
            overlayData.renderType = CameraRenderType.Overlay;
            baseData.cameraStack.Clear();
            baseData.cameraStack.Add(overlay);
        }

        private Transform BuildSpentStage(Transform parent)
        {
            var go = new GameObject("SpentStage");
            go.transform.SetParent(parent, false);
            spentBooster = new GameObject("Booster").transform;
            spentBooster.SetParent(go.transform, false);
            go.SetActive(false);
            return go.transform;
        }

        /// <summary>
        /// The spent booster is the same stage-1 hardware the vehicle just
        /// dropped, built from the same geometry. The frame places the stage's
        /// own position, so the mesh is centred on its half-height.
        /// </summary>
        private void RebuildSpentStage(RocketGeometryDto geometry)
        {
            if (spentBooster == null)
            {
                return;
            }
            for (int i = spentBooster.childCount - 1; i >= 0; i--)
            {
                Destroy(spentBooster.GetChild(i).gameObject);
            }
            RocketBuilder.BuildBooster(spentBooster, geometry);
            spentBooster.localPosition = new Vector3(0f, -geometry.stage1.length * 0.5f, 0f);
        }
    }
}
