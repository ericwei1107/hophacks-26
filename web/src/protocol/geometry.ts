/**
 * RocketGeometry from the same DerivedRocket the physics uses. Renderers
 * assemble the vehicle from this; nothing downstream re-derives dimensions
 * from the player's slider values.
 *
 * DerivedRocket measures everything from the nose. RocketGeometry measures
 * from the base, because that is where a renderer stands the vehicle up.
 */

import type { DerivedRocket } from "../domain/derive";
import type { RocketGeometry } from "./types";

export function toRocketGeometry(rocket: DerivedRocket): RocketGeometry {
  const total = rocket.totalLengthM;
  const lengthOf = (kind: string): number =>
    rocket.components.find((c) => c.kind === kind)?.lengthM ?? 0;

  const fairing = lengthOf("fairing");
  const stage2Tank = lengthOf("stage2-tank");
  const stage2Engine = lengthOf("stage2-engine");
  const interstage = lengthOf("interstage");
  const stage1Tank = lengthOf("stage1-tank");
  const stage1Engine = lengthOf("stage1-engine");

  // Base upward: stage-1 engine bay, stage-1 tank, interstage | stage-2 engine
  // bay, stage-2 tank | fairing.
  const stage1Length = stage1Engine + stage1Tank + interstage;
  const stage2Length = stage2Engine + stage2Tank;

  return {
    diameter: rocket.diameterM,
    stage1: { length: stage1Length, engineCount: rocket.stage1.engineCount },
    stage2: { base: stage1Length, length: stage2Length },
    payload: { base: stage1Length + stage2Length, length: fairing },
    fins: { span: rocket.fins.spanM, length: rocket.fins.rootChordM },
    cpFromBase: total - rocket.centerOfPressureM,
    totalLength: total,
    stage1NozzleDiameter: rocket.stage1.engine.nozzleDiameterM,
    stage2NozzleDiameter: rocket.stage2.engine.nozzleDiameterM,
  };
}
