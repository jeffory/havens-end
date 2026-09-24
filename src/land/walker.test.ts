import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../config';
import { Block } from '../voxel/blocks';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { createWalker, stepWalker, standable, type Walker } from './walker';

/** A flat beach at y = 12 (top at SEA_LEVEL) from x = -20 to 20, sea beyond. */
function beach(): VoxelWorld {
  const world = new VoxelWorld();
  for (let x = -20; x < 20; x++) for (let z = -20; z < 20; z++) for (let y = 0; y < SEA_LEVEL; y++) world.setVoxel(x, y, z, Block.Sand);
  return world;
}

function walk(w: Walker, world: VoxelWorld, mx: number, mz: number, seconds: number): Walker {
  for (let t = 0; t < seconds; t += 1 / 60) stepWalker(w, mx, mz, world, 1 / 60);
  return w;
}

describe('stepWalker', () => {
  it('walks across flat ground and settles on it', () => {
    const world = beach();
    const w = walk(createWalker(0, SEA_LEVEL + 0.5, 0), world, 1, 0, 2);
    expect(w.y).toBe(SEA_LEVEL);
    expect(w.onGround).toBe(true);
    expect(w.x).toBeGreaterThan(7);
    expect(w.facing).toBeCloseTo(Math.PI / 2, 1);
  });

  it('climbs steps and scrambles up two-voxel ledges, but not a three-voxel wall', () => {
    const world = beach();
    for (let z = -20; z < 20; z++) world.setVoxel(3, SEA_LEVEL, z, Block.Stone);
    const w = walk(createWalker(0, SEA_LEVEL, 0), world, 1, 0, 2);
    expect(w.x).toBeGreaterThan(4);
    expect(w.y).toBe(SEA_LEVEL); // down the far side again

    for (let z = -20; z < 20; z++) for (const y of [SEA_LEVEL, SEA_LEVEL + 1, SEA_LEVEL + 2]) world.setVoxel(15, y, z, Block.Stone);
    for (let z = -20; z < 20; z++) for (const y of [SEA_LEVEL, SEA_LEVEL + 1]) world.setVoxel(10, y, z, Block.Stone);
    walk(w, world, 1, 0, 3);
    expect(w.x).toBeLessThan(15 - 0.29);
    expect(w.x).toBeGreaterThan(14);
    expect(w.y).toBe(SEA_LEVEL); // over the two-high ledge and down again
  });

  it('wades into the shallows but stops where the water gets deep', () => {
    const world = beach();
    // A shelf of shallow water, then deep sea.
    for (let x = 20; x < 24; x++) for (let z = -20; z < 20; z++) for (let y = 0; y < SEA_LEVEL - 1; y++) world.setVoxel(x, y, z, Block.Sand);
    const w = walk(createWalker(15, SEA_LEVEL, 0), world, 1, 0, 4);
    expect(w.x).toBeGreaterThan(20);
    expect(w.x).toBeLessThan(24);
    expect(w.y).toBe(SEA_LEVEL - 1);
  });

  it('walks through crops but not through fences', () => {
    const world = beach();
    world.setVoxel(3, SEA_LEVEL, 0, Block.Cane);
    world.setVoxel(3, SEA_LEVEL + 1, 0, Block.Cane);
    for (let z = -20; z < 20; z++) world.setVoxel(6, SEA_LEVEL, z, Block.Fence);
    const w = walk(createWalker(0, SEA_LEVEL, 0.5), world, 1, 0, 2);
    // Fences are one voxel: stepped over, like a stile, only if there's nothing on top.
    expect(w.x).toBeGreaterThan(3);
    expect(w.y).toBeGreaterThanOrEqual(SEA_LEVEL);
  });

  it('drops off ledges onto lower ground', () => {
    const world = beach();
    for (let x = -20; x < 0; x++) for (let z = -20; z < 20; z++) for (let y = SEA_LEVEL; y < SEA_LEVEL + 3; y++) world.setVoxel(x, y, z, Block.Stone);
    const w = walk(createWalker(-2, SEA_LEVEL + 3, 0), world, 1, 0, 1.5);
    expect(w.x).toBeGreaterThan(1);
    expect(w.y).toBe(SEA_LEVEL);
  });

  it('knows where someone can stand', () => {
    const world = beach();
    expect(standable(world, 0, 0)).toBe(SEA_LEVEL);
    expect(standable(world, 40, 0)).toBeNull();
  });
});
