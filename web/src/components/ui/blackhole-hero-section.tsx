"use client";

import * as React from "react";
import { useEffect, useRef } from "react";

export interface BlackHoleHeroSectionProps
  extends React.HTMLAttributes<HTMLDivElement> {
  distance?: number;
  elevation?: number;
  azimuth?: number;
  orbitSpeed?: number;
  roll?: number;
  fov?: number;
  diskInner?: number;
  diskOuter?: number;
  diskThickness?: number;
  diskDensity?: number;
  brightness?: number;
  spinSpeed?: number;
  grain?: number;
  doppler?: number;
  hotColor?: string;
  midColor?: string;
  coolColor?: string;
  starBrightness?: number;
  glow?: number;
  exposure?: number;
  vignette?: number;
  steps?: number;
  resolution?: number;
  maxDpr?: number;
  focus?: [number, number];
  scrim?: "none" | "left" | "right" | "top" | "bottom";
  scrimStrength?: number;
  paused?: boolean;
  children?: React.ReactNode;
}

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const SCENE_FRAG = `
precision highp float;

#define MAX_STEPS 460
#define WIND_CYCLE 46.0

varying vec2 vUv;

uniform vec2  uRes;
uniform float uTime;
uniform vec3  uCamPos;
uniform vec3  uRight;
uniform vec3  uUp;
uniform vec3  uFwd;
uniform float uTanHalf;
uniform vec2  uFocus;
uniform float uSteps;
uniform float uSkyR;
uniform float uDiskIn;
uniform float uDiskOut;
uniform float uThick;
uniform float uDensity;
uniform float uSpin;
uniform float uGrain;
uniform float uBright;
uniform float uDoppler;
uniform vec3  uHot;
uniform vec3  uMid;
uniform vec3  uCool;
uniform float uStars;
uniform float uEncode;
uniform vec2  uJitter;
uniform float uSeed;

float hash13(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
}

float fbm(vec3 p, float lod) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += (i == 3 ? a * lod : a) * vnoise(p);
    p = p * 2.03 + vec3(11.3, 7.1, 3.7);
    a *= 0.5;
  }
  return s;
}

void gasAt(vec3 p, float rd, float dt, out float dens, out vec3 tint, out float heat) {
  float rn = clamp((rd - uDiskIn) / max(0.001, uDiskOut - uDiskIn), 0.0, 1.0);
  float tk = uThick * (0.35 + 1.25 * rn);
  float v = p.y / tk;
  float sheet = exp(-v * v);
  float lod = clamp(1.0 - dt * uGrain * 14.0, 0.0, 1.0);
  float phi = atan(p.z, p.x);
  float omega = uSpin * pow(uDiskIn / rd, 1.5);
  float lr = log(rd) * 1.1 + uSpin * uTime * 0.05;

  float u = uTime / WIND_CYCLE;
  float fA = fract(u);
  float fB = fract(u + 0.5);
  float w = abs(2.0 * fA - 1.0);

  float cloudsA = fbm(vec3(vec2(cos(phi + omega * fA * WIND_CYCLE),
                                sin(phi + omega * fA * WIND_CYCLE)) * (rd * uGrain), lr), lod);
  float cloudsB = fbm(vec3(vec2(cos(phi + omega * fB * WIND_CYCLE),
                                sin(phi + omega * fB * WIND_CYCLE)) * (rd * uGrain), lr + 40.0), lod);
  float clouds = mix(cloudsA, cloudsB, w);
  float filaments = clouds * clouds * 1.75;
  float inner = smoothstep(0.0, 0.07, rn);
  float outer = 1.0 - smoothstep(0.45, 1.0, rn);
  float prof = inner * outer * pow(uDiskIn / rd, 2.0);

  dens = max(0.0, filaments * 1.5 - 0.30) * sheet * prof * uDensity * 4.6;
  heat = pow(uDiskIn / rd, 0.8) * (0.72 + 0.55 * clouds);
  tint = mix(uCool, uMid, smoothstep(0.10, 0.52, heat));
  tint = mix(tint, uHot, smoothstep(0.52, 1.05, heat));
}

vec3 starField(vec3 d) {
  vec3 a = abs(d);
  vec2 uv;
  float face;
  if (a.x >= a.y && a.x >= a.z)      { uv = d.yz / a.x; face = d.x > 0.0 ? 0.0 : 1.0; }
  else if (a.y >= a.z)               { uv = d.xz / a.y; face = d.y > 0.0 ? 2.0 : 3.0; }
  else                               { uv = d.xy / a.z; face = d.z > 0.0 ? 4.0 : 5.0; }

  vec3 col = vec3(0.0);
  for (int k = 0; k < 3; k++) {
    float sc = 90.0 * pow(2.2, float(k));
    vec2 p = uv * sc;
    vec2 id = floor(p);
    vec2 f = fract(p) - 0.5;
    float h = hash13(vec3(id, face * 19.0));
    if (h > 0.965) {
      vec2 off = vec2(hash13(vec3(id, face + 11.0)), hash13(vec3(id, face + 23.0)));
      float dd = length(f - (off - 0.5) * 0.7);
      float s = smoothstep(0.055, 0.0, dd);
      float warm = hash13(vec3(id, face + 51.0));
      col += s * (0.6 + 4.5 * fract(h * 97.0))
           * mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.88, 0.72), warm)
           / pow(2.2, float(k));
    }
  }
  col += vec3(0.013, 0.017, 0.030) * fbm(d * 2.6, 1.0);
  return col;
}

void main() {
  vec2 uv = (gl_FragCoord.xy + uJitter - uFocus * uRes) / uRes.y;
  vec3 dir = normalize(uFwd + (uv.x * uRight + uv.y * uUp) * 2.0 * uTanHalf);
  vec3 pos = uCamPos;
  vec3 vel = dir;
  vec3 hv = cross(pos, vel);
  float h2 = dot(hv, hv);
  float h = sqrt(h2);
  float swept = 0.0;
  vec3 col = vec3(0.0);
  float transmit = 1.0;
  bool captured = false;
  float jitter = fract(sin(dot(gl_FragCoord.xy + uSeed, vec2(12.9898, 78.233))) * 43758.5453);

  for (int i = 0; i < MAX_STEPS; i++) {
    if (float(i) >= uSteps) break;
    float r2 = dot(pos, pos);
    float r = sqrt(r2);
    if (r < 1.0) { captured = true; break; }
    if (r > uSkyR && dot(pos, vel) > 0.0) break;
    if (transmit < 0.004) break;

    float dt = clamp(0.14 * (r - 1.0), 0.025, 1.1);
    if (r < uDiskOut * 1.25) {
      float rn = clamp((r - uDiskIn) / max(0.001, uDiskOut - uDiskIn), 0.0, 1.0);
      float tk = uThick * (0.35 + 1.25 * rn);
      dt = min(dt, max(tk * 0.38, abs(pos.y) * 0.5));
    }

    swept += h * dt / r2;
    float deep = exp(-1.3 * max(0.0, swept - 4.6));
    jitter = fract(jitter + 0.6180339887);
    vec3 mid = pos + vel * (dt * jitter);
    float rd = length(mid.xz);

    if (rd > uDiskIn && rd < uDiskOut && abs(mid.y) < uThick * 5.0) {
      float dens;
      float heat;
      vec3 tint;
      gasAt(mid, rd, dt, dens, tint, heat);
      if (dens > 0.001) {
        vec3 tang = normalize(cross(vec3(0.0, 1.0, 0.0), vec3(mid.x, 0.0, mid.z)));
        float beta = min(0.85, sqrt(0.5 / max(rd, 1.5)));
        float gam = inversesqrt(max(1e-4, 1.0 - beta * beta));
        vec3 toObs = -normalize(vel);
        float g = 1.0 / (gam * (1.0 - beta * dot(tang, toObs)));
        g *= sqrt(max(0.05, 1.0 - 1.0 / rd));
        float boost = pow(max(g, 0.02), 3.0 * uDoppler);
        vec3 shift = mix(
          vec3(1.0),
          g > 1.0 ? vec3(0.86, 0.94, 1.14) : vec3(1.15, 0.82, 0.62),
          clamp(abs(g - 1.0) * 1.6, 0.0, 1.0) * uDoppler
        );
        float emit = uBright * (0.26 + 2.0 * heat * heat);
        col += tint * shift * (emit * boost * dens * transmit * dt * deep);
        transmit *= exp(-dens * 0.30 * dt);
      }
    }

    vec3 acc = -1.5 * h2 * pos / (r2 * r2 * r);
    vel += acc * dt;
    pos += vel * dt;
  }

  if (!captured && uStars > 0.001) {
    vec3 toHole = normalize(-uCamPos);
    float sI = length(cross(normalize(dir), toHole));
    float sS = length(cross(normalize(vel), toHole));
    float stretch = clamp(sI / max(1e-3, sS), 1.0, 40.0);
    col += starField(normalize(vel)) * uStars * transmit / stretch;
  }

  if (uEncode > 0.5) col = col / (1.0 + col);
  gl_FragColor = vec4(col, 1.0);
}
`;

