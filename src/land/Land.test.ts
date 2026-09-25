import { describe, expect, it } from 'vitest';
import { Sea } from '../combat/sea';
import { createAi } from '../combat/ai';
import { createVessel, shipClass } from '../combat/vessel';
import { SEA_LEVEL } from '../config';
import { cargoCount } from '../economy/goods';
import type { Port } from '../economy/ports';
import { footprintSamples } from '../sailing/hull';
import { BRIG, MERCHANT_BRIG, MERCHANT_SLOOP, SLOOP } from '../sailing/ships';
import { Weather } from '../sailing/weather';
import { Block } from '../voxel/blocks';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { PACK_SIZE } from '../economy/captain';
import { WATER_LEVEL } from '../ocean/waves';
import { CROPS } from './crops';
import { DROP_SECONDS } from './drops';
import { palmTree } from '../worldgen/island';
import { type Deposit, type DepositKind, DEPOSITS, Deposits, REGROW_DAYS } from './deposits';
import { CLAIM_RADIUS, Land, TOOL_LIST } from './Land';

function box(length: number, beam: number): Float32Array {
  const cells: Array<[number, number]> = [];
  for (let x = 0; x < beam; x++) for (let z = 0; z < length; z++) cells.push([x - beam / 2, z - length / 2]);
  return footprintSamples(cells);
}

const CLASSES = new Map(
  [SLOOP, BRIG, MERCHANT_SLOOP, MERCHANT_BRIG].map((type) => [type, shipClass(type, box(15, 5), 2.5, 16)] as const),
);

const FAR_PORT: Port = { id: 0, name: 'Haven', faction: 'merchant', x: 3000, z: 0, heading: 0, islandX: 3000, islandZ: 0, pier: { x: 3000, y: 13, z: 0 }, places: [], lamps: [] };

/** A flat grassy island from x, z = -40 to 40 (ground top at SEA_LEVEL + 1), a tree on it, and the ship lying off its east shore. */
function setup() {
  const world = new VoxelWorld();
  for (let x = -40; x < 40; x++) {
    for (let z = -40; z < 40; z++) {
      for (let y = 0; y <= SEA_LEVEL; y++) world.setVoxel(x, y, z, y === SEA_LEVEL ? Block.Grass : Block.Dirt);
    }
  }
  // A beach along the east shore, a rock, and a little tree.
  for (let z = -40; z < 40; z++) for (let x = 36; x < 40; x++) world.setVoxel(x, SEA_LEVEL, z, Block.Air), world.setVoxel(x, SEA_LEVEL - 1, z, Block.Sand);
  world.setVoxel(20, SEA_LEVEL + 1, 5, Block.Stone);
  for (let y = SEA_LEVEL + 1; y < SEA_LEVEL + 5; y++) world.setVoxel(10, y, 10, Block.Wood);
  for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) world.setVoxel(10 + dx, SEA_LEVEL + 5, 10 + dz, Block.Leaves);

  const sea = new Sea(world, new Weather({ cells: [] }), CLASSES, SLOOP, [FAR_PORT], 1, false);
  Object.assign(sea.player.ship, { x: 50, z: 0, heading: 0, surge: 0 });
  const land = new Land(world, sea);
  return { world, sea, land };
}

function walkTo(land: Land, x: number, z: number, facing = 0) {
  const w = land.walker!;
  Object.assign(w, { x, z, facing, y: land.world.surfaceHeight(Math.floor(x), Math.floor(z)) });
}

/** Lets what's come loose fall, then walks the captain over to each thing lying about to pick it up. */
function gather(land: Land) {
  for (let i = 0; i < 120; i++) land.step(1 / 60);
  const w = land.walker!;
  const home = { x: w.x, y: w.y, z: w.z };
  for (const d of [...land.drops]) {
    Object.assign(w, { x: d.x, y: d.y, z: d.z });
    for (let i = 0; i < 60 && land.drops.includes(d); i++) land.step(1 / 60);
  }
  Object.assign(w, home);
}

