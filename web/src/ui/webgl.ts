/**
 * WebGL availability detection for the readable non-3D fallback, and a check
 * for software rendering so the launch view can scale its effects down.
 *
 * Both probes are cached. Creating a real WebGL context is expensive and the
 * browser only allows a handful at once — calling getContext on a dummy canvas
 * every React render will steal the live scene's context and leave a black
 * screen.
 */

let webglAvailable: boolean | null = null;
let softwareRenderer: boolean | null = null;

function probeContext(): WebGLRenderingContext | null {
  if (typeof document === "undefined" || typeof WebGLRenderingContext === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  return (canvas.getContext("webgl2") || canvas.getContext("webgl")) as WebGLRenderingContext | null;
}

function releaseContext(gl: WebGLRenderingContext | null): void {
  if (gl && typeof gl.getExtension === "function") {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

/** Test-only: drop the cached probe so the next call hits getContext again. */
export function resetWebGLAvailabilityForTests(): void {
  webglAvailable = null;
  softwareRenderer = null;
}

export function isWebGLAvailable(): boolean {
  if (webglAvailable !== null) {
    return webglAvailable;
  }
  try {
    const gl = probeContext();
    webglAvailable = !!gl;
    releaseContext(gl);
  } catch {
    webglAvailable = false;
  }
  return webglAvailable;
}

/**
 * True when WebGL is running on a CPU rasterizer (SwiftShader, llvmpipe,
 * Mesa's software paths) rather than a GPU. Bloom and particle effects cost
 * whole frames there, so the launch view drops to low effects on its own.
 */
export function isSoftwareRenderer(): boolean {
  if (softwareRenderer !== null) {
    return softwareRenderer;
  }
  try {
    const gl = probeContext();
    if (!gl) {
      softwareRenderer = true;
      return true;
    }
    const info = typeof gl.getExtension === "function" ? gl.getExtension("WEBGL_debug_renderer_info") : null;
    const renderer = String(
      info && typeof gl.getParameter === "function"
        ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL)
        : typeof gl.getParameter === "function"
          ? gl.getParameter(gl.RENDERER)
          : "",
    ).toLowerCase();
    softwareRenderer = /swiftshader|llvmpipe|softpipe|software|mesa offscreen/.test(renderer);
    releaseContext(gl);
  } catch {
    softwareRenderer = false;
  }
  return softwareRenderer;
}
