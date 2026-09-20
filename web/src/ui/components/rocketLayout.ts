/**
 * Visual layout of the vehicle, derived from the same DerivedRocket the
 * physics uses. The assembly preview, the flight scene and the exhaust all
 * read nozzle positions and section heights from here, so the plume always
 * starts where the bells are — including after separation, when the only
 * engine left is the upper stage's.
 *
 * Meters. The base of the full stack is y = 0 and the nose is at +Y.
 */

import type { ComponentKind, DerivedRocket, RocketComponent } from "../../domain/derive";

export interface EngineSlot {
  x: number;
  z: number;
}

export interface Section {
  yBottom: number;
  yTop: number;
  length: number;
}

export interface RocketLayout {
  radius: number;
  diameter: number;
  totalLength: number;
  fairing: Section & { coneLength: number; barrelLength: number };
  stage2Tank: Section;
  stage2Bay: Section;
  interstage: Section;
  stage1Tank: Section;
  stage1Bay: Section;
  /** Bottom of the stage-2 engine bay: the base of what stays attached after separation. */
  stage2BaseY: number;
  /** Top of the interstage: the top of what falls away at separation. */
  stage1TopY: number;
  stage1: {
    slots: EngineSlot[];
    nozzleRadius: number;
    throatRadius: number;
    bellLength: number;
    /** Where the bell's throat sits (top of the bell). */
    throatY: number;
    /** Nozzle exit plane: where the plume starts. */
    exitY: number;
  };
  stage2: {
    slot: EngineSlot;
    nozzleRadius: number;
    throatRadius: number;
    bellLength: number;
    throatY: number;
    exitY: number;
  };
}

function section(c: RocketComponent | undefined, total: number): Section {
  if (!c) {
    return { yBottom: 0, yTop: 0, length: 0 };
  }
  const yTop = total - c.xStartM;
  return { yBottom: yTop - c.lengthM, yTop, length: c.lengthM };
}

/**
 * Engine positions on the base plate. One engine sits on the axis; up to six
 * form a ring; seven and nine add a centre engine to a ring of six or eight.
 */
export function engineSlots(count: number, bodyRadius: number, nozzleRadius: number): EngineSlot[] {
  const n = Math.max(1, Math.round(count));
  if (n === 1) {
    return [{ x: 0, z: 0 }];
  }
  const withCenter = n === 7 || n === 9;
  const ringCount = withCenter ? n - 1 : n;
  const ring = Math.max(0, bodyRadius - nozzleRadius * 1.02);
  const slots: EngineSlot[] = [];
  for (let i = 0; i < ringCount; i++) {
    const a = (i / ringCount) * Math.PI * 2;
    slots.push({ x: Math.cos(a) * ring, z: Math.sin(a) * ring });
  }
  if (withCenter) {
    slots.push({ x: 0, z: 0 });
  }
  return slots;
}

export function rocketLayout(rocket: DerivedRocket): RocketLayout {
  const total = rocket.totalLengthM;
  const r = rocket.diameterM / 2;
  const find = (kind: ComponentKind) => rocket.components.find((c) => c.kind === kind);

  const fairingSection = section(find("fairing"), total);
  const coneLength = Math.min(fairingSection.length * 0.5, 1.7 * r);
  const fairing = {
    ...fairingSection,
    coneLength,
    barrelLength: Math.max(0.05, fairingSection.length - coneLength),
  };
  const stage2Tank = section(find("stage2-tank"), total);
  const stage2Bay = section(find("stage2-engine"), total);
  const interstage = section(find("interstage"), total);
  const stage1Tank = section(find("stage1-tank"), total);
  const stage1Bay = section(find("stage1-engine"), total);

  const stage1NozzleR = rocket.stage1.engine.nozzleDiameterM / 2;
  const stage1Bell = stage1NozzleR * 2.2;
  const stage1ThroatY = stage1Bay.yBottom + stage1Bay.length * 0.35;

  const stage2NozzleR = rocket.stage2.engine.nozzleDiameterM / 2;
  // The upper-stage bell hangs inside the interstage; it never reaches the
  // stage-1 tank dome below it.
  const stage2ThroatY = stage2Bay.yBottom + stage2Bay.length * 0.6;
  const stage2Bell = Math.max(
    0.2,
    Math.min(stage2NozzleR * 2.2, stage2ThroatY - interstage.yBottom - 0.15),
  );

  return {
    radius: r,
    diameter: rocket.diameterM,
    totalLength: total,
    fairing,
    stage2Tank,
    stage2Bay,
    interstage,
    stage1Tank,
    stage1Bay,
    stage2BaseY: stage2Bay.yBottom,
    stage1TopY: interstage.yTop,
    stage1: {
      slots: engineSlots(rocket.stage1.engineCount, r, stage1NozzleR),
      nozzleRadius: stage1NozzleR,
      throatRadius: stage1NozzleR * 0.42,
      bellLength: stage1Bell,
      throatY: stage1ThroatY,
      exitY: stage1ThroatY - stage1Bell,
    },
    stage2: {
      slot: { x: 0, z: 0 },
      nozzleRadius: stage2NozzleR,
      throatRadius: stage2NozzleR * 0.38,
      bellLength: stage2Bell,
      throatY: stage2ThroatY,
      exitY: stage2ThroatY - stage2Bell,
    },
  };
}
