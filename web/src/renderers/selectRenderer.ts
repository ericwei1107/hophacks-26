/**
 * Picks the launch renderer and falls back without ceremony.
 *
 * Unity is used only when everything lines up: WebGPU exists, the player did
 * not ask for three.js, and a Unity build is actually deployed. Anything else
 * — a missing build, a startup throw, a player that never reports ready —
 * lands on the three.js view with a notice, within the load timeout.
 *
 * The query parameter is the escape hatch for demos and for bug reports:
 * `?renderer=three` forces the fallback, `?renderer=unity` forces the attempt
 * (and still falls back if it fails, rather than leaving a blank screen).
 */

import type { LaunchRenderer, RendererCameraMode } from "./LaunchRenderer";
import { ThreeLaunchRenderer } from "./ThreeLaunchRenderer";
import { UnityLaunchRenderer } from "./UnityLaunchRenderer";
import { DEFAULT_UNITY_BASE_PATH, unityBuildAvailable } from "./UnityHost";
import type { SerializableFlightResult } from "../workers/protocol";

export type RendererPreference = "auto" | "three" | "unity";

export interface RendererSelection {
  renderer: LaunchRenderer;
  id: "three" | "unity";
  /** Set when Unity was wanted but not used; shown to the player. */
  notice: string | null;
}

export interface SelectRendererOptions {
  container: HTMLElement;
  flight: SerializableFlightResult;
  lowEffects: boolean;
  reducedMotion?: boolean;
  cameraMode: RendererCameraMode;
  zoom: number;
  preference?: RendererPreference;
  unityBasePath?: string;
  timeoutMs?: number;
  onProgress?: (progress: number) => void;
}

export function readRendererPreference(search = window.location.search): RendererPreference {
  const value = new URLSearchParams(search).get("renderer");
  return value === "three" || value === "unity" ? value : "auto";
}

export function hasWebGpu(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

/** Unity is opt-in. Auto stays on three.js so a blank WebGPU player cannot hide the launch. */
export function shouldAttemptUnity(preference: RendererPreference): boolean {
  return preference === "unity";
}

/**
 * Mount the best available renderer. Always resolves with something mounted:
 * a launch that shows nothing is worse than a launch that shows the old view.
 */
export async function selectRenderer(options: SelectRendererOptions): Promise<RendererSelection> {
  const preference = options.preference ?? readRendererPreference();
  const basePath = options.unityBasePath ?? DEFAULT_UNITY_BASE_PATH;

  const mountThree = async (notice: string | null): Promise<RendererSelection> => {
    const renderer = new ThreeLaunchRenderer({
      flight: options.flight,
      lowEffects: options.lowEffects,
      reducedMotion: options.reducedMotion ?? false,
      cameraMode: options.cameraMode,
      zoom: options.zoom,
    });
    await renderer.mount(options.container);
    return { renderer, id: "three", notice };
  };

  if (!shouldAttemptUnity(preference)) {
    return mountThree(null);
  }

  if (!hasWebGpu()) {
    return mountThree(
      preference === "unity"
        ? "This browser has no WebGPU support, so the launch view is running on three.js."
        : null,
    );
  }

  if (!(await unityBuildAvailable(basePath))) {
    return mountThree(
      preference === "unity"
        ? `No Unity build is deployed at ${basePath}; the launch view is running on three.js.`
        : null,
    );
  }

  const unity = new UnityLaunchRenderer({
    basePath,
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    cameraMode: options.cameraMode,
    zoom: options.zoom,
  });

  try {
    await unity.mount(options.container);
    return { renderer: unity, id: "unity", notice: null };
  } catch (error) {
    unity.dispose();
    const reason = error instanceof Error ? error.message : String(error);
    return mountThree(`The Unity launch view failed to start (${reason}); showing three.js instead.`);
  }
}
