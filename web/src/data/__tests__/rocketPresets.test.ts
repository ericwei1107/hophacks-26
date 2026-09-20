import { describe, expect, it } from "vitest";

import { ROCKET_PRESETS } from "../rocketPresets";
import { defaultEnvironment, runFlight } from "../../sim/ascent/flight";
import { referenceSnapshot } from "../../sim/orbital/weather";
import { MODEL_VERSION } from "../../domain/version";

describe("rocket presets", () => {
  it.each(ROCKET_PRESETS)("launches the $name configuration", (preset) => {
      const result = runFlight({
        config: { ...preset.settings, modelVersion: MODEL_VERSION },
        environment: defaultEnvironment(referenceSnapshot()),
      });

    expect(result.outcome).not.toBe("invalid_build");
    expect(result.orbitAchieved).toBe(true);
  });
});
