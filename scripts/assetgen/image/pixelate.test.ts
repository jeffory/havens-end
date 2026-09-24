import { describe, expect, it } from 'vitest';
import { kCentroidDownscale } from './pixelate';
import { createRaster, getPixel, setPixel } from './raster';

const RED = [220, 30, 30, 255] as const;
const BLUE = [20, 40, 200, 255] as const;
const CLEAR = [0, 0, 0, 0] as const;

describe('kCentroidDownscale', () => {
  it('maps uniform blocks to one pixel each', () => {
    const src = createRaster(4, 4, RED);
    for (let y = 0; y < 2; y++) for (let x = 2; x < 4; x++) setPixel(src, x, y, BLUE);

    const out = kCentroidDownscale(src, 2, 2);

    expect([out.width, out.height]).toEqual([2, 2]);
    expect(getPixel(out, 0, 0)).toEqual([...RED]);
    expect(getPixel(out, 1, 0)).toEqual([...BLUE]);
    expect(getPixel(out, 1, 1)).toEqual([...RED]);
  });

  it('takes the dominant colour of a cell instead of averaging', () => {
    const src = createRaster(4, 4, RED);
    setPixel(src, 0, 0, BLUE); // 1 of 16 pixels is an anti-aliasing stray

    const out = kCentroidDownscale(src, 1, 1);

    expect(getPixel(out, 0, 0)).toEqual([...RED]);
  });

  it("in 'detail' mode keeps a thin contrasting line that 'dominant' mode drops", () => {
    // 10×10 cell of light stone with a 3 px dark mortar line (30% of the cell).
    const src = createRaster(10, 10, [170, 170, 175, 255]);
    for (let y = 0; y < 10; y++) for (let x = 4; x < 7; x++) setPixel(src, x, y, [60, 60, 65, 255]);

    expect(getPixel(kCentroidDownscale(src, 1, 1), 0, 0)).toEqual([170, 170, 175, 255]);
    expect(getPixel(kCentroidDownscale(src, 1, 1, 3, 'detail'), 0, 0)).toEqual([60, 60, 65, 255]);
  });

  it("in 'detail' mode ignores slivers and faint differences", () => {
    const sliver = createRaster(10, 10, [170, 170, 175, 255]);
    for (let y = 0; y < 10; y++) setPixel(sliver, 0, y, [60, 60, 65, 255]); // 10% of the cell
    const faint = createRaster(10, 10, [170, 170, 175, 255]);
    for (let y = 0; y < 10; y++) for (let x = 0; x < 4; x++) setPixel(faint, x, y, [150, 150, 155, 255]);

    expect(getPixel(kCentroidDownscale(sliver, 1, 1, 3, 'detail'), 0, 0)).toEqual([170, 170, 175, 255]);
    expect(getPixel(kCentroidDownscale(faint, 1, 1, 3, 'detail'), 0, 0)).toEqual([170, 170, 175, 255]);
  });

  it('keeps cells transparent when most of their pixels are transparent', () => {
    const src = createRaster(4, 4, CLEAR);
    setPixel(src, 0, 0, RED);
    for (let y = 2; y < 4; y++) for (let x = 2; x < 4; x++) setPixel(src, x, y, RED);

    const out = kCentroidDownscale(src, 2, 2);

    expect(getPixel(out, 0, 0)[3]).toBe(0);
    expect(getPixel(out, 1, 1)).toEqual([...RED]);
  });
});
