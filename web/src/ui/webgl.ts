/**
 * WebGL availability detection for the readable non-3D fallback, and a check
 * for software rendering so the launch view can scale its effects down.
 */
export function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl2") || canvas.getContext("webgl"))
    );
  } catch {
    return false;
  }
}

let softwareRenderer: boolean | null = null;

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
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) {
      softwareRenderer = true;
      return true;
    }
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(
      info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    ).toLowerCase();
    softwareRenderer = /swiftshader|llvmpipe|softpipe|software|mesa offscreen/.test(renderer);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    softwareRenderer = false;
  }
  return softwareRenderer;
}
