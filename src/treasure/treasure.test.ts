import { describe, expect, it } from 'vitest';
import { Sea } from '../combat/sea';
import { shipClass } from '../combat/vessel';
import { SEA_LEVEL } from '../config';
import { phaseOf } from '../core/clock';
import { Economy } from '../economy/economy';
import type { Port } from '../economy/ports';
import { type Deposit, Deposits } from '../land/deposits';
import { Land } from '../land/Land';
import { createWalker } from '../land/walker';
import { footprintSamples } from '../sailing/hull';
import { BRIG, MERCHANT_BRIG, MERCHANT_SLOOP, SLOOP } from '../sailing/ships';
import { Weather } from '../sailing/weather';
import { Block } from '../voxel/blocks';
import { VoxelWorld } from '../voxel/VoxelWorld';
import type { IslandPlan } from '../worldgen/archipelago';
import { RELIC_LIST } from './relics';
import { HEADINGS } from './sites';
import { MAP_CASE, PIECES, Treasure, type TreasureMap } from './Treasure';

const CLASSES = new Map(
  [SLOOP, BRIG, MERCHANT_SLOOP, MERCHANT_BRIG].map((type) => {
    const cells: Array<[number, number]> = [];
    for (let x = 0; x < 5; x++) for (let z = 0; z < 15; z++) cells.push([x - 2.5, z - 7.5]);
    return [type, shipClass(type, footprintSamples(cells), 2.5, 16)] as const;
  }),
);

const HAVEN: IslandPlan = { seed: 0, centerX: 0, centerZ: 0, radius: 20, peak: 10, port: { name: 'Haven', faction: 'merchant' } };
const islet = (seed: number, x: number, z: number, name: string, cursed = false): IslandPlan => ({ seed, centerX: x, centerZ: z, radius: 15, peak: 5, port: null, name, cursed });
/** Haven, then an islet in each tier: near (1), mid (2), far (3 and 7), and three cursed ones (4-6). The farthest (3) is Blackwood's. */
const ISLANDS: IslandPlan[] = [
  HAVEN,
  islet(1, 400, 0, 'Gull Cay'),
  islet(2, 1000, 0, 'Heron Key'),
  islet(3, 0, 1800, 'Conch Isle'),
  islet(4, -900, 0, "Dead Man's Cay", true),
  islet(5, -900, 600, 'Wraith Key', true),
  islet(6, -900, -600, 'Hollow Cay', true),
  islet(7, 1700, 0, 'Salt Cay'),
];
const PIRATE_PORT: Port = { id: 0, name: 'Rook’s Nest', faction: 'pirate', x: 3000, z: 3000, heading: 0, islandX: 3000, islandZ: 3000, pier: { x: 3000, y: 13, z: 3000 }, places: [], lamps: [] };
const FREE_PORT: Port = { ...PIRATE_PORT, id: 1, name: 'Freehold', faction: 'merchant', x: -3000, islandX: -3000, pier: { x: -3000, y: 13, z: 3000 } };

/** Flat grassy islets, a pirate haven far off, and the captain ashore on nothing in particular. */
function setup() {
  const world = new VoxelWorld();
  for (const plan of ISLANDS.slice(1)) {
    for (let x = plan.centerX - plan.radius; x <= plan.centerX + plan.radius; x++) {
      for (let z = plan.centerZ - plan.radius; z <= plan.centerZ + plan.radius; z++) {
        for (let y = 0; y <= SEA_LEVEL + 1; y++) world.setVoxel(x, y, z, y === SEA_LEVEL + 1 ? Block.Grass : Block.Dirt);
      }
    }
  }
  const sea = new Sea(world, new Weather({ cells: [] }), CLASSES, SLOOP, [PIRATE_PORT], 1, false);
  const land = new Land(world, sea);
  const treasure = new Treasure(world, sea, land, ISLANDS, ['Old Marta'], 1);
  sea.captain.gold = 100000;
  return { world, sea, land, treasure };
}

const night = (sea: Sea) => (sea.clock.phase = phaseOf(23));
const noon = (sea: Sea) => (sea.clock.phase = phaseOf(12));

/** Buys every map on offer tonight, a night at a time, until there's one of this tier. */
function mapOf(t: ReturnType<typeof setup>, tier: TreasureMap['tier']): TreasureMap {
  night(t.sea);
  for (let n = 0; n < 40; n++) {
    t.sea.clock.day = 100 + n;
    const offer = t.treasure.offersFor(PIRATE_PORT).find((o) => o.map.tier === tier);
    if (offer && t.treasure.buy(PIRATE_PORT, offer.map.id).ok) return offer.map;
  }
  throw new Error(`no ${tier} map`);
}