/** An outcrop of `kind` on the flat grass, footprint (x0..x0+1, z0..z0+1): four blocks and one on top. */
function outcrop(land: Land, kind: DepositKind, x0 = -20, z0 = -20, id = 1): Deposit {
  const y = SEA_LEVEL + 1;
  const ore = DEPOSITS[kind].ore;
  const cells: Array<[number, number, number, number]> = [[x0, y, z0, ore], [x0 + 1, y, z0, ore], [x0, y, z0 + 1, ore], [x0 + 1, y, z0 + 1, ore], [x0, y + 1, z0, ore]];
  for (const [x, cy, z, b] of cells) land.world.setVoxel(x, cy, z, b);
  const d: Deposit = { id, kind, x: x0, z: z0, cells };
  land.deposits = new Deposits([...land.deposits.list, d]);
  return d;
}

describe('going ashore', () => {
  it('rows ashore from a ship lying off a beach, and back aboard stows the pack', () => {
    const { sea, land } = setup();
    expect(land.goAshore().ok).toBe(true);
    expect(sea.ashore).toBe(true);
    expect(land.walker!.x).toBeLessThan(40);
    land.pack.timber = 12;
    expect(land.nearShip()).toBe(true);
    expect(land.goAboard().ok).toBe(true);
    expect(land.walker).toBeNull();
    expect(sea.ashore).toBe(false);
    expect(sea.player.cargo.timber).toBe(12);
    expect(cargoCount(land.pack)).toBe(0);
  });

  it('needs a beach nearby and a ship at rest', () => {
    const { sea, land } = setup();
    sea.player.ship.x = 90;
    expect(land.goAshore().ok).toBe(false);
    sea.player.ship.x = 50;
    sea.player.ship.surge = 8;
    expect(land.goAshore().ok).toBe(false);
  });

  it('not with enemies on your tail', () => {
    const { sea, land } = setup();
    const hunter = createVessel(sea.nextId++, 'Pirate sloop', 'pirate', sea.classFor(SLOOP), 90, 0, 0, 2);
    hunter.ai = createAi(0, 0, 0);
    hunter.ai.mode = 'engage';
    sea.add(hunter);
    expect(land.goAshore().message).toMatch(/enemies/);
  });

  it('keeps the ship at anchor while the captain is away', () => {
    const { sea, land } = setup();
    land.goAshore();
    const x = sea.player.ship.x;
    for (let i = 0; i < 120; i++) sea.step(1 / 60, { rudder: 1, sails: 1, ammo: 'round', fire: [], board: false });
    expect(sea.player.ship.x).toBe(x);
  });
});

