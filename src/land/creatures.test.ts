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
import { CROPS } from './crops';
import { type CreatureKind, CREATURES, harm } from './creatures';
import { Land } from './Land';
import { createWalker } from './walker';

const CLASSES = new Map(
  [SLOOP, BRIG, MERCHANT_SLOOP, MERCHANT_BRIG].map((type) => {
    const cells: Array<[number, number]> = [];
    for (let x = 0; x < 5; x++) for (let z = 0; z < 15; z++) cells.push([x - 2.5, z - 7.5]);
    return [type, shipClass(type, footprintSamples(cells), 2.5, 16)] as const;
  }),
);
const FAR_PORT: Port = { id: 0, name: 'Haven', faction: 'merchant', x: 3000, z: 0, heading: 0, islandX: 3000, islandZ: 0, pier: { x: 3000, y: 13, z: 0 }, places: [], lamps: [] };

/** A grassy island with a sandy east shore, the captain ashore at the middle, at night; a ripe maize plant at (10, 0). */
function night() {
  const world = new VoxelWorld();
  for (let x = -40; x < 40; x++) for (let z = -40; z < 40; z++) for (let y = 0; y <= SEA_LEVEL; y++) world.setVoxel(x, y, z, y === SEA_LEVEL ? Block.Grass : Block.Dirt);
  for (let z = -40; z < 40; z++) for (let x = 30; x < 40; x++) world.setVoxel(x, SEA_LEVEL, z, Block.Air), world.setVoxel(x, SEA_LEVEL - 1, z, Block.Sand);
  const sea = new Sea(world, new Weather({ cells: [] }), CLASSES, SLOOP, [FAR_PORT], 1, false);
  Object.assign(sea.player.ship, { x: 50, z: 0, heading: 0, surge: 0 });
  sea.clock.phase = phaseOf(23);
  const land = new Land(world, sea, 3);
  land.goAshore();
  Object.assign(land.walker!, { x: 0.5, z: 0.5, y: SEA_LEVEL + 1 });
  world.setVoxel(10, SEA_LEVEL, 0, Block.Soil);
  land.plantCrop(10, SEA_LEVEL + 1, 0, 'maize');
  land.crops[0].planted -= CROPS.maize.seconds;
  return { world, sea, land };
}

function run(sea: Sea, land: Land, seconds: number) {
  for (let t = 0; t < seconds; t += 1 / 30) {
    sea.pass(1 / 30);
    land.step(1 / 30);
  }
}

function loose(land: Land, kind: CreatureKind, x: number, z: number) {
  land.creatures.push({ id: land.nextCreature++, kind, walker: createWalker(x, SEA_LEVEL + 1, z), hp: CREATURES[kind].hp, target: null, eating: 0, fleeing: 0, flee: { x: 0, z: 0 }, think: 0 });
  land.spawnIn = 1e9; // just this one
}

/** A grassy upland plateau (ground top at SEA_LEVEL + 6), sand round its edge, the captain in the middle at noon. */
function upland() {
  const world = new VoxelWorld();
  for (let x = -40; x < 40; x++) {
    for (let z = -40; z < 40; z++) {
      const edge = Math.max(Math.abs(x), Math.abs(z)) > 34;
      const top = edge ? SEA_LEVEL : SEA_LEVEL + 6;
      for (let y = 0; y <= top; y++) world.setVoxel(x, y, z, y === top ? (edge ? Block.Sand : Block.Grass) : Block.Dirt);
    }
  }
  const sea = new Sea(world, new Weather({ cells: [] }), CLASSES, SLOOP, [FAR_PORT], 1, false);
  Object.assign(sea.player.ship, { x: 50, z: 0, heading: 0, surge: 0 });
  sea.clock.phase = phaseOf(12);
  const land = new Land(world, sea, 3);
  land.goAshore();
  Object.assign(land.walker!, { x: 0.5, z: 0.5, y: SEA_LEVEL + 7 });
  return { world, sea, land };
}

const goats = (land: Land) => land.creatures.filter((c) => c.kind === 'goat');

