import { kmeans } from './kmeans';
import { createRaster, type Raster } from './raster';

/**
 * 'dominant': each output pixel is its cell's largest colour cluster (clean, flat).
 * 'detail': a strongly contrasting cluster covering a real share of the cell wins
 * instead, darker ones first, so thin lines such as mortar, plank gaps and outlines
 * survive the reduction the way a pixel artist would keep them.
 */
export type DownscaleMode = 'dominant' | 'detail';

/** A minority cluster must cover this share of the cell to count as a feature. */
const FEATURE_SHARE = 0.2;
/** …and differ from the dominant colour by this much luma (0–255). */
const FEATURE_CONTRAST = 64;

/**
 * Downscales "fake" pixel art (a diffusion image whose pixels are soft and off-grid) to
 * true pixels, one k-means-clustered source cell per output pixel, so edges stay crisp
 * instead of averaging into mud. A cell is transparent when most of its pixels are.
 */
export function kCentroidDownscale(src: Raster, width: number, height: number, k = 3, mode: DownscaleMode = 'dominant'): Raster {
  const out = createRaster(width, height);
  const cell: number[] = [];
  for (let cy = 0; cy < height; cy++) {
    const y0 = Math.floor((cy * src.height) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * src.height) / height));
    for (let cx = 0; cx < width; cx++) {
      const x0 = Math.floor((cx * src.width) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * src.width) / width));
      cell.length = 0;
      let transparent = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * src.width + x) * 4;
          if (src.data[i + 3] < 128) transparent++;
          else cell.push(src.data[i], src.data[i + 1], src.data[i + 2]);
        }
      }
      if (transparent * 3 > cell.length) continue; // more transparent than opaque pixels: leave clear
      const [r, g, b] = cellColour(cell, k, mode);
      out.data.set([r, g, b, 255], (cy * width + cx) * 4);
    }
  }
  return out;
}

/** The colour a cell of packed RGB triples reduces to. */
export function cellColour(rgb: number[], k: number, mode: DownscaleMode): [number, number, number] {
  const { centroids, counts } = kmeans(rgb, k, 6);
  const luma = (c: number) => 0.299 * centroids[c * 3] + 0.587 * centroids[c * 3 + 1] + 0.114 * centroids[c * 3 + 2];
  let pick = 0;
  for (let c = 1; c < counts.length; c++) if (counts[c] > counts[pick]) pick = c;

  if (mode === 'detail') {
    const dominant = pick;
    const total = rgb.length / 3;
    let bestScore = 0;
    for (let c = 0; c < counts.length; c++) {
      if (c === dominant || counts[c] < total * FEATURE_SHARE) continue;
      const contrast = Math.abs(luma(c) - luma(dominant));
      if (contrast < FEATURE_CONTRAST) continue;
      const score = contrast * (luma(c) < luma(dominant) ? 1.25 : 1); // dark lines first, as in hand-made pixel art
      if (score > bestScore) {
        bestScore = score;
        pick = c;
      }
    }
  }
  return [Math.round(centroids[pick * 3]), Math.round(centroids[pick * 3 + 1]), Math.round(centroids[pick * 3 + 2])];
}