describe('working the land', () => {
  it('fells trees and breaks outcrops: timber, saplings and stone to pick up', () => {
    const { world, land } = setup();
    land.goAshore();
    walkTo(land, 10.5, 9); // facing +z, the tree just ahead
    // A small tree stands three blows: the first two only chip it.
    expect(land.use('axe').ok).toBe(true);
    expect(land.use('axe').ok).toBe(true);
    expect(world.getVoxel(10, SEA_LEVEL + 1, 10)).toBe(Block.Wood);
    expect(land.drops).toHaveLength(0);
    expect(land.takeEvents().filter((e) => e.kind === 'work').map((e) => e.kind === 'work' && e.action)).toEqual(['chop', 'chop']);
    expect(land.use('axe').ok).toBe(true);
    expect(world.getVoxel(10, SEA_LEVEL + 5, 10)).toBe(Block.Air);
    // A piece of timber from each block of trunk, and a sapling or two from the leaves.
    expect(land.drops.filter((d) => d.good === 'timber')).toHaveLength(4);
    const saplings = land.drops.filter((d) => d.good === 'sapling').length;
    expect(saplings).toBeGreaterThanOrEqual(1);
    expect(saplings).toBeLessThanOrEqual(2);
    expect(land.pack.timber).toBeUndefined();
    gather(land);
    expect(land.pack.timber).toBe(4);
    expect(land.pack.sapling).toBe(saplings);
    outcrop(land, 'stone', 20, 5);
    walkTo(land, 20.5, 3.8); // facing the boulder
    for (let i = 0; i < DEPOSITS.stone.blows; i++) expect(land.use('pickaxe').ok).toBe(true);
    gather(land);
    expect(land.pack.stone).toBeGreaterThanOrEqual(DEPOSITS.stone.yield[0]);
  });

  it('fells one tree at a time, leaning palms and all, even where two canopies touch', () => {
    const { world, land } = setup();
    land.goAshore();
    palmTree(world, -10, SEA_LEVEL + 1, 0, 0.99); // leans after its fourth block, fronds reaching three out
    palmTree(world, -10, SEA_LEVEL + 1, 6, 0.99);
    const before = (z0: number, z1: number) => {
      let n = 0;
      for (let x = -16; x <= -4; x++) for (let z = z0; z <= z1; z++) for (let y = SEA_LEVEL + 1; y < SEA_LEVEL + 12; y++) n += world.getVoxel(x, y, z) === Block.Air ? 0 : 1;
      return n;
    };
    const second = before(4, 12);
    walkTo(land, -9.5, -1);
    // A tall palm stands five blows, wherever on her they land.
    for (let i = 0; i < 4; i++) expect(land.use('axe', i % 2 ? { x: -10, y: SEA_LEVEL + 2, z: 0 } : undefined).ok).toBe(true);
    expect(land.drops).toHaveLength(0);
    expect(land.use('axe').ok).toBe(true);
    expect(land.drops.filter((d) => d.good === 'timber').length).toBeGreaterThanOrEqual(7);
    expect(before(-6, 2)).toBe(0); // all of it, the leaning top and the fronds too
    expect(before(4, 12)).toBeGreaterThan(second - 4); // the other palm stands
    expect(world.getVoxel(-10, SEA_LEVEL + 1, 6)).toBe(Block.Wood);
  });

  it('needs a campfire before shaping or farming the land, and the fire needs timber', () => {
    const { land } = setup();
    land.goAshore();
    walkTo(land, 0.5, 0.5);
    expect(land.use('hoe').message).toMatch(/campfire/);
    expect(land.build('campfire', 0, 3, 0).message).toMatch(/timber/);
    land.pack.timber = 5;
    expect(land.build('campfire', 0, 3, 0).ok).toBe(true);
    expect(land.pack.timber).toBeUndefined();
    expect(land.claimed(CLAIM_RADIUS - 2, 3)).toBe(true);
    expect(land.claimed(CLAIM_RADIUS + 5, 3)).toBe(false);
  });

  it('tills, plants, grows and harvests', () => {
    const { world, sea, land } = setup();
    land.goAshore();
    land.pack.timber = 5;
    land.build('campfire', 0, -6, 0);
    land.pack.caneCuttings = 2;
    walkTo(land, 5.5, 5.5);
    expect(land.use('hoe').ok).toBe(true);
    expect(world.getVoxel(5, SEA_LEVEL, 6)).toBe(Block.Soil);
    expect(land.use('caneCuttings').ok).toBe(true);
    expect(land.pack.caneCuttings).toBe(1);
    expect(world.getVoxel(5, SEA_LEVEL + 1, 6)).toBe(Block.Sprout);
    expect(land.interaction()).toBeNull();
    sea.time += CROPS.cane.seconds;
    land.step(1);
    expect(world.getVoxel(5, SEA_LEVEL + 3, 6)).toBe(Block.CaneTop);
    expect(land.interaction()?.kind).toBe('harvest');
    expect(land.use('axe').ok).toBe(true); // any tool picks a ripe crop
    gather(land);
    expect(land.pack.cane).toBe(CROPS.cane.amount);
    expect(world.getVoxel(5, SEA_LEVEL + 1, 6)).toBe(Block.Air);
  });

  it('has no shovel: the captain digs for treasure where they stand, and the ground is left as it was', () => {
    const { world, land } = setup();
    expect(TOOL_LIST).not.toContain('shovel');
    land.goAshore();
    walkTo(land, 0.5, 0.5);
    const top = SEA_LEVEL; // the ground under your feet
    const before = world.getVoxel(0, top, 0);
    expect(land.dig()).toEqual({ ok: true, message: expect.stringMatching(/nothing/i) });
    expect(world.getVoxel(0, top, 0)).toBe(before);
    expect(land.drops).toHaveLength(0);
    // Buried treasure is asked about the spot.
    const asked: number[][] = [];
    land.buried = { search: (x, y, z) => (asked.push([x, y, z]), 'Loose earth.') };
    expect(land.dig().message).toBe('Loose earth.');
    expect(asked).toEqual([[0, top, 0]]);
  });

  it('won’t dig rock', () => {
    const { world, land } = setup();
    land.goAshore();
    walkTo(land, 0.5, 0.5);
    world.setVoxel(0, SEA_LEVEL, 0, Block.Stone);
    expect(land.digAim()).toMatchObject({ ok: false, reason: expect.stringMatching(/hard/) });
    expect(land.dig().ok).toBe(false);
    expect(world.getVoxel(0, SEA_LEVEL, 0)).toBe(Block.Stone);
  });

  it('plants saplings on open ground, and they grow into trees', () => {
    const { world, sea, land } = setup();
    land.goAshore();
    walkTo(land, 0.5, 0.5);
    expect(land.use('sapling').message).toMatch(/no saplings/);
    land.pack.sapling = 1;
    expect(land.use('sapling').ok).toBe(true);
    expect(world.getVoxel(0, SEA_LEVEL + 1, 1)).toBe(Block.Sprout);
    expect(land.pack.sapling).toBeUndefined();
    sea.time += 1000;
    land.step(1);
    expect(world.getVoxel(0, SEA_LEVEL + 1, 1)).toBe(Block.Wood);
  });
});

