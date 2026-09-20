/**
 * Small procedural-texture helpers shared by the Earth albedo and the launch
 * site terrain. Everything is seeded so a texture looks the same on every
 * launch and every replay.
 */

export function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** Tileable greyscale value noise, `size` pixels square. */
export function noiseTile(size = 256, seed = 1, octaves = 4): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const rand = seededRandom(seed);

  const lattices: { n: number; values: Float32Array }[] = [];
  for (let o = 0; o < octaves; o++) {
    const n = 6 * 2 ** o;
    const values = new Float32Array(n * n);
    for (let i = 0; i < values.length; i++) {
      values[i] = rand();
    }
    lattices.push({ n, values });
  }

  const smooth = (t: number) => t * t * (3 - 2 * t);
  const data = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let value = 0;
      let amplitude = 0.5;
      let total = 0;
      for (const { n, values } of lattices) {
        const fx = (x / size) * n;
        const fy = (y / size) * n;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = smooth(fx - x0);
        const ty = smooth(fy - y0);
        const x1 = (x0 + 1) % n;
        const y1 = (y0 + 1) % n;
        const v00 = values[y0 * n + x0];
        const v10 = values[y0 * n + x1];
        const v01 = values[y1 * n + x0];
        const v11 = values[y1 * n + x1];
        const v = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
        value += v * amplitude;
        total += amplitude;
        amplitude *= 0.5;
      }
      const g = Math.round((value / total) * 255);
      const i = (y * size + x) * 4;
      data[i] = g;
      data[i + 1] = g;
      data[i + 2] = g;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Composite a noise tile across a canvas with the given blend mode. */
export function overlayNoise(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  tile: HTMLCanvasElement,
  alpha: number,
  operation: GlobalCompositeOperation = "overlay",
  scale = 1,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = operation;
  const w = tile.width * scale;
  const h = tile.height * scale;
  for (let y = 0; y < height; y += h) {
    for (let x = 0; x < width; x += w) {
      ctx.drawImage(tile, x, y, w, h);
    }
  }
  ctx.restore();
}

/** Fade a canvas's alpha to zero from `innerFraction` of its half-size to the edge. */
export function fadeEdges(ctx: CanvasRenderingContext2D, size: number, innerFraction: number): void {
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, half * innerFraction, half, half, half);
  gradient.addColorStop(0, "rgba(0,0,0,1)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.save();
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();
}
