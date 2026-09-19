/**
 * Unity's build file names change with the version and the compression
 * settings, which is exactly why they are read from the build's own
 * index.html rather than hard-coded. These cover the shapes Unity actually
 * emits.
 */

import { describe, expect, it, vi } from "vitest";

import { parseUnityIndexHtml, unityBuildAvailable } from "../UnityHost";

const UNCOMPRESSED = `
<script>
  var buildUrl = "Build";
  var loaderUrl = buildUrl + "/RocketRenderer.loader.js";
  var config = {
    arguments: [],
    dataUrl: buildUrl + "/RocketRenderer.data",
    frameworkUrl: buildUrl + "/RocketRenderer.framework.js",
    codeUrl: buildUrl + "/RocketRenderer.wasm",
    streamingAssetsUrl: "StreamingAssets",
    companyName: "Apogee",
    productName: "RocketRenderer",
    productVersion: "0.1.0",
  };
</script>
`;

const BROTLI = `
<script>
  var buildUrl = "Build";
  var loaderUrl = buildUrl + "/web.loader.js";
  var config = {
    dataUrl: buildUrl + "/web.data.br",
    frameworkUrl: buildUrl + "/web.framework.js.br",
    codeUrl: buildUrl + "/web.wasm.br",
    streamingAssetsUrl: "StreamingAssets",
    productName: "RocketRenderer",
  };
</script>
`;

describe("parseUnityIndexHtml", () => {
  it("resolves an uncompressed build against the base path", () => {
    const config = parseUnityIndexHtml(UNCOMPRESSED, "/unity");
    expect(config.loaderUrl).toBe("/unity/Build/RocketRenderer.loader.js");
    expect(config.dataUrl).toBe("/unity/Build/RocketRenderer.data");
    expect(config.frameworkUrl).toBe("/unity/Build/RocketRenderer.framework.js");
    expect(config.codeUrl).toBe("/unity/Build/RocketRenderer.wasm");
    expect(config.streamingAssetsUrl).toBe("/unity/StreamingAssets");
    expect(config.productName).toBe("RocketRenderer");
  });

  it("handles Brotli names and a different product name", () => {
    const config = parseUnityIndexHtml(BROTLI, "/unity/");
    expect(config.dataUrl).toBe("/unity/Build/web.data.br");
    expect(config.codeUrl).toBe("/unity/Build/web.wasm.br");
    expect(config.companyName).toBeUndefined();
  });

  it("refuses an index.html that declares nothing useful", () => {
    expect(() => parseUnityIndexHtml("<html><body>hello</body></html>", "/unity")).toThrow(
      /did not declare/,
    );
  });
});

describe("unityBuildAvailable", () => {
  it("is true when the build is reachable and parseable", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => UNCOMPRESSED,
    }) as unknown as typeof fetch;
    await expect(unityBuildAvailable("/unity", fetchImpl)).resolves.toBe(true);
  });

  it("is false when the files are gone", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "",
    }) as unknown as typeof fetch;
    await expect(unityBuildAvailable("/unity", fetchImpl)).resolves.toBe(false);
  });

  it("is false when the network throws", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
    await expect(unityBuildAvailable("/unity", fetchImpl)).resolves.toBe(false);
  });

  it("is false when index.html is served but is not a Unity build", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "<html>404 page</html>",
    }) as unknown as typeof fetch;
    await expect(unityBuildAvailable("/unity", fetchImpl)).resolves.toBe(false);
  });
});