describe('reach', () => {
  it('works an outcrop under a canopy, not the air beneath the leaves', () => {
    const { world, land } = setup();
    land.goAshore();
    outcrop(land, 'stone', 0, 1);
    walkTo(land, 0.5, 0.5);
    const feet = SEA_LEVEL + 1;
    world.setVoxel(0, feet + 3, 1, Block.Leaves);
    expect(land.aim('pickaxe', { x: 0, z: 1 })).toMatchObject({ ok: true, action: 'mine', y: feet });
  });

  it('reaches an outcrop block picked with the mouse, if it’s in reach', () => {
    const { land } = setup();
    land.goAshore();
    outcrop(land, 'iron', 0, 1);
    walkTo(land, 0.5, 0.5);
    const feet = SEA_LEVEL + 1;
    expect(land.aim('pickaxe', { x: 0, y: feet + 1, z: 1 })).toMatchObject({ ok: true, action: 'mine', y: feet + 1 });
    expect(land.aim('hoe', { x: 0, z: 1 }).ok).toBe(false);
  });

  it('reaches only a couple of blocks down', () => {
    const { world, land } = setup();
    land.goAshore();
    walkTo(land, 0.5, 0.5);
    for (let y = 0; y <= SEA_LEVEL; y++) world.setVoxel(0, y, 1, y < SEA_LEVEL - 3 ? Block.Dirt : Block.Air);
    const aim = land.aim('pickaxe', { x: 0, z: 1 });
    expect(aim.ok).toBe(false);
    expect(aim.x).toBeUndefined(); // nothing to mark
  });
});

