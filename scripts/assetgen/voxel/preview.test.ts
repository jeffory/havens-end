import { describe, expect, it } from 'vitest';
import { getPixel } from '../image/raster';
import { renderIso } from './preview';
import type { Rgb, VoxelGrid } from './voxelize';

function grid(size: [number, number, number], cells: Array<[number, number, number, Rgb]>): VoxelGrid {
  return {
    size,
    get: (x, y, z) => cells.find((c) => c[0] === x && c[1] === y && c[2] === z)?.[3],
    entries: () => cells,
  };
}

const brightness = (p: number[]) => p[0] + p[1] + p[2];

describe('renderIso', () => {
  it('draws a cube with a lit top and darker sides on a transparent background', () => {
    const img = renderIso(grid([1, 1, 1], [[0, 0, 0, [200, 200, 200]]]), 8);

    expect([img.width, img.height]).toEqual([16, 16]);
    const top = getPixel(img, 8, 4);
    const left = getPixel(img, 3, 10);
    const right = getPixel(img, 12, 10);
    expect(brightness(top)).toBeGreaterThan(brightness(left));
    expect(brightness(left)).toBeGreaterThan(brightness(right));
    expect(getPixel(img, 0, 0)[3]).toBe(0);
  });

  it('shows the voxel nearer the viewer where two project to the same spot', () => {
    // Viewer looks from front-right-above (−y, +x, +z): (1, 0, 1) hides (0, 1, 0).
    const img = renderIso(
      grid([2, 2, 2], [
        [0, 1, 0, [255, 0, 0]],
        [1, 0, 1, [0, 0, 255]],
      ]),
      8,
    );
    const blue = Array.from({ length: img.width * img.height }, (_, i) => getPixel(img, i % img.width, Math.floor(i / img.width))).filter(
      (p) => p[3] > 0 && p[2] > p[0],
    ).length;
    const red = Array.from({ length: img.width * img.height }, (_, i) => getPixel(img, i % img.width, Math.floor(i / img.width))).filter(
      (p) => p[3] > 0 && p[0] > p[2],
    ).length;
    expect(blue).toBeGreaterThan(0);
    expect(red).toBe(0);
  });
});
