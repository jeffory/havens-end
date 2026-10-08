import { describe, expect, it } from 'vitest';
import type { PropPlacement } from '../props/types';
import { Block } from '../voxel/blocks';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { plotCells, standProp } from './furnish';

describe('standing a prop', () => {
  it('sets it over its cells, anchored where its top is, and keeps people out of them three high', () => {
    const world = new VoxelWorld();
    world.setVoxel(5, 11, 7, Block.Stone); // what's there already stays
    const decor: PropPlacement[] = [];
    const p = standProp(world, decor, 'barrel', { x0: 5, z0: 7, x1: 5, z1: 7 }, 10, 2);
    expect(decor).toEqual([p]);
    expect(p).toEqual({ kind: 'barrel', x: 5.5, y: 10, z: 7.5, facing: 2, anchor: { x: 5, y: 10, z: 7 } });
    expect([10, 11, 12, 13].map((y) => world.getVoxel(5, y, 7))).toEqual([Block.Blocker, Block.Stone, Block.Blocker, Block.Air]);
  });

  it('refuses cells that aren’t its shape', () => {
    expect(() => standProp(new VoxelWorld(), [], 'crate', { x0: 0, z0: 0, x1: 1, z1: 0 }, 10, 0)).toThrow();
  });

  it('turns a prop that isn’t square with its facing', () => {
    const decor: PropPlacement[] = [];
    // A stall is three across and two deep: facing east, it takes two cells along x and three along z.
    const p = standProp(new VoxelWorld(), decor, 'stallProduceRed', { x0: 0, z0: 0, x1: 1, z1: 2 }, 10, 1);
    expect([p.x, p.z]).toEqual([1, 1.5]);
    expect(p.anchor).toEqual({ x: 0, y: 12, z: 1 });
    expect(() => standProp(new VoxelWorld(), decor, 'stallProduceRed', { x0: 0, z0: 0, x1: 1, z1: 2 }, 10, 0)).toThrow();
  });

  it('gives a plot’s cells as standProp takes them', () => {
    expect(plotCells({ x0: 4, z0: -2, w: 3, d: 2 })).toEqual({ x0: 4, z0: -2, x1: 6, z1: -1 });
  });
});