const BLEND_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uCur;
uniform sampler2D uPrev;
uniform float uAlpha;
void main() {
  vec3 c = texture2D(uCur, vUv).rgb;
  vec3 p = texture2D(uPrev, vUv).rgb;
  gl_FragColor = vec4(mix(p, c, uAlpha), 1.0);
}
`;

const BRIGHT_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uDecode;
uniform float uPack;
uniform float uThreshold;
void main() {
  vec3 s = texture2D(uTex, vUv + uTexel * vec2(-1.0, -1.0)).rgb
         + texture2D(uTex, vUv + uTexel * vec2( 1.0, -1.0)).rgb
         + texture2D(uTex, vUv + uTexel * vec2(-1.0,  1.0)).rgb
         + texture2D(uTex, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
  s *= 0.25;
  if (uDecode > 0.5) s = s / max(vec3(0.002), 1.0 - s);
  float l = max(s.r, max(s.g, s.b));
  s *= max(0.0, l - uThreshold) / max(0.0001, l);
  gl_FragColor = vec4(s * uPack, 1.0);
}
`;

const BLUR_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uStep;
void main() {
  vec3 s = texture2D(uTex, vUv).rgb * 0.2270270;
  s += (texture2D(uTex, vUv + uStep * 1.3846154).rgb
      + texture2D(uTex, vUv - uStep * 1.3846154).rgb) * 0.3162162;
  s += (texture2D(uTex, vUv + uStep * 3.2307692).rgb
      + texture2D(uTex, vUv - uStep * 3.2307692).rgb) * 0.0702702;
  gl_FragColor = vec4(s, 1.0);
}
`;

const COMPOSITE_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2  uRes;
uniform float uDecode;
uniform float uPack;
uniform float uGlow;
uniform float uExposure;
uniform float uVignette;
uniform float uScrimDir;
uniform float uScrimAmt;
uniform float uSeed;

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec3 scene = texture2D(uScene, vUv).rgb;
  if (uDecode > 0.5) scene = scene / max(vec3(0.002), 1.0 - scene);
  vec3 bloom = texture2D(uBloom, vUv).rgb / uPack;
  vec3 c = scene + bloom * uGlow;
  c = aces(c * uExposure);
  c = pow(max(c, 0.0), vec3(0.4545));
  vec2 d = vUv - 0.5;
  c *= 1.0 - uVignette * dot(d, d) * 1.9;

  if (uScrimDir > 0.5) {
    float x = uScrimDir < 1.5 ? vUv.x
            : uScrimDir < 2.5 ? 1.0 - vUv.x
            : uScrimDir < 3.5 ? 1.0 - vUv.y
            : vUv.y;
    c *= 1.0 - uScrimAmt * pow(1.0 - clamp(x, 0.0, 1.0), 2.4);
  }

  float n = fract(sin(dot(gl_FragCoord.xy + uSeed, vec2(12.9898, 78.233))) * 43758.5453);
  c += (n - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0);
}
`;

