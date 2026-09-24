import { describe, expect, it } from 'vitest';
import { Sea } from '../combat/sea';
import { shipClass } from '../combat/vessel';
import { SEA_LEVEL } from '../config';
import { phaseOf } from '../core/clock';
import type { Port } from '../economy/ports';
import { footprintSamples } from '../sailing/hull';
import { BRIG, MERCHANT_BRIG, MERCHANT_SLOOP, SLOOP } from '../sailing/ships';
import { Weather } from '../sailing/weather';
import { Block } from '../voxel/blocks';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { campStores, stock } from './camps';
import { CROPS, SAPLING_SECONDS } from './crops';
import { Land } from './Land';
import { indoors } from './settlers';
import type { Building } from './structures';

const CLASSES = new Map(
  [SLOOP, BRIG, MERCHANT_SLOOP, MERCHANT_BRIG].map((type) => {
    const cells: Array<[number, number]> = [];
    for (let x = 0; x < 5; x++) for (let z = 0; z < 15; z++) cells.push([x - 2.5, z - 7.5]);
    return [type, shipClass(type, footprintSamples(cells), 2.5, 16)] as const;
  }),
);
const FAR_PORT: Port = { id: 0, name: 'Haven', faction: 'merchant', x: 3000, z: 0, heading: 0, islandX: 3000, islandZ: 0, pier: { x: 3000, y: 13, z: 0 }, places: [], lamps: [] };

/**
 * A flat grassy island from -40 to 40 with a beach on its east shore and the ship off
 * it, and a camp in the middle: a fire, a hut, a storehouse. Morning, day 1.
 */
function camp() {
  const world = new VoxelWorld();
  for (let x = -40; x < 40; x++) for (let z = -40; z < 40; z++) for (let y = 0; y <= SEA_LEVEL; y++) world.setVoxel(x, y, z, y === SEA_LEVEL ? Block.Grass : Block.Dirt);
  for (let z = -40; z < 40; z++) for (let x = 36; x < 40; x++) world.setVoxel(x, SEA_LEVEL, z, Block.Air), world.setVoxel(x, SEA_LEVEL - 1, z, Block.Sand);
  const sea = new Sea(world, new Weather({ cells: [] }), CLASSES, SLOOP, [FAR_PORT], 1, false);
  Object.assign(sea.player.ship, { x: 50, z: 0, heading: 0, surge: 0 });
  sea.clock.phase = phaseOf(8);
  const land = new Land(world, sea, 7);
  land.goAshore();
  Object.assign(land.walker!, { x: 0.5, z: 0.5, y: SEA_LEVEL + 1 });
  land.pack.timber = 40;
  land.pack.stone = 40;
  sea.player.cargo = { timber: 200, stone: 100 };
  const build = (kind: Building['kind'], x: number, z: number, rot = 0) => {
    const result = land.build(kind, x, z, rot);
    if (!result.ok) throw new Error(`${kind}: ${result.message}`);
    return land.buildings.at(-1)!;
  };
  const fire = build('campfire', 0, 0);
  const hut = build('hut', -12, 0);
  const store = build('storehouse', 12, 0, 1);
  sea.captain.pack = {};
  return { world, sea, land, fire, hut, store, build };
}

/** Time goes by on land: the clock with it. */
function run(sea: Sea, land: Land, seconds: number, watched = true, dt = 1 / 20) {
  for (let t = 0; t < seconds; t += dt) {
    sea.pass(dt);
    land.step(dt, watched);
  }
}

