import { describe, expect, it } from 'vitest';
import { parseVox } from '../../../src/vox/parseVox';
import { gridToVox } from './toVox';
import type { Rgb, VoxelGrid } from './voxelize';

function grid(size: [number, number, number], cells: Array<[number, number, number, Rgb]>): VoxelGrid {
  return {
    size,
    get: (x, y, z) => cells.find((c) => c[0] === x && c[1] === y && c[2] === z)?.[3],
    entries: () => cells,
  };
}

const colourAt = (file: ReturnType<typeof parseVox>, index: number) => Array.from(file.palette.subarray(index * 4, index * 4 + 3));

describe('gridToVox', () => {
  it('writes a .vox the game parser reads back with the same cells and colours', () => {
    const bytes = gridToVox(
      grid([2, 1, 3], [
        [0, 0, 0, [200, 10, 10]],
        [1, 0, 2, [10, 10, 200]],
        [0, 0, 2, [200, 10, 10]],
      ]),
      { colors: 16, name: 'chest' },
    );

    const file = parseVox(bytes.slice().buffer);
    const model = file.models[0];
    expect([model.sizeX, model.sizeY, model.sizeZ]).toEqual([2, 1, 3]);
    const cells = [];
    for (let i = 0; i < model.voxels.length; i += 4) cells.push([model.voxels[i], model.voxels[i + 1], model.voxels[i + 2], colourAt(file, model.voxels[i + 3])]);
    expect(cells).toContainEqual([1, 0, 2, [10, 10, 200]]);
    expect(cells).toContainEqual([0, 0, 0, [200, 10, 10]]);
    expect(file.instances[0].name).toBe('chest');
  });

  it('reduces colours to the palette budget', () => {
    const cells: Array<[number, number, number, Rgb]> = [];
    for (let i = 0; i < 64; i++) cells.push([i % 8, Math.floor(i / 8), 0, [i * 4, 255 - i * 4, (i * 13) % 256]]);

    const file = parseVox(gridToVox(grid([8, 8, 1], cells), { colors: 8, name: 'x' }).slice().buffer);

    expect(new Set(Array.from(file.models[0].voxels.filter((_, i) => i % 4 === 3))).size).toBeLessThanOrEqual(8);
  });

  it('refuses grids larger than MagicaVoxel allows', () => {
    expect(() => gridToVox(grid([300, 1, 1], []), { colors: 8, name: 'x' })).toThrow(/256/);
  });
});
