using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace Apogee.RocketRenderer
{
    /// <summary>
    /// Camera framing, shot selection and shake.
    ///
    /// A two-camera stack: the near camera draws the rocket, the pad and the
    /// effects; the far camera draws the Earth, its atmosphere and the stars,
    /// and renders first. Trying to put a 6371 km sphere and a 60 m vehicle in
    /// one depth buffer is what produces z-fighting on the pad, so they never
    /// share one. Both cameras are kept on exactly the same transform and field
    /// of view, so the two images line up as one.
    ///
    /// Shots. The web app's buttons still select `chase`, `ground`, `overhead`
    /// and `orbit` directly. The default is `auto`: a director that picks the
    /// shot from the flight itself — held low and close on the pad, tracking the
    /// climb, back to a chase downrange, wide for staging, and out to the planet
    /// once there is a planet worth looking at.
    ///
    /// Blending. A shot change sweeps rather than snaps, which is what makes it
    /// read as a camera rather than a teleport — except where the two shots are
    /// so far apart that sweeping would be a minute-long dolly, where it cuts.
    ///
    /// Shake has two sources that sum: a continuous rumble from the vehicle's own
    /// loads (throttle and dynamic pressure), and decaying impulses fired by
    /// events. Both fall off with the camera's distance from the vehicle, so the
    /// pad shot is violent and the orbit shot is perfectly steady.
    ///
    /// This is deliberately not Cinemachine. Cinemachine drives a single camera
    /// through a Brain, and this renderer's whole reason for existing is a
    /// synchronised far/near stack; adding it would mean either fighting the
    /// Brain for the transform or pulling a package the project does not
    /// otherwise need. The behaviour it would have provided — blended shots,
    /// impulse shake, noise, dynamic lens — is implemented directly below
    /// against the stack that is actually here.
    /// </summary>
    public class CameraDirector : MonoBehaviour
    {
        public Camera NearCamera;
        public Camera FarCamera;

        private const float MinZoom = 0.0005f;
        private const float MaxZoom = 6f;
        private const float MaxElevation = 1.35f;

        /// <summary>Distances from the instruction document, in metres.</summary>
        private const float ChaseDistanceM = 95f;
        private const float WideDistanceM = 1_700f;
        private const float OrbitRadiusM = 2.7e7f;

        private const float BaseFov = 50f;

        /// <summary>Beyond this jump between shots, sweep becomes cut.</summary>
        private const float CutThresholdM = 5_000f;
        private const float BlendSeconds = 1.4f;

        private string mode = "auto";
        private float zoom = 1f;
        private float azimuth;
        private float elevation;

        /// <summary>Smoothed camera offset, so the chase shot does not snap.</summary>
        private Vector3 smoothedOffset = Vector3.zero;
        private bool hasOffset;

        /// <summary>The shot the director last resolved, to notice a change.</summary>
        private string activeShot = "";

        /// <summary>Blend progress out of the previous shot, 0..1.</summary>
        private float blend = 1f;
        private Vector3 blendFromOffset;
        private Vector3 blendFromTarget;

        /// <summary>
        /// An event-forced shot and the unscaled seconds it still holds for.
        /// Staging is worth looking at properly, wherever the director was.
        /// </summary>
        private string forcedShot = "";
        private float forcedShotTime;

        /// <summary>Decaying event impulses: amplitude now, and how fast it dies.</summary>
        private float impulse;
        private float impulseDecay = 1f;

        private float smoothedFov = BaseFov;
        private float lastFrameT;

        private void OnEnable()
        {
            RenderPipelineManager.beginCameraRendering += OnBeginCameraRendering;
        }

        private void OnDisable()
        {
            RenderPipelineManager.beginCameraRendering -= OnBeginCameraRendering;
            RenderSettings.fog = false;
        }

        /// <summary>
        /// Fog is a global setting, but only the near camera may have it. The
        /// far camera draws the Earth from thousands of kilometres away, where
        /// any density that reads as haze up close is solid. Toggling it as each
        /// camera starts is what lets one scene have both.
        /// </summary>
        private void OnBeginCameraRendering(ScriptableRenderContext context, Camera camera)
        {
            if (!EarthView.HazeEnabled)
            {
                return;
            }
            RenderSettings.fog = camera == NearCamera;
        }

        /// <summary>
        /// Turn post-processing and its antialiasing pass on or off at runtime.
        ///
        /// This exists to be driven from the page. Post-processing on the WebGPU
        /// backend is the part of this renderer most likely to fail silently on
        /// a machine we cannot test, and a blank canvas gives nothing to go on.
        /// Being able to switch it off without a rebuild turns "the launch view
        /// is black" into one question answered in a second.
        /// </summary>
        public void SetPostProcessing(bool enabled)
        {
            if (NearCamera == null)
            {
                return;
            }
            var data = NearCamera.GetUniversalAdditionalCameraData();
            if (data == null)
            {
                return;
            }
            data.renderPostProcessing = enabled;
            data.antialiasing = enabled
                ? AntialiasingMode.FastApproximateAntialiasing
                : AntialiasingMode.None;
            Debug.Log($"CameraDirector: post-processing {(enabled ? "on" : "off")}");
        }

        public void SetMode(string next)
        {
            if (string.IsNullOrEmpty(next))
            {
                return;
            }
            mode = next;
            // A mode change is a fresh framing: drop the accumulated drag.
            azimuth = 0f;
            elevation = 0f;
            forcedShot = "";
            forcedShotTime = 0f;
        }

        public void Orbit(float deltaAzimuth, float deltaElevation)
        {
            azimuth += deltaAzimuth;
            elevation = Mathf.Clamp(elevation + deltaElevation, -MaxElevation, MaxElevation);
        }

        public void Zoom(float factor)
        {
            if (factor > 0f)
            {
                zoom = Mathf.Clamp(zoom * factor, MinZoom, MaxZoom);
            }
        }

        public void Reset()
        {
            zoom = 1f;
            azimuth = 0f;
            elevation = 0f;
            hasOffset = false;
            impulse = 0f;
            blend = 1f;
            activeShot = "";
            forcedShot = "";
            forcedShotTime = 0f;
            smoothedFov = BaseFov;
        }

        public void Apply(RenderFrameDto frame)
        {
            if (NearCamera == null)
            {
                return;
            }

            if (frame.discontinuity)
            {
                hasOffset = false;
                impulse = 0f;
                blend = 1f;
                activeShot = "";
                forcedShot = "";
                forcedShotTime = 0f;
            }

            ApplyEventImpulses(frame);

            string shot = ResolveShot(frame);
            Vector3 target;
            Vector3 offset = ShotOffset(frame, shot, out bool planetShot, out target);

            // A new shot either sweeps from where the camera already is, or —
            // when the two are wildly far apart — simply cuts.
            if (shot != activeShot)
            {
                if (hasOffset && (offset - smoothedOffset).magnitude < CutThresholdM)
                {
                    blendFromOffset = smoothedOffset;
                    blendFromTarget = Vector3.zero;
                    blend = 0f;
                }
                else
                {
                    blend = 1f;
                    hasOffset = false;
                }
                activeShot = shot;
            }

            float dt = Mathf.Clamp(Mathf.Abs(frame.t - lastFrameT), 0f, 0.5f);
            lastFrameT = frame.t;

            if (blend < 1f)
            {
                blend = Mathf.Clamp01(blend + Time.unscaledDeltaTime / BlendSeconds);
                // Ease in and out, so the move starts and lands softly.
                float eased = Mathf.SmoothStep(0f, 1f, blend);
                offset = Vector3.Lerp(blendFromOffset, offset, eased);
                target = Vector3.Lerp(blendFromTarget, target, eased);
                smoothedOffset = offset;
                hasOffset = true;
            }
            else if (!hasOffset)
            {
                smoothedOffset = offset;
                hasOffset = true;
            }
            else
            {
                // Smooth the offset so the chase shot swings rather than snapping
                // when the vehicle pitches. A seek skips the smoothing.
                smoothedOffset = Vector3.Lerp(smoothedOffset, offset, 1f - Mathf.Exp(-6f * dt));
            }

            Vector3 position = target + smoothedOffset + Shake(frame);
            NearCamera.transform.position = position;
            NearCamera.transform.LookAt(target, Vector3.up);

            ApplyLens(frame, planetShot);

            if (FarCamera != null)
            {
                FarCamera.transform.position = NearCamera.transform.position;
                FarCamera.transform.rotation = NearCamera.transform.rotation;
                FarCamera.fieldOfView = NearCamera.fieldOfView;
                FarCamera.backgroundColor = EarthView.SkyColor(Mathf.Max(0f, frame.altitude));
            }

            // The near camera stays enabled even in the planet shot, where it has
            // nothing to draw. It is the last camera in the stack and therefore
            // the one that resolves post-processing: switching it off takes the
            // bloom and the tonemapping with it, and on the WebGPU backend it
            // leaves the frame blank rather than merely flat. An empty overlay
            // pass over a cleared depth buffer is far cheaper than that bug.
        }

        // -- shot selection --------------------------------------------------

        /// <summary>
        /// In `auto`, the flight picks the shot. Event-forced shots win while
        /// they hold; otherwise altitude decides, which keeps the choice
        /// identical on a replay and stable when the player scrubs.
        /// </summary>
        private string ResolveShot(RenderFrameDto frame)
        {
            if (mode != "auto")
            {
                return mode;
            }

            forcedShotTime = Mathf.Max(0f, forcedShotTime - Time.unscaledDeltaTime);
            if (forcedShotTime > 0f && !string.IsNullOrEmpty(forcedShot))
            {
                return forcedShot;
            }

            float altitude = Mathf.Max(0f, frame.altitude);

            // Held on the pad through the ignition hold and the first moments of
            // the climb, where the interesting thing is the vehicle leaving.
            if (frame.t < 6f && altitude < 900f)
            {
                return "pad";
            }
            // A long lens from the ground, holding the climb in frame.
            if (altitude < 14_000f)
            {
                return "tracking";
            }
            // Alongside, where the vehicle is the subject and the Earth is scenery.
            if (altitude < 90_000f)
            {
                return "chase";
            }
            return "orbit";
        }

        private void ApplyEventImpulses(RenderFrameDto frame)
        {
            // Ignition is the hardest hit of the flight: it should feel like it.
            if (frame.HasEvent("liftoff"))
            {
                FireImpulse(1.5f, 0.55f);
            }
            if (frame.HasEvent("max_q"))
            {
                FireImpulse(0.8f, 1.1f);
            }
            if (frame.HasEvent("separation"))
            {
                FireImpulse(0.9f, 1.3f);
                ForceShot("staging", 4.5f);
            }
            if (frame.HasEvent("stage2_ignition"))
            {
                FireImpulse(0.5f, 1.6f);
            }
            // The shockwave off a breakup — the biggest and slowest to die away.
            if (frame.HasEvent("failed"))
            {
                FireImpulse(2.6f, 0.4f);
                ForceShot("tracking", 6f);
            }
        }

        private void FireImpulse(float amplitude, float decay)
        {
            // Impulses take the strongest rather than summing, so two events in
            // the same frame cannot throw the camera off the screen.
            impulse = Mathf.Max(impulse, amplitude);
            impulseDecay = decay;
        }

        private void ForceShot(string shot, float seconds)
        {
            forcedShot = shot;
            forcedShotTime = seconds;
        }

        private Vector3 ShotOffset(
            RenderFrameDto frame, string shot, out bool planetShot, out Vector3 target)
        {
            // Point the chase shot along the direction of travel, falling back to
            // straight up on the pad where the air-relative velocity is zero.
            Vector3 forward = frame.velLocal.sqrMagnitude > 1f
                ? frame.velLocal.normalized
                : Vector3.up;
            Vector3 side = Vector3.Cross(forward, Vector3.up);
            if (side.sqrMagnitude < 1e-4f)
            {
                side = Vector3.right;
            }
            side.Normalize();

            planetShot = shot == "orbit";
            target = Vector3.zero;

            float altitude = Mathf.Max(0f, frame.altitude);
            Vector3 offset;

            switch (shot)
            {
                case "pad":
                    // Low, close and anchored to the pad, looking steeply up as
                    // the vehicle climbs out of frame.
                    offset = new Vector3(46f, -altitude + 10f, 32f) / Mathf.Max(0.35f, zoom);
                    break;

                case "tracking":
                    // A long lens on the ground. Following only part of the climb
                    // keeps the vehicle in frame while still selling the height.
                    offset = new Vector3(
                        360f,
                        -altitude * 0.62f + 70f,
                        240f) / Mathf.Max(0.2f, zoom);
                    break;

                case "staging":
                    // Back and to the side, far enough to hold both the spent
                    // booster and the departing upper stage in one frame.
                    offset = (side * 0.8f + Vector3.up * 0.3f - forward * 0.5f).normalized
                        * (230f / zoom);
                    break;

                case "chase":
                    offset = (side * 0.75f + Vector3.up * 0.35f - forward * 0.45f).normalized
                        * (ChaseDistanceM / zoom);
                    break;

                case "ground":
                    // A camera on a tripod at the pad perimeter: it stays on the
                    // ground where the pad is and tracks the vehicle climbing away.
                    offset = LaunchSiteView.SiteOffset(frame) + new Vector3(190f / zoom, 24f, 110f / zoom);
                    break;

                case "orbit":
                    // Looking at the Earth from far out, with the vehicle a marker.
                    target = frame.earthCenterLocal;
                    offset = (Vector3.up * 0.8f + Vector3.right * 0.6f).normalized * OrbitRadiusM;
                    break;

                default: // "overhead" — the wide shot
                    offset = (Vector3.right * 0.8f + Vector3.up * 0.55f + Vector3.forward * 0.1f)
                        .normalized * (WideDistanceM / zoom);
                    planetShot = offset.magnitude > 1.2e4f;
                    break;
            }
            return ApplyOrbitOffset(offset);
        }

        private Vector3 ApplyOrbitOffset(Vector3 offset)
        {
            if (azimuth == 0f && elevation == 0f)
            {
                return offset;
            }
            float radius = offset.magnitude;
            if (radius < 1e-6f)
            {
                return offset;
            }
            float theta = Mathf.Atan2(offset.z, offset.x) + azimuth;
            float phi = Mathf.Clamp(
                Mathf.Asin(Mathf.Clamp(offset.y / radius, -1f, 1f)) + elevation,
                -MaxElevation,
                MaxElevation);
            float cosPhi = Mathf.Cos(phi);
            return new Vector3(
                radius * cosPhi * Mathf.Cos(theta),
                radius * Mathf.Sin(phi),
                radius * cosPhi * Mathf.Sin(theta));
        }

        // -- lens and shake ---------------------------------------------------

        /// <summary>
        /// The lens widens a little under acceleration. It is a small effect on
        /// purpose — enough to feel the vehicle pulling away, not enough to read
        /// as a zoom — and it is switched off entirely for the planet shot, where
        /// there is no sense of speed to sell.
        /// </summary>
        private void ApplyLens(RenderFrameDto frame, bool planetShot)
        {
            float targetFov = BaseFov;
            if (!planetShot)
            {
                float accel = Mathf.Clamp01((frame.g - 1f) / 4f);
                targetFov = BaseFov + 7f * accel + 3.5f * Mathf.Clamp01(impulse);
            }
            // Unscaled, so the lens keeps breathing while the flight is paused.
            smoothedFov = Mathf.Lerp(smoothedFov, targetFov, 1f - Mathf.Exp(-3.5f * Time.unscaledDeltaTime));
            NearCamera.fieldOfView = smoothedFov;
        }

        /// <summary>
        /// Shake from the vehicle's own loads: throttle sets the base amplitude,
        /// dynamic pressure raises it, and it dies away with the air. Events add
        /// a decaying impulse on top. Everything then falls off with how far the
        /// camera is standing from the vehicle, because a shot from orbit has no
        /// business shaking.
        /// </summary>
        private Vector3 Shake(RenderFrameDto frame)
        {
            impulse = Mathf.Max(0f, impulse - Time.unscaledDeltaTime * impulseDecay);

            if (!frame.playing || frame.playbackSpeed > EffectsController.MaxEmissionPlaybackSpeed)
            {
                return Vector3.zero;
            }

            float altitudeFalloff = 1f - Mathf.Clamp01((Mathf.Max(0f, frame.altitude) - 60_000f) / 30_000f);
            float loadFactor = 1f + Mathf.Clamp01(frame.q / 40_000f) * 1.6f;
            float rumble = frame.throttle * loadFactor * altitudeFalloff;

            // Distance falloff: violent on the pad shot, imperceptible from far
            // out. Scaled against the chase distance so that shot is the norm.
            float distance = Mathf.Max(1f, smoothedOffset.magnitude);
            float distanceFalloff = Mathf.Clamp01(ChaseDistanceM / distance);

            float amplitude = (rumble + impulse * 2.4f) * 0.4f * distanceFalloff;
            if (amplitude < 1e-4f)
            {
                return Vector3.zero;
            }

            // Two octaves: a low sway under a high-frequency buzz reads as a real
            // mount far better than one frequency does.
            float fast = Time.unscaledTime * 32f;
            float slow = Time.unscaledTime * 7f;
            Vector3 high = new Vector3(
                Mathf.PerlinNoise(fast, 0.1f) - 0.5f,
                Mathf.PerlinNoise(0.3f, fast) - 0.5f,
                Mathf.PerlinNoise(fast, fast) - 0.5f);
            Vector3 low = new Vector3(
                Mathf.PerlinNoise(slow, 5.1f) - 0.5f,
                Mathf.PerlinNoise(9.7f, slow) - 0.5f,
                Mathf.PerlinNoise(slow, slow) - 0.5f);

            // Shake in metres has to scale with the shot, or it is invisible from
            // 400 m and nauseating from 40 m.
            float scale = Mathf.Max(1f, distance * 0.05f);
            return (high + low * 0.6f) * amplitude * scale;
        }
    }
}
