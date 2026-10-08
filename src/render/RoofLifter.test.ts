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

  describe('shops', () => {
    /** Flat grass round the shop. */
    function flat() {
      const world = new VoxelWorld();
      for (let x = -12; x < 30; x++) for (let z = -20; z < 20; z++) for (let y = 0; y <= GROUND; y++) world.setVoxel(x, y, z, Block.Grass);
      return world;
    }
    /** The camera straight over the captain, so only nearness lifts. */
    const overhead = (x: number, z: number) => ({ x, y: BASE + 40, z: z + 0.01 });
    /** The blocks of these kinds in a plot and a block round it. */
    function blocks(world: VoxelWorld, f: Footprint, ids: readonly number[]): Array<[number, number, number]> {
      const out: Array<[number, number, number]> = [];
      for (let x = f.x0 - 1; x <= f.x0 + f.w; x++) {
        for (let z = f.z0 - 1; z <= f.z0 + f.d; z++) for (let y = BASE; y < BASE + 12; y++) if (ids.includes(world.getVoxel(x, y, z))) out.push([x, y, z]);
      }
      return out;
    }

    /**
     * An open hall like the market's: posts at the corners and every other cell down both
     * sides, a wall across the back, open at the front (toward −z), under a gable roof whose
     * ridge runs along the front, its eaves at head height.
     */
    function openHall(world: VoxelWorld, f: Footprint): void {
      const [x1, z1] = [f.x0 + f.w - 1, f.z0 + f.d - 1];
      for (let x = f.x0; x <= x1; x++) {
        for (let z = f.z0; z <= z1; z++) {
          world.setVoxel(x, BASE - 1, z, Block.Planks);
          const side = x === f.x0 || x === x1;
          if (z === z1) for (let y = BASE; y < BASE + 3; y++) world.setVoxel(x, y, z, Block.Plaster);
          else if (side && (z - f.z0) % 2 === 0) for (let y = BASE; y < BASE + 3; y++) world.setVoxel(x, y, z, Block.Wood);
        }
      }
      for (let x = f.x0 - 1; x <= x1 + 1; x++) {
        for (let z = f.z0 - 1; z <= z1 + 1; z++) world.setVoxel(x, BASE + 3 + Math.round((f.d + 1) / 2 - Math.abs(z - (f.z0 + (f.d - 1) / 2))) - 1, z, Block.Thatch);
      }
    }

    /**
     * A shipyard's shed: a plank wall across the back and up one end, posts at the open
     * corners, a gable roof with its ridge along the shed, and timber stacked against the
     * back. Open at the front (toward −z) and at the other end.
     */
    function shed(world: VoxelWorld, f: Footprint): void {
      const [x1, z1] = [f.x0 + f.w - 1, f.z0 + f.d - 1];
      for (let x = f.x0; x <= x1; x++) {
        for (let z = f.z0; z <= z1; z++) {
          world.setVoxel(x, BASE - 1, z, Block.Planks);
          const wall = z === z1 || x === x1;
          const post = (x === f.x0 || x === x1) && (z === f.z0 || z === z1);
          if (wall || post) for (let y = BASE; y < BASE + 3; y++) world.setVoxel(x, y, z, wall ? Block.Planks : Block.Wood);
        }
      }
      const half = (f.d - 1) / 2 + 1;
      for (let x = f.x0 - 1; x <= x1 + 1; x++) {
        for (let z = f.z0 - 1; z <= z1 + 1; z++) world.setVoxel(x, BASE + 3 + Math.round(half - Math.abs(z - (f.z0 + (f.d - 1) / 2))) - 1, z, Block.Thatch);
      }
      for (let x = f.x0 + 1; x < x1; x++) for (let y = BASE; y < BASE + 2; y++) world.setVoxel(x, y, z1 - 1, Block.Wood);
    }

    it('lifts an open market hall’s roof whole, from the middle of its open front and from inside, and leaves its posts to head height', () => {
      const world = flat();
      const hall: Footprint = { x0: 10, z0: -6, w: 6, d: 6 };
      openHall(world, hall);
      for (const [x, z] of [[12.5, -6.5], [12.5, -3.5]]) {
        const lifts = new RoofLifter(world).update({ x, y: BASE + 1.2, z }, BASE, overhead(x, z), 1 / 60, 2);
        expect(blocks(world, hall, [Block.Thatch]).filter(([bx, by, bz]) => !lifted(lifts, bx, by, bz)), `thatch left, from ${x},${z}`).toEqual([]);
        expect(blocks(world, hall, [Block.Wood, Block.Plaster]).filter(([bx, by, bz]) => by < BASE + 2 && lifted(lifts, bx, by, bz)), `lifted below head height, from ${x},${z}`).toEqual([]);
      }
    });

    it('lifts a three-sided shed’s roof whole, from its open front and from inside, and leaves its walls to head height', () => {
      const world = flat();
      const yard: Footprint = { x0: 10, z0: -6, w: 5, d: 5 };
      shed(world, yard);
      for (const [x, z] of [[12.5, -6.5], [11.5, -4.5]]) {
        const lifts = new RoofLifter(world).update({ x, y: BASE + 1.2, z }, BASE, overhead(x, z), 1 / 60, 2);
        expect(blocks(world, yard, [Block.Thatch]).filter(([bx, by, bz]) => !lifted(lifts, bx, by, bz)), `thatch left, from ${x},${z}`).toEqual([]);
        expect(blocks(world, yard, [Block.Wood, Block.Planks]).filter(([bx, by, bz]) => by < BASE + 2 && lifted(lifts, bx, by, bz)), `lifted below head height, from ${x},${z}`).toEqual([]);
      }
    });

    it('doesn’t take a shed’s roof with it for a prop grazing its corner, only its own edge', () => {
      const world = flat();
      const yard: Footprint = { x0: 10, z0: -6, w: 5, d: 5 };
      shed(world, yard);
      // A stall's blocker just beyond the shed's own ground, its top course touching the
      // eave's corner tile only at the edge (one cell out diagonally both ways), as a cart
      // squeezed into a tight corner of the square might.
      for (let y = BASE; y < BASE + 3; y++) world.setVoxel(8, y, -8, Block.Blocker);
      // Straight and level down the line x = 8.5, z = -20 to 10, well clear of the shed
      // itself (x 9 to 15 with its eaves), through the blocker's own height.
      const lifts = new RoofLifter(world).update({ x: 8.5, y: BASE + 1, z: -20 }, BASE, { x: 8.5, y: BASE + 1, z: 10 }, 1 / 60);
      expect(lifted(lifts, 8, BASE + 2, -8), 'the prop, in the way').toBe(true);
      expect(blocks(world, yard, [Block.Thatch]).filter(([bx, by, bz]) => lifted(lifts, bx, by, bz)), 'the shed, only grazed at the corner').toEqual([]);
    });

    it('cuts a two-storey shop at head height from its porch, canopy, jambs and all, as a house is cut', () => {
      const world = flat();
      const plot: Footprint = { x0: 0, z0: 0, w: 7, d: 6 };
      const door = buildHouse(world, plot, BASE, { walls: Block.Plaster, roof: Block.Thatch }, 3.5, -10, 2);
      // A porch as the town builds one: a deck of plank slabs three wide and two deep, a canopy
      // over it a storey up, and the doorway opened a storey high, its jambs carried up beside it.
      for (let k = 1; k <= 2; k++) {
        for (let a = -1; a <= 1; a++) {
          world.setVoxel(door.x + a, BASE, door.z - k, Block.PlanksSlab);
          world.setVoxel(door.x + a, BASE + 3, door.z - k, Block.PlanksSlab);
        }
      }
      world.setVoxel(door.x, BASE + 2, door.z, Block.Air);
      for (const a of [-1, 1]) for (let y = BASE; y <= BASE + 2; y++) world.setVoxel(door.x + a, y, door.z, Block.Wood);
      // The captain on the deck, half a block up, before the door.
      const [x, z] = [door.x + 0.5, door.z - 0.5];
      const lifts = new RoofLifter(world).update({ x, y: BASE + 1.7, z }, BASE + 0.5, overhead(x, z), 1 / 60, 2);
      const withPorch: Footprint = { x0: plot.x0, z0: plot.z0 - 2, w: plot.w, d: plot.d + 2 };
      const shop = blocks(world, withPorch, [Block.Plaster, Block.Window, Block.Wood, Block.Thatch, Block.PlanksSlab]);
      expect(shop.filter(([bx, by, bz]) => by >= BASE + 2 && !lifted(lifts, bx, by, bz)), 'left standing from head height up').toEqual([]);
      expect(shop.filter(([bx, by, bz]) => by < BASE + 2 && lifted(lifts, bx, by, bz)), 'lifted below head height').toEqual([]);
    });

    it('looks past a stall in the way to the roof behind it', () => {
      const world = village();
      // A stall's corner post between the captain and the house, and the camera beyond the house.
      for (let y = BASE; y < BASE + 3; y++) world.setVoxel(3, y, -4, Block.Wood);
      const chest = { x: 3.5, y: BASE + 1.2, z: -6.5 };
      const camera = { x: 3.5, y: BASE + 8, z: 16 };
      const lifts = new RoofLifter(world).update(chest, BASE, camera, 1 / 60);
      const d = Math.hypot(camera.x - chest.x, camera.y - chest.y, camera.z - chest.z);
      const inTheWay: string[] = [];
      for (let t = 0; t < d; t += 0.05) {
        const [x, y, z] = [chest.x, chest.y, chest.z].map((c, i) => Math.floor(c + (([camera.x, camera.y, camera.z][i] - c) * t) / d));
        if ([Block.Plaster, Block.Window, Block.Thatch, Block.Wood].includes(world.getVoxel(x, y, z) as never) && !lifted(lifts, x, y, z)) inTheWay.push(`${x},${y},${z}`);
      }
      expect(inTheWay).toEqual([]);
    });

    it('takes a prop that keeps people out away when it’s in the way: the lifter sees its blocker', () => {
      const world = village();
      // A stall's cells, as the town builder keeps people out of them (three high), between the captain and the house.
      for (let y = BASE; y < BASE + 3; y++) world.setVoxel(3, y, -4, Block.Blocker);
      const lifts = new RoofLifter(world).update({ x: 3.5, y: BASE + 1.2, z: -6.5 }, BASE, { x: 3.5, y: BASE + 8, z: 16 }, 1 / 60);
      // Its anchor is the cell its top is in: lifted, so the prop goes.
      expect(lifted(lifts, 3, BASE + 2, -4)).toBe(true);
    });

    it('doesn’t take a prop away just for the captain leaning on it, only when it’s really in the way', () => {
      const world = village();
      // The same stall's blocker, with the captain pressed right up against its near face
      // (half the walker's own width off it): some of the lifter's side rays start inside it.
      for (let y = BASE; y < BASE + 3; y++) world.setVoxel(3, y, -4, Block.Blocker);
      const chest = { x: 3.5, y: BASE + 1.2, z: -4.3 };
      // The camera behind the captain, the same side as them: the prop isn't in the way of
      // anything, so it stays, however hard they're leaning on it.
      const near = new RoofLifter(world).update(chest, BASE, { x: 3.5, y: BASE + 8, z: -16 }, 1 / 60);
      expect(lifted(near, 3, BASE + 2, -4), 'not in the way: stays').toBe(false);
      // The camera beyond it, toward the house: genuinely in the way, so it still goes.
      const through = new RoofLifter(world).update(chest, BASE, { x: 3.5, y: BASE + 8, z: 16 }, 1 / 60);
      expect(lifted(through, 3, BASE + 2, -4), 'in the way: goes').toBe(true);
    });
  });
});