describe('treasure maps', () => {
  it('are harder the further out the islet lies, and the cursed isles are their own', () => {
    const { treasure } = setup();
    expect([1, 2, 3, 4].map((i) => treasure.tierOf(i))).toEqual(['near', 'mid', 'far', 'cursed']);
    expect(treasure.legendIsland).toBe(3);
  });

  it('are sold by the fixer only after dark, two a night, a cursed one at a pirate haven', () => {
    const { sea, treasure } = setup();
    noon(sea);
    expect(treasure.offersFor(PIRATE_PORT)).toEqual([]);
    night(sea);
    const offers = treasure.offersFor(PIRATE_PORT);
    expect(offers).toHaveLength(2);
    expect(offers[0].map.tier).toBe('cursed');
    expect(new Set(offers.map((o) => o.map.site.island)).size).toBe(2);
    expect(treasure.offersFor(PIRATE_PORT)).toBe(offers); // the same all night
    noon(sea);
    expect(treasure.buy(PIRATE_PORT, offers[1].map.id).ok).toBe(false);
  });

  it('are bought for gold, raising the landmark they point to', () => {
    const t = setup();
    const gold = t.sea.captain.gold;
    const map = mapOf(t, 'mid');
    expect(t.sea.captain.gold).toBeLessThan(gold);
    expect(t.sea.captain.maps).toContain(map);
    const l = map.site.landmark;
    expect(t.world.getVoxel(l.x, l.y, l.z)).not.toBe(Block.Air);
    expect(map.from).toMatch(/Old Marta/);
    expect(map.clue).toMatch(/Heron Key/);
  });

  it('give directions that really lead from the landmark to the X', () => {
    const t = setup();
    for (const tier of ['mid', 'far'] as const) {
      const { site, clue } = mapOf(t, tier);
      let x = site.landmark.x;
      let z = site.landmark.z;
      for (const leg of site.legs) {
        x += HEADINGS[leg.heading].dx * leg.paces;
        z += HEADINGS[leg.heading].dz * leg.paces;
      }
      expect([x, z]).toEqual([site.x, site.z]);
      expect(site.legs).toHaveLength(tier === 'mid' ? 1 : 2);
      if (site.legs.length === 2) expect(HEADINGS[site.legs[0].heading].dx * HEADINGS[site.legs[1].heading].dx + HEADINGS[site.legs[0].heading].dz * HEADINGS[site.legs[1].heading].dz).toBe(0);
      expect(clue).toMatch(tier === 'mid' ? /paces (north|south|east|west)/ : /toward the (sunrise|sunset|pole star|noonday sun)/);
    }
  });

  it('turn up among a prize’s papers now and then, and in tavern talk once a day', () => {
    const { sea, treasure } = setup();
    for (let i = 0; i < 20; i++) treasure.prize('pirate', 'Sea Wolf');
    const found = sea.captain.maps.length;
    expect(found).toBeGreaterThan(0);
    expect(found).toBeLessThan(20);
    expect(sea.captain.maps.every((m) => m.from === 'Found aboard the Sea Wolf' && (m.tier === 'near' || m.tier === 'mid'))).toBe(true);
    sea.captain.maps.length = 0;
    const economy = new Economy(sea, [PIRATE_PORT, FREE_PORT], 1);
    economy.rumourSources.push((port) => treasure.rumour(port));
    for (let i = 0; i < 20; i++) economy.buyRound(PIRATE_PORT);
    expect(sea.captain.maps).toHaveLength(1);
    expect(economy.states[0].rumours.some((r) => /gold buried|dead guard/.test(r))).toBe(true);
    sea.clock.day += 1;
    for (let i = 0; i < 20; i++) economy.buyRound(PIRATE_PORT);
    expect(sea.captain.maps).toHaveLength(2);
  });

  it('fit only so many in the case', () => {
    const { sea, treasure } = setup();
    for (let i = 0; i < MAP_CASE; i++) sea.captain.maps.push({ id: 1000 + i, site: { island: 9 } } as TreasureMap);
    for (let i = 0; i < 20; i++) treasure.prize('pirate', 'Sea Wolf');
    expect(sea.captain.maps).toHaveLength(MAP_CASE);
  });
});

