/**
 * The Unity WebGPU launch view, behind the LaunchRenderer interface.
 *
 * Everything Unity knows arrives through `SendMessage`. It is handed the
 * rocket's geometry once and a frame per animation tick, and it sends nothing
 * back except "ready" and "error". Time, physics and the HUD stay in
 * JavaScript.
 *
 * Frames are JSON strings, one per animation frame at most, which is the
 * simple thing that works. If profiling ever shows garbage-collection stalls
 * inside Unity, the fix is a pull model where Unity reads a float array — but
 * not before it is measured.
 */

import type { RenderFrame, RocketGeometry } from "../protocol";
import type { LaunchRenderer, RendererCameraMode, RendererInfo } from "./LaunchRenderer";
import { UnityHost, type UnityHostOptions } from "./UnityHost";

export const UNITY_RENDERER_INFO: RendererInfo = { id: "unity", label: "Unity WebGPU" };

const MIN_ZOOM = 0.0005;
const MAX_ZOOM = 6;

export interface UnityLaunchRendererOptions extends UnityHostOptions {
  cameraMode?: RendererCameraMode;
  zoom?: number;
}

export class UnityLaunchRenderer implements LaunchRenderer {
  readonly info = UNITY_RENDERER_INFO;

  private readonly host: UnityHost;
  private readonly initialMode: RendererCameraMode;
  private canvas: HTMLCanvasElement | null = null;
  private container: HTMLElement | null = null;
  private observer: ResizeObserver | null = null;
  private geometry: RocketGeometry | null = null;
  private zoom: number;
  /** The playback time of the last frame sent, so a paused view stays quiet. */
  private lastSentTime = Number.NaN;
  private lastSentSpeed = Number.NaN;

  constructor(options: UnityLaunchRendererOptions = {}) {
    this.host = new UnityHost(options);
    this.initialMode = options.cameraMode ?? "overhead";
    this.zoom = options.zoom ?? 1;
  }

  async mount(container: HTMLElement): Promise<void> {
    const canvas = document.createElement("canvas");
    canvas.id = "unity-canvas";
    canvas.className = "renderer-surface unity-canvas";
    // Unity grabs the keyboard by default, which would swallow typing in the
    // HTML controls layered over it. tabIndex keeps focus handling explicit.
    canvas.tabIndex = -1;
    container.appendChild(canvas);
    this.canvas = canvas;
    this.container = container;

    this.applyCanvasSize();
    this.observer = new ResizeObserver(() => this.applyCanvasSize());
    this.observer.observe(container);

    try {
      await this.host.load(canvas);
    } catch (error) {
      this.teardownDom();
      throw error;
    }

    if (this.geometry) {
      this.host.send("SetRocket", JSON.stringify(this.geometry));
    }
    this.host.send("SetCameraMode", this.initialMode);
  }

  setRocket(geometry: RocketGeometry): void {
    this.geometry = geometry;
    this.host.send("SetRocket", JSON.stringify(geometry));
  }

  setFrame(frame: RenderFrame): void {
    // While paused nothing moves, so re-sending the same instant only makes
    // garbage. A discontinuity or an event always goes through.
    const unchanged =
      !frame.playing &&
      !frame.discontinuity &&
      frame.events.length === 0 &&
      frame.t === this.lastSentTime &&
      frame.playbackSpeed === this.lastSentSpeed;
    if (unchanged) {
      return;
    }
    this.lastSentTime = frame.t;
    this.lastSentSpeed = frame.playbackSpeed;
    this.host.send("SetFrame", JSON.stringify(toUnityFrame(frame)));
  }

  setCameraMode(mode: RendererCameraMode): void {
    this.host.send("SetCameraMode", mode);
  }

  orbitCamera(dAzimuth: number, dElevation: number): void {
    this.host.send("OrbitCamera", `${dAzimuth},${dElevation}`);
  }

  zoomCamera(factor: number): void {
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
    this.host.send("ZoomCamera", String(factor));
  }

  /** Back to the pre-launch hold, clearing every effect. */
  resetFlight(): void {
    this.lastSentTime = Number.NaN;
    this.host.send("ResetFlight");
  }

  resize(): void {
    this.applyCanvasSize();
  }

  dispose(): void {
    this.teardownDom();
    void this.host.dispose();
  }

  private teardownDom(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.canvas?.remove();
    this.canvas = null;
    this.container = null;
  }

  /**
   * Match the canvas backing store to the container at the device pixel
   * ratio, the way Unity's own template does. Without this the player renders
   * at CSS pixels and looks soft on a retina display.
   */
  private applyCanvasSize(): void {
    const canvas = this.canvas;
    const container = this.container;
    if (!canvas || !container) {
      return;
    }
    const rect = container.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }
}

/**
 * Flatten a frame for `JsonUtility`, which cannot parse a nullable object or
 * a top-level array. The spent booster becomes a presence flag plus fields.
 */
export interface UnityRenderFrame {
  t: number;
  discontinuity: boolean;
  playbackSpeed: number;
  playing: boolean;
  stage: number;
  throttle: number;
  altitude: number;
  latDeg: number;
  lonDeg: number;
  speedAir: number;
  mach: number;
  q: number;
  g: number;
  aoaDeg: number;
  comFromBase: number;
  attachedLength: number;
  attitude: { x: number; y: number; z: number; w: number };
  velLocal: { x: number; y: number; z: number };
  earthCenterLocal: { x: number; y: number; z: number };
  earthQuat: { x: number; y: number; z: number; w: number };
  sunDirLocal: { x: number; y: number; z: number };
  stage1SpentPresent: boolean;
  stage1SpentPos: { x: number; y: number; z: number };
  stage1SpentAttitude: { x: number; y: number; z: number; w: number };
  events: string[];
}

const ZERO_VEC = { x: 0, y: 0, z: 0 };
const IDENTITY_QUAT = { x: 0, y: 0, z: 0, w: 1 };

export function toUnityFrame(frame: RenderFrame): UnityRenderFrame {
  const vec = (v: readonly number[]) => ({ x: v[0], y: v[1], z: v[2] });
  const quat = (q: readonly number[]) => ({ x: q[0], y: q[1], z: q[2], w: q[3] });
  const spent = frame.stage1Spent;
  return {
    t: frame.t,
    discontinuity: frame.discontinuity,
    playbackSpeed: frame.playbackSpeed,
    playing: frame.playing,
    stage: frame.stage,
    throttle: frame.throttle,
    altitude: frame.altitude,
    latDeg: frame.latDeg,
    lonDeg: frame.lonDeg,
    speedAir: frame.speedAir,
    mach: frame.mach,
    q: frame.q,
    g: frame.g,
    aoaDeg: frame.aoaDeg,
    comFromBase: frame.comFromBase,
    attachedLength: frame.attachedLength,
    attitude: quat(frame.attitude),
    velLocal: vec(frame.velLocal),
    earthCenterLocal: vec(frame.earthCenterLocal),
    earthQuat: quat(frame.earthQuat),
    sunDirLocal: vec(frame.sunDirLocal),
    stage1SpentPresent: spent !== null,
    stage1SpentPos: spent ? vec(spent.posLocal) : ZERO_VEC,
    stage1SpentAttitude: spent ? quat(spent.attitude) : IDENTITY_QUAT,
    events: frame.events,
  };
}
