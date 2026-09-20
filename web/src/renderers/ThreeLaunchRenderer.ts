/**
 * The existing three.js launch view, behind the LaunchRenderer interface.
 *
 * This is the fallback path and it must never break: if WebGPU is missing, if
 * the Unity build is not deployed, or if Unity fails at startup, this is what
 * the player sees. It mounts its own React root so the flight screen can swap
 * renderers without re-rendering the HUD around it.
 *
 * It receives static flight data at construction — the trail, the ground
 * track and the spent-booster path are the whole recording, not one frame —
 * and everything that moves comes from `setFrame`.
 */

import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";

import type { RenderFrame, RocketGeometry } from "../protocol";
import type { SerializableFlightResult } from "../workers/protocol";
import { FlightScene, type SceneCameraState } from "../ui/components/FlightScene";
import { SafeCanvas } from "../ui/components/SafeCanvas";
import { isSoftwareRenderer } from "../ui/webgl";
import type { LaunchRenderer, RendererCameraMode, RendererInfo } from "./LaunchRenderer";

const MIN_ZOOM = 0.0005;
const MAX_ZOOM = 6;

export const THREE_RENDERER_INFO: RendererInfo = { id: "three", label: "three.js" };

export interface ThreeLaunchRendererOptions {
  flight: SerializableFlightResult;
  lowEffects: boolean;
  /** No camera shake. */
  reducedMotion?: boolean;
  /** Initial camera mode, so a swap mid-flight keeps the player's choice. */
  cameraMode?: RendererCameraMode;
  zoom?: number;
}

export class ThreeLaunchRenderer implements LaunchRenderer {
  readonly info = THREE_RENDERER_INFO;

  private readonly flight: SerializableFlightResult;
  private readonly lowEffects: boolean;
  private readonly reducedMotion: boolean;
  private readonly frameRef: { current: RenderFrame | null } = { current: null };
  private readonly cameraRef: { current: SceneCameraState };
  private geometry: RocketGeometry | null = null;
  private root: Root | null = null;
  private host: HTMLDivElement | null = null;

  constructor(options: ThreeLaunchRendererOptions) {
    this.flight = options.flight;
    // A CPU rasterizer cannot afford bloom or particles: drop to low effects
    // on its own rather than crawling.
    this.lowEffects = options.lowEffects || isSoftwareRenderer();
    this.reducedMotion = options.reducedMotion ?? false;
    this.cameraRef = {
      current: {
        mode: options.cameraMode ?? "overhead",
        zoom: options.zoom ?? 1,
        azimuth: 0,
        elevation: 0,
      },
    };
  }

  async mount(container: HTMLElement): Promise<void> {
    const host = document.createElement("div");
    host.className = "renderer-surface";
    container.appendChild(host);
    this.host = host;
    this.root = createRoot(host);
    this.root.render(
      createElement(
        SafeCanvas,
        {
          camera: { fov: 50, near: 0.0001, far: 100_000, position: [0.12, 0.08, 0.12] },
          gl: { logarithmicDepthBuffer: true, alpha: false },
          dpr: this.lowEffects ? 1 : ([1, 1.5] as [number, number]),
        },
        createElement(FlightScene, {
          flight: this.flight,
          frameRef: this.frameRef,
          cameraRef: this.cameraRef,
          lowEffects: this.lowEffects,
          reducedMotion: this.reducedMotion,
        }),
      ),
    );
  }

  setRocket(geometry: RocketGeometry): void {
    // The three scene builds its mesh from the same DerivedRocket the physics
    // uses, so there is nothing to rebuild here; keeping the geometry makes
    // the two renderers answer the same questions.
    this.geometry = geometry;
  }

  /** The geometry this renderer was last given, for parity checks. */
  get rocketGeometry(): RocketGeometry | null {
    return this.geometry;
  }

  setFrame(frame: RenderFrame): void {
    this.frameRef.current = frame;
  }

  setCameraMode(mode: RendererCameraMode): void {
    this.cameraRef.current.mode = mode;
    // A mode change is a fresh framing: drop accumulated drag.
    this.cameraRef.current.azimuth = 0;
    this.cameraRef.current.elevation = 0;
  }

  orbitCamera(dAzimuth: number, dElevation: number): void {
    this.cameraRef.current.azimuth += dAzimuth;
    this.cameraRef.current.elevation += dElevation;
  }

  zoomCamera(factor: number): void {
    const zoom = this.cameraRef.current.zoom * factor;
    this.cameraRef.current.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  }

  /** Current zoom, so the flight screen's readout matches what is drawn. */
  get zoom(): number {
    return this.cameraRef.current.zoom;
  }

  resize(): void {
    // react-three-fiber's Canvas already observes its container.
  }

  dispose(): void {
    this.frameRef.current = null;
    const root = this.root;
    const host = this.host;
    this.root = null;
    this.host = null;
    if (root) {
      // Unmounting synchronously from inside a React commit throws; defer it.
      queueMicrotask(() => {
        root.unmount();
        host?.remove();
      });
    } else {
      host?.remove();
    }
  }
}