describe('outcrops', () => {
  it('stand so many blows, then break up into what they hold', () => {
    const { world, land } = setup();
    land.goAshore();
    const d = outcrop(land, 'copper');
    walkTo(land, -19.5, -21.2); // facing its near side
    for (let i = 1; i < DEPOSITS.copper.blows; i++) expect(land.use('pickaxe').ok).toBe(true);
    for (const [x, y, z, b] of d.cells) expect(world.getVoxel(x, y, z)).toBe(b);
    expect(land.drops).toHaveLength(0);
    expect(land.use('pickaxe').ok).toBe(true);
    for (const [x, y, z] of d.cells) expect(world.getVoxel(x, y, z)).toBe(Block.Air);
    const won = land.drops.filter((drop) => drop.good === 'copperOre').reduce((n, drop) => n + drop.amount, 0);
    expect(won).toBeGreaterThanOrEqual(DEPOSITS.copper.yield[0]);
    expect(won).toBeLessThanOrEqual(DEPOSITS.copper.yield[1]);
    const actions = land.takeEvents().flatMap((e) => (e.kind === 'work' ? [e.action] : []));
    expect(actions).toEqual([...Array(DEPOSITS.copper.blows - 1).fill('mine'), 'break']);
  });

  it('are all the pickaxe breaks: the island’s own rock stays', () => {
    const { world, land } = setup();
    land.goAshore();
    world.setVoxel(0, SEA_LEVEL + 1, 1, Block.Stone);
    walkTo(land, 0.5, 0.5);
    expect(land.use('pickaxe').message).toMatch(/Only outcrops/);
    expect(world.getVoxel(0, SEA_LEVEL + 1, 1)).toBe(Block.Stone);
  });

  it('grow back after three days, but not into someone standing there', () => {
    const { world, sea, land } = setup();
    land.goAshore();
    const d = outcrop(land, 'stone');
    walkTo(land, -19.5, -21.2);
    for (let i = 0; i < DEPOSITS.stone.blows; i++) land.use('pickaxe');
    sea.clock.day += REGROW_DAYS - 1;
    land.step(1.1);
    expect(world.getVoxel(-20, SEA_LEVEL + 1, -20)).toBe(Block.Air);
    sea.clock.day += 1;
    walkTo(land, -19.5, -19.5); // standing in it
    land.step(1.1);
    expect(world.getVoxel(-20, SEA_LEVEL + 1, -20)).toBe(Block.Air);
    walkTo(land, -10.5, -10.5);
    land.step(1.1);
    for (const [x, y, z, b] of d.cells) expect(world.getVoxel(x, y, z)).toBe(b);
  });

  it('won’t grow back hanging over dug-out ground, or onto a tilled field', () => {
    const { world, sea, land } = setup();
    land.goAshore();
    const d = outcrop(land, 'stone');
    walkTo(land, -19.5, -21.2);
    for (let i = 0; i < DEPOSITS.stone.blows; i++) land.use('pickaxe');
    walkTo(land, -10.5, -10.5);
    world.setVoxel(-20, SEA_LEVEL, -20, Block.Air); // dug out (an older save's shovel)
    world.setVoxel(-19, SEA_LEVEL, -19, Block.Soil); // tilled
    sea.clock.day += REGROW_DAYS;
    land.step(1.1);
    expect(world.getVoxel(-19, SEA_LEVEL + 1, -20)).toBe(Block.Air);
    world.setVoxel(-20, SEA_LEVEL, -20, Block.Grass);
    land.step(1.1);
    expect(world.getVoxel(-19, SEA_LEVEL + 1, -20)).toBe(Block.Air); // the field still stops it
    world.setVoxel(-19, SEA_LEVEL, -19, Block.Grass);
    land.step(1.1);
    for (const [x, y, z, b] of d.cells) expect(world.getVoxel(x, y, z)).toBe(b);
  });

  it('a building on a worked-out outcrop’s spot keeps it from growing back', () => {
    const { world, sea, land } = setup();
    land.goAshore();
    outcrop(land, 'stone', -12, -12);
    land.pack.timber = 20;
    walkTo(land, -11.5, -13.2);
    for (let i = 0; i < DEPOSITS.stone.blows; i++) land.use('pickaxe');
    expect(land.build('campfire', -4, -4, 0).ok).toBe(true);
    expect(land.build('fence', -12, -12, 0).ok).toBe(true);
    sea.clock.day += REGROW_DAYS + 1;
    walkTo(land, -4.5, -8.5);
    land.step(1.1);
    expect(world.getVoxel(-11, SEA_LEVEL + 1, -11)).toBe(Block.Air);
  });

  it('can’t be built over while they stand', () => {
    const { land } = setup();
    land.goAshore();
    outcrop(land, 'iron', -12, -12);
    land.pack.timber = 20;
    land.pack.stone = 20;
    walkTo(land, -4.5, -8.5);
    expect(land.build('campfire', -4, -4, 0).ok).toBe(true);
    expect(land.placement('hut', -12, -12, 0).reason).toMatch(/outcrop/);
  });

  it('are saved worked out, and grow back on time after a load', () => {
    const { world, sea, land } = setup();
    land.goAshore();
    const d = outcrop(land, 'stone');
    walkTo(land, -19.5, -21.2);
    for (let i = 0; i < DEPOSITS.stone.blows; i++) land.use('pickaxe');
    const saved = JSON.parse(JSON.stringify(land.snapshot()));
    const again = new Land(world, sea);
    again.deposits = new Deposits([d]);
    again.restore(saved);
    expect(again.deposits.at(-20, SEA_LEVEL + 1, -20)).toBeNull();
    sea.clock.day += REGROW_DAYS;
    again.step(1.1);
    expect(world.getVoxel(-20, SEA_LEVEL + 1, -20)).toBe(DEPOSITS.stone.ore);
  });

  it('an outcrop a save’s own edits wiped out on a claim never grows back; off it, it does', () => {
    const { world, sea, land } = setup();
    land.goAshore();
    walkTo(land, -4.5, -8.5);
    land.pack.timber = 5;
    expect(land.build('campfire', -4, -4, 0).ok).toBe(true);
    const camp = outcrop(land, 'stone', -20, -20, 1); // within the claim
    const wild = outcrop(land, 'stone', 30, 30, 2); // well outside it
    const saved = JSON.parse(JSON.stringify(land.snapshot()));
    for (const d of [camp, wild]) for (const [x, y, z] of d.cells) world.setVoxel(x, y, z, Block.Air); // an older save's chunks, loaded over them
    delete saved.deposits; // and that save knew nothing of outcrops
    const again = new Land(world, sea);
    again.deposits = new Deposits([camp, wild]);
    again.restore(saved);
    sea.clock.day += 30;
    again.step(1.1);
    expect(world.getVoxel(-20, SEA_LEVEL + 1, -20)).toBe(Block.Air);
    expect(world.getVoxel(30, SEA_LEVEL + 1, 30)).toBe(DEPOSITS.stone.ore);
  });

  it('a miner’s whole outcrop at once, for the camp’s stores', () => {
    const { world, land } = setup();
    const d = outcrop(land, 'silver');
    const got = land.mineDeposit(d.id);
    expect(got?.good).toBe('silverOre');
    expect(got!.amount).toBeGreaterThanOrEqual(DEPOSITS.silver.yield[0]);
    expect(world.getVoxel(-20, SEA_LEVEL + 1, -20)).toBe(Block.Air);
    expect(land.mineDeposit(d.id)).toBeNull();
  });
});

