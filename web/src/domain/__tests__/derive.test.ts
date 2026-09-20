import { describe, expect, it } from "vitest";

import { referenceConfig, type RocketConfig } from "../config";
import { centerOfMassFromComponents, deriveRocket, enginesFitDiameter } from "../derive";
import { createEngineCatalog, ispAtPressure, thrustAtPressure } from "../engines";

const catalog = createEngineCatalog();

function derive(overrides: Partial<RocketConfig> = {}) {
  return deriveRocket({ ...referenceConfig(), ...overrides }, catalog);
}

describe("engine catalog", () => {
  it("derives mass flow and thrust consistently via F = ṁ·g₀·Isp", () => {
    const booster = catalog.engines.booster;
    expect(booster.massFlowKgS).toBeCloseTo(339.90540432597606, 9);
    expect(booster.vacuumThrustN).toBeCloseTo(1_066_666.6667, 1);
    expect(booster.seaLevelThrustN).toBeCloseTo(950_000, 6);

    const vacuum = catalog.engines.vacuum;
    expect(vacuum.vacuumThrustN).toBeCloseTo(930_000, 6);
    expect(vacuum.seaLevelThrustN).toBeCloseTo(269_565.2174, 1);
  });

  it("interpolates thrust with ambient pressure consistently", () => {
    const booster = catalog.engines.booster;
    const atSeaLevel = thrustAtPressure(booster, 101_325);
    const inVacuum = thrustAtPressure(booster, 0);
    expect(atSeaLevel).toBeCloseTo(booster.seaLevelThrustN, 6);
    expect(inVacuum).toBeCloseTo(booster.vacuumThrustN, 6);
    expect(ispAtPressure(booster, 101_325)).toBeCloseTo(booster.seaLevelIspS, 6);
    expect(ispAtPressure(booster, 0)).toBeCloseTo(booster.vacuumIspS, 6);
  });
});

describe("deriveRocket: reference build", () => {
  const rocket = derive();

  it("reproduces the documented stage dry masses", () => {
    expect(rocket.stage1.dryMassKg).toBe(23_220);
    expect(rocket.stage2.dryMassKg).toBe(5_300);
    expect(rocket.dryMassKg).toBe(34_520);
    expect(rocket.wetMassKg).toBe(364_520);
  });

  it("reproduces the documented performance figures", () => {
    // Calibrated to clear the trans-lunar delta-v requirement (~12.4-12.7
    // km/s, LUNAR_MISSION_PLAN.md §2.2) — see referenceConfig()'s doc comment.
    expect(rocket.liftoffTwr).toBeCloseTo(1.3288, 3);
    expect(rocket.totalIdealDeltaVMs).toBeCloseTo(12_501, -2); // ≈ 12.5 km/s scale
  });

  it("derives geometry from the same calculation", () => {
    expect(rocket.totalLengthM).toBeCloseTo(43.777, 3);
    expect(rocket.slenderness).toBeCloseTo(11.832, 2);
    expect(rocket.dragAreaM2).toBeCloseTo(3.5808, 3);
    expect(rocket.stage1.tankLengthM).toBeCloseTo(25.454, 2);
    expect(rocket.stage2.tankLengthM).toBeCloseTo(6.853, 2);
  });

  it("is stable with a comfortable margin", () => {
    expect(rocket.centerOfMassM).toBeCloseTo(25.041, 2);
    expect(rocket.centerOfPressureM).toBeCloseTo(31.836, 2);
    expect(rocket.staticMargin).toBeGreaterThan(1.0);
    expect(rocket.staticMargin).toBeCloseTo(1.837, 2);
  });

  it("passes all blocking checks", () => {
    expect(rocket.checks.filter((c) => c.severity === "error")).toEqual([]);
    expect(rocket.enginePackingOk).toBe(true);
  });
});

