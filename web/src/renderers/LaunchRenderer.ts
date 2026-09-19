/**
 * The launch view is behind this interface so the three.js scene and the
 * Unity WebGPU player are interchangeable. A renderer draws frames; it never
 * owns time, never simulates, and never decides what happens next.
 *
 * The instruction document names three camera modes (chase, wide, orbit).
 * This app ships four, and the flight screen's buttons must keep working, so
 * the interface carries all four: `overhead` is this app's name for the wide
 * shot, and `ground` is an extra pad-level camera.
 */

import type { RenderFrame, RocketGeometry } from "../protocol";

export type RendererCameraMode = "overhead" | "chase" | "ground" | "orbit";

export interface LaunchRenderer {
  /** Attach to a container. Resolves once the renderer can accept frames. */
  mount(container: HTMLElement): Promise<void>;
  /** Called once per launch, before the first frame. */
  setRocket(geometry: RocketGeometry): void;
  /** Called every animation frame while playing, and once after each seek. */
  setFrame(frame: RenderFrame): void;
  setCameraMode(mode: RendererCameraMode): void;
  /** Additive azimuth/elevation offsets, radians, from a pointer drag. */
  orbitCamera(dAzimuth: number, dElevation: number): void;
  /** Multiplies the camera distance; clamped by the renderer. */
  zoomCamera(factor: number): void;
  resize(): void;
  dispose(): void;
}

/** What a renderer reports about itself, for the fallback notice and notes. */
export interface RendererInfo {
  id: "three" | "unity";
  label: string;
}