describe('things lying about', () => {
  it('fall and come to rest on the ground, and float in the sea', () => {
    const { land } = setup();
    land.drop('stone', 5.5, SEA_LEVEL + 4, 5.5);
    land.drop('timber', 60.5, SEA_LEVEL + 4, 5.5); // off the island
    for (let i = 0; i < 180; i++) land.step(1 / 60);
    const [stone, timber] = land.drops;
    expect(stone.still).toBe(true);
    expect(stone.y).toBe(SEA_LEVEL + 1);
    expect(timber.still).toBe(true);
    expect(timber.y).toBeCloseTo(WATER_LEVEL - 0.15);
  });

  it('pile up together, and are gone in time', () => {
    const { land } = setup();
    for (let i = 0; i < 4; i++) land.drop('earth', 5.5, SEA_LEVEL + 1.2, 5.5);
    for (const d of land.drops) Object.assign(d, { vx: 0, vz: 0 });
    for (let i = 0; i < 120; i++) land.step(1 / 60);
    expect(land.drops).toHaveLength(1);
    expect(land.drops[0].amount).toBe(4);
    land.step(DROP_SECONDS);
    expect(land.drops).toHaveLength(0);
  });

  it('stay on the ground when the pack is full', () => {
    const { land } = setup();
    land.goAshore();
    walkTo(land, 10.5, 9);
    land.pack.stone = PACK_SIZE;
    for (let i = 0; i < 3; i++) land.use('axe');
    gather(land);
    expect(land.pack.timber).toBeUndefined();
    expect(land.drops.filter((d) => d.good === 'timber').reduce((n, d) => n + d.amount, 0)).toBe(4);
    expect(land.takeEvents().some((e) => e.kind === 'notice' && /full/.test(e.text))).toBe(true);
  });
});

