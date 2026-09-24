import { describe, expect, it } from 'vitest';
import { createRaster, getPixel, setPixel } from './raster';
import { compositeMasked, maskToRaster, roll, seamCrossMask, seamScore } from './seam';

function horizontalGradient(w: number, h: number) {
  const r = createRaster(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setPixel(r, x, y, [(x * 255) / (w - 1), 80, 80, 255]);
  return r;
}

function periodic(w: number, h: number) {
  const r = createRaster(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = 128 + 100 * Math.sin((2 * Math.PI * x) / w) * Math.cos((2 * Math.PI * y) / h);
      setPixel(r, x, y, [v, v, v, 255]);
    }
  }
  return r;
}

describe('seamScore', () => {
  it('is about 1 for an image that already wraps', () => {
    const s = seamScore(periodic(64, 64));
    expect(s.x).toBeLessThan(1.5);
    expect(s.y).toBeLessThan(1.5);
  });

  it('is large across the wrap of a gradient, and 1 where nothing changes', () => {
    const s = seamScore(horizontalGradient(64, 64));
    expect(s.x).toBeGreaterThan(20);
    expect(s.y).toBe(1);
  });
});

describe('roll', () => {
  it('shifts pixels with wrap-around', () => {
    const r = createRaster(4, 4, [0, 0, 0, 255]);
    setPixel(r, 3, 3, [255, 0, 0, 255]);

    const out = roll(r, 2, 1);

    expect(getPixel(out, 1, 0)).toEqual([255, 0, 0, 255]);
  });
});

describe('seamCrossMask', () => {
  it('covers the centre lines and leaves the corners untouched', () => {
    const m = seamCrossMask(64, 64, 16, 4);
    const at = (x: number, y: number) => m[y * 64 + x];

    expect(at(32, 5)).toBe(1); // on the vertical bar
    expect(at(5, 32)).toBe(1); // on the horizontal bar
    expect(at(2, 2)).toBe(0);
  });

  it('can cover only the vertical bar, for textures that tile horizontally', () => {
    const m = seamCrossMask(64, 64, 16, 4, 'x');
    expect(m[5 * 64 + 32]).toBe(1);
    expect(m[32 * 64 + 5]).toBe(0);
  });

  it('feathers the bar edges', () => {
    const m = seamCrossMask(64, 64, 16, 4);
    const edge = m[5 * 64 + 22]; // just outside the 24..40 core
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(1);
  });
});

describe('compositeMasked', () => {
  it('keeps base pixels exactly where the mask is 0 and takes the overlay where it is 1', () => {
    const base = createRaster(2, 1, [10, 20, 30, 255]);
    const over = createRaster(2, 1, [200, 200, 200, 255]);

    const out = compositeMasked(base, over, new Float32Array([0, 1]));

    expect(getPixel(out, 0, 0)).toEqual([10, 20, 30, 255]);
    expect(getPixel(out, 1, 0)).toEqual([200, 200, 200, 255]);
  });
});

describe('maskToRaster', () => {
  it('encodes the mask as opaque greyscale', () => {
    const r = maskToRaster(new Float32Array([0, 1]), 2, 1);
    expect(getPixel(r, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(getPixel(r, 1, 0)).toEqual([255, 255, 255, 255]);
  });
});
