/**
 * Loads and owns the Unity WebGPU player.
 *
 * Unity's build output is named after the product and the compression
 * settings, and those names change between versions and configurations. Rather
 * than guess them, this reads the build's *own* generated `index.html` and
 * copies the loader URL and config out of it — so a rebuild with different
 * settings keeps working without touching this file.
 *
 * Nothing here is loaded until the player presses Launch. The build screen
 * must never wait on a Unity download.
 */

export interface UnityBuildConfig {
  loaderUrl: string;
  dataUrl: string;
  frameworkUrl: string;
  codeUrl: string;
  streamingAssetsUrl?: string;
  companyName?: string;
  productName?: string;
  productVersion?: string;
}

export interface UnityInstance {
  SendMessage(objectName: string, methodName: string, value?: string | number): void;
  SetFullscreen?(value: number): void;
  Quit(): Promise<void>;
  Module?: { canvas?: HTMLCanvasElement };
}

type CreateUnityInstance = (
  canvas: HTMLCanvasElement,
  config: UnityBuildConfig & Record<string, unknown>,
  onProgress?: (progress: number) => void,
) => Promise<UnityInstance>;

declare global {
  interface Window {
    createUnityInstance?: CreateUnityInstance;
    /** The jslib bridge calls into this; it must exist before the loader runs. */
    __rocketHost?: {
      onReady: () => void;
      onError: (message: string) => void;
    };
  }
}

export const DEFAULT_UNITY_BASE_PATH = "/unity";
export const UNITY_LOAD_TIMEOUT_MS = 30_000;

/** Absolute-ish join that tolerates a trailing slash on the base path. */
function joinPath(base: string, rest: string): string {
  if (/^(https?:)?\/\//.test(rest) || rest.startsWith("/")) {
    return rest;
  }
  return `${base.replace(/\/+$/, "")}/${rest.replace(/^\.?\//, "")}`;
}

/**
 * Pull the loader URL and config out of a Unity-generated index.html.
 *
 * The generated template declares `var buildUrl = "Build";` and then builds
 * every URL from it. We resolve the same way instead of assuming file names.
 */
export function parseUnityIndexHtml(html: string, basePath: string): UnityBuildConfig {
  const buildUrlMatch = /var\s+buildUrl\s*=\s*["']([^"']+)["']/.exec(html);
  const buildDir = joinPath(basePath, buildUrlMatch ? buildUrlMatch[1] : "Build");

  const resolve = (expression: string): string => {
    const relative = /buildUrl\s*\+\s*["']([^"']+)["']/.exec(expression);
    if (relative) {
      // The template writes `buildUrl + "/name"`: that leading slash is a
      // separator, not a root-relative path.
      return joinPath(buildDir, relative[1].replace(/^\/+/, ""));
    }
    const literal = /["']([^"']+)["']/.exec(expression);
    return literal ? joinPath(basePath, literal[1]) : "";
  };

  const field = (name: string): string => {
    const match = new RegExp(`${name}\\s*[:=]\\s*([^,;\\n}]+)`).exec(html);
    return match ? resolve(match[1]) : "";
  };

  const loaderUrl = field("loaderUrl");
  const dataUrl = field("dataUrl");
  const frameworkUrl = field("frameworkUrl");
  const codeUrl = field("codeUrl");

  if (!loaderUrl || !dataUrl || !frameworkUrl || !codeUrl) {
    throw new Error(
      "Unity index.html did not declare loaderUrl, dataUrl, frameworkUrl and codeUrl",
    );
  }

  const streaming = /streamingAssetsUrl\s*:\s*["']([^"']+)["']/.exec(html);
  const stringField = (name: string): string | undefined => {
    const match = new RegExp(`${name}\\s*:\\s*["']([^"']*)["']`).exec(html);
    return match ? match[1] : undefined;
  };
  const company = stringField("companyName");
  const product = stringField("productName");
  const version = stringField("productVersion");

  return {
    loaderUrl,
    dataUrl,
    frameworkUrl,
    codeUrl,
    ...(streaming ? { streamingAssetsUrl: joinPath(basePath, streaming[1]) } : {}),
    ...(company !== undefined ? { companyName: company } : {}),
    ...(product !== undefined ? { productName: product } : {}),
    ...(version !== undefined ? { productVersion: version } : {}),
  };
}

/** True when a Unity build looks deployed at this path. Cheap, and cached. */
export async function unityBuildAvailable(
  basePath = DEFAULT_UNITY_BASE_PATH,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(`${basePath.replace(/\/+$/, "")}/index.html`, {
      method: "GET",
      cache: "no-cache",
    });
    if (!response.ok) {
      return false;
    }
    const html = await response.text();
    parseUnityIndexHtml(html, basePath);
    return true;
  } catch {
    return false;
  }
}

