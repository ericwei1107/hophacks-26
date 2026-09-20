import { describe, expect, it } from "vitest";

import { readRendererPreference, shouldAttemptUnity } from "../selectRenderer";

describe("readRendererPreference", () => {
  it("defaults to auto", () => {
    expect(readRendererPreference("")).toBe("auto");
    expect(readRendererPreference("?other=1")).toBe("auto");
  });

  it("accepts the explicit query values", () => {
    expect(readRendererPreference("?renderer=three")).toBe("three");
    expect(readRendererPreference("?renderer=unity")).toBe("unity");
  });
});

describe("shouldAttemptUnity", () => {
  it("is opt-in so a blank WebGPU player cannot hide the three.js view", () => {
    expect(shouldAttemptUnity("auto")).toBe(false);
    expect(shouldAttemptUnity("three")).toBe(false);
    expect(shouldAttemptUnity("unity")).toBe(true);
  });
});
