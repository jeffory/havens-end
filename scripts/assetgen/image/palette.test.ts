import { describe, expect, it } from 'vitest';
import { distinctColours, kmeansPalette, parsePalette, quantize } from './palette';
import { createRaster, getPixel, setPixel } from './raster';

describe('kmeansPalette', () => {
  it('recovers the colours of an image that already has few colours', () => {
    const r = createRaster(3, 3, [200, 10, 10, 255]);
    setPixel(r, 1, 1, [10, 200, 10, 255]);
    setPixel(r, 2, 2, [10, 10, 200, 255]);

    const palette = kmeansPalette(r, 3).map((c) => c.join(','));

    expect(palette.sort()).toEqual(['10,10,200', '10,200,10', '200,10,10']);
  });

  it('ignores transparent pixels', () => {
    const r = createRaster(2, 1, [0, 0, 0, 0]);
    setPixel(r, 1, 0, [50, 60, 70, 255]);

    expect(kmeansPalette(r, 4)).toEqual([[50, 60, 70]]);
  });
});

describe('quantize', () => {
  it('snaps every opaque pixel to its nearest palette colour', () => {
    const r = createRaster(2, 1, [190, 20, 25, 255]);
    setPixel(r, 1, 0, [20, 30, 180, 255]);

    const q = quantize(r, [
      [200, 0, 0],
      [0, 0, 200],
    ]);

    expect(getPixel(q, 0, 0)).toEqual([200, 0, 0, 255]);
    expect(getPixel(q, 1, 0)).toEqual([0, 0, 200, 255]);
  });

  it('makes alpha binary: faint pixels vanish, solid ones become fully opaque', () => {
    const r = createRaster(2, 1, [100, 100, 100, 40]);
    setPixel(r, 1, 0, [100, 100, 100, 200]);

    const q = quantize(r, [[100, 100, 100]]);

    expect(getPixel(q, 0, 0)[3]).toBe(0);
    expect(getPixel(q, 1, 0)[3]).toBe(255);
  });

  it('limits a many-coloured image to the palette size', () => {
    const r = createRaster(16, 16);
    for (let i = 0; i < 256; i++) setPixel(r, i % 16, Math.floor(i / 16), [i, 255 - i, (i * 7) % 256, 255]);

    const q = quantize(r, kmeansPalette(r, 8));

    expect(distinctColours(q)).toBeLessThanOrEqual(8);
  });
});

describe('parsePalette', () => {
  it('reads hex colours one per line, skipping comments and blanks', () => {
    expect(parsePalette('; GIMP-ish comment\n#e9d6a0\n\n6cae4c\n# not a colour\n')).toEqual([
      [0xe9, 0xd6, 0xa0],
      [0x6c, 0xae, 0x4c],
    ]);
  });
});
