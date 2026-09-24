import { describe, expect, it } from 'vitest';
import { Block } from './blocks';
import { VoxelWorld } from './VoxelWorld';

describe('VoxelWorld', () => {
  it('reads back voxels at negative and chunk-boundary coordinates', () => {
    const world = new VoxelWorld();
    const points: Array<[number, number, number]> = [
      [0, 0, 0], [31, 5, 31], [32, 5, 32], [-1, 3, -1], [-32, 40, -33], [100, 63, -100],
    ];
    points.forEach(([x, y, z], i) => world.setVoxel(x, y, z, (i % 5) + 1));
    points.forEach(([x, y, z], i) => expect(world.getVoxel(x, y, z)).toBe((i % 5) + 1));
    expect(world.getVoxel(1, 0, 0)).toBe(Block.Air);
  });

  it('does not allocate chunks when clearing empty space', () => {
    const world = new VoxelWorld();
    expect(world.setVoxel(5, 5, 5, Block.Air)).toBe(false);
    expect(world.chunkCount).toBe(0);
  });

  it('marks only the owning chunk dirty for interior edits', () => {
    const world = new VoxelWorld();
    for (const [cx, cz] of [[0, 0], [1, 0], [-1, 0]]) world.getOrCreateChunk(cx, 0, cz);
    world.takeDirty(Infinity);

    world.setVoxel(10, 10, 10, Block.Stone);
    expect(world.takeDirty(Infinity).map((c) => [c.cx, c.cy, c.cz])).toEqual([[0, 0, 0]]);
  });

  it('marks neighbouring chunks dirty for edits on a chunk face', () => {
    const world = new VoxelWorld();
    for (const [cx, cz] of [[0, 0], [1, 0], [-1, 0], [0, 1]]) world.getOrCreateChunk(cx, 0, cz);
    world.takeDirty(Infinity);

    world.setVoxel(31, 10, 10, Block.Stone); // +x face of chunk (0,0,0)
    const dirty = world.takeDirty(Infinity).map((c) => `${c.cx},${c.cy},${c.cz}`).sort();
    expect(dirty).toEqual(['0,0,0', '1,0,0']);
  });

  it('reports voxel changes to listeners, but not no-op writes', () => {
    const world = new VoxelWorld();
    const seen: number[][] = [];
    world.onChange((x, y, z, prev, next) => seen.push([x, y, z, prev, next]));

    world.setVoxel(1, 2, 3, Block.Sand);
    world.setVoxel(1, 2, 3, Block.Sand);
    world.setVoxel(1, 2, 3, Block.Air);
    expect(seen).toEqual([
      [1, 2, 3, Block.Air, Block.Sand],
      [1, 2, 3, Block.Sand, Block.Air],
    ]);
  });

  it('finds the surface height of a column across chunk layers', () => {
    const world = new VoxelWorld();
    expect(world.surfaceHeight(4, -4)).toBe(0);
    for (let y = 0; y <= 40; y++) world.setVoxel(4, y, -4, Block.Stone);
    expect(world.surfaceHeight(4, -4)).toBe(41);
    world.setVoxel(4, 40, -4, Block.Air);
    expect(world.surfaceHeight(4, -4)).toBe(40);
  });
});
