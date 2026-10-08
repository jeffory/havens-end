import { describe, expect, it, vi } from 'vitest';
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
import type { BanditCamp } from '../worldgen/bandits';
import { Bandits } from './bandits';
import { HEALTH_MAX, Land } from './Land';
import { findPath } from './paths';
import { groundBelow } from './walker';

// Every way a bandit looks for goes through the real search, watched.
vi.mock('./paths', async (original) => {
  const paths = await original<typeof import('./paths')>();
  return { ...paths, findPath: vi.fn(paths.findPath) };
});

const CLASSES = new Map(
  [SLOOP, BRIG, MERCHANT_SLOOP, MERCHANT_BRIG].map((type) => {
    const cells: Array<[number, number]> = [];
    for (let x = 0; x < 5; x++) for (let z = 0; z < 15; z++) cells.push([x - 2.5, z - 7.5]);
    return [type, shipClass(type, footprintSamples(cells), 2.5, 16)] as const;
  }),
);
const FAR_PORT: Port = { id: 0, name: 'Haven', faction: 'merchant', x: 3000, z: 0, heading: 0, islandX: 3000, islandZ: 0, pier: { x: 3000, y: 13, z: 0 }, places: [], lamps: [] };
const GROUND = SEA_LEVEL + 1;

/**
 * Four bandits fighting the captain on a narrow islet (80 long, 14 wide), so that many of
 * the places they'd keep their distance at are out in the sea; and ten campfires of the
 * captain's on islands far off, none of whose claims come near.
 */
function fight() {
  const world = new VoxelWorld();
  for (let x = -40; x < 40; x++) for (let z = -7; z < 7; z++) for (let y = 0; y <= SEA_LEVEL; y++) world.setVoxel(x, y, z, y === SEA_LEVEL ? Block.Grass : Block.Dirt);
  const camp: BanditCamp = { id: 7, x: 0, y: GROUND, z: 0, islandX: 0, islandZ: 0, islandRadius: 36, tier: 2, size: 4, chest: { x: 2, y: GROUND, z: 2 } };
  world.setVoxel(0, GROUND, 0, Block.Embers);
  const sea = new Sea(world, new Weather({ cells: [] }), CLASSES, SLOOP, [FAR_PORT], 1, false);
  Object.assign(sea.player.ship, { x: 50, z: 0, heading: 0, surge: 0 });
  sea.clock.phase = phaseOf(12);
  const land = new Land(world, sea, 5);
  land.bandits = new Bandits([camp]);
  for (let i = 0; i < 10; i++) land.buildings.push({ id: 100 + i, kind: 'campfire', x0: 2000 + i * 100, z0: 2000, w: 3, d: 3, y: GROUND, rot: 0 });
  land.goAshore();
  Object.assign(land.walker!, { x: 20.5, z: 0.5, y: GROUND });
  land.step(1 / 20);
  land.bandits.alertAll();
  return land;
}

describe('bandits looking for a way', () => {
  it('search the plain world when no camp of the captain’s claims ground near their islet', () => {
    const land = fight();
    vi.mocked(findPath).mockClear();
    for (let t = 0; t < 20; t += 1 / 20) {
      land.step(1 / 20);
      land.health = HEALTH_MAX;
    }
    const calls = vi.mocked(findPath).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.filter(([world]) => world !== land.world)).toHaveLength(0);
  });

  it('never search for a way to somewhere out in the sea', () => {
    // Keeping their distance from a captain on a narrow islet, a good many of the places
    // they pick are out in the water: no way is searched for to those.
    const land = fight();
    vi.mocked(findPath).mockClear();
    for (let t = 0; t < 20; t += 1 / 20) {
      land.step(1 / 20);
      land.health = HEALTH_MAX;
    }
    const calls = vi.mocked(findPath).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const wet = (to: { x: number; z: number }) => groundBelow(land.world, to.x, to.z, GROUND + 4) < SEA_LEVEL;
    for (const [, , to] of calls) expect(wet(to), `searched for a way to ${to.x.toFixed(1)}, ${to.z.toFixed(1)}`).toBe(false);
  });
});
