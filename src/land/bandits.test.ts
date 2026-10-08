import { describe, expect, it } from 'vitest';
import { Sea } from '../combat/sea';
import { shipClass } from '../combat/vessel';
import { SEA_LEVEL } from '../config';
import type { Port } from '../economy/ports';
import { footprintSamples } from '../sailing/hull';
import { BRIG, MERCHANT_BRIG, MERCHANT_SLOOP, SLOOP } from '../sailing/ships';
import { Weather } from '../sailing/weather';
import { Block } from '../voxel/blocks';
import { VoxelWorld } from '../voxel/VoxelWorld';
import type { BanditCamp } from '../worldgen/bandits';
import { Bandits, CAMP_BACK_DAYS, HOLD_RADIUS } from './bandits';
import { Land } from './Land';

const CLASSES = new Map(
  [SLOOP, BRIG, MERCHANT_SLOOP, MERCHANT_BRIG].map((type) => {
    const cells: Array<[number, number]> = [];
    for (let x = 0; x < 5; x++) for (let z = 0; z < 15; z++) cells.push([x - 2.5, z - 7.5]);
    return [type, shipClass(type, footprintSamples(cells), 2.5, 16)] as const;
  }),
);
const FAR_PORT: Port = { id: 0, name: 'Haven', faction: 'merchant', x: 3000, z: 0, heading: 0, islandX: 3000, islandZ: 0, pier: { x: 3000, y: 13, z: 0 }, places: [], lamps: [] };
const GROUND = SEA_LEVEL + 1;

/** A camp at the middle of a flat grassy islet 80 across, three bandits strong, its fire and chest in place. */
export function banditIslet(size = 3) {
  const world = new VoxelWorld();
  for (let x = -40; x < 40; x++) for (let z = -40; z < 40; z++) for (let y = 0; y <= SEA_LEVEL; y++) world.setVoxel(x, y, z, y === SEA_LEVEL ? Block.Grass : Block.Dirt);
  const camp: BanditCamp = { id: 7, x: 0, y: GROUND, z: 0, islandX: 0, islandZ: 0, islandRadius: 36, tier: 1, size, chest: { x: 2, y: GROUND, z: 2 } };
  world.setVoxel(0, GROUND, 0, Block.Embers);
  world.setVoxel(2, GROUND, 2, Block.Chest);
  const sea = new Sea(world, new Weather({ cells: [] }), CLASSES, SLOOP, [FAR_PORT], 1, false);
  Object.assign(sea.player.ship, { x: 50, z: 0, heading: 0, surge: 0 });
  const land = new Land(world, sea, 5);
  land.bandits = new Bandits([camp]);
  return { world, sea, land, camp };
}

describe('bandits’ camps', () => {
  it('are manned at first, as many as the camp holds', () => {
    const { land, camp } = banditIslet();
    expect(land.bandits.manned(camp)).toBe(true);
    expect(land.bandits.state(camp.id)).toMatchObject({ left: 3, cleared: null, looted: false, gone: false });
  });

  it('hold their ground: no campfire within 60 of a manned camp, but one is fine once it’s cleared', () => {
    const { land, sea, camp } = banditIslet();
    sea.player.cargo.timber = 50;
    land.goAshore();
    expect(land.placement('campfire', 20, 0, 0)).toMatchObject({ ok: false, reason: 'Bandits hold this ground: clear their camp first.' });
    for (let i = 0; i < 3; i++) land.bandits.lose(camp, land.day());
    expect(land.placement('campfire', 20, 0, 0).ok).toBe(true);
  });

  it('are manned again five days after they’re cleared', () => {
    const { land, sea, camp } = banditIslet();
    for (let i = 0; i < 3; i++) land.bandits.lose(camp, land.day());
    expect(land.bandits.manned(camp)).toBe(false);
    sea.clock.day += CAMP_BACK_DAYS - 1;
    land.step(1.1);
    expect(land.bandits.manned(camp)).toBe(false);
    sea.clock.day += 1;
    land.step(1.1);
    expect(land.bandits.manned(camp)).toBe(true);
    expect(land.bandits.state(camp.id)).toMatchObject({ left: 3, looted: false });
  });

  it('stay empty for good once the captain’s camp claims ground near a cleared one', () => {
    const { land, sea, camp } = banditIslet();
    sea.player.cargo.timber = 50;
    land.goAshore();
    for (let i = 0; i < 3; i++) land.bandits.lose(camp, land.day());
    expect(land.build('campfire', 30, 0, 0).ok).toBe(true);
    sea.clock.day += CAMP_BACK_DAYS + 1;
    land.step(1.1);
    expect(land.bandits.manned(camp)).toBe(false);
    expect(land.bandits.state(camp.id).gone).toBe(true);
  });

  it('keep a chest: E opens it once, for gold and goods, and it’s full again when they’re back', () => {
    const { land, sea, camp } = banditIslet();
    land.goAshore();
    Object.assign(land.walker!, { x: 2.5, z: 1.2, y: GROUND });
    expect(land.interaction()).toEqual({ kind: 'chest', camp: camp.id });
    const gold = sea.captain.gold;
    expect(land.openChest(camp.id).ok).toBe(true);
    expect(sea.captain.gold - gold).toBeGreaterThanOrEqual(90);
    expect(sea.captain.gold - gold).toBeLessThanOrEqual(180);
    expect(land.drops.length).toBeGreaterThan(0);
    expect(land.interaction()?.kind).not.toBe('chest');
    expect(land.openChest(camp.id).ok).toBe(false);
    for (let i = 0; i < 3; i++) land.bandits.lose(camp, land.day());
    sea.clock.day += CAMP_BACK_DAYS;
    land.step(1.1);
    expect(land.bandits.state(camp.id).looted).toBe(false);
  });

  it('are saved, and an older save finds them all manned', () => {
    const { land, camp } = banditIslet();
    land.bandits.lose(camp, land.day());
    const saved = JSON.parse(JSON.stringify(land.snapshot()));
    const fresh = banditIslet().land;
    fresh.restore(saved);
    expect(fresh.bandits.state(camp.id).left).toBe(2);
    delete saved.bandits;
    const older = banditIslet().land;
    older.restore(saved);
    expect(older.bandits.state(camp.id).left).toBe(3);
  });

  it('a camp whose ground a save’s own camp already claims is left empty for good', () => {
    const { world, land, camp } = banditIslet();
    // An older save: the player camped on this islet before there were bandits.
    const saved = JSON.parse(JSON.stringify(land.snapshot()));
    saved.buildings = [{ id: 1, kind: 'campfire', x0: 20, z0: 0, w: 3, d: 3, y: GROUND, rot: 0 }];
    world.setVoxel(21, GROUND, 1, Block.Embers);
    land.restore(saved);
    expect(land.bandits.manned(camp)).toBe(false);
    expect(land.bandits.state(camp.id).gone).toBe(true);
    expect(HOLD_RADIUS).toBe(60);
  });

  it('a camp an old save’s edits wiped out (its fire gone) is left empty for good', () => {
    const { world, land, camp } = banditIslet();
    world.setVoxel(0, GROUND, 0, Block.Air);
    land.restore(JSON.parse(JSON.stringify(land.snapshot())));
    expect(land.bandits.state(camp.id).gone).toBe(true);
  });
});
