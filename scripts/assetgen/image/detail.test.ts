import { describe, expect, it } from 'vitest';
import { detailResolution } from './detail';
import { createRaster, setPixel } from './raster';

function checker(size: number, cell: number) {
  const r = createRaster(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const on = (Math.floor(x / cell) + Math.floor(y / cell)) % 2;
      setPixel(r, x, y, on ? [200, 180, 60, 255] : [40, 60, 90, 255]);
    }
  }
  return r;
}

describe('detailResolution', () => {
  it('estimates how many art pixels span the image', () => {
    expect(detailResolution(checker(512, 32))).toBeCloseTo(16, 0);
    expect(detailResolution(checker(512, 8))).toBeCloseTo(64, 0);
  });

  it('is about 1 for a flat image', () => {
    expect(detailResolution(createRaster(256, 256, [90, 90, 90, 255]))).toBeLessThanOrEqual(1);
  });
});
