// @vitest-environment jsdom
/**
 * The load path's failure modes are the whole reason the three.js fallback
 * exists, so they are worth pinning down: a missing build, an index.html that
 * is not a Unity build, and a player that downloads but never reports ready.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { UnityHost } from "../UnityHost";

function mockFetch(handler: () => Partial<Response> | Promise<Partial<Response>>): void {
  vi.stubGlobal("fetch", vi.fn(async () => handler() as Response));
}

const UNITY_INDEX = `
  var buildUrl = "Build";
  var loaderUrl = buildUrl + "/RocketRenderer.loader.js";
  var config = {
    dataUrl: buildUrl + "/RocketRenderer.data",
    frameworkUrl: buildUrl + "/RocketRenderer.framework.js",
    codeUrl: buildUrl + "/RocketRenderer.wasm",
  };
`;

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.__rocketHost;
  document.querySelectorAll("script").forEach((s) => s.remove());
});

describe("UnityHost", () => {
  it("registers the bridge target before anything can call into it", () => {
    mockFetch(() => ({ ok: true, text: async () => UNITY_INDEX }));
    const host = new UnityHost({ timeoutMs: 50 });
    const canvas = document.createElement("canvas");
    const pending = host.load(canvas).catch(() => {});
    // Synchronously after load() is entered, before any await settles.
    expect(window.__rocketHost).toBeDefined();
    return pending;
  });

  it("rejects when the build is not deployed", async () => {
    mockFetch(() => ({ ok: false, status: 404, text: async () => "" }));
    const host = new UnityHost({ timeoutMs: 5_000 });
    await expect(host.load(document.createElement("canvas"))).rejects.toThrow(/not found/);
  });

  it("rejects when index.html is served but is not a Unity build", async () => {
    mockFetch(() => ({ ok: true, text: async () => "<html>not unity</html>" }));
    const host = new UnityHost({ timeoutMs: 5_000 });
    await expect(host.load(document.createElement("canvas"))).rejects.toThrow(/did not declare/);
  });

  it("rejects when the player never reports ready", async () => {
    mockFetch(() => ({ ok: true, text: async () => UNITY_INDEX }));
    const host = new UnityHost({ timeoutMs: 40 });
    await expect(host.load(document.createElement("canvas"))).rejects.toThrow(/within 0 s|did not report ready/);
    expect(host.isReady).toBe(false);
  });

  it("resolves once the jslib bridge reports ready", async () => {
    mockFetch(() => ({ ok: true, text: async () => UNITY_INDEX }));
    const host = new UnityHost({ timeoutMs: 5_000 });
    const loading = host.load(document.createElement("canvas"));
    // Stand in for the scene calling RocketBridge_Ready().
    await Promise.resolve();
    window.__rocketHost!.onReady();
    await loading;
    expect(host.isReady).toBe(true);
  });

  it("swallows messages sent before the player is ready", () => {
    const host = new UnityHost({ timeoutMs: 50 });
    expect(() => host.send("SetFrame", "{}")).not.toThrow();
  });

  it("restores the window when disposed", async () => {
    mockFetch(() => ({ ok: true, text: async () => UNITY_INDEX }));
    const host = new UnityHost({ timeoutMs: 40 });
    await host.load(document.createElement("canvas")).catch(() => {});
    await host.dispose();
    expect(window.__rocketHost).toBeUndefined();
    expect(document.querySelectorAll("script")).toHaveLength(0);
  });
});
