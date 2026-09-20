/**
 * Gate A: the browser mission model must match the Python reference fixtures.
 *
 * Perturbed cases carry explicit inputs exported by Python, so no PRNG
 * parity between the languages is required.
 */

import { describe, expect, it } from "vitest";

import {
  atmosphericRelativeVelocity,
  estimateAtmosphericDensity,
  estimateCollisionAvoidanceDeltaV,
  estimateDisposalDeltaV,
  estimateStationkeepingDeltaV,
  orbitalVelocity,
  simulate,
} from "../simulate";
import type { SimulationResult, SpacecraftMission, SpaceWeather } from "../types";
import {
  correctionsJson,
  loadFixture,
  missionsJson,
  perturbedJson,
  scalarsJson,
  weatherJson,
} from "./fixtures";

/** Python and JS doubles can differ by ~1 ulp in transcendentals. */
const REL_TOL = 1e-12;

function expectClose(actual: number, expected: number) {
  if (expected === 0) {
    expect(Math.abs(actual)).toBeLessThan(1e-15);
    return;
  }
  if (!Number.isFinite(expected)) {
    expect(actual).toBe(expected);
    return;
  }
  expect(Math.abs(actual - expected) / Math.abs(expected)).toBeLessThan(REL_TOL);
}

function expectResult(actual: SimulationResult, expected: SimulationResult) {
  expect(actual.passed).toBe(expected.passed);
  expect(actual.failure_reasons).toEqual(expected.failure_reasons);
  expectClose(actual.available_delta_v, expected.available_delta_v);
  expectClose(actual.required_delta_v, expected.required_delta_v);
  expectClose(actual.drag_delta_v, expected.drag_delta_v);
  expectClose(actual.collision_avoidance_delta_v, expected.collision_avoidance_delta_v);
  expectClose(actual.insertion_delta_v, expected.insertion_delta_v);
  expectClose(actual.disposal_delta_v, expected.disposal_delta_v);
  expectClose(actual.propellant_required, expected.propellant_required);
  expectClose(actual.propellant_consumed, expected.propellant_consumed);
  expectClose(actual.propellant_remaining, expected.propellant_remaining);
  expectClose(actual.initial_altitude, expected.initial_altitude);
  expectClose(actual.final_altitude, expected.final_altitude);
  expectClose(actual.orbital_decay, expected.orbital_decay);
  expectClose(actual.average_density, expected.average_density);
  expectClose(actual.average_drag, expected.average_drag);
}

interface MissionsFixture {
  payload: {
    weather: SpaceWeather;
    cases: { name: string; mission: SpacecraftMission; expected: SimulationResult }[];
  };
}

describe("Python parity: mission outcomes", () => {
  const fixture = loadFixture<MissionsFixture>(missionsJson);

  for (const testCase of fixture.payload.cases) {
    it(`matches the ${testCase.name} mission`, () => {
      const result = simulate(testCase.mission, fixture.payload.weather);
      expectResult(result, testCase.expected);
    });
  }
});

interface ScalarFixture {
  payload: {
    orbital_velocity: { altitude_km: number; value: number }[];
    atmospheric_relative_velocity: {
      altitude_km: number;
      inclination_deg: number;
      value: number;
    }[];
    density: { altitude_km: number; inclination_deg: number; value: number }[];
    disposal_delta_v: { altitude_km: number; value: number }[];
    collision_avoidance_delta_v: {
      altitude_km: number;
      inclination_deg: number;
      area: number;
      lifespan: number;
      cam_scale: number;
      value: number;
    }[];
    stationkeeping: {
      mission: SpacecraftMission;
      altitude_km: number;
      value: number;
    }[];
  };
}

describe("Python parity: scalar helpers", () => {
  const fixture = loadFixture<ScalarFixture>(scalarsJson);
  const weather = loadFixture<{ payload: { weather: SpaceWeather } }>(
    weatherJson,
  ).payload.weather;

  it("matches orbital velocity", () => {
    for (const c of fixture.payload.orbital_velocity) {
      expectClose(orbitalVelocity(c.altitude_km), c.value);
    }
  });

  it("matches atmospheric-relative velocity", () => {
    for (const c of fixture.payload.atmospheric_relative_velocity) {
      expectClose(atmosphericRelativeVelocity(c.altitude_km, c.inclination_deg), c.value);
    }
  });

  it("matches thermospheric density", () => {
    for (const c of fixture.payload.density) {
      expectClose(estimateAtmosphericDensity(c.altitude_km, weather, c.inclination_deg), c.value);
    }
  });

  it("matches disposal delta-v", () => {
    for (const c of fixture.payload.disposal_delta_v) {
      expectClose(estimateDisposalDeltaV(c.altitude_km), c.value);
    }
  });

  it("matches collision-avoidance delta-v", () => {
    for (const c of fixture.payload.collision_avoidance_delta_v) {
      const mission: SpacecraftMission = {
        mass: 750,
        fuel: 200,
        lifespan: c.lifespan,
        target_altitude: c.altitude_km,
        target_inclination: c.inclination_deg,
        cross_section_area: c.area,
        drag_coefficient: 2.2,
        isp: 325,
      };
      expectClose(estimateCollisionAvoidanceDeltaV(mission, c.cam_scale), c.value);
    }
  });

  it("matches stationkeeping delta-v", () => {
    for (const c of fixture.payload.stationkeeping) {
      const mission = { ...c.mission, target_altitude: c.altitude_km };
      const [total] = estimateStationkeepingDeltaV(mission, weather);
      expectClose(total, c.value);
    }
  });
});

interface PerturbedFixture {
  payload: {
    cases: {
      index: number;
      mission: SpacecraftMission;
      weather: SpaceWeather;
      ops: {
        insertion_altitude_error_km: number;
        insertion_inclination_error_deg: number;
        cam_scale: number;
      };
      expected: SimulationResult;
    }[];
  };
}

describe("Python parity: explicit perturbed cases", () => {
  const fixture = loadFixture<PerturbedFixture>(perturbedJson);

  it(`replays all ${fixture.payload.cases.length} perturbed cases`, () => {
    for (const testCase of fixture.payload.cases) {
      const result = simulate(testCase.mission, testCase.weather, testCase.ops);
      try {
        expectResult(result, testCase.expected);
      } catch (error) {
        throw new Error(`perturbed case ${testCase.index} mismatch`, { cause: error });
      }
    }
  });
});

interface CorrectionsFixture {
  payload: Record<
    string,
    {
      mission: SpacecraftMission;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    }
  >;
}

describe("intentional corrections", () => {
  const fixture = loadFixture<CorrectionsFixture>(correctionsJson);
  const weather = loadFixture<{ payload: { weather: SpaceWeather } }>(
    weatherJson,
  ).payload.weather;

  it("matches the corrected (after) behavior", () => {
    for (const correction of Object.values(fixture.payload)) {
      const result = simulate(correction.mission, weather);
      for (const [key, value] of Object.entries(correction.after)) {
        const actual = result[key as keyof SimulationResult];
        if (Array.isArray(value)) {
          expect(actual).toEqual(value);
        } else {
          expectClose(actual as number, value as number);
        }
      }
    }
  });
});
