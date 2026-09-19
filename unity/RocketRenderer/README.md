# RocketRenderer — the Unity WebGPU launch view

This project draws the flight. It does not simulate it. Every position,
attitude and telemetry value it renders arrives from the TypeScript flight sim
in `web/src/sim`, through `web/src/protocol`, as a `RenderFrame`.

## Ground rules

1. **No physics here.** No `Rigidbody`, no gravity, no drag, no integration.
2. **No rocket dimensions here.** The vehicle is assembled from the
   `RocketGeometry` the sim sends, never from the player's slider values.
3. **No clock here.** JavaScript owns playback time. Scrubbing, pausing,
   replaying and speed changes all happen there; this project draws the frame
   it was handed.
4. **Nothing Earth-centered arrives here.** Unity runs on 32-bit floats, which
   cannot hold Earth-scale coordinates at metre precision. Every vector in a
   frame is relative to the rocket.

## Requirements

- **Unity 6.6 (6000.6) or newer**, for WebGPU as a supported graphics API.
  Before committing to a version, confirm WebGPU's status in Unity's own
  documentation and release notes — the build script fails loudly rather than
  silently producing a WebGL 2 player if the API is not available.
- Universal Render Pipeline (`com.unity.render-pipelines.universal`).

## Installing

Unity Hub → Installs → Install Editor → **6000.6 or newer**. When the module
list appears, tick **Web Build Support**; it is not selected by default, and
without it `BuildTarget.WebGL` is not available and the build script fails.

## Building

**First time, use the editor.** Run **Apogee → Build Web Player** from the menu
bar. This C# has not been compiled before, so the Console is where you will see
any errors — a headless build only prints an exit code.

### Opening the project

Recent Unity Hub versions treat the folder you pick in *Add project* as a
**parent to scan**, not as the project itself. Pointing it at
`unity/RocketRenderer` fails with "No valid Unity projects found"; point it at
the containing `unity/` folder instead and Hub finds `RocketRenderer` inside.

To bypass Hub entirely, launch the editor against the project directly:

```sh
"<editor>/Unity.app/Contents/MacOS/Unity" \
  -projectPath /absolute/path/to/unity/RocketRenderer
```

Hub usually lists the project afterwards, since the editor records it as
recently opened.

**After that, headless.** The `Unity` executable is not on `PATH`; it lives
inside the installed editor. From the repo root:

```sh
"<editor>/Unity.app/Contents/MacOS/Unity" \
  -quit -batchmode \
  -projectPath unity/RocketRenderer \
  -executeMethod Apogee.RocketRenderer.EditorTools.BuildScript.BuildWeb \
  -logFile -
```

`<editor>` is the version directory. Hub's default is
`/Applications/Unity/Hub/Editor/<version>`, but if a secondary install
location was set (Hub → Preferences → Installs), the version directories sit
directly under it instead. To find yours:

```sh
ls -d /Applications/Unity/Hub/Editor/* 2>/dev/null
cat "$HOME/Library/Application Support/UnityHub/secondaryInstallPath.json"
```

To confirm the Web module is installed, look for `WebGLSupport`:

```sh
ls "<editor>/PlaybackEngines"
```

`-logFile -` sends the build log to stdout; without it Unity writes to
`~/Library/Logs/Unity/Editor.log` and the terminal stays silent. The editor
must be **closed** — two processes cannot hold the same project.

On Windows the executable is
`C:\Program Files\Unity\Hub\Editor\<version>\Editor\Unity.exe`; the
arguments are identical.

Output goes to `web/public/unity/`, which is **not** committed — the web app
falls back to the three.js launch view when it is absent. `BuildScript` applies
every player setting itself (WebGPU, compression, product name) so a fresh
clone builds the same player without anyone clicking through the editor.

## Layout

| File | Role |
|---|---|
| `SimTypes.cs` | The wire format, mirrored from `web/src/protocol`. Field names must match the JSON exactly. |
| `SimBridge.cs` | The only door in: `SetRocket`, `SetFrame`, `SetCameraMode`, `OrbitCamera`, `ZoomCamera`, `ResetFlight`. |
| `SceneBootstrap.cs` | Builds the entire scene from code at startup. |
| `RocketBuilder.cs` | Assembles the vehicle from `RocketGeometry`. |
| `FlightView.cs` | Applies one frame: attitude, Earth, sun, spent booster. |
| `EarthView.cs` | Globe, atmosphere shell, stars, ground disc. |
| `EffectsController.cs` | Every effect, driven by telemetry. |
| `CameraDirector.cs` | The four camera modes, plus shake. |
| `Plugins/WebGL/RocketBridge.jslib` | The two signals back to the page: ready and error. |
| `Editor/BuildScript.cs` | Headless build entry point; also generates the scene. |

## Why the scene is built from code

The committed scene holds one GameObject (`SimBridge`), and everything else is
constructed at runtime by `SceneBootstrap`. That keeps the whole Unity side
reviewable as a text diff, and avoids binary scene and VFX assets that can only
be edited inside the editor.

For the same reason the effects use built-in `ParticleSystem` components rather
than VFX Graph: a `.vfx` asset only exists once it has been authored in the
editor. Swapping individual emitters for VFX Graph assets later is a change
inside `EffectsController` alone.
