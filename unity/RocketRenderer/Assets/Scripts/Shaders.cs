using System.Collections.Generic;
using UnityEngine;

namespace Apogee.RocketRenderer
{
    /// <summary>
    /// Runtime shader lookup that cannot take the scene down with it.
    ///
    /// Every material in this project is created from code, which means every
    /// shader is named by a string rather than referenced as an asset. That is
    /// what the whole build-the-scene-from-source approach costs: nothing in the
    /// build references these shaders, so the shader stripper is free to drop
    /// them, `Shader.Find` then returns null, and `new Material(null)` throws
    /// "Value cannot be null. Parameter name: shader" — which, thrown out of
    /// scene construction, loses the entire renderer rather than one effect.
    ///
    /// `BuildScript.EnsureAlwaysIncludedShaders` is the actual fix: it registers
    /// the shaders so they survive stripping. This is the backstop for when that
    /// has not run, or when a shader name changes in a future URP. A missing
    /// shader here costs one material — the object draws untextured — and says
    /// so once in the console, instead of killing the player.
    /// </summary>
    internal static class Shaders
    {
        /// <summary>Names already reported, so a per-frame call cannot spam.</summary>
        private static readonly HashSet<string> Reported = new HashSet<string>();

        /// <summary>
        /// The first of <paramref name="shaderNames"/> that exists in the build,
        /// or null if none do.
        /// </summary>
        internal static Shader Find(params string[] shaderNames)
        {
            for (int i = 0; i < shaderNames.Length; i++)
            {
                Shader shader = Shader.Find(shaderNames[i]);
                if (shader != null)
                {
                    return shader;
                }
            }
            Report(shaderNames);
            return null;
        }

        /// <summary>
        /// A material on the first available shader, tinted, or null when none
        /// of the candidates survived into the build. Callers may assign the
        /// result to a renderer directly: an untextured object is a far better
        /// outcome than a thrown exception during scene construction.
        /// </summary>
        internal static Material Create(Color color, params string[] shaderNames)
        {
            Shader shader = Find(shaderNames);
            if (shader == null)
            {
                return null;
            }
            var material = new Material(shader);
            Tint(material, color);
            return material;
        }

        /// <summary>
        /// Set a material's tint. URP exposes it as `_BaseColor`, the legacy and
        /// particle shaders as `_Color`, and the two do not always alias, so set
        /// whichever are actually there.
        /// </summary>
        internal static void Tint(Material material, Color color)
        {
            if (material == null)
            {
                return;
            }
            if (material.HasProperty("_BaseColor"))
            {
                material.SetColor("_BaseColor", color);
            }
            if (material.HasProperty("_Color"))
            {
                material.SetColor("_Color", color);
            }
        }

        private static void Report(string[] shaderNames)
        {
            string key = string.Join(", ", shaderNames);
            if (!Reported.Add(key))
            {
                return;
            }
            Debug.LogError(
                $"None of these shaders are in the build: {key}. Add them to "
                + "BuildScript.RequiredShaders so they are always included, then rebuild.");
        }
    }
}
