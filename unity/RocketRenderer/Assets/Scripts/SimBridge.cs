using System;
using System.Reflection;
using System.Runtime.InteropServices;
using UnityEngine;

namespace Apogee.RocketRenderer
{
    /// <summary>
    /// The only door into this player. Everything the page sends arrives here
    /// through `SendMessage("SimBridge", …)`, and the only things that go back
    /// out are "ready" and "error".
    ///
    /// This component parses and forwards. It never decides anything about the
    /// flight: the TypeScript sim is the single source of truth and Unity draws
    /// what it is told.
    /// </summary>
    public class SimBridge : MonoBehaviour
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")]
        private static extern void RocketBridge_Ready();

        [DllImport("__Internal")]
        private static extern void RocketBridge_Error(string message);
#else
        private static void RocketBridge_Ready()
        {
            Debug.Log("RocketBridge_Ready (editor stub)");
        }

        private static void RocketBridge_Error(string message)
        {
            Debug.LogError($"RocketBridge_Error (editor stub): {message}");
        }
#endif

        public SceneBootstrap Scene;

        private bool announcedReady;

        private void Start()
        {
            // The page's HTML controls sit over this canvas; Unity grabbing the
            // keyboard would swallow every keystroke meant for them. Resolved by
            // reflection (rather than a direct UnityEngine.WebGLInput reference)
            // so this compiles on any editor regardless of installed modules.
            DisableWebGLKeyboardCapture();

            try
            {
                if (Scene == null)
                {
                    Scene = GetComponent<SceneBootstrap>();
                }
                if (Scene != null && !Scene.Built)
                {
                    Scene.BuildScene();
                }
                Announce();
            }
            catch (Exception error)
            {
                Fail($"Scene setup failed: {error.Message}");
            }
        }

        // -- messages from JavaScript ------------------------------------------

        public void SetRocket(string json)
        {
            try
            {
                var geometry = JsonUtility.FromJson<RocketGeometryDto>(json);
                if (geometry == null || geometry.totalLength <= 0f)
                {
                    Fail("SetRocket received geometry with no length");
                    return;
                }
                Scene.ApplyRocket(geometry);
            }
            catch (Exception error)
            {
                Fail($"SetRocket failed: {error.Message}");
            }
        }

        public void SetFrame(string json)
        {
            try
            {
                var frame = JsonUtility.FromJson<RenderFrameDto>(json);
                if (frame == null)
                {
                    return;
                }
                if (!IsFinite(frame))
                {
                    // Holding the previous frame beats letting a NaN through:
                    // one poisoned transform stays poisoned for the rest of the
                    // flight.
                    Debug.LogError($"SetFrame: non-finite frame at t={frame.t}; holding the previous one");
                    return;
                }
                Scene.ApplyFrame(frame);
            }
            catch (Exception error)
            {
                Fail($"SetFrame failed: {error.Message}");
            }
        }

        public void SetCameraMode(string mode)
        {
            Scene?.Cameras?.SetMode(mode);
        }

        /// <summary>Payload is "dAzimuth,dElevation" in radians.</summary>
        public void OrbitCamera(string payload)
        {
            if (Scene?.Cameras == null || string.IsNullOrEmpty(payload))
            {
                return;
            }
            string[] parts = payload.Split(',');
            if (parts.Length != 2)
            {
                return;
            }
            if (float.TryParse(parts[0], System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture, out float azimuth)
                && float.TryParse(parts[1], System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture, out float elevation))
            {
                Scene.Cameras.Orbit(azimuth, elevation);
            }
        }

        public void ZoomCamera(string factor)
        {
            if (Scene?.Cameras == null)
            {
                return;
            }
            if (float.TryParse(factor, System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture, out float value))
            {
                Scene.Cameras.Zoom(value);
            }
        }

        /// <summary>Replay: clear every effect and let the next frame reseed them.</summary>
        public void ResetFlight()
        {
            Scene?.ResetFlight();
        }

        /// <summary>
        /// Toggle post-processing from the page: "0" or "false" turns it off.
        ///
        /// A diagnostic hatch. Post-processing on the WebGPU backend can fail
        /// with nothing in the console and nothing on the canvas, and this makes
        /// it one message to rule in or out instead of a rebuild.
        /// </summary>
        public void SetPostProcessing(string value)
        {
            bool enabled = value != "0"
                && !string.Equals(value, "false", StringComparison.OrdinalIgnoreCase);
            Scene?.Cameras?.SetPostProcessing(enabled);
        }

        // -- helpers -------------------------------------------------------------

        private static void DisableWebGLKeyboardCapture()
        {
            try
            {
                Type webGlInputType = Type.GetType("UnityEngine.WebGLInput, UnityEngine.WebGLModule")
                    ?? Type.GetType("UnityEngine.WebGLInput, UnityEngine");
                FieldInfo field = webGlInputType?.GetField(
                    "captureAllKeyboardInput", BindingFlags.Public | BindingFlags.Static);
                field?.SetValue(null, false);
            }
            catch (Exception error)
            {
                Debug.LogWarning($"DisableWebGLKeyboardCapture skipped: {error.Message}");
            }
        }

        private void Announce()
        {
            if (announcedReady)
            {
                return;
            }
            announcedReady = true;
            RocketBridge_Ready();
        }

        private void Fail(string message)
        {
            Debug.LogError(message);
            RocketBridge_Error(message);
        }

        private static bool IsFinite(RenderFrameDto frame)
        {
            return IsFinite(frame.t)
                && IsFinite(frame.throttle)
                && IsFinite(frame.altitude)
                && IsFinite(frame.comFromBase)
                && IsFinite(frame.attachedLength)
                && IsFinite(frame.q)
                && IsFinite(frame.mach)
                && IsFinite(frame.attitude)
                && IsFinite(frame.earthQuat)
                && IsFinite(frame.velLocal)
                && IsFinite(frame.earthCenterLocal)
                && IsFinite(frame.sunDirLocal)
                && (!frame.stage1SpentPresent
                    || (IsFinite(frame.stage1SpentPos) && IsFinite(frame.stage1SpentAttitude)));
        }

        private static bool IsFinite(float value) => !float.IsNaN(value) && !float.IsInfinity(value);

        private static bool IsFinite(Vector3 v) => IsFinite(v.x) && IsFinite(v.y) && IsFinite(v.z);

        private static bool IsFinite(Quaternion q) =>
            IsFinite(q.x) && IsFinite(q.y) && IsFinite(q.z) && IsFinite(q.w);
    }
}
