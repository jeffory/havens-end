import { kmeans } from './kmeans';
import { createRaster, type Raster } from './raster';

export type Rgb = [number, number, number];

/** Pixels with alpha below this are treated as background everywhere in assetgen. */
export const ALPHA_CUTOFF = 128;

/** Samples beyond this are strided; k-means on ~40k colours is plenty for a palette. */
const MAX_SAMPLES = 40_000;

/**
 * Up to `n` representative colours of the opaque pixels. An image that already has `n`
 * or fewer colours returns exactly those.
 */
export function kmeansPalette(r: Raster, n: number): Rgb[] {
  const opaque = opaqueRgb(r);
  const unique = uniqueTriples(opaque);
  if (unique.length <= n) return unique;

  const stride = Math.max(1, Math.ceil(opaque.length / 3 / MAX_SAMPLES));
  const sample: number[] = [];
  for (let i = 0; i < opaque.length / 3; i += stride) sample.push(opaque[i * 3], opaque[i * 3 + 1], opaque[i * 3 + 2]);

  const { centroids, counts } = kmeans(sample, n, 16);
  const out: Rgb[] = [];
  for (let c = 0; c < counts.length; c++) {
    if (counts[c] === 0) continue;
    out.push([Math.round(centroids[c * 3]), Math.round(centroids[c * 3 + 1]), Math.round(centroids[c * 3 + 2])]);
  }
  return uniqueTriples(out.flat());
}

/** Maps each opaque pixel to its nearest palette colour; alpha becomes 0 or 255. */
export function quantize(r: Raster, palette: Rgb[]): Raster {
  const out = createRaster(r.width, r.height);
  const cache = new Map<number, number>();
  for (let i = 0; i < r.data.length; i += 4) {
    if (r.data[i + 3] < ALPHA_CUTOFF) continue;
    const key = (r.data[i] << 16) | (r.data[i + 1] << 8) | r.data[i + 2];
    let index = cache.get(key);
    if (index === undefined) {
      index = nearest(palette, r.data[i], r.data[i + 1], r.data[i + 2]);
      cache.set(key, index);
    }
    out.data.set([...palette[index], 255], i);
  }
  return out;
}

/** Number of different colours among opaque pixels. */
export function distinctColours(r: Raster): number {
  const seen = new Set<number>();
  for (let i = 0; i < r.data.length; i += 4) {
    if (r.data[i + 3] >= ALPHA_CUTOFF) seen.add((r.data[i] << 16) | (r.data[i + 1] << 8) | r.data[i + 2]);
  }
  return seen.size;
}

/** A palette file: one `#rrggbb` (or `rrggbb`) per line; anything else is ignored. */
export function parsePalette(text: string): Rgb[] {
  const out: Rgb[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^#?([0-9a-f]{6})$/i.exec(line.trim());
    if (!m) continue;
    const v = parseInt(m[1], 16);
    out.push([(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
  }
  return out;
}

/** Index of the closest colour by "redmean" distance, a cheap perceptual weighting. */
export function nearest(palette: Rgb[], r: number, g: number, b: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const [pr, pg, pb] = palette[i];
    const rm = (r + pr) / 2;
    const dr = r - pr;
    const dg = g - pg;
    const db = b - pb;
    const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function opaqueRgb(r: Raster): number[] {
  const out: number[] = [];
  for (let i = 0; i < r.data.length; i += 4) {
    if (r.data[i + 3] >= ALPHA_CUTOFF) out.push(r.data[i], r.data[i + 1], r.data[i + 2]);
  }
  return out;
}

function uniqueTriples(rgb: number[]): Rgb[] {
  const seen = new Map<number, Rgb>();
  for (let i = 0; i < rgb.length; i += 3) {
    const key = (rgb[i] << 16) | (rgb[i + 1] << 8) | rgb[i + 2];
    if (!seen.has(key)) seen.set(key, [rgb[i], rgb[i + 1], rgb[i + 2]]);
  }
  return [...seen.values()];
}
