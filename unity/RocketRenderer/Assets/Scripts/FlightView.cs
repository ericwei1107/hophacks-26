using UnityEngine;

namespace Apogee.RocketRenderer
{
    /// <summary>
    /// Applies one frame to the scene. This is the whole of "Unity draws the
    /// flight": no integration, no forces, no clock — every value here came
    /// from the TypeScript sim through <see cref="SimBridge"/>.
    ///
    /// Floating origin: the rocket never moves. The world is placed around it,
    /// which is what keeps 32-bit transforms exact next to the vehicle no
    /// matter how far downrange it has flown.
    /// </summary>
    public class FlightView : MonoBehaviour
    {
        public RocketBuilder Rocket;
        public EarthView Earth;
        public EffectsController Effects;
        public CameraDirector Cameras;
        public Light Sun;

        private Transform attitudePivot;
        private Transform spentStage;

        /// <summary>The last frame applied, or null before the first one.</summary>
        public RenderFrameDto Current { get; private set; }

        public void Initialise(Transform attitudePivotTransform, Transform spentStageTransform)
        {
            attitudePivot = attitudePivotTransform;
            spentStage = spentStageTransform;
        }

        public void Apply(RenderFrameDto frame)
        {
            Current = frame;

            // --- the vehicle, at the origin -----------------------------------
            if (attitudePivot != null)
            {
                attitudePivot.localRotation = frame.attitude;
            }
            if (Rocket != null && Rocket.Geometry != null)
            {
                Rocket.SetStage1Visible(frame.stage == 1);
                // The frame's origin is the center of mass, measured from the
                // base of whatever is still attached. After separation that base
                // has moved up the stack by exactly the length that left.
                float attachedBase = Rocket.Geometry.totalLength - frame.attachedLength;
                Rocket.transform.localPosition = new Vector3(0f, -(attachedBase + frame.comFromBase), 0f);
            }

            // --- the world around it ------------------------------------------
            if (Earth != null)
            {
                Earth.Apply(frame);
            }
            if (Sun != null)
            {
                // A directional light only cares about its rotation.
                Vector3 toSun = frame.sunDirLocal.sqrMagnitude > 1e-6f ? frame.sunDirLocal : Vector3.up;
                Sun.transform.rotation = Quaternion.LookRotation(-toSun.normalized, Vector3.up);
            }

            // --- the spent booster ---------------------------------------------
            if (spentStage != null)
            {
                spentStage.gameObject.SetActive(frame.stage1SpentPresent);
                if (frame.stage1SpentPresent)
                {
                    spentStage.localPosition = frame.stage1SpentPos;
                    spentStage.localRotation = frame.stage1SpentAttitude;
                }
            }

            if (Effects != null)
            {
                Effects.Apply(frame);
            }
            if (Cameras != null)
            {
                Cameras.Apply(frame);
            }
        }
    }
}
