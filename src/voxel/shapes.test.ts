import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../config';
import { baseOf, Block, BLOCK_PALETTE, blocksWalker, FACING_DIRS, isPickable, isSolid, shapeOf, slabOf, stairFacing, stairOf } from './blocks';
import { FLAG_CUTAWAY } from './palette';
import { raycastVoxels } from './raycast';
import { boxBlocked, pointBlocked, topIn } from './shapes';
import { VoxelWorld } from './VoxelWorld';

describe('stairs and slabs', () => {
  it('come in gravel, stone and planks: a slab and four stairs each', () => {
    for (const material of [Block.Gravel, Block.Stone, Block.Planks]) {
      const slab = slabOf(material);
      expect(shapeOf(slab)).toHaveLength(1);
      expect(baseOf(slab)).toBe(material);
      expect(stairFacing(slab)).toBe(-1);
      for (let facing = 0; facing < 4; facing++) {
        const stair = stairOf(material, facing);
        expect(shapeOf(stair)).toHaveLength(2);
        expect(baseOf(stair)).toBe(material);
        expect(stairFacing(stair)).toBe(facing);
        expect(isSolid(stair)).toBe(true);
        expect(blocksWalker(stair)).toBe(true);
      }
    }
    expect(stairOf(Block.Gravel, 0)).toBe(Block.GravelStairS);
    expect(stairOf(Block.Planks, 3)).toBe(Block.PlanksStairW);
    expect(shapeOf(Block.Stone)).toBeNull();
    expect(baseOf(Block.Sand)).toBe(Block.Sand);
    expect(() => slabOf(Block.Sand)).toThrow();
  });

  it('take their colour and flags from what they are cut from', () => {
    expect(BLOCK_PALETTE.flags![Block.PlanksStairN] & FLAG_CUTAWAY).toBe(FLAG_CUTAWAY);
    for (let c = 0; c < 3; c++) expect(BLOCK_PALETTE.colors[Block.StoneSlab * 3 + c]).toBe(BLOCK_PALETTE.colors[Block.Stone * 3 + c]);
  });

  it('stand half a block high, or a whole one on a stair’s upper half', () => {
    expect(topIn(Block.Stone, 0.5, 0.5)).toBe(1);
    expect(topIn(Block.GravelSlab, 0.2, 0.8)).toBe(0.5);
    // Climbing south (+z): the low step on the north half, the top on the south half.
    expect(topIn(Block.StoneStairS, 0.5, 0.25)).toBe(0.5);
    expect(topIn(Block.StoneStairS, 0.5, 0.75)).toBe(1);
    // Every stair climbs the way FACING_DIRS says.
    for (let facing = 0; facing < 4; facing++) {
      const [dx, dz] = FACING_DIRS[facing];
      const stair = stairOf(Block.Planks, facing);
      expect(topIn(stair, 0.5 + dx * 0.25, 0.5 + dz * 0.25)).toBe(1);
      expect(topIn(stair, 0.5 - dx * 0.25, 0.5 - dz * 0.25)).toBe(0.5);
    }
  });

  it('block only their own boxes, not their whole cell', () => {
    const world = new VoxelWorld();
    world.setVoxel(0, SEA_LEVEL, 0, Block.StoneSlab);
    expect(boxBlocked(world, 0.2, SEA_LEVEL + 0.51, 0.2, 0.8, SEA_LEVEL + 1.5, 0.8)).toBe(false);
    expect(boxBlocked(world, 0.2, SEA_LEVEL + 0.4, 0.2, 0.8, SEA_LEVEL + 1.5, 0.8)).toBe(true);
    expect(pointBlocked(world, 0.5, SEA_LEVEL + 0.25, 0.5)).toBe(true);
    expect(pointBlocked(world, 0.5, SEA_LEVEL + 0.75, 0.5)).toBe(false);
    world.setVoxel(2, SEA_LEVEL, 0, Block.Stone);
    expect(pointBlocked(world, 2.5, SEA_LEVEL + 0.75, 0.5)).toBe(true);
  });
});

describe('the blocker', () => {
  it('is solid underfoot and to ships, but never picked, and no part of the ground', () => {
    const world = new VoxelWorld();
    world.setVoxel(0, SEA_LEVEL - 1, 0, Block.Sand);
    world.setVoxel(0, SEA_LEVEL + 2, 0, Block.Blocker);
    expect(isSolid(Block.Blocker)).toBe(true);
    expect(blocksWalker(Block.Blocker)).toBe(true);
    expect(isPickable(Block.Blocker)).toBe(false);
    expect(isPickable(Block.Stone)).toBe(true);
    expect(world.surfaceHeight(0, 0)).toBe(SEA_LEVEL);
    // A ray straight down passes through it to the sand.
    expect(raycastVoxels(world, 0.5, SEA_LEVEL + 5, 0.5, 0, -1, 0, 20)?.y).toBe(SEA_LEVEL - 1);
  });
});