describe('digging for treasure', () => {
  it('comes up where you dig within a block of the X: gold, goods on the ground, the map used up', () => {
    const t = setup();
    const map = mapOf(t, 'near');
    const { x, z } = map.site;
    const top = map.site.y + 1; // the ground you stand on
    const gold = t.sea.captain.gold;
    expect(t.treasure.search(x + 3, top, z)).toMatch(/loose/);
    expect(t.treasure.search(x + 9, top, z)).toBeNull();
    expect(t.treasure.search(x + 1, top, z - 1)).toMatch(/chest/);
    // The chest sits in the ground where you dug, and nothing else is disturbed.
    expect(t.world.getVoxel(x + 1, top, z - 1)).toBe(Block.Chest);
    expect(t.world.getVoxel(x, top, z)).toBe(Block.Grass);
    expect(t.sea.captain.gold).toBe(gold + map.loot.gold);
    expect(t.land.drops.reduce((n, d) => n + d.amount, 0)).toBe(Object.values(map.loot.goods).reduce((a, b) => a + b, 0));
    expect(t.sea.captain.maps).not.toContain(map);
    expect(t.treasure.takeNotices()[0].text).toMatch(/chest holds \d+ gold/);
    expect(t.treasure.search(x, top, z)).toBeNull();
  });

  it('is dug up on foot, standing on the X, without a spade in hand', () => {
    const t = setup();
    const map = mapOf(t, 'near');
    const { x, z } = map.site;
    t.land.walker = createWalker(x + 0.5, SEA_LEVEL + 2, z + 0.5, 0);
    const dug = t.land.dig();
    expect(dug).toMatchObject({ ok: true, message: expect.stringMatching(/chest/) });
    expect(t.world.getVoxel(x, SEA_LEVEL + 1, z)).toBe(Block.Chest);
  });

  it('buries chests clear of outcrops', () => {
    const covered = setup();
    // Outcrops (registered, no blocks needed) every 4 blocks across Gull Cay, the only near islet.
    const list: Deposit[] = [];
    for (let x = 385; x <= 415; x += 4) for (let z = -15; z <= 15; z += 4) list.push({ id: list.length + 1, kind: 'stone', x, z, cells: [] });
    covered.land.deposits = new Deposits(list);
    night(covered.sea);
    let near = false;
    for (let n = 0; n < 40; n++) {
      covered.sea.clock.day = 100 + n;
      if (covered.treasure.offersFor(PIRATE_PORT).some((o) => o.map.tier === 'near')) near = true;
    }
    expect(near).toBe(false);
  });

  it('won’t give up a cursed hoard by day; at night its guardian rises, and must be beaten', () => {
    const t = setup();
    const map = mapOf(t, 'cursed');
    const { x, y, z } = map.site;
    noon(t.sea);
    expect(t.treasure.search(x, y, z)).toMatch(/keeps to the dark/);
    expect(t.treasure.takeEvents()).toEqual([]);
    night(t.sea);
    expect(t.treasure.search(x, y, z)).toMatch(/cold/);
    const [event] = t.treasure.takeEvents();
    expect(event).toMatchObject({ kind: 'guardian', map: map.id });
    // Losing costs a tenth of your gold, and the hoard stays.
    const gold = t.sea.captain.gold;
    expect(t.treasure.guardianWon()).toBe(Math.round(gold / 10));
    expect(t.sea.captain.maps).toContain(map);
    t.treasure.guardianBeaten(map.id, x, y, z);
    expect(t.sea.captain.maps).not.toContain(map);
    expect(t.sea.captain.pieces).toBe(1);
    expect(t.sea.captain.relics).toHaveLength(1);
  });

  it('joins Blackwood’s chart from the three cursed hoards, and his hoard holds every find left, and a letter', () => {
    const t = setup();
    night(t.sea);
    for (let i = 0; i < PIECES; i++) {
      const map = mapOf(t, 'cursed');
      t.treasure.guardianBeaten(map.id, map.site.x, map.site.y, map.site.z);
    }
    expect(t.sea.captain.pieces).toBe(PIECES);
    const legend = t.sea.captain.maps.find((m) => m.tier === 'legend')!;
    expect(legend.site.island).toBe(3);
    expect(legend.clue).toMatch(/Blackwood/);
    // No more maps to the cursed isles: their hoards are gone.
    t.sea.clock.day = 500;
    expect(t.treasure.offersFor(PIRATE_PORT).some((o) => o.map.tier === 'cursed')).toBe(false);
    expect(t.treasure.search(legend.site.x, legend.site.y, legend.site.z)).toMatch(/chest/);
    expect(t.sea.captain.relics.sort()).toEqual([...RELIC_LIST].sort());
    expect(t.sea.captain.letter).toBe(true);
  });

  it('keeps the night’s offers and the hoards taken through a save', () => {
    const t = setup();
    const map = mapOf(t, 'cursed');
    t.treasure.guardianBeaten(map.id, map.site.x, map.site.y, map.site.z);
    const offers = t.treasure.offersFor(PIRATE_PORT);
    const saved = JSON.parse(JSON.stringify(t.treasure.snapshot()));
    const u = setup();
    u.sea.clock.day = t.sea.clock.day;
    night(u.sea);
    u.treasure.restore(saved);
    expect(u.treasure.offersFor(PIRATE_PORT)).toEqual(offers);
    for (let d = 0; d < 10; d++) {
      u.sea.clock.day += 1;
      expect(u.treasure.offersFor(PIRATE_PORT).some((o) => o.map.site.island === map.site.island)).toBe(false);
    }
  });
});
