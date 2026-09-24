import { describe, expect, it } from 'vitest';
import { decodeImage, encodePng, resize } from './io';
import { createRaster, getPixel, setPixel } from './raster';

describe('image io', () => {
  it('round-trips RGBA pixels through PNG exactly', async () => {
    const r = createRaster(3, 2, [10, 20, 30, 255]);
    setPixel(r, 2, 1, [250, 0, 5, 0]);
    setPixel(r, 1, 0, [1, 2, 3, 128]);

    const back = await decodeImage(await encodePng(r));

    expect([back.width, back.height]).toEqual([3, 2]);
    expect(getPixel(back, 0, 0)).toEqual([10, 20, 30, 255]);
    expect(getPixel(back, 1, 0)).toEqual([1, 2, 3, 128]);
    expect(getPixel(back, 2, 1)[3]).toBe(0);
  });

  it('scales up with hard pixel edges in nearest mode', async () => {
    const r = createRaster(2, 1, [255, 0, 0, 255]);
    setPixel(r, 1, 0, [0, 0, 255, 255]);

    const big = await resize(r, 8, 4, 'nearest');

    expect(getPixel(big, 3, 2)).toEqual([255, 0, 0, 255]);
    expect(getPixel(big, 4, 2)).toEqual([0, 0, 255, 255]);
  });
});