export interface UnityHostOptions {
  basePath?: string;
  timeoutMs?: number;
  onProgress?: (progress: number) => void;
}

/**
 * One Unity player: load it, talk to it, shut it down.
 *
 * `load` resolves only once the scene has called back through the jslib
 * bridge, so a renderer that awaits it knows Unity is ready for frames rather
 * than merely downloaded.
 */
export class UnityHost {
  private readonly basePath: string;
  private readonly timeoutMs: number;
  private readonly onProgress: ((progress: number) => void) | undefined;

  private instance: UnityInstance | null = null;
  private script: HTMLScriptElement | null = null;
  private ready = false;
  private failed: Error | null = null;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((error: Error) => void) | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private previousHost: Window["__rocketHost"];

  constructor(options: UnityHostOptions = {}) {
    this.basePath = options.basePath ?? DEFAULT_UNITY_BASE_PATH;
    this.timeoutMs = options.timeoutMs ?? UNITY_LOAD_TIMEOUT_MS;
    this.onProgress = options.onProgress;
  }

  get isReady(): boolean {
    return this.ready;
  }

  async load(canvas: HTMLCanvasElement): Promise<void> {
    const readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    // Register the bridge target before anything Unity-side can call it.
    this.previousHost = window.__rocketHost;
    window.__rocketHost = {
      onReady: () => this.handleReady(),
      onError: (message: string) => this.handleError(new Error(message || "Unity reported an error")),
    };

    this.timeout = setTimeout(() => {
      this.handleError(
        new Error(`Unity did not report ready within ${Math.round(this.timeoutMs / 1000)} s`),
      );
    }, this.timeoutMs);

    // Deliberately not awaited inline: the ready promise is what this resolves
    // on, and it settles on ready, on error, or on the timeout. Awaiting the
    // download sequence here instead would let a loader script that never
    // fires an event hang the launch view past the timeout.
    void this.startSequence(canvas);

    await readyPromise;
  }

  private async startSequence(canvas: HTMLCanvasElement): Promise<void> {
    try {
      const response = await fetch(`${this.basePath.replace(/\/+$/, "")}/index.html`, {
        cache: "no-cache",
      });
      if (!response.ok) {
        throw new Error(`Unity build not found at ${this.basePath} (${response.status})`);
      }
      const config = parseUnityIndexHtml(await response.text(), this.basePath);
      await this.loadScript(config.loaderUrl);

      const create = window.createUnityInstance;
      if (!create) {
        throw new Error("Unity loader did not define createUnityInstance");
      }
      const instance = await create(canvas, { ...config }, (progress) => {
        this.onProgress?.(progress);
      });
      if (this.failed) {
        // The load already gave up; do not leave an orphaned player running.
        void instance.Quit();
        return;
      }
      this.instance = instance;
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  send(method: string, value?: string): void {
    if (!this.ready || !this.instance) {
      return;
    }
    try {
      this.instance.SendMessage("SimBridge", method, value ?? "");
    } catch (error) {
      // A player that has already crashed should not take the app with it.
      console.error(`UnityHost: SendMessage(${method}) failed`, error);
    }
  }

  async dispose(): Promise<void> {
    this.clearTimeout();
    if (window.__rocketHost && this.previousHost === undefined) {
      delete window.__rocketHost;
    } else if (this.previousHost !== undefined) {
      window.__rocketHost = this.previousHost;
    }
    this.script?.remove();
    this.script = null;
    const instance = this.instance;
    this.instance = null;
    this.ready = false;
    if (instance) {
      try {
        await instance.Quit();
      } catch (error) {
        console.error("UnityHost: Quit failed", error);
      }
    }
  }

  private loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load the Unity loader at ${src}`));
      document.body.appendChild(script);
      this.script = script;
    });
  }

  private handleReady(): void {
    if (this.failed || this.ready) {
      return;
    }
    this.clearTimeout();
    this.ready = true;
    this.onProgress?.(1);
    this.resolveReady?.();
    this.resolveReady = null;
    this.rejectReady = null;
  }

  private handleError(error: Error): void {
    if (this.ready || this.failed) {
      return;
    }
    this.clearTimeout();
    this.failed = error;
    this.rejectReady?.(error);
    this.resolveReady = null;
    this.rejectReady = null;
  }

  private clearTimeout(): void {
    if (this.timeout !== null) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }
}
