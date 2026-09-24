import { describe, expect, it } from 'vitest';
import { sliceGrid } from './grid';
import { createRaster, getPixel, type Raster, setPixel } from './raster';

const BLACK = [0, 0, 0, 255] as const;
const colourOf = (i: number) => [40 + i * 20, 200 - i * 15, 90 + ((i * 37) % 100), 255] as const;

/** 3×3 atlas: 4 px black frame and gutters; column separators may be moved off-centre. */
function atlas(cell: number, colOffsets = [0, 0]): Raster {
  const g = 4;
  const size = cell * 3 + g * 4;
  const r = createRaster(size, size, BLACK);
  const colStart = [g, g + cell + g + colOffsets[0], g + 2 * (cell + g) + colOffsets[1]];
  const colEnd = [colStart[1] - g, colStart[2] - g, size - g];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const y0 = g + row * (cell + g);
      for (let y = y0; y < y0 + cell; y++) for (let x = colStart[col]; x < colEnd[col]; x++) setPixel(r, x, y, colourOf(row * 3 + col));
    }
  }
  return r;
}

const hasBlack = (r: Raster) => {
  for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) if (getPixel(r, x, y)[0] === 0) return true;
  return false;
};

describe('sliceGrid', () => {
  it('cuts an atlas along its black gutters, dropping the gutters', () => {
    const cells = sliceGrid(atlas(40), 3, 3, 'black');

    expect(cells).toHaveLength(9);
    cells.forEach((cell, i) => {
      expect(hasBlack(cell)).toBe(false);
      expect(getPixel(cell, 5, 5)).toEqual([...colourOf(i)]);
    });
  });

  it('finds gutters that are off their even-split positions', () => {
    const cells = sliceGrid(atlas(40, [6, -5]), 3, 3, 'black');

    cells.forEach((cell) => expect(hasBlack(cell)).toBe(false));
    expect(cells[0].width).toBe(46);
    expect(cells[1].width).toBe(29);
  });

  it('keeps a dark texture whole instead of trimming it as if it were gutter', () => {
    const r = atlas(40);
    // Make the centre cell near-black tar with a faint pattern.
    for (let y = 48; y < 88; y++) for (let x = 48; x < 88; x++) setPixel(r, x, y, (x + y) % 5 ? [20, 18, 24, 255] : [45, 40, 50, 255]);

    const cells = sliceGrid(r, 3, 3, 'black');

    expect([cells[4].width, cells[4].height]).toEqual([40, 40]);
  });

  it('splits evenly when there are no gutters', () => {
    const cells = sliceGrid(createRaster(90, 60, [9, 9, 9, 255]), 3, 2, 'none');

    expect(cells.map((c) => [c.width, c.height])).toEqual(Array(6).fill([30, 30]));
  });
});
