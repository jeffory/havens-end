import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../config';
import { Block } from '../voxel/blocks';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { blockerGround, createWalker, stepWalker, standable, type Walker } from './walker';

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
    // Not on a prop's blocker, even where it's the highest thing in the column.
    world.setVoxel(5, SEA_LEVEL, 0, Block.Blocker);
    expect(standable(world, 5, 0)).toBeNull();
  });

  it('refuses to scramble up onto a prop’s blocker: stopped dead, like a wall', () => {
    const world = beach();
    // A ledge two high (within STEP_UP), but it's a prop's blocker: nobody's keel vaults onto one.
    for (let z = -5; z <= 5; z++) for (const y of [SEA_LEVEL, SEA_LEVEL + 1]) world.setVoxel(3, y, z, Block.Blocker);
    const w = walk(createWalker(0, SEA_LEVEL, 0), world, 1, 0, 2);
    expect(w.x).toBeLessThan(3 - 0.29); // never crosses in: the walker's own half-width off its face
    expect(w.y).toBe(SEA_LEVEL);
    expect(w.onGround).toBe(true);
  });

  it('refuses to walk off a ledge onto a prop’s blocker: stopped at the edge, on real ground, never frozen above it', () => {
    const world = beach();
    for (let x = -20; x < 0; x++) for (let z = -20; z < 20; z++) for (let y = SEA_LEVEL; y < SEA_LEVEL + 3; y++) world.setVoxel(x, y, z, Block.Stone);
    // A prop's blocker right where stepping off the ledge would otherwise land.
    for (let x = 0; x < 5; x++) for (let z = -2; z <= 2; z++) world.setVoxel(x, SEA_LEVEL, z, Block.Blocker);
    const w = walk(createWalker(-2, SEA_LEVEL + 3, 0), world, 1, 0, 3);
    // Stopped at the ledge's own edge, on its own real ground: never crossed into the
    // blocker's column, so never above it and never resting on it either.
    expect(w.onGround).toBe(true);
    expect(w.x).toBeLessThan(0);
    expect(blockerGround(world, w.x, w.y, w.z)).toBe(false);
    // Not frozen: holding the opposite way moves them straight back, unlike a hover stuck in place.
    const stopped = w.x;
    walk(w, world, -1, 0, 0.5);
    expect(w.x).toBeLessThan(stopped);
  });

  it('walks up a stair a half-step at a time, with no scramble', () => {
    const world = beach();
    // A stair climbing east onto a step a block up.
    for (let z = -20; z < 20; z++) {
      world.setVoxel(3, SEA_LEVEL, z, Block.StoneStairE);
      for (let x = 4; x < 20; x++) world.setVoxel(x, SEA_LEVEL, z, Block.Stone);
    }
    const w = createWalker(0.5, SEA_LEVEL, 0.5);
    let biggest = 0;
    for (let t = 0; t < 2; t += 1 / 60) {
      const before = w.y;
      stepWalker(w, 1, 0, world, 1 / 60);
      biggest = Math.max(biggest, w.y - before);
    }
    expect(w.x).toBeGreaterThan(6);
    expect(w.y).toBe(SEA_LEVEL + 1);
    expect(biggest).toBeLessThanOrEqual(0.5);
  });

  it('climbs a stair walking across it at a slant', () => {
    const world = beach();
    for (let z = -20; z < 20; z++) {
      world.setVoxel(3, SEA_LEVEL, z, Block.StoneStairE);
      for (let x = 4; x < 20; x++) world.setVoxel(x, SEA_LEVEL, z, Block.Stone);
    }
    const w = walk(createWalker(0.5, SEA_LEVEL, -5.5), world, 1, 1, 2);
    expect(w.x).toBeGreaterThan(5);
    expect(w.y).toBe(SEA_LEVEL + 1);
  });

  it('stands on a slab half a block up, and lands on one from above', () => {
    const world = beach();
    for (let x = 3; x < 6; x++) for (let z = -20; z < 20; z++) world.setVoxel(x, SEA_LEVEL, z, Block.PlanksSlab);
    const w = walk(createWalker(0.5, SEA_LEVEL, 0.5), world, 1, 0, 0.9);
    expect(w.x).toBeGreaterThan(3.5);
    expect(w.x).toBeLessThan(5.5);
    expect(w.y).toBe(SEA_LEVEL + 0.5);
    expect(walk(createWalker(4.5, SEA_LEVEL + 3, 0.5), world, 0, 0, 1).y).toBe(SEA_LEVEL + 0.5);
    expect(standable(world, 4.5, 0.5)).toBe(SEA_LEVEL + 0.5);
  });

  it('lands on whichever half of a stair it falls onto', () => {
    const world = beach();
    world.setVoxel(3, SEA_LEVEL, 0, Block.StoneStairE);
    expect(walk(createWalker(3.2, SEA_LEVEL + 3, 0.5), world, 0, 0, 1).y).toBe(SEA_LEVEL + 0.5);
    expect(walk(createWalker(3.8, SEA_LEVEL + 3, 0.5), world, 0, 0, 1).y).toBe(SEA_LEVEL + 1);
  });
});
