import { afterEach, describe, expect, it, vi } from "vitest";

import { isWebGLAvailable, resetWebGLAvailabilityForTests } from "../webgl";

describe("isWebGLAvailable", () => {
  afterEach(() => {
    resetWebGLAvailabilityForTests();
    vi.unstubAllGlobals();
  });

  it("returns false without a document and does not throw", () => {
    expect(isWebGLAvailable()).toBe(false);
    expect(isWebGLAvailable()).toBe(false);
  });

  it("probes getContext only once", () => {
    resetWebGLAvailabilityForTests();
    let calls = 0;
    const canvas = {
      getContext: () => {
        calls += 1;
        return {};
      },
    };
    vi.stubGlobal("WebGLRenderingContext", function WebGLRenderingContext() {});
    vi.stubGlobal("document", { createElement: () => canvas });
    expect(isWebGLAvailable()).toBe(true);
    expect(isWebGLAvailable()).toBe(true);
    expect(calls).toBe(1);
  });
});
