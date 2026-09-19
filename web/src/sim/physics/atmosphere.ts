/**
 * Layered atmosphere model.
 *
 * The preserved thermospheric density function (from the Python reference) is
 * a thermospheric approximation and must not be extrapolated to sea level, so
 * the atmosphere is built in three layers:
 *
 * 1. 0–85 km: standard-atmosphere table (US Standard Atmosphere 1976 values),
 *    log-linear interpolation between rows.
 * 2. 85–150 km: transition region — log-density interpolation between the
 *    table value at 85 km and the weather-sensitive value at 150 km.
 * 3. ≥150 km: the preserved weather-sensitive thermospheric function.
 *
 * Both boundaries are continuous by construction. Pressure follows the same
 * blending; above 85 km it is negligible for engine thrust but kept
 * continuous for consistency.
 */

import { estimateAtmosphericDensity } from "../orbital/simulate";
import type { SpaceWeather } from "../orbital/types";

/** altitude km, pressure Pa, density kg/m^3, temperature K */
type AtmosphereRow = [altitudeKm: number, pressurePa: number, densityKgM3: number, temperatureK: number];

const STANDARD_ATMOSPHERE: AtmosphereRow[] = [
  [0, 101_325, 1.225, 288.15],
  [1, 89_876, 1.1117, 281.65],
  [2, 79_501, 1.0066, 275.15],
  [3, 70_121, 0.909_25, 268.66],
  [4, 61_660, 0.819_35, 262.17],
  [5, 54_048, 0.736_43, 255.68],
  [6, 47_217, 0.660_11, 249.19],
  [7, 41_105, 0.590_02, 242.7],
  [8, 35_651, 0.525_79, 236.22],
  [9, 30_800, 0.467_06, 229.73],
  [10, 26_499, 0.413_51, 223.25],
  [11, 22_699, 0.364_8, 216.77],
  [12, 19_399, 0.311_94, 216.65],
  [13, 16_579, 0.266_6, 216.65],
  [14, 14_170, 0.227_86, 216.65],
  [15, 12_111, 0.194_75, 216.65],
  [16, 10_352, 0.166_47, 216.65],
  [17, 8_849.7, 0.142_3, 216.65],
  [18, 7_565.2, 0.121_65, 216.65],
  [19, 6_467.5, 0.104, 216.65],
  [20, 5_529.3, 0.088_91, 216.65],
  [22, 4_047.5, 0.064_51, 218.57],
  [24, 2_971.7, 0.046_938, 220.56],
  [26, 2_188.6, 0.034_257, 222.54],
  [28, 1_616.2, 0.025_047, 224.53],
  [30, 1_197, 0.018_341, 226.51],
  [32, 889.06, 0.013_555, 228.49],
  [34, 662.01, 0.009_887, 230.47],
  [36, 494.31, 0.007_234, 232.45],
  [38, 369.77, 0.005_305, 234.43],
  [40, 277.14, 0.003_896, 236.41],
  [42, 207.97, 0.002_866, 238.39],
  [44, 156.08, 0.002_111, 240.37],
  [46, 117.06, 0.001_556, 242.35],
  [48, 87.867, 0.001_149, 244.33],
  [50, 65.978, 0.000_845, 246.31],
  [55, 31.224, 0.000_383, 251.2],
  [60, 14.957, 0.000_18, 256.1],
  [65, 7.2022, 8.618e-5, 261.0],
  [70, 3.4485, 4.075e-5, 265.9],
  [75, 1.6305, 1.896e-5, 270.8],
  [80, 0.7576, 8.64e-6, 275.7],
  [85, 0.3455, 3.858e-6, 280.6],
];

const TRANSITION_TOP_KM = 150;
/** Representative temperature used to anchor transition-region pressure. */
const TRANSITION_TOP_TEMPERATURE_K = 634;
const SPECIFIC_GAS_CONSTANT = 287.05;

export interface AtmosphereSample {
  altitudeKm: number;
  /** kg/m^3 */
  density: number;
  /** Pa */
  pressure: number;
}

function logInterpolate(h: number, lo: AtmosphereRow, hi: AtmosphereRow, column: 1 | 2): number {
  const fraction = (h - lo[0]) / (hi[0] - lo[0]);
  const logLo = Math.log(lo[column]);
  const logHi = Math.log(hi[column]);
  return Math.exp(logLo + fraction * (logHi - logLo));
}

function tableSample(h: number, column: 1 | 2): number {
  if (h <= 0) {
    return STANDARD_ATMOSPHERE[0][column];
  }
  const last = STANDARD_ATMOSPHERE[STANDARD_ATMOSPHERE.length - 1];
  if (h >= last[0]) {
    return last[column];
  }
  for (let i = 1; i < STANDARD_ATMOSPHERE.length; i++) {
    if (h <= STANDARD_ATMOSPHERE[i][0]) {
      return logInterpolate(h, STANDARD_ATMOSPHERE[i - 1], STANDARD_ATMOSPHERE[i], column);
    }
  }
  return last[column];
}

export class Atmosphere {
  private readonly density85: number;
  private readonly pressure85: number;
  private readonly density150: number;
  private readonly pressure150: number;

  constructor(
    private readonly weather: SpaceWeather,
    private readonly densityScale = 1,
  ) {
    this.density85 = tableSample(85, 2) * densityScale;
    this.pressure85 = tableSample(85, 1);
    this.density150 = estimateAtmosphericDensity(TRANSITION_TOP_KM, weather, 0) * densityScale;
    this.pressure150 = this.density150 * SPECIFIC_GAS_CONSTANT * TRANSITION_TOP_TEMPERATURE_K;
  }

  /** A copy of this atmosphere with density scaled (ascent uncertainty). */
  withDensityScale(scale: number): Atmosphere {
    return new Atmosphere(this.weather, this.densityScale * scale);
  }

  /** Density in kg/m^3 at altitude (km above the launch site). */
  density(altitudeKm: number): number {
    if (!Number.isFinite(altitudeKm)) {
      return 0;
    }
    if (altitudeKm <= 85) {
      return tableSample(Math.max(altitudeKm, 0), 2) * this.densityScale;
    }
    if (altitudeKm >= TRANSITION_TOP_KM) {
      return estimateAtmosphericDensity(altitudeKm, this.weather, 0) * this.densityScale;
    }
    const fraction = (altitudeKm - 85) / (TRANSITION_TOP_KM - 85);
    return Math.exp(
      Math.log(this.density85) + fraction * (Math.log(this.density150) - Math.log(this.density85)),
    );
  }

  /** Pressure in Pa at altitude (km above the launch site). */
  pressure(altitudeKm: number): number {
    if (!Number.isFinite(altitudeKm)) {
      return 0;
    }
    if (altitudeKm <= 85) {
      return tableSample(Math.max(altitudeKm, 0), 1);
    }
    if (altitudeKm >= TRANSITION_TOP_KM) {
      // Above the transition, pressure is negligible for thrust; keep the
      // transition-top value decaying with density for continuity.
      const densityRatio =
        estimateAtmosphericDensity(altitudeKm, this.weather, 0) / this.density150;
      return this.pressure150 * densityRatio;
    }
    const fraction = (altitudeKm - 85) / (TRANSITION_TOP_KM - 85);
    return Math.exp(
      Math.log(this.pressure85) + fraction * (Math.log(this.pressure150) - Math.log(this.pressure85)),
    );
  }

  sample(altitudeKm: number): AtmosphereSample {
    return {
      altitudeKm,
      density: this.density(altitudeKm),
      pressure: this.pressure(altitudeKm),
    };
  }
}