describe('building', () => {
  it('draws materials from the pack, then the ship at anchor, and lays a hut on level ground', () => {
    const { world, sea, land } = setup();
    land.goAshore();
    land.pack.timber = 5;
    land.build('campfire', 20, 0, 0);
    sea.player.cargo = { timber: 40, stone: 20 };
    land.pack.timber = 10;
    walkTo(land, 25, 0);
    const hut = land.build('hut', 25, 10, 0);
    expect(hut.ok).toBe(true);
    expect(land.pack.timber).toBeUndefined();
    expect(sea.player.cargo).toEqual({ timber: 20, stone: 10 });
    // Planks for walls, thatch on top.
    expect(world.getVoxel(23, SEA_LEVEL + 1, 8)).toBe(Block.Planks);
    expect(land.interaction()).toBeNull();
    expect(land.build('hut', 25, 12, 0).message).toMatch(/Too close/);
  });

  it('lays fences and paths one cell at a time, and takes them up again', () => {
    const { world, land } = setup();
    land.goAshore();
    land.pack.timber = 7;
    land.pack.stone = 1;
    land.build('campfire', 0, -6, 0);
    expect(land.build('fence', 4, 4, 0).ok).toBe(true);
    expect(land.build('fence', 5, 4, 0).ok).toBe(true);
    expect(land.build('path', 4, 6, 0).ok).toBe(true);
    expect(world.getVoxel(4, SEA_LEVEL + 1, 4)).toBe(Block.Fence);
    expect(world.getVoxel(4, SEA_LEVEL, 6)).toBe(Block.Gravel);
    walkTo(land, 4.5, 3);
    expect(land.use('axe').ok).toBe(true);
    expect(world.getVoxel(4, SEA_LEVEL + 1, 4)).toBe(Block.Air);
    expect(land.pack.timber).toBe(1);
  });

  it('keeps goods in a storehouse, and a campfire with buildings on its claim stays', () => {
    const { land } = setup();
    land.goAshore();
    land.pack.timber = 45;
    land.pack.stone = 15;
    land.build('campfire', 0, -6, 0);
    expect(land.build('storehouse', 0, 6, 1).ok).toBe(true);
    const store = land.buildings.find((b) => b.kind === 'storehouse')!;
    const fire = land.buildings.find((b) => b.kind === 'campfire')!;
    expect(land.demolish(fire.id).ok).toBe(false);
    land.pack.sugar = 10;
    expect(Land.transfer(land.pack, store.store!, 'sugar', 10, 150)).toBe(10);
    expect(land.demolish(store.id).message).toMatch(/Empty/);
    Land.transfer(store.store!, land.pack, 'sugar', 10, 40);
    expect(land.demolish(store.id).ok).toBe(true);
    expect(land.pack.timber).toBe(20);
  });

  it("won't touch a port's town", () => {
    const { land, sea } = setup();
    land.goAshore();
    land.pack.timber = 5;
    (sea.ports as Port[])[0] = { ...FAR_PORT, x: 30, z: 0 };
    expect(land.build('campfire', 0, 0, 0).message).toMatch(/town/);
    walkTo(land, 10.5, 9);
    expect(land.use('axe').message).toMatch(/town/);
  });
});
