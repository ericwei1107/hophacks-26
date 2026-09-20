using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;
using Apogee.RocketRenderer;

namespace Apogee.RocketRenderer.EditorTools
{
    /// <summary>
    /// Builds the Web player straight into the web app's public directory.
    ///
    /// Runnable headless, which is the point:
    ///
    ///   Unity -quit -batchmode -projectPath unity/RocketRenderer \
    ///         -executeMethod Apogee.RocketRenderer.EditorTools.BuildScript.BuildWeb
    ///
    /// Every setting that matters is applied here rather than clicked in the
    /// editor, so a fresh clone builds the same player:
    ///
    ///  * WebGPU as the graphics API. WebGL 2 has no GPU compute, so the
    ///    effects this renderer exists for are not available on it.
    ///  * Compression disabled for now. Brotli halves the download but needs
    ///    Content-Encoding headers on both the dev server and the host; turn it
    ///    on only once those are configured.
    ///  * The scene is generated here too — it holds one GameObject, and
    ///    SceneBootstrap builds the rest at runtime.
    /// </summary>
    public static class BuildScript
    {
        private const string ScenePath = "Assets/Scenes/Main.unity";
        private const string OutputRelativeToProject = "../../web/public/unity";

        /// <summary>
        /// Shaders the scene only ever names as a string, through Shader.Find.
        ///
        /// The build has no way to know they are used: the committed scene holds
        /// one GameObject and every material is created at runtime, so nothing
        /// references these assets and the shader stripper drops them. The player
        /// then starts, calls Shader.Find, gets null, and dies on the first
        /// `new Material(null)` with "Value cannot be null. Parameter name:
        /// shader". Registering them as always-included is what keeps building
        /// the scene from code compatible with stripping.
        /// </summary>
        private static readonly string[] RequiredShaders =
        {
            "Universal Render Pipeline/Lit",
            "Universal Render Pipeline/Unlit",
            "Universal Render Pipeline/Particles/Unlit",
        };

        [MenuItem("Apogee/Build Web Player")]
        public static void BuildWeb()
        {
            string outputPath = Path.GetFullPath(
                Path.Combine(Application.dataPath, "..", OutputRelativeToProject));

            Debug.Log($"[BuildScript] Building the Web player into {outputPath}");

            ApplyPlayerSettings();
            EnsureAlwaysIncludedShaders();
            string scenePath = EnsureScene();

            if (Directory.Exists(outputPath))
            {
                Directory.Delete(outputPath, true);
            }
            Directory.CreateDirectory(outputPath);

            var options = new BuildPlayerOptions
            {
                scenes = new[] { scenePath },
                locationPathName = outputPath,
                target = BuildTarget.WebGL,
                options = BuildOptions.None,
            };

            BuildReport report = BuildPipeline.BuildPlayer(options);
            BuildSummary summary = report.summary;
            if (summary.result != BuildResult.Succeeded)
            {
                string message = $"[BuildScript] Build {summary.result} with {summary.totalErrors} error(s)";
                Debug.LogError(message);
                if (Application.isBatchMode)
                {
                    EditorApplication.Exit(1);
                }
                throw new Exception(message);
            }

            Debug.Log(
                $"[BuildScript] Build succeeded: {summary.totalSize / (1024 * 1024)} MB in {summary.totalTime}");
        }

        private static void ApplyPlayerSettings()
        {
            PlayerSettings.companyName = "Apogee";
            PlayerSettings.productName = "RocketRenderer";

            // WebGPU only. Automatic API selection would silently pick WebGL 2,
            // which cannot run the GPU work this renderer is here for.
            PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.WebGL, false);
            GraphicsDeviceType[] apis = ResolveWebGpuApis();
            if (apis.Length > 0)
            {
                PlayerSettings.SetGraphicsAPIs(BuildTarget.WebGL, apis);
            }
            else
            {
                Debug.LogWarning(
                    "[BuildScript] This Unity version exposes no WebGPU graphics API. "
                    + "Unity 6.6 (6000.6) or newer is required; falling back to the project default.");
                PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.WebGL, true);
            }

            PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
            PlayerSettings.WebGL.dataCaching = true;
            PlayerSettings.WebGL.exceptionSupport = WebGLExceptionSupport.None;
            PlayerSettings.runInBackground = true;
            EditorUserBuildSettings.development = false;
        }

        /// <summary>
        /// Add <see cref="RequiredShaders"/> to the project's always-included
        /// shader list, so the stripper keeps them even though the only thing
        /// naming them is a string in a script.
        ///
        /// This edits ProjectSettings/GraphicsSettings.asset through
        /// SerializedObject because the list has no public API. It is
        /// idempotent: shaders already on the list are left alone, so repeated
        /// builds do not grow it.
        /// </summary>
        private static void EnsureAlwaysIncludedShaders()
        {
            UnityEngine.Object[] assets =
                AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/GraphicsSettings.asset");
            if (assets == null || assets.Length == 0 || assets[0] == null)
            {
                Debug.LogWarning(
                    "[BuildScript] Could not open GraphicsSettings; runtime Shader.Find calls may "
                    + "return null in the player.");
                return;
            }

            var settings = new SerializedObject(assets[0]);
            SerializedProperty list = settings.FindProperty("m_AlwaysIncludedShaders");
            if (list == null || !list.isArray)
            {
                Debug.LogWarning(
                    "[BuildScript] GraphicsSettings has no m_AlwaysIncludedShaders array; "
                    + "runtime Shader.Find calls may return null in the player.");
                return;
            }

            var present = new HashSet<string>();
            for (int i = 0; i < list.arraySize; i++)
            {
                if (list.GetArrayElementAtIndex(i).objectReferenceValue is Shader shader)
                {
                    present.Add(shader.name);
                }
            }

            bool changed = false;
            foreach (string name in RequiredShaders)
            {
                if (present.Contains(name))
                {
                    continue;
                }
                Shader shader = Shader.Find(name);
                if (shader == null)
                {
                    // Not fatal here: the runtime falls back rather than dying,
                    // but the effect that wanted it will be missing.
                    Debug.LogWarning($"[BuildScript] Shader not found in the editor: {name}");
                    continue;
                }
                list.InsertArrayElementAtIndex(list.arraySize);
                list.GetArrayElementAtIndex(list.arraySize - 1).objectReferenceValue = shader;
                changed = true;
                Debug.Log($"[BuildScript] Always-including shader: {name}");
            }

            if (changed)
            {
                settings.ApplyModifiedPropertiesWithoutUndo();
                AssetDatabase.SaveAssets();
            }
        }

        /// <summary>
        /// The WebGPU enum member was added in Unity 6.6. Resolving it by name
        /// keeps this script compiling on older editors, which then fail loudly
        /// rather than producing a silent WebGL 2 build.
        /// </summary>
        private static GraphicsDeviceType[] ResolveWebGpuApis()
        {
            foreach (GraphicsDeviceType value in Enum.GetValues(typeof(GraphicsDeviceType)))
            {
                if (value.ToString().Equals("WebGPU", StringComparison.OrdinalIgnoreCase))
                {
                    return new[] { value };
                }
            }
            return Array.Empty<GraphicsDeviceType>();
        }

        /// <summary>
        /// Create (or recreate) the one-object scene. Keeping scene authoring in
        /// code is what lets the whole Unity project live in a text diff.
        /// </summary>
        private static string EnsureScene()
        {
            Directory.CreateDirectory(Path.Combine(Application.dataPath, "Scenes"));

            Scene scene = EditorSceneManager.NewScene(
                NewSceneSetup.EmptyScene,
                NewSceneMode.Single);

            var go = new GameObject("SimBridge");
            var bootstrap = go.AddComponent<SceneBootstrap>();
            var bridge = go.AddComponent<SimBridge>();
            bridge.Scene = bootstrap;

            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene, ScenePath);
            AssetDatabase.Refresh();
            return ScenePath;
        }
    }
}