describe('settlers', () => {
  it('come ashore from the ship to camps with beds for them', () => {
    const { sea, land, fire, hut } = camp();
    expect(land.settle(fire, 2).message).toMatch(/no settlers aboard/);
    sea.captain.passengers = 3;
    expect(land.settle(fire, 3).ok).toBe(true);
    expect(land.settlersAt(fire)).toHaveLength(2); // one hut, two beds
    expect(sea.captain.passengers).toBe(1);
    expect(land.settle(fire, 1).message).toMatch(/bed/);
    expect(land.demolish(fire.id).ok).toBe(false);
    expect(land.sendAboard(land.settlers[0].id).ok).toBe(true);
    expect(sea.captain.passengers).toBe(2);
    expect(hut.kind).toBe('hut');
  });

  it('farmers harvest ripe crops into the storehouse and sow them again with seed from it', () => {
    const { sea, land, fire, store } = camp();
    for (let x = 4; x < 8; x++) land.plantCrop(x, SEA_LEVEL + 1, 8, 'cane');
    for (let x = 4; x < 8; x++) land.world.setVoxel(x, SEA_LEVEL, 8, Block.Soil);
    store.store!.caneCuttings = 2;
    store.store!.maize = 5;
    sea.captain.passengers = 1;
    land.settle(fire, 1);
    land.assign(land.settlers[0].id, 'farmer');
    sea.pass(CROPS.cane.seconds);
    run(sea, land, 40);
    expect(store.store!.cane).toBe(4 * CROPS.cane.amount);
    expect(store.store!.caneCuttings).toBeUndefined();
    // Two went straight back in; the other two wait for seed.
    expect(land.crops).toHaveLength(2);
    expect(land.fallow).toHaveLength(2);
    store.store!.caneCuttings = 5;
    run(sea, land, 30);
    expect(land.crops).toHaveLength(4);
    expect(land.fallow).toHaveLength(0);
  });

  it('a workshop hand turns the stores into goods by day, and goes home at night', () => {
    const { sea, land, fire, store, build } = camp();
    const sawpit = build('sawpit', 0, 10);
    store.store!.timber = 7;
    store.store!.maize = 5;
    sea.captain.passengers = 1;
    land.settle(fire, 1);
    const hand = land.settlers[0];
    land.assign(hand.id, 'worker', sawpit.id);
    run(sea, land, 45);
    expect(store.store!.planks).toBe(4);
    expect(store.store!.timber).toBe(1);
    expect(land.workshopState(sawpit)).toBe('short');
    sea.clock.phase = phaseOf(21);
    run(sea, land, 20);
    expect(indoors(hand)).toBe(true);
    expect(land.workshopState(sawpit)).toBe('off-duty');
    sea.clock.phase = phaseOf(6.9);
    run(sea, land, 10);
    expect(indoors(hand)).toBe(false);
  });

  it('eat at sunrise, and leave after going hungry too long', () => {
    const { sea, land, fire, store } = camp();
    store.store!.maize = 3;
    sea.captain.passengers = 2;
    land.settle(fire, 2);
    const day = () => {
      sea.clock.phase = 0.99;
      run(sea, land, 0.1 * sea.clock.length, false, 1);
    };
    day();
    expect(store.store!.maize).toBe(1);
    expect(land.settlers.every((s) => s.hungry === 0)).toBe(true);
    day();
    expect(land.settlers.filter((s) => s.hungry > 0)).toHaveLength(1);
    day();
    day();
    day();
    expect(land.settlers).toHaveLength(0);
    const notices = land.takeEvents().filter((e) => e.kind === 'notice');
    expect(notices.some((e) => e.kind === 'notice' && /left your camp/.test(e.text))).toBe(true);
  });

  it('woodcutters fell trees for timber and plant saplings that grow back', () => {
    const { sea, land, world, fire, store } = camp();
    for (let y = SEA_LEVEL + 1; y < SEA_LEVEL + 5; y++) world.setVoxel(0, y, -15, Block.Wood);
    world.setVoxel(0, SEA_LEVEL + 5, -15, Block.Leaves);
    store.store!.maize = 5;
    sea.captain.passengers = 1;
    land.settle(fire, 1);
    land.assign(land.settlers[0].id, 'woodcutter');
    run(sea, land, 30);
    expect(store.store!.timber).toBe(4);
    expect(land.saplings).toHaveLength(1);
    expect(world.getVoxel(0, SEA_LEVEL + 1, -15)).toBe(Block.Sprout);
    run(sea, land, SAPLING_SECONDS, false, 1);
    expect(land.saplings).toHaveLength(0);
    expect(world.getVoxel(0, SEA_LEVEL + 1, -15)).toBe(Block.Wood);
  });

  it('fishers bring fish in from the shore', () => {
    const { sea, land, fire, store } = camp();
    store.store!.maize = 5;
    sea.captain.passengers = 1;
    land.settle(fire, 1);
    land.assign(land.settlers[0].id, 'fisher');
    expect(land.shore(fire).length).toBeGreaterThan(0);
    run(sea, land, 50);
    expect(store.store!.fish ?? 0).toBeGreaterThan(0);
  });

  it('keep working while nobody is watching, a little less exactly', () => {
    const { sea, land, fire, store } = camp();
    for (let x = 4; x < 8; x++) land.plantCrop(x, SEA_LEVEL + 1, 8, 'maize');
    store.store!.maize = 5;
    sea.captain.passengers = 1;
    land.settle(fire, 1);
    land.assign(land.settlers[0].id, 'farmer');
    sea.pass(CROPS.maize.seconds);
    run(sea, land, 40, false, 0.5);
    expect(stock(campStores(land.buildings, fire)).maize).toBe(5 + 4 * CROPS.maize.amount - 4);
  });
});
