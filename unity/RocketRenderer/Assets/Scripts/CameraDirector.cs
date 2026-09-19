using UnityEngine;

namespace Apogee.RocketRenderer
{
    /// <summary>
    /// Camera framing and shake.
    ///
    /// A two-camera stack: the near camera draws the rocket, the pad and the
    /// effects; the far camera draws the Earth, its atmosphere and the stars,
    /// and renders first. Trying to put a 6371 km sphere and a 60 m vehicle in
    /// one depth buffer is what produces z-fighting on the pad, so they never
    /// share one.
    ///
    /// The four modes match the web app's buttons. `overhead` is the wide shot
    /// the instruction document calls "wide"; `ground` is a pad-level camera
    /// this app adds.
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

        private string mode = "overhead";
        private float zoom = 1f;
        private float azimuth;
        private float elevation;

        /// <summary>Smoothed camera offset, so the chase shot does not snap.</summary>
        private Vector3 smoothedOffset = Vector3.zero;
        private bool hasOffset;

        /// <summary>Remaining shake from an event burst, in seconds.</summary>
        private float shakeBurst;
        private float lastFrameT;

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
            hasOffset = false;
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
            shakeBurst = 0f;
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
                shakeBurst = 0f;
            }
            if (frame.HasEvent("max_q") || frame.HasEvent("separation"))
            {
                shakeBurst = 0.9f;
            }

            Vector3 target = Vector3.zero;
            Vector3 offset = FrameOffset(frame, out bool planetShot, out target);

            // Smooth the offset so the chase shot swings rather than snapping
            // when the vehicle pitches. A seek skips the smoothing.
            if (!hasOffset)
            {
                smoothedOffset = offset;
                hasOffset = true;
            }
            else
            {
                float dt = Mathf.Clamp(Mathf.Abs(frame.t - lastFrameT), 0f, 0.5f);
                smoothedOffset = Vector3.Lerp(smoothedOffset, offset, 1f - Mathf.Exp(-6f * dt));
            }
            lastFrameT = frame.t;

            Vector3 position = target + smoothedOffset + Shake(frame);
            NearCamera.transform.position = position;
            NearCamera.transform.LookAt(target, Vector3.up);

            if (FarCamera != null)
            {
                FarCamera.transform.position = NearCamera.transform.position;
                FarCamera.transform.rotation = NearCamera.transform.rotation;
                FarCamera.backgroundColor = EarthView.SkyColor(Mathf.Max(0f, frame.altitude));
            }

            // Well away from the vehicle, the near camera has nothing to draw.
            NearCamera.enabled = !planetShot || zoom > 0.02f;
        }

        private Vector3 FrameOffset(RenderFrameDto frame, out bool planetShot, out Vector3 target)
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

            planetShot = mode == "orbit";
            target = Vector3.zero;

            Vector3 offset;
            switch (mode)
            {
                case "chase":
                    offset = (side * 0.75f + Vector3.up * 0.35f - forward * 0.45f).normalized
                        * (ChaseDistanceM / zoom);
                    break;
                case "ground":
                    // A fixed pad-level camera: it does not follow the vehicle up.
                    offset = new Vector3(180f, 28f - frame.altitude, 80f);
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

        /// <summary>
        /// Shake from the vehicle's own loads: throttle sets the base amplitude,
        /// dynamic pressure raises it, and it dies away with the air. Events add
        /// a short burst on top.
        /// </summary>
        private Vector3 Shake(RenderFrameDto frame)
        {
            if (!frame.playing || frame.playbackSpeed > EffectsController.MaxEmissionPlaybackSpeed)
            {
                return Vector3.zero;
            }
            shakeBurst = Mathf.Max(0f, shakeBurst - Time.unscaledDeltaTime);

            float altitudeFalloff = 1f - Mathf.Clamp01((Mathf.Max(0f, frame.altitude) - 60_000f) / 30_000f);
            float loadFactor = 1f + Mathf.Clamp01(frame.q / 40_000f) * 1.6f;
            float amplitude = (frame.throttle * loadFactor * altitudeFalloff + shakeBurst * 2.2f) * 0.35f;
            if (amplitude < 1e-4f)
            {
                return Vector3.zero;
            }
            float time = Time.unscaledTime * 32f;
            return new Vector3(
                (Mathf.PerlinNoise(time, 0.1f) - 0.5f),
                (Mathf.PerlinNoise(0.3f, time) - 0.5f),
                (Mathf.PerlinNoise(time, time) - 0.5f)) * amplitude;
        }
    }
}
