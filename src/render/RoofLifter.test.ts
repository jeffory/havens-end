import { describe, expect, it } from 'vitest';
import { Block, BLOCK_PALETTE } from '../voxel/blocks';
import { FLAG_CUTAWAY } from '../voxel/palette';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { buildHouse, type Footprint } from '../worldgen/buildings';
import { type Lift, RoofLifter } from './RoofLifter';

const GROUND = 10;
const BASE = GROUND + 1;
const HOUSE: Footprint = { x0: 0, z0: 0, w: 7, d: 5 };

/** A one-storey thatched house on flat ground. */
function village() {
  const world = new VoxelWorld();
  for (let x = -12; x < 20; x++) for (let z = -12; z < 20; z++) for (let y = 0; y <= GROUND; y++) world.setVoxel(x, y, z, Block.Grass);
  buildHouse(world, HOUSE, BASE, { walls: Block.Plaster, roof: Block.Thatch }, 3.5, -10);
  return world;
}

/** As the terrain shader tests it: the middle of the voxel, inside a box and above where it lifts from. */
const lifted = (lifts: Lift[], x: number, y: number, z: number) =>
  lifts.some((l) => y + 0.5 > l.from && x + 0.5 > l.x0 && x + 0.5 < l.x1 && z + 0.5 > l.z0 && z + 0.5 < l.z1);

function blocksOf(world: VoxelWorld, id: number): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let x = HOUSE.x0 - 2; x < HOUSE.x0 + HOUSE.w + 2; x++) {
    for (let z = HOUSE.z0 - 2; z < HOUSE.z0 + HOUSE.d + 2; z++) for (let y = BASE; y < BASE + 12; y++) if (world.getVoxel(x, y, z) === id) out.push([x, y, z]);
  }
  return out;
}

/** The captain in front of the house (feet at `feet`), the camera high behind it, so the house is in the way. */
function liftFor(world: VoxelWorld, feet: number): Lift[] {
  const lifter = new RoofLifter(world);
  return lifter.update({ x: 3.5, y: feet + 1.2, z: -2.5 }, feet, { x: 3.5, y: feet + 8, z: 16 }, 1 / 60);
}