describe('night creatures', () => {
  it('come out around the captain at night, and are gone by day', () => {
    const { sea, land } = night();
    run(sea, land, 30);
    expect(land.creatures.length).toBeGreaterThan(0);
    sea.clock.phase = phaseOf(12);
    run(sea, land, 1);
    expect(land.creatures).toHaveLength(0);
  });

  it('a boar tramples crops left out in the open', () => {
    const { sea, land } = night();
    loose(land, 'boar', 2.5, 0.5);
    run(sea, land, 10);
    expect(land.crops).toHaveLength(0);
    expect(land.takeEvents().some((e) => e.kind === 'notice' && /trampled/.test(e.text))).toBe(true);
  });

  it('but not through a fence', () => {
    const { sea, land, world } = night();
    for (let x = 8; x <= 12; x++) for (let z = -2; z <= 2; z++) if (Math.abs(x - 10) === 2 || Math.abs(z) === 2) world.setVoxel(x, SEA_LEVEL + 1, z, Block.Fence);
    loose(land, 'boar', 2.5, 0.5);
    run(sea, land, 10);
    expect(land.crops).toHaveLength(1);
  });

  it('and keeps away from torchlight', () => {
    const { sea, land } = night();
    land.pack.timber = 6;
    expect(land.build('campfire', 0, -14, 0).ok).toBe(true);
    expect(land.build('torch', 13, 0, 0).ok).toBe(true);
    loose(land, 'crab', 2.5, 0.5);
    run(sea, land, 12);
    expect(land.crops[0].planted).toBeLessThan(sea.time - CROPS.maize.seconds + 1);
  });

  it('can be caught for the pot', () => {
    const { land } = night();
    loose(land, 'boar', 0.5, 1.5);
    land.walker!.facing = 0;
    expect(land.use('axe').message).toMatch(/bolts/);
    land.creatures[0].walker.z = 1.5;
    expect(land.use('axe').message).toMatch(/Caught/);
    expect(land.drops.filter((d) => d.good === 'meat')).toHaveLength(3);
    // It lands, and the captain goes to pick it up.
    for (let i = 0; i < 60; i++) land.step(1 / 60);
    for (const d of [...land.drops]) {
      Object.assign(land.walker!, { x: d.x, z: d.z });
      for (let i = 0; i < 60; i++) land.step(1 / 60);
    }
    expect(land.pack.meat).toBe(3);
    expect(land.creatures).toHaveLength(0);
  });
});

describe('wild goats', () => {
  it('graze by day in herds of two to four, on upland grass', () => {
    const { land } = upland();
    const footed = () => {
      for (const g of goats(land)) expect(g.walker.y).toBeGreaterThanOrEqual(SEA_LEVEL + 5);
    };
    for (let t = 0; t < 40; t += 1 / 20) {
      land.step(1 / 20);
      footed();
    }
    const herd = goats(land);
    expect(herd.length).toBeGreaterThanOrEqual(2);
    expect(herd.length).toBeLessThanOrEqual(4);
    // The captain walks in among them: the whole herd bolts, and still mustn't leave the upland.
    Object.assign(land.walker!, { x: herd[0].walker.x + 2, z: herd[0].walker.z });
    for (let t = 0; t < 80; t += 1 / 20) {
      land.step(1 / 20);
      footed();
    }
    expect(land.creatures.filter((c) => c.kind !== 'goat')).toHaveLength(0);
  });

  it('keep away from camps and firelight', () => {
    const { land, sea } = upland();
    sea.player.cargo.timber = 50;
    land.build('campfire', 0, 3, 0);
    for (let t = 0; t < 60; t += 1 / 20) land.step(1 / 20);
    for (const g of goats(land)) expect(land.claimed(g.walker.x, g.walker.z)).toBe(false);
  });

  it('bolt when the captain comes within about eight blocks, the herd with them', () => {
    const { land } = upland();
    loose(land, 'goat', 6.5, 0.5);
    loose(land, 'goat', 9.5, 2.5);
    land.creatures.forEach((c) => (c.walker.y = SEA_LEVEL + 7));
    for (let t = 0; t < 0.6; t += 1 / 20) land.step(1 / 20);
    for (const g of goats(land).slice(0, 2)) expect(g.fleeing).toBeGreaterThan(0);
  });

  it('are gone at night, as crabs and boar are gone by day', () => {
    const { land, sea } = upland();
    loose(land, 'goat', 20.5, 0.5);
    sea.clock.phase = phaseOf(23);
    land.step(1 / 20);
    expect(goats(land)).toHaveLength(0);
    sea.clock.phase = phaseOf(12);
    loose(land, 'boar', 20.5, 0.5);
    land.step(1 / 20);
    expect(land.creatures.filter((c) => c.kind === 'boar')).toHaveLength(0);
  });

  it('take two blows, and give two meat and a hide', () => {
    const { land } = upland();
    loose(land, 'goat', 20.5, 0.5);
    const goat = land.creatures[0];
    expect(harm(goat, 1, 0, 0)).toBeNull();
    expect(goat.fleeing).toBeGreaterThan(0);
    expect(harm(goat, 1, 0, 0)).toEqual({ meat: 2, hides: 1 });
    expect(CREATURES.goat.hp).toBe(2);
  });
});
