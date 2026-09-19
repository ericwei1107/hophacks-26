import { describe, expect, it } from "vitest";

import { EARTH_RADIUS, MU_EARTH } from "../../physics/constants";
import { norm, sub, vec3 } from "../../physics/vec3";
import { findSoiEncounter, phasedMoonEpoch } from "../coast";
import { MOON_SOI_RADIUS_M, moonPositionEci } from "../moon";
import { transferRequirement } from "../transfer";

describe("phasedMoonEpoch + findSoiEncounter", () => {
  const parkingRadiusM = EARTH_RADIUS + 200_000;
  const vCircular = Math.sqrt(MU_EARTH / parkingRadiusM);
  const requirement = transferRequirement(parkingRadiusM);

  it("a correctly phased, nominal-energy burn reaches the Moon's SOI", () => {
    const ignitionPosition = vec3(parkingRadiusM, 0, 0);
    const ignitionAbsoluteTimeS = 0;
    const epoch = phasedMoonEpoch(ignitionPosition, ignitionAbsoluteTimeS, requirement.timeOfFlightS);

    const postBurnVelocity = vec3(0, vCircular + requirement.deltaVRequiredMs, 0);
    const encounter = findSoiEncounter(ignitionPosition, postBurnVelocity, ignitionAbsoluteTimeS, epoch);

    expect(encounter).not.toBeNull();
    expect(encounter!.tSinceIgnitionS).toBeGreaterThan(0);
    // Arrives close to the nominal Hohmann time of flight (within a day —
    // the SOI is entered somewhat before apogee, not exactly at it).
    expect(Math.abs(encounter!.tSinceIgnitionS - requirement.timeOfFlightS)).toBeLessThan(86_400);

    const distanceAtEncounter = norm(sub(vec3(), encounter!.vehiclePositionEci, encounter!.moonPositionEci));
    expect(distanceAtEncounter).toBeCloseTo(MOON_SOI_RADIUS_M, -3);
  });

  it("an arbitrary (unphased) epoch generally does not produce an encounter", () => {
    const ignitionPosition = vec3(parkingRadiusM, 0, 0);
    const postBurnVelocity = vec3(0, vCircular + requirement.deltaVRequiredMs, 0);
    // A phase deliberately 90 degrees off from correct: the Moon is nowhere
    // near the transfer orbit's apogee at arrival time.
    const badEpoch = phasedMoonEpoch(ignitionPosition, 0, requirement.timeOfFlightS) + Math.PI / 2;
    const encounter = findSoiEncounter(ignitionPosition, postBurnVelocity, 0, badEpoch);
    expect(encounter).toBeNull();
  });

  it("a large delta-v shortfall never reaches the Moon's distance, let alone the SOI", () => {
    const ignitionPosition = vec3(parkingRadiusM, 0, 0);
    const epoch = phasedMoonEpoch(ignitionPosition, 0, requirement.timeOfFlightS);
    const shortfallVelocity = vec3(0, vCircular + requirement.deltaVRequiredMs * 0.5, 0);
    const encounter = findSoiEncounter(ignitionPosition, shortfallVelocity, 0, epoch);
    expect(encounter).toBeNull();
  });

  it("phasedMoonEpoch places the Moon along the apogee direction at arrival", () => {
    const ignitionPosition = vec3(parkingRadiusM, 0, 0);
    const epoch = phasedMoonEpoch(ignitionPosition, 0, requirement.timeOfFlightS);
    const moonAtArrival = moonPositionEci(vec3(), requirement.timeOfFlightS, epoch);
    // Apogee direction is opposite the ignition position (Hohmann geometry).
    const angle = Math.atan2(moonAtArrival[1], moonAtArrival[0]);
    expect(Math.abs(angle - Math.PI)).toBeLessThan(1e-6);
  });
});