describe('RoofLifter', () => {
  it('lifts a house’s whole roof, eaves and all, and leaves its walls to head height', () => {
    const world = village();
    const lifts = liftFor(world, BASE);
    expect(lifts.length).toBeGreaterThan(0);
    const left = blocksOf(world, Block.Thatch).filter(([x, y, z]) => !lifted(lifts, x, y, z));
    expect(left, 'thatch left standing').toEqual([]);
    const walls = blocksOf(world, Block.Plaster).filter(([, y]) => y < BASE + 2);
    expect(walls.filter(([x, y, z]) => lifted(lifts, x, y, z)), 'walls lifted below head height').toEqual([]);
  });

  it('takes a lantern hung on a wall away with the wall', () => {
    const world = village();
    // Hung outside by the door (the house's door faces the captain's side, at z = -1).
    world.setVoxel(2, BASE + 2, -1, Block.Lantern);
    const lifts = liftFor(world, BASE);
    expect(lifted(lifts, 2, BASE + 2, -1)).toBe(true);
    // And the shader will take it: it's one of the blocks that lift.
    expect((BLOCK_PALETTE.flags![Block.Lantern] & FLAG_CUTAWAY) !== 0).toBe(true);
  });

  it('lifts the whole roof too when the captain stands on higher ground than the house', () => {
    const world = village();
    const lifts = liftFor(world, BASE + 1);
    expect(lifts.length).toBeGreaterThan(0);
    const left = blocksOf(world, Block.Thatch).filter(([x, y, z]) => !lifted(lifts, x, y, z));
    expect(left, 'thatch left standing').toEqual([]);
  });

  it('clears the line of sight, however low it passes through a tall building', () => {
    // A two-storey house, the captain just behind it, the camera low on the other side.
    const world = new VoxelWorld();
    for (let x = -12; x < 20; x++) for (let z = -20; z < 20; z++) for (let y = 0; y <= GROUND; y++) world.setVoxel(x, y, z, Block.Grass);
    buildHouse(world, HOUSE, BASE, { walls: Block.Plaster, roof: Block.Thatch }, 3.5, 10, 2);
    const chest = { x: 3.5, y: BASE + 1.2, z: 5.6 };
    const camera = { x: 3.5, y: BASE + 14, z: -12 };
    const lifts = new RoofLifter(world).update(chest, BASE, camera, 1 / 60);
    const d = Math.hypot(camera.x - chest.x, camera.y - chest.y, camera.z - chest.z);
    const inTheWay: string[] = [];
    for (let t = 0; t < d; t += 0.05) {
      const [x, y, z] = [chest.x, chest.y, chest.z].map((c, i) => Math.floor(c + (([camera.x, camera.y, camera.z][i] - c) * t) / d));
      if ([Block.Plaster, Block.Window, Block.Thatch, Block.Wood].includes(world.getVoxel(x, y, z) as never) && !lifted(lifts, x, y, z)) inTheWay.push(`${x},${y},${z}`);
    }
    expect(inTheWay).toEqual([]);
  });

  it('never lifts the boards the captain stands on', () => {
    // A deck of planks, like a pier's, with a post standing on it in the way.
    const world = new VoxelWorld();
    for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) world.setVoxel(x, GROUND, z, Block.Planks);
    for (let y = GROUND + 1; y < GROUND + 7; y++) world.setVoxel(0, y, 2, Block.Wood);
    const lifts = new RoofLifter(world).update({ x: 0.5, y: GROUND + 2.2, z: -1.5 }, GROUND + 1, { x: 0.5, y: GROUND + 14, z: 14 }, 1 / 60);
    expect(lifts.length).toBeGreaterThan(0);
    for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) expect(lifted(lifts, x, GROUND, z), `deck at ${x},${z}`).toBe(false);
  });

  describe('in town', () => {
    /** A street of three houses: one in the way, one beside the captain, one far down the street. */
    function street() {
      const world = village();
      const beside: Footprint = { x0: 10, z0: -8, w: 6, d: 5 };
      const far: Footprint = { x0: -40, z0: -8, w: 6, d: 5 };
      for (let x = -45; x < 20; x++) for (let z = -12; z < 20; z++) for (let y = 0; y <= GROUND; y++) world.setVoxel(x, y, z, Block.Grass);
      buildHouse(world, beside, BASE, { walls: Block.Plaster, roof: Block.Thatch }, 3.5, -10);
      buildHouse(world, far, BASE, { walls: Block.Plaster, roof: Block.Thatch }, 3.5, -10);
      // A tree across the street: trees aren't lifted for being near, only for being in the way.
      for (let y = BASE; y < BASE + 5; y++) world.setVoxel(-4, y, -8, Block.Wood);
      for (let x = -6; x <= -2; x++) for (let z = -10; z <= -6; z++) world.setVoxel(x, BASE + 5, z, Block.Leaves);
      return { world, beside, far };
    }
    const roofOf = (world: VoxelWorld, f: Footprint) => {
      const out: Array<[number, number, number]> = [];
      for (let x = f.x0 - 1; x <= f.x0 + f.w; x++) for (let z = f.z0 - 1; z <= f.z0 + f.d; z++) for (let y = BASE; y < BASE + 12; y++) if (world.getVoxel(x, y, z) === Block.Thatch) out.push([x, y, z]);
      return out;
    };
    const captain = (x: number, z: number) => ({ x, y: BASE + 1.2, z });

    it('lifts every house near the captain, not only the one in the way', () => {
      const { world, beside, far } = street();
      const lifter = new RoofLifter(world);
      const lifts = lifter.update(captain(3.5, -4.5), BASE, { x: 3.5, y: BASE + 8, z: 16 }, 1 / 60, 12);
      expect(roofOf(world, beside).filter(([x, y, z]) => !lifted(lifts, x, y, z)), 'the house beside').toEqual([]);
      expect(roofOf(world, far).filter(([x, y, z]) => lifted(lifts, x, y, z)), 'the house down the street').toEqual([]);
      expect(lifted(lifts, -4, BASE + 5, -8), 'the tree').toBe(false);
    });

    it('keeps a house lifted till the captain is well clear of it, so it doesn’t flicker at the edge', () => {
      const { world, beside } = street();
      const lifter = new RoofLifter(world);
      // Away from the camera's line, so only nearness lifts: the camera straight overhead.
      const look = (x: number) => lifter.update(captain(x, -4.5), BASE, { x, y: BASE + 40, z: -4.5 }, 0.5, 12);
      const [bx, by, bz] = roofOf(world, beside)[0];
      // The house, with its eaves, starts 9 along.
      expect(lifted(look(-3), bx, by, bz), 'within 12').toBe(true);
      expect(lifted(look(-4), bx, by, bz), 'a little further, 13').toBe(true);
      expect(lifted(look(-7), bx, by, bz), 'well clear, 16').toBe(false);
    });

    it('spends its lifts on roofed buildings, not on the stalls, benches and flags about the square', () => {
      const { world, beside } = street();
      // A square full of low things nearer the captain than the house: benches, a stall, a flag.
      for (let i = 0; i < 16; i++) world.setVoxel(-8 + (i % 8) * 2, BASE, -12 + Math.floor(i / 8) * 2, Block.Planks);
      for (let y = BASE; y < BASE + 6; y++) world.setVoxel(6, y, -12, Block.Wood);
      for (let a = 1; a <= 5; a++) world.setVoxel(6 + a, BASE + 5, -12, Block.FlagBlack);
      const lifts = new RoofLifter(world).update(captain(3.5, -4.5), BASE, { x: 3.5, y: BASE + 40, z: -4.5 }, 1 / 60, 12);
      expect(roofOf(world, beside).filter(([x, y, z]) => !lifted(lifts, x, y, z)), 'the house beside').toEqual([]);
      expect(lifted(lifts, 8, BASE + 5, -12), 'the flag').toBe(false);
    });

    it('lifts an open shed’s roof whole, though its courses only meet at their edges', () => {
      const world = village();
      // Posts at the corners, and a stepped roof over them with no gable walls to join its courses.
      for (const [x, z] of [[10, -8], [14, -8], [10, -4], [14, -4]]) for (let y = BASE; y < BASE + 3; y++) world.setVoxel(x, y, z, Block.Wood);
      const roof: Array<[number, number, number]> = [];
      for (let x = 9; x <= 15; x++) {
        for (let z = -9; z <= -3; z++) {
          const y = BASE + 5 - Math.abs(z + 6);
          world.setVoxel(x, y, z, Block.Thatch);
          roof.push([x, y, z]);
        }
      }
      const lifts = new RoofLifter(world).update(captain(3.5, -4.5), BASE, { x: 3.5, y: BASE + 40, z: -4.5 }, 1 / 60, 12);
      expect(roof.filter(([x, y, z]) => !lifted(lifts, x, y, z)), 'thatch left standing').toEqual([]);
      expect(lifts.length, 'lifts spent on it').toBeLessThanOrEqual(3);
    });

    it('lifts nothing for nearness out of town', () => {
      const { world, beside } = street();
      const lifts = new RoofLifter(world).update(captain(3.5, -4.5), BASE, { x: 3.5, y: BASE + 40, z: -4.5 }, 1 / 60);
      expect(roofOf(world, beside).filter(([x, y, z]) => lifted(lifts, x, y, z))).toEqual([]);
    });
  });
});
