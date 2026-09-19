using System;
using UnityEngine;

namespace Apogee.RocketRenderer
{
    /// <summary>
    /// The wire format, mirrored exactly from packages/protocol (web/src/protocol).
    /// Field names must match the JSON character for character.
    ///
    /// These are parsed with <see cref="JsonUtility"/>, which cannot handle a
    /// top-level array, a dictionary or a nullable field. That is why the spent
    /// booster is a presence flag plus flat fields rather than a nullable object,
    /// and why every type here is a plain [Serializable] class of public fields.
    /// </summary>
    [Serializable]
    public class RocketStage1Dto
    {
        public float length;
        public int engineCount;
    }

    [Serializable]
    public class RocketSectionDto
    {
        /// <summary>
        /// Height of the section's lowest point above the stack base, m.
        /// `base` is a C# keyword, so the identifier is escaped; the field's
        /// runtime name is still "base", which is what JsonUtility binds to.
        /// </summary>
        public float @base;
        public float length;
    }

    [Serializable]
    public class RocketFinsDto
    {
        public float span;
        public float length;
    }

    [Serializable]
    public class RocketGeometryDto
    {
        public float diameter;
        public RocketStage1Dto stage1;
        public RocketSectionDto stage2;
        public RocketSectionDto payload;
        public RocketFinsDto fins;
        public float cpFromBase;
        public float totalLength;
        public float stage1NozzleDiameter;
        public float stage2NozzleDiameter;
    }

    /// <summary>
    /// One frame of flight, already in this renderer's local frame: origin at
    /// the rocket's center of mass, +Y up, +X east, +Z north. Nothing here is
    /// Earth-centered, because 32-bit floats cannot hold Earth-scale positions
    /// at metre precision.
    /// </summary>
    [Serializable]
    public class RenderFrameDto
    {
        public float t;
        public bool discontinuity;
        public float playbackSpeed;
        public bool playing;
        public int stage;
        public float throttle;
        public float altitude;
        public float latDeg;
        public float lonDeg;
        public float speedAir;
        public float mach;
        public float q;
        public float g;
        public float aoaDeg;
        public float comFromBase;
        public float attachedLength;
        public Quaternion attitude;
        public Vector3 velLocal;
        public Vector3 earthCenterLocal;
        public Quaternion earthQuat;
        public Vector3 sunDirLocal;
        public bool stage1SpentPresent;
        public Vector3 stage1SpentPos;
        public Quaternion stage1SpentAttitude;
        public string[] events;

        public bool HasEvent(string id)
        {
            if (events == null)
            {
                return false;
            }
            for (int i = 0; i < events.Length; i++)
            {
                if (events[i] == id)
                {
                    return true;
                }
            }
            return false;
        }
    }
}
