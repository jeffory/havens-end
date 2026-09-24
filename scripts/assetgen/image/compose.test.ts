import { describe, expect, it } from 'vitest';
import { applyMask, contentBox, packAtlas, padToSquare, tile, tintToward } from './compose';
import { createRaster, getPixel, setPixel } from './raster';

describe('applyMask', () => {
  it('takes alpha from the mask image (white = opaque)', () => {
    const img = createRaster(2, 1, [10, 20, 30, 255]);
    const mask = createRaster(2, 1, [0, 0, 0, 255]);
    setPixel(mask, 1, 0, [255, 255, 255, 255]);

    const out = applyMask(img, mask);

    expect(getPixel(out, 0, 0)[3]).toBe(0);
    expect(getPixel(out, 1, 0)).toEqual([10, 20, 30, 255]);
  });
});

describe('contentBox', () => {
  it('finds the bounding box of opaque pixels', () => {
    const r = createRaster(10, 10);
    setPixel(r, 2, 3, [1, 1, 1, 255]);
    setPixel(r, 6, 8, [1, 1, 1, 255]);

    expect(contentBox(r)).toEqual({ x: 2, y: 3, width: 5, height: 6 });
  });

  it('returns null for a fully transparent image', () => {
    expect(contentBox(createRaster(4, 4))).toBeNull();
  });
});

describe('padToSquare', () => {
  it('centres the image on a transparent square', () => {
    const out = padToSquare(createRaster(2, 4, [9, 9, 9, 255]));

    expect([out.width, out.height]).toEqual([4, 4]);
    expect(getPixel(out, 0, 0)[3]).toBe(0);
    expect(getPixel(out, 1, 0)).toEqual([9, 9, 9, 255]);
  });
});

describe('tile', () => {
  it('repeats the image nx × ny times', () => {
    const r = createRaster(2, 1, [1, 0, 0, 255]);
    setPixel(r, 1, 0, [2, 0, 0, 255]);

    const t = tile(r, 3, 2);

    expect([t.width, t.height]).toEqual([6, 2]);
    expect(getPixel(t, 4, 1)).toEqual([1, 0, 0, 255]);
    expect(getPixel(t, 5, 1)).toEqual([2, 0, 0, 255]);
  });
});

describe('tintToward', () => {
  it('shifts the average colour to the target while keeping the variation', () => {
    const r = createRaster(2, 1, [100, 100, 100, 255]);
    setPixel(r, 1, 0, [140, 140, 140, 255]);

    const out = tintToward(r, [233, 214, 160]);
    const [a, b] = [getPixel(out, 0, 0), getPixel(out, 1, 0)];

    expect(Math.abs((a[0] + b[0]) / 2 - 233)).toBeLessThan(12);
    expect(Math.abs((a[2] + b[2]) / 2 - 160)).toBeLessThan(12);
    expect(b[1]).toBeGreaterThan(a[1]); // lighter pixel stays lighter
  });
});

describe('packAtlas', () => {
  it('packs equal tiles into a square-ish grid and records where each went', () => {
    const tiles = ['a', 'b', 'c'].map((name, i) => ({ name, image: createRaster(16, 16, [i * 50, 0, 0, 255]) }));

    const { image, layout } = packAtlas(tiles);

    expect([image.width, image.height]).toEqual([32, 32]);
    expect(layout.tiles.c).toEqual({ x: 0, y: 16, width: 16, height: 16 });
    expect(getPixel(image, 20, 5)).toEqual([50, 0, 0, 255]);
  });
});
