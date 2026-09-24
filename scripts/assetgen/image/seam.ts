import { createRaster, type Raster } from './raster';

/**
 * How visible the wrap-around seam is: the mean colour jump across the wrap, divided by
 * the mean jump between the pixels just inside each edge. About 1 means the texture
 * tiles invisibly; much above 2 means a visible seam.
 */
export function seamScore(r: Raster): { x: number; y: number } {
  return { x: axisScore(r, true), y: axisScore(r, false) };
}

function axisScore(r: Raster, horizontal: boolean): number {
  const { width: w, height: h, data } = r;
  const along = horizontal ? w : h;
  const across = horizontal ? h : w;
  // Jump between positions s and t along the axis, in row/column a.
  const jump = (a: number, s: number, t: number) => {
    const i = horizontal ? (a * w + s) * 4 : (s * w + a) * 4;
    const j = horizontal ? (a * w + t) * 4 : (t * w + a) * 4;
    return Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]);
  };
  let wrap = 0;
  let inside = 0;
  for (let a = 0; a < across; a++) {
    wrap += jump(a, along - 1, 0);
    inside += (jump(a, 0, 1) + jump(a, 1, 2) + jump(a, along - 2, along - 1) + jump(a, along - 3, along - 2)) / 4;
  }
  if (inside === 0) return wrap === 0 ? 1 : Infinity;
  return wrap / inside;
}

/** Shifts the image by (dx, dy) with wrap-around. Rolling by half moves the seams to the centre. */
export function roll(r: Raster, dx: number, dy: number): Raster {
  const { width: w, height: h } = r;
  const out = createRaster(w, h);
  for (let y = 0; y < h; y++) {
    const ty = (((y + dy) % h) + h) % h;
    for (let x = 0; x < w; x++) {
      const tx = (((x + dx) % w) + w) % w;
      out.data.set(r.data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4), (ty * w + tx) * 4);
    }
  }
  return out;
}

/** Which wrap directions must be seamless: both, or only across the left/right edges. */
export type TileAxes = 'xy' | 'x';

/**
 * A cross through the image centre, `band` pixels wide, with linear feathering: the
 * region to repaint after rolling a texture by half, so its old edges blend into each
 * other. With axes 'x' only the vertical bar (the old left/right edges) is covered.
 */
export function seamCrossMask(width: number, height: number, band: number, feather: number, axes: TileAxes = 'xy'): Float32Array {
  const ramp = (d: number) => (d <= band / 2 ? 1 : d < band / 2 + feather ? 1 - (d - band / 2) / feather : 0);
  const mask = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const vy = axes === 'xy' ? ramp(Math.abs(y + 0.5 - height / 2)) : 0;
    for (let x = 0; x < width; x++) mask[y * width + x] = Math.max(vy, ramp(Math.abs(x + 0.5 - width / 2)));
  }
  return mask;
}

/** base where the mask is 0, over where it is 1, blended in between. */
export function compositeMasked(base: Raster, over: Raster, mask: Float32Array): Raster {
  const out = createRaster(base.width, base.height);
  for (let p = 0; p < mask.length; p++) {
    const m = mask[p];
    for (let c = 0; c < 4; c++) {
      const i = p * 4 + c;
      out.data[i] = Math.round(base.data[i] * (1 - m) + over.data[i] * m);
    }
  }
  return out;
}

/** The mask as an opaque greyscale image (white = 1), the form ComfyUI loads masks from. */
export function maskToRaster(mask: Float32Array, width: number, height: number): Raster {
  const out = createRaster(width, height);
  for (let p = 0; p < mask.length; p++) {
    const v = Math.round(mask[p] * 255);
    out.data.set([v, v, v, 255], p * 4);
  }
  return out;
}
