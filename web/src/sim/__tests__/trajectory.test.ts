import { describe, expect, it } from "vitest";

import { referenceConfig } from "../../domain/config";
import { defaultEnvironment, runFlight } from "../ascent/flight";
import { EARTH_RADIUS } from "../physics/constants";
import { referenceSnapshot } from "../orbital/weather";
import { createTrajectory } from "../trajectory";

const flight = runFlight({
  config: referenceConfig(),
  environment: defaultEnvironment(referenceSnapshot()),
  seed: 0,
});
const trajectory = createTrajectory(flight.telemetry);

describe("sampleTelemetry near the pad", () => {
  it("never interpolates the stack through the Earth", () => {
    for (let t = 0; t <= 2; t += 0.01) {
      const sample = trajectory.sampleAt(t);
      const r = Math.hypot(...sample.positionEciM);
      expect(r).toBeGreaterThanOrEqual(EARTH_RADIUS - 1e-6);
      expect(sample.altitudeKm).toBeGreaterThanOrEqual(0);
    }
  });
});
