import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../config';
import { Block } from '../voxel/blocks';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { findPath, pathLength } from './paths';

/** A flat beach at y = 12 (top at SEA_LEVEL) from x = -20 to 20, sea beyond. */
function beach(): VoxelWorld {
  const world = new VoxelWorld();
  for (let x = -20; x < 20; x++) for (let z = -20; z < 20; z++) for (let y = 0; y < SEA_LEVEL; y++) world.setVoxel(x, y, z, Block.Sand);
  return world;
}

const wall = (world: VoxelWorld, x: number, z0: number, z1: number, height: number) => {
  for (let z = z0; z <= z1; z++) for (let y = SEA_LEVEL; y < SEA_LEVEL + height; y++) world.setVoxel(x, y, z, Block.Stone);
};

describe('findPath', () => {
  it('goes straight across open ground', () => {
    const path = findPath(beach(), { x: 0.5, y: SEA_LEVEL, z: 0.5 }, { x: 10, z: 0 })!;
    expect(path.at(-1)).toEqual({ x: 10.5, y: SEA_LEVEL, z: 0.5 });
    expect(path.length).toBe(10);
  });

  it('finds the gap in a wall too high to climb', () => {
    const world = beach();
    wall(world, 5, -20, 3, 3);
    wall(world, 5, 5, 19, 3);
    const path = findPath(world, { x: 0.5, y: SEA_LEVEL, z: 0.5 }, { x: 10, z: 0 })!;
    expect(path.some((p) => p.x === 5.5 && p.z === 4.5)).toBe(true);
    expect(path.every((p) => p.y === SEA_LEVEL)).toBe(true);
  });

  it('scrambles over a low wall rather than walking round it', () => {
    const world = beach();
    wall(world, 5, -20, 19, 2);
    const path = findPath(world, { x: 0.5, y: SEA_LEVEL, z: 0.5 }, { x: 10, z: 0 })!;
    expect(path.some((p) => p.x === 5.5 && p.y === SEA_LEVEL + 2)).toBe(true);
    expect(pathLength({ x: 0.5, z: 0.5 }, path)).toBeLessThan(11);
  });

  it('gives up when there is no way through', () => {
    const world = beach();
    wall(world, 5, -20, 19, 3);
    expect(findPath(world, { x: 0.5, y: SEA_LEVEL, z: 0.5 }, { x: 10, z: 0 })).toBeNull();
  });

  it('stops beside the target when asked to', () => {
    const world = beach();
    wall(world, 10, 0, 0, 5); // a tree trunk, say
    const path = findPath(world, { x: 0.5, y: SEA_LEVEL, z: 0.5 }, { x: 10, z: 0 }, 1.5)!;
    const end = path.at(-1)!;
    expect(Math.hypot(end.x - 10.5, end.z - 0.5)).toBeLessThanOrEqual(1.5);
  });

  it('keeps out of water too deep to wade', () => {
    const world = beach();
    // A channel dug across the beach, down to the seabed.
    for (let z = -20; z < 20; z++) for (let y = 5; y < SEA_LEVEL; y++) world.setVoxel(5, y, z, Block.Air);
    expect(findPath(world, { x: 0.5, y: SEA_LEVEL, z: 0.5 }, { x: 10, z: 0 })).toBeNull();
  });
});
