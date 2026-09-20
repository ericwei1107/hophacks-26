/**
 * The renderer contract. These are the only shapes that cross from the
 * simulation into a launch renderer, three.js or Unity alike.
 *
 * Two rules hold everything together:
 *  1. Unity never simulates. It draws exactly the state in a RenderFrame.
 *  2. Nothing Earth-centered is ever sent. Unity runs on 32-bit floats, and
 *     Earth-scale coordinates lose metre-level precision there, so every
 *     vector here is expressed relative to the rocket itself.
 */

export type Vec3 = [number, number, number];
/** x, y, z, w. */
export type Quat = [number, number, number, number];

/**
 * Produced by the sim from the player's build. A renderer assembles the
 * vehicle from this and never re-derives dimensions from slider values.
 * All distances are metres, measured from the base of the stack upward.
 */
export interface RocketGeometry {
  /** Body diameter, m. */
  diameter: number;
  /** Booster: engine bay, tank and interstage, from the base up. */
  stage1: { length: number; engineCount: number };
  /** Upper stage: `base` is the height of its lowest point above the stack base. */
  stage2: { base: number; length: number };
  /** Fairing and the payload inside it. */
  payload: { base: number; length: number };
  /** One fin: `span` radially outward, `length` is the root chord. */
  fins: { span: number; length: number };
  /** Center of pressure, m from the base. */
  cpFromBase: number;
  /** Full stack height, m — the sum of the three section lengths. */
  totalLength: number;
  /** Stage-1 nozzle exit diameter, m, so plumes scale with the engine. */
  stage1NozzleDiameter: number;
  /** Stage-2 nozzle exit diameter, m. */
  stage2NozzleDiameter: number;
}

/**
 * One frame of flight state, already converted into the renderer's local
 * frame: origin at the rocket's center of mass, +Y up (radially outward),
 * +X east, +Z north.
 */
export interface RenderFrame {
  /** Seconds since liftoff. Negative during the pre-launch ignition hold. */
  t: number;
  /** True after a seek or restart: clear particles and trails. */
  discontinuity: boolean;
  /** 1, 5, 20 … — effects thin out as this rises. */
  playbackSpeed: number;
  /** False while the playback clock is held: freeze effects. */
  playing: boolean;
  stage: 1 | 2;
  /** 0..1. */
  throttle: number;
  /** Metres above sea level, rocket base. */
  altitude: number;
  latDeg: number;
  lonDeg: number;
  /** Speed relative to the air, m/s. */
  speedAir: number;
  mach: number;
  /** Dynamic pressure, Pa. */
  q: number;
  /** Proper acceleration, g. */
  g: number;
  aoaDeg: number;
  /** Center of mass, m from the stack base; moves as propellant burns. */
  comFromBase: number;
  /** Height of the still-attached stack, m; shortens at staging. */
  attachedLength: number;
  /** Body to local frame, already in renderer axes. */
  attitude: Quat;
  /** Velocity relative to the air, m/s, renderer axes. */
  velLocal: Vec3;
  /** Rocket to Earth center, renderer axes. */
  earthCenterLocal: Vec3;
  /** Orientation of the Earth mesh in the local frame, renderer axes. */
  earthQuat: Quat;
  /**
   * Orientation of the sim's inertial frame in the local frame, renderer axes.
   * Lets a renderer place inertial-frame geometry — the trajectory trail, the
   * ground track, the max-Q marker — without being handed a live
   * Earth-centered coordinate every frame: it converts that static geometry
   * once with `enuVecToRenderer` and then only moves a group transform. Like
   * `earthQuat`, it assumes its geometry is already in renderer axes; it
   * differs from `earthQuat` only by the Earth's own spin. Unity ignores it.
   */
  inertialQuat: Quat;
  /** Unit vector toward the sun, renderer axes. */
  sunDirLocal: Vec3;
  /** Spent stage 1 relative to the rocket, or null before separation. */
  stage1Spent: null | { posLocal: Vec3; attitude: Quat };
  /**
   * The Moon, relative to the rocket, renderer axes. Always present (the
   * Moon is always somewhere), but always at a range-compressed distance —
   * see `rangeCompressionFactor`. `radiusM` is the Moon's true radius,
   * uncompressed: only distance is compressed, matching
   * LUNAR_MISSION_PLAN.md §6.1's "bodies keep true radii" rule.
   */
  moon: { posLocal: Vec3; quat: Quat; radiusM: number };
  /**
   * How much `moon.posLocal`'s distance was compressed relative to the true
   * Earth-Moon geometry (1 = uncompressed). A renderer that draws other
   * far-field geometry (a transfer-arc trail, say) should apply the same
   * factor for a consistent scale bar; only the Moon does today.
   */
  rangeCompressionFactor: number;
  /** Events crossed since the previous frame, e.g. "max_q", "separation". */
  events: string[];
}

/** Playback state the sim cannot know, supplied by the PlaybackController. */
export interface PlaybackState {
  /** Playback position in seconds; may be negative during the ignition hold. */
  t: number;
  discontinuity: boolean;
  playbackSpeed: number;
  playing: boolean;
  events: string[];
  /** The flight's seed — the Moon's ephemeris phase is derived from it (see `moonEpochPhaseRad`) so its rendered position is stable and replay-deterministic. */
  seed: number;
  /**
   * Visual throttle override for the pre-launch ignition hold, when the
   * recording has not started yet. 0..1, or null to use the recorded value.
   */
  throttleOverride?: number | null;
}

const VEC_FIELDS = ["velLocal", "earthCenterLocal", "sunDirLocal"] as const;
const QUAT_FIELDS = ["attitude", "earthQuat", "inertialQuat"] as const;
const NUMBER_FIELDS = [
  "t", "playbackSpeed", "stage", "throttle", "altitude", "latDeg", "lonDeg",
  "speedAir", "mach", "q", "g", "aoaDeg", "comFromBase", "attachedLength",
  "rangeCompressionFactor",
] as const;

/**
 * Names every non-finite field in a frame. A renderer must refuse to send a
 * frame that fails this and hold the previous one instead: a single NaN
 * reaching Unity poisons transforms for the rest of the flight.
 */
export function nonFiniteFields(frame: RenderFrame): string[] {
  const bad: string[] = [];
  for (const key of NUMBER_FIELDS) {
    if (!Number.isFinite(frame[key])) {
      bad.push(key);
    }
  }
  for (const key of VEC_FIELDS) {
    frame[key].forEach((v, i) => {
      if (!Number.isFinite(v)) bad.push(`${key}[${i}]`);
    });
  }
  for (const key of QUAT_FIELDS) {
    frame[key].forEach((v, i) => {
      if (!Number.isFinite(v)) bad.push(`${key}[${i}]`);
    });
  }
  const spent = frame.stage1Spent;
  if (spent) {
    spent.posLocal.forEach((v, i) => {
      if (!Number.isFinite(v)) bad.push(`stage1Spent.posLocal[${i}]`);
    });
    spent.attitude.forEach((v, i) => {
      if (!Number.isFinite(v)) bad.push(`stage1Spent.attitude[${i}]`);
    });
  }
  frame.moon.posLocal.forEach((v, i) => {
    if (!Number.isFinite(v)) bad.push(`moon.posLocal[${i}]`);
  });
  frame.moon.quat.forEach((v, i) => {
    if (!Number.isFinite(v)) bad.push(`moon.quat[${i}]`);
  });
  if (!Number.isFinite(frame.moon.radiusM)) {
    bad.push("moon.radiusM");
  }
  return bad;
}
