import { describe, expect, it } from "vitest";

import { validateRocketPresets } from "./rocketPresets";

describe("rocket preset validation", () => {
  it("rejects settings outside the canonical RocketConfig schema", () => {
    expect(() => validateRocketPresets([{
      id: "invalid-key",
      name: "Invalid",
      tier: "historical",
      summary: "Test fixture.",
      status: "UNVERIFIED",
      sources: [],
      settings: { motorImpulseNs: 1 },
    }])).toThrow("unknown settings key: motorImpulseNs");
  });
});
