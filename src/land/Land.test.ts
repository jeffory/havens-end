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
import { CROPS } from './crops';
import { CLAIM_RADIUS, Land } from './Land';

function box(length: number, beam: number): Float32Array {
  const cells: Array<[number, number]> = [];
  for (let x = 0; x < beam; x++) for (let z = 0; z < length; z++) cells.push([x - beam / 2, z - length / 2]);
  return footprintSamples(cells);
}

const CLASSES = new Map(
  [SLOOP, BRIG, MERCHANT_SLOOP, MERCHANT_BRIG].map((type) => [type, shipClass(type, box(15, 5), 2.5, 16)] as const),
);

const FAR_PORT: Port = { id: 0, name: 'Haven', faction: 'merchant', x: 3000, z: 0, heading: 0, islandX: 3000, islandZ: 0, pier: { x: 3000, y: 13, z: 0 }, places: [] };

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
  it('fells trees and breaks rock anywhere, into the pack', () => {
    const { world, land } = setup();
    land.goAshore();
    walkTo(land, 10.5, 9); // facing +z, the tree just ahead
    expect(land.use('axe').ok).toBe(true);
    expect(land.pack.timber).toBe(4);
    expect(world.getVoxel(10, SEA_LEVEL + 5, 10)).toBe(Block.Air);
    walkTo(land, 20.5, 4);
    expect(land.use('pickaxe').ok).toBe(true);
    expect(land.pack.stone).toBe(1);
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
    land.step(1, 0, 0);
    expect(world.getVoxel(5, SEA_LEVEL + 3, 6)).toBe(Block.CaneTop);
    expect(land.interaction()?.kind).toBe('harvest');
    expect(land.use('shovel').ok).toBe(true); // any tool picks a ripe crop
    expect(land.pack.sugar).toBe(CROPS.cane.amount);
    expect(world.getVoxel(5, SEA_LEVEL + 1, 6)).toBe(Block.Air);
  });

  it('shovels the ground level with your feet', () => {
    const { world, land } = setup();
    land.goAshore();
    land.pack.timber = 5;
    land.build('campfire', 0, -6, 0);
    walkTo(land, 0.5, 0.5);
    expect(land.use('shovel').ok).toBe(true); // level ground: dig
    expect(world.getVoxel(0, SEA_LEVEL, 1)).toBe(Block.Air);
    expect(land.use('shovel').ok).toBe(true); // a hole: fill
    expect(world.getVoxel(0, SEA_LEVEL, 1)).toBe(Block.Dirt);
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
