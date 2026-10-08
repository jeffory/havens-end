import { describe, expect, it } from 'vitest';
import { Block } from './blocks';
import { raycastVoxels } from './raycast';
import { VoxelWorld } from './VoxelWorld';

describe('raycastVoxels', () => {
  const world = new VoxelWorld();
  for (let x = -10; x < 10; x++) for (let z = -10; z < 10; z++) world.setVoxel(x, 4, z, Block.Stone);
  world.setVoxel(-3, 5, 2, Block.Sand);

  it('hits the top face of the ground when looking straight down', () => {
    const hit = raycastVoxels(world, 2.5, 20, 2.5, 0, -1, 0, 100);
    expect(hit).toMatchObject({ x: 2, y: 4, z: 2, nx: 0, ny: 1, nz: 0 });
    expect(hit!.distance).toBeCloseTo(15);
  });

  it('reports the side face it entered through', () => {
    const hit = raycastVoxels(world, 0.5, 5.5, 2.5, -1, 0, 0, 100);
    expect(hit).toMatchObject({ x: -3, y: 5, z: 2, nx: 1, ny: 0, nz: 0 });
  });

  it('works with negative coordinates on every axis', () => {
    const len = Math.hypot(-1, -2, -1);
    const hit = raycastVoxels(world, 0.2, 8.3, 0.7, -1 / len, -2 / len, -1 / len, 100);
    expect(hit?.y).toBe(4);
    expect(hit?.ny).toBe(1);
  });

  it('returns null when nothing is within range', () => {
    expect(raycastVoxels(world, 0.5, 20, 0.5, 0, 1, 0, 100)).toBeNull();
    expect(raycastVoxels(world, 0.5, 20, 0.5, 0, -1, 0, 10)).toBeNull();
  });

  it('reports the voxel it starts inside, with no face normal', () => {
    const hit = raycastVoxels(world, 2.5, 4.5, 2.5, 0, -1, 0, 100);
    expect(hit).toMatchObject({ x: 2, y: 4, z: 2, nx: 0, ny: 0, nz: 0, distance: 0 });
  });

  it('skips the voxel it starts inside when told to, and reports the next one along', () => {
    // Starting inside the ground layer, with nothing below it: skipping finds nothing.
    expect(raycastVoxels(world, 2.5, 4.5, 2.5, 0, -1, 0, 100, true)).toBeNull();

    // Two blocks in a row: starting inside the first, skipping reports the second, with
    // its proper face normal, exactly as if the ray had started outside the first.
    const wall = new VoxelWorld();
    wall.setVoxel(0, 0, 0, Block.Stone);
    wall.setVoxel(1, 0, 0, Block.Stone);
    const hit = raycastVoxels(wall, 0.5, 0.5, 0.5, 1, 0, 0, 100, true);
    expect(hit).toMatchObject({ x: 1, y: 0, z: 0, nx: -1, ny: 0, nz: 0 });
  });
});