describe("deriveRocket: slider consistency", () => {
  it("updates geometry and mass together when diameter changes", () => {
    const narrow = derive({ diameterM: 2.5 });
    // Same propellant in a narrower tank -> longer rocket.
    expect(narrow.stage1.tankLengthM).toBeGreaterThan(derive().stage1.tankLengthM);
    expect(narrow.slenderness).toBeGreaterThan(derive().slenderness);
    // Smaller frontal area -> less drag area.
    expect(narrow.dragAreaM2).toBeLessThan(derive().dragAreaM2);
    // Lighter fairing per the (d/3.7)^2 rule.
    expect(narrow.dryMassKg).toBeLessThan(derive().dryMassKg);
  });

  it("updates delta-v when tank capacity changes", () => {
    const bigger = derive({ stage1PropellantKg: 300_000 });
    expect(bigger.stage1.idealDeltaVMs).toBeGreaterThan(derive().stage1.idealDeltaVMs);
    // +40 t propellant over the reference's 260 t and +7.2% of it in tank
    // structure.
    expect(bigger.wetMassKg).toBe(407_400);
  });

  it("makes useful payload and payload propellant independent ascent costs", () => {
    const moreMissionMass = derive({ payloadDryMassKg: 5_000 });
    const morePayloadFuel = derive({ payloadPropellantKg: 2_000 });
    expect(moreMissionMass.wetMassKg).toBe(derive().wetMassKg + 1_000);
    expect(morePayloadFuel.wetMassKg).toBe(derive().wetMassKg + 1_000);
    expect(moreMissionMass.totalIdealDeltaVMs).toBeLessThan(derive().totalIdealDeltaVMs);
    expect(morePayloadFuel.totalIdealDeltaVMs).toBeLessThan(derive().totalIdealDeltaVMs);
  });

  it("charges larger fins aerodynamic drag as well as structural mass", () => {
    expect(derive({ finSpanM: 2.5 }).dragAreaM2).toBeGreaterThan(derive({ finSpanM: 1.5 }).dragAreaM2);
  });
});

describe("deriveRocket: blocking checks", () => {
  it("rejects out-of-range values", () => {
    const rocket = derive({ diameterM: 12 });
    expect(rocket.checks.some((c) => c.id === "out_of_range_diameterM" && c.severity === "error")).toBe(true);
  });

  it("rejects a vacuum engine on stage 1", () => {
    const rocket = derive({ stage1Engine: "vacuum" });
    expect(rocket.checks.some((c) => c.id === "stage1_engine_not_sea_level")).toBe(true);
  });

  it("rejects engines that cannot fit", () => {
    const rocket = derive({ stage1EngineCount: 9, diameterM: 1.5 });
    expect(rocket.enginePackingOk).toBe(false);
    expect(rocket.checks.some((c) => c.id === "engine_packing")).toBe(true);
  });

  it("flags excessive slenderness as a warning (launch demonstrates the failure)", () => {
    const rocket = derive({ diameterM: 1.0, stage1PropellantKg: 400_000 });
    expect(rocket.slenderness).toBeGreaterThan(20);
    const check = rocket.checks.find((c) => c.id === "slenderness_limit");
    // Physically assembled but poor designs may still launch; the structural
    // failure happens at liftoff in the solver, not at build time.
    expect(check?.severity).toBe("warning");
  });
});

describe("deriveRocket: stability model", () => {
  it("is unstable without fins", () => {
    const rocket = derive({ finSpanM: 0 });
    expect(rocket.staticMargin).toBeLessThan(0);
    expect(rocket.checks.some((c) => c.id === "static_margin")).toBe(true);
  });

  it("crosses into stability near 1.8 m of fin span", () => {
    expect(derive({ finSpanM: 1.5 }).staticMargin).toBeLessThan(1.0);
    expect(derive({ finSpanM: 2.0 }).staticMargin).toBeGreaterThan(1.0);
  });

  it("moves the center of mass forward as fuel burns", () => {
    const rocket = derive();
    const burned = rocket.components.map((c) => ({ ...c, propellantKg: 0 }));
    // With tanks empty, CM sits higher (toward the nose).
    const emptyCm = centerOfMassFromComponents(burned);
    expect(emptyCm).toBeLessThan(rocket.centerOfMassM);
  });
});

describe("engine packing", () => {
  it("fits known counts inside the reference diameter", () => {
    expect(enginesFitDiameter(1.4, 4, 3.7)).toBe(true);
    expect(enginesFitDiameter(1.4, 9, 3.7)).toBe(false);
    expect(enginesFitDiameter(2.0, 1, 3.7)).toBe(true);
    expect(enginesFitDiameter(2.0, 1, 1.5)).toBe(false);
  });
});
