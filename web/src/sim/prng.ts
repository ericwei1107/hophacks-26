/**
 * Specified seeded PRNG and Gaussian transform for the browser.
 *
 * mulberry32 (32-bit seeded uniform) + Box-Muller for Gaussians. This is the
 * game's own generator: no attempt is made to reproduce Python's draws from
 * the same integer seed. Language-parity tests instead replay the explicit
 * perturbation fixtures exported by Python (fixtures/perturbed_cases.json).
 */

/** mulberry32: seeded uniform in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private readonly nextUniform: () => number;
  private spare: number | null = null;

  constructor(seed: number) {
    this.nextUniform = mulberry32(seed);
  }

  /** Uniform in [0, 1). */
  uniform(): number {
    return this.nextUniform();
  }

  /** Uniform in [min, max). */
  uniformRange(min: number, max: number): number {
    return min + (max - min) * this.nextUniform();
  }

  /** Gaussian via Box-Muller with the polar (Marsaglia) method avoided for
   *  simplicity: direct Box-Muller, caching the second draw. */
  gauss(mu = 0, sigma = 1): number {
    if (this.spare !== null) {
      const value = this.spare;
      this.spare = null;
      return mu + sigma * value;
    }
    let u1 = 0;
    while (u1 === 0) {
      u1 = this.nextUniform();
    }
    const u2 = this.nextUniform();
    const magnitude = Math.sqrt(-2 * Math.log(u1));
    this.spare = magnitude * Math.sin(2 * Math.PI * u2);
    return mu + sigma * (magnitude * Math.cos(2 * Math.PI * u2));
  }
}