const RAD = Math.PI / 180;

function hexToLinear(hex: string): [number, number, number] {
  const h = hex.trim().replace("#", "");
  const full = h.length === 3
    ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
    : h.slice(0, 6);
  const n = Number.parseInt(full, 16);
  const srgb = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  return srgb.map((value) =>
    value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
  ) as [number, number, number];
}

type Prog = {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
};

type Target = {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
};

export function BlackHoleHeroSection({
  distance = 24,
  elevation = -5.5,
  azimuth = 0,
  orbitSpeed = 0,
  roll = -20,
  fov = 42,
  diskInner = 3,
  diskOuter = 15,
  diskThickness = 0.26,
  diskDensity = 1,
  brightness = 1,
  spinSpeed = 0.06,
  grain = 0.48,
  doppler = 0.35,
  hotColor = "#FFF3DE",
  midColor = "#FF9838",
  coolColor = "#8E3A0B",
  starBrightness = 0,
  glow = 1,
  exposure = 0.9,
  vignette = 0.28,
  steps = 300,
  resolution = 0.7,
  maxDpr = 1.75,
  focus = [0.72, 0.46],
  scrim = "none",
  scrimStrength = 0.9,
  paused = false,
  className = "",
  children,
  ...rest
}: BlackHoleHeroSectionProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const props = useRef({
    distance, elevation, azimuth, orbitSpeed, roll, fov, diskInner, diskOuter,
    diskThickness, diskDensity, brightness, spinSpeed, grain, doppler, hotColor,
    midColor, coolColor, starBrightness, glow, exposure, vignette, steps,
    resolution, maxDpr, focus, scrim, scrimStrength, paused,
  });

  useEffect(() => {
    props.current = {
      distance, elevation, azimuth, orbitSpeed, roll, fov, diskInner, diskOuter,
      diskThickness, diskDensity, brightness, spinSpeed, grain, doppler, hotColor,
      midColor, coolColor, starBrightness, glow, exposure, vignette, steps,
      resolution, maxDpr, focus, scrim, scrimStrength, paused,
    };
  });

  useEffect(() => {
    const hostElement = hostRef.current;
    const canvasElement = canvasRef.current;
    if (!hostElement || !canvasElement) return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const options: WebGLContextAttributes = {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    };

    // The shaders are GLSL ES 1.00, so prefer WebGL 1. WebGL 2 requires a
    // different shader syntax even though the rendering pipeline is identical.
    const context = canvasElement.getContext("webgl", options);
    if (!context) {
      hostElement.dataset["webgl"] = "unsupported";
      canvasElement.style.display = "none";
      return;
    }
    const host = hostElement;
    const canvas = canvasElement;
    const gl = context;

    function giveUp(reason: string) {
      host.dataset["webgl"] = reason;
      canvas.style.display = "none";
    }

    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = debugInfo
      ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || "")
      : "";
    const software = /swiftshader|llvmpipe|softpipe|software|microsoft basic/i.test(renderer);

    function compile(type: number, source: string): WebGLShader | null {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error("blackhole: shader failed —", gl.getShaderInfoLog(shader) || "no log");
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    }

    function link(fragmentSource: string): Prog | null {
      const vertexShader = compile(gl.VERTEX_SHADER, VERT);
      const fragmentShader = compile(gl.FRAGMENT_SHADER, fragmentSource);
      if (!vertexShader || !fragmentShader) return null;
      const program = gl.createProgram();
      if (!program) return null;
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.bindAttribLocation(program, 0, "aPos");
      gl.linkProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error("blackhole: program failed —", gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
      }
      const uniforms: Record<string, WebGLUniformLocation | null> = {};
      const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
      for (let index = 0; index < count; index++) {
        const info = gl.getActiveUniform(program, index);
        if (info) uniforms[info.name] = gl.getUniformLocation(program, info.name);
      }
      return { program, uniforms };
    }

    const uniform = (program: Prog, name: string) => program.uniforms[name] ?? null;

    let hdr = true;
    let textureType: number = gl.UNSIGNED_BYTE;
    let internalFormat: number = gl.RGBA;
    const halfFloat = gl.getExtension("OES_texture_half_float");
    const colorBuffer = gl.getExtension("EXT_color_buffer_half_float");
    if (halfFloat && colorBuffer) textureType = halfFloat.HALF_FLOAT_OES;
    else hdr = false;

    if (!hdr) {
      textureType = gl.UNSIGNED_BYTE;
      internalFormat = gl.RGBA;
    }

    const linear = !!gl.getExtension("OES_texture_half_float_linear") || !hdr;
    const filter = linear ? gl.LINEAR : gl.NEAREST;
    const pack = hdr ? 1 : 0.12;

    function makeTarget(w: number, h: number): Target | null {
      const texture = gl.createTexture();
      const framebuffer = gl.createFramebuffer();
      if (!texture || !framebuffer) return null;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, gl.RGBA, textureType, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        gl.deleteTexture(texture);
        gl.deleteFramebuffer(framebuffer);
        return null;
      }
      return { fb: framebuffer, tex: texture, w, h };
    }

    let sceneProgram: Prog | null = null;
    let blendProgram: Prog | null = null;
    let brightProgram: Prog | null = null;
    let blurProgram: Prog | null = null;
    let compositeProgram: Prog | null = null;
    let vertexBuffer: WebGLBuffer | null = null;
    let scene: Target | null = null;
    let historyA: Target | null = null;
    let historyB: Target | null = null;
    let bloomA: Target | null = null;
    let bloomB: Target | null = null;
    let settled = 0;
    let width = 0;
    let height = 0;
    let sceneWidth = 0;
    let sceneHeight = 0;

    function build() {
      sceneProgram = link(SCENE_FRAG);
      blendProgram = link(BLEND_FRAG);
      brightProgram = link(BRIGHT_FRAG);
      blurProgram = link(BLUR_FRAG);
      compositeProgram = link(COMPOSITE_FRAG);
      if (!sceneProgram || !blendProgram || !brightProgram || !blurProgram || !compositeProgram) {
        return false;
      }

      vertexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      return true;
    }

    function dropTargets() {
      for (const target of [scene, historyA, historyB, bloomA, bloomB]) {
        if (!target) continue;
        gl.deleteTexture(target.tex);
        gl.deleteFramebuffer(target.fb);
      }
      scene = historyA = historyB = bloomA = bloomB = null;
      settled = 0;
    }

    function resize() {
      const rect = host.getBoundingClientRect();
      const dpr = software ? 1 : Math.min(window.devicePixelRatio || 1, Math.max(1, props.current.maxDpr));
      const cssWidth = Math.max(1, Math.round(rect.width));
      const cssHeight = Math.max(1, Math.round(rect.height));
      const scale = software ? 0.34 : Math.min(1, Math.max(0.4, props.current.resolution));
      const nextWidth = Math.max(2, Math.round(cssWidth * dpr));
      const nextHeight = Math.max(2, Math.round(cssHeight * dpr));
      const nextSceneWidth = Math.max(2, Math.round(nextWidth * scale));
      const nextSceneHeight = Math.max(2, Math.round(nextHeight * scale));
      if (
        nextWidth === width && nextHeight === height &&
        nextSceneWidth === sceneWidth && nextSceneHeight === sceneHeight
      ) return;

      width = nextWidth;
      height = nextHeight;
      sceneWidth = nextSceneWidth;
      sceneHeight = nextSceneHeight;
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      dropTargets();
      scene = makeTarget(sceneWidth, sceneHeight);
      historyA = makeTarget(sceneWidth, sceneHeight);
      historyB = makeTarget(sceneWidth, sceneHeight);
      bloomA = makeTarget(Math.max(2, sceneWidth >> 2), Math.max(2, sceneHeight >> 2));
      bloomB = makeTarget(Math.max(2, sceneWidth >> 2), Math.max(2, sceneHeight >> 2));
    }

    let clock = reduced ? 6 : 0;
    let lastFrame = 0;
    let running = true;
    let visible = true;
    let animationFrame = 0;

    function pass(program: Prog, target: Target | null) {
      gl.useProgram(program.program);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
      gl.viewport(0, 0, target ? target.w : width, target ? target.h : height);
    }

    const draw = () => gl.drawArrays(gl.TRIANGLES, 0, 3);
    const bind = (texture: WebGLTexture, unit: number) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
    };

    const halton: Array<[number, number]> = [
      [0.5, 0.333], [0.25, 0.667], [0.75, 0.111], [0.125, 0.444],
      [0.625, 0.778], [0.375, 0.222], [0.875, 0.556], [0.0625, 0.889],
    ];

    function render(time: number) {
      if (!sceneProgram || !blendProgram || !brightProgram || !blurProgram || !compositeProgram) return;
      if (!scene || !historyA || !historyB || !bloomA || !bloomB) return;
      const current = props.current;
      const azimuthRadians = (current.azimuth + current.orbitSpeed * time) * RAD;
      const elevationRadians = Math.max(-88, Math.min(88, current.elevation)) * RAD;
      const cameraDistance = Math.max(2.2, current.distance);
      const cosElevation = Math.cos(elevationRadians);
      const cameraX = cameraDistance * cosElevation * Math.cos(azimuthRadians);
      const cameraY = cameraDistance * Math.sin(elevationRadians);
      const cameraZ = cameraDistance * cosElevation * Math.sin(azimuthRadians);
      const forwardX = -cameraX / cameraDistance;
      const forwardY = -cameraY / cameraDistance;
      const forwardZ = -cameraZ / cameraDistance;
      let rightX = forwardZ;
      let rightY = 0;
      let rightZ = -forwardX;
      const rightLength = Math.hypot(rightX, rightY, rightZ) || 1;
      rightX /= rightLength;
      rightY /= rightLength;
      rightZ /= rightLength;
      const upX = rightY * forwardZ - rightZ * forwardY;
      const upY = rightZ * forwardX - rightX * forwardZ;
      const upZ = rightX * forwardY - rightY * forwardX;
      const cosRoll = Math.cos(current.roll * RAD);
      const sinRoll = Math.sin(current.roll * RAD);
      const rolledRightX = rightX * cosRoll + upX * sinRoll;
      const rolledRightY = rightY * cosRoll + upY * sinRoll;
      const rolledRightZ = rightZ * cosRoll + upZ * sinRoll;
      const rolledUpX = -rightX * sinRoll + upX * cosRoll;
      const rolledUpY = -rightY * sinRoll + upY * cosRoll;
      const rolledUpZ = -rightZ * sinRoll + upZ * cosRoll;
      const hot = hexToLinear(current.hotColor);
      const mid = hexToLinear(current.midColor);
      const cool = hexToLinear(current.coolColor);
      const outer = Math.max(current.diskInner + 0.5, current.diskOuter);

      pass(sceneProgram, scene);
      gl.uniform2f(uniform(sceneProgram, "uRes"), scene.w, scene.h);
      gl.uniform1f(uniform(sceneProgram, "uTime"), time);
      gl.uniform3f(uniform(sceneProgram, "uCamPos"), cameraX, cameraY, cameraZ);
      gl.uniform3f(uniform(sceneProgram, "uRight"), rolledRightX, rolledRightY, rolledRightZ);
      gl.uniform3f(uniform(sceneProgram, "uUp"), rolledUpX, rolledUpY, rolledUpZ);
      gl.uniform3f(uniform(sceneProgram, "uFwd"), forwardX, forwardY, forwardZ);
      gl.uniform1f(uniform(sceneProgram, "uTanHalf"), Math.tan(Math.max(8, Math.min(110, current.fov)) * 0.5 * RAD));
      gl.uniform2f(uniform(sceneProgram, "uFocus"), current.focus[0], 1 - current.focus[1]);
      gl.uniform1f(uniform(sceneProgram, "uSteps"), software ? 130 : Math.max(60, Math.min(460, Math.round(current.steps))));
      gl.uniform1f(uniform(sceneProgram, "uSkyR"), Math.max(cameraDistance * 1.35, outer * 2.4));
      gl.uniform1f(uniform(sceneProgram, "uDiskIn"), Math.max(1.05, current.diskInner));
      gl.uniform1f(uniform(sceneProgram, "uDiskOut"), outer);
      gl.uniform1f(uniform(sceneProgram, "uThick"), Math.max(0.02, current.diskThickness));
      gl.uniform1f(uniform(sceneProgram, "uDensity"), Math.max(0, current.diskDensity));
      gl.uniform1f(uniform(sceneProgram, "uSpin"), current.spinSpeed * 6.2831853);
      gl.uniform1f(uniform(sceneProgram, "uGrain"), Math.max(0.02, current.grain));
      gl.uniform1f(uniform(sceneProgram, "uBright"), Math.max(0, current.brightness));
      gl.uniform1f(uniform(sceneProgram, "uDoppler"), Math.max(0, Math.min(1, current.doppler)));
      gl.uniform3f(uniform(sceneProgram, "uHot"), hot[0], hot[1], hot[2]);
      gl.uniform3f(uniform(sceneProgram, "uMid"), mid[0], mid[1], mid[2]);
      gl.uniform3f(uniform(sceneProgram, "uCool"), cool[0], cool[1], cool[2]);
      gl.uniform1f(uniform(sceneProgram, "uStars"), Math.max(0, current.starBrightness));
      gl.uniform1f(uniform(sceneProgram, "uEncode"), hdr ? 0 : 1);
      const sample = halton[settled % halton.length] ?? halton[0]!;
      gl.uniform2f(uniform(sceneProgram, "uJitter"), sample[0] - 0.5, sample[1] - 0.5);
      gl.uniform1f(uniform(sceneProgram, "uSeed"), (settled % 64) * 17.13);
      draw();

      const alpha = settled === 0 ? 1 : 0.14;
      pass(blendProgram, historyB);
      bind(scene.tex, 0);
      bind(historyA.tex, 1);
      gl.uniform1i(uniform(blendProgram, "uCur"), 0);
      gl.uniform1i(uniform(blendProgram, "uPrev"), 1);
      gl.uniform1f(uniform(blendProgram, "uAlpha"), alpha);
      draw();
      const shown = historyB;
      const temporary = historyA;
      historyA = historyB;
      historyB = temporary;
      settled++;

      pass(brightProgram, bloomA);
      bind(shown.tex, 0);
      gl.uniform1i(uniform(brightProgram, "uTex"), 0);
      gl.uniform2f(uniform(brightProgram, "uTexel"), 1 / shown.w, 1 / shown.h);
      gl.uniform1f(uniform(brightProgram, "uDecode"), hdr ? 0 : 1);
      gl.uniform1f(uniform(brightProgram, "uPack"), pack);
      gl.uniform1f(uniform(brightProgram, "uThreshold"), 0.85);
      draw();

      const blur = (source: Target, destination: Target, dx: number, dy: number) => {
        pass(blurProgram!, destination);
        bind(source.tex, 0);
        gl.uniform1i(uniform(blurProgram!, "uTex"), 0);
        gl.uniform2f(uniform(blurProgram!, "uStep"), dx / destination.w, dy / destination.h);
        draw();
      };
      blur(bloomA, bloomB, 1, 0);
      blur(bloomB, bloomA, 0, 1);
      blur(bloomA, bloomB, 2.6, 0);
      blur(bloomB, bloomA, 0, 2.6);

      pass(compositeProgram, null);
      bind(shown.tex, 0);
      bind(bloomA.tex, 1);
      gl.uniform1i(uniform(compositeProgram, "uScene"), 0);
      gl.uniform1i(uniform(compositeProgram, "uBloom"), 1);
      gl.uniform2f(uniform(compositeProgram, "uRes"), width, height);
      gl.uniform1f(uniform(compositeProgram, "uDecode"), hdr ? 0 : 1);
      gl.uniform1f(uniform(compositeProgram, "uPack"), pack);
      gl.uniform1f(uniform(compositeProgram, "uGlow"), Math.max(0, current.glow) * 0.26);
      gl.uniform1f(uniform(compositeProgram, "uExposure"), Math.max(0.05, current.exposure));
      gl.uniform1f(uniform(compositeProgram, "uVignette"), Math.max(0, Math.min(1, current.vignette)));
      const scrimDirection = current.scrim === "left" ? 1
        : current.scrim === "right" ? 2
          : current.scrim === "top" ? 3
            : current.scrim === "bottom" ? 4 : 0;
      gl.uniform1f(uniform(compositeProgram, "uScrimDir"), scrimDirection);
      gl.uniform1f(uniform(compositeProgram, "uScrimAmt"), Math.max(0, Math.min(1, current.scrimStrength)));
      gl.uniform1f(uniform(compositeProgram, "uSeed"), (time * 60) % 1000);
      draw();
    }

    function settle(passes: number) {
      for (let index = 0; index < passes; index++) render(clock);
    }

    function tick(now: number) {
      if (!running) return;
      animationFrame = requestAnimationFrame(tick);
      if (!visible) {
        lastFrame = now;
        return;
      }
      const delta = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0;
      lastFrame = now;
      if (!props.current.paused && !reduced) clock += delta;
      render(clock);
    }

    if (!build()) {
      giveUp("build-failed");
      return;
    }
    resize();
    settle(reduced ? 16 : 1);
    if (!reduced) animationFrame = requestAnimationFrame(tick);

    const resizeObserver = new ResizeObserver(() => {
      resize();
      if (reduced || props.current.paused) settle(16);
    });
    resizeObserver.observe(host);

    const intersectionObserver = new IntersectionObserver(
      (entries) => { visible = entries[0]?.isIntersecting ?? true; },
      { threshold: 0 },
    );
    intersectionObserver.observe(host);

    const onVisibility = () => {
      visible = !document.hidden;
      lastFrame = 0;
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      running = false;
      cancelAnimationFrame(animationFrame);
      canvas.style.display = "none";
    };
    const onContextRestored = () => {
      width = height = sceneWidth = sceneHeight = 0;
      if (!build()) {
        giveUp("lost");
        return;
      }
      canvas.style.display = "";
      host.dataset["webgl"] = "";
      resize();
      running = true;
      lastFrame = 0;
      settle(reduced ? 16 : 1);
      if (!reduced) animationFrame = requestAnimationFrame(tick);
    };

    document.addEventListener("visibilitychange", onVisibility);
    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);

    return () => {
      running = false;
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      dropTargets();
      if (vertexBuffer) gl.deleteBuffer(vertexBuffer);
      for (const program of [sceneProgram, blendProgram, brightProgram, blurProgram, compositeProgram]) {
        if (program) gl.deleteProgram(program.program);
      }
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className={`relative isolate h-full w-full overflow-hidden bg-black ${className}`}
      {...rest}
    >
      <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 h-full w-full" />
      {children ? <div className="relative z-10 h-full w-full">{children}</div> : null}
    </div>
  );
}

export default BlackHoleHeroSection;
