import { describe, expect, it } from 'vitest';
import { Sea } from '../combat/sea';
import { shipClass } from '../combat/vessel';
import { SEA_LEVEL } from '../config';
import { phaseOf } from '../core/clock';
import type { Port } from '../economy/ports';
import { WATER_LEVEL } from '../ocean/waves';
import { footprintSamples } from '../sailing/hull';
import { BRIG, MERCHANT_BRIG, MERCHANT_SLOOP, SLOOP } from '../sailing/ships';
import { Weather } from '../sailing/weather';
import { Block } from '../voxel/blocks';
import { VoxelWorld } from '../voxel/VoxelWorld';
import type { BanditCamp } from '../worldgen/bandits';
import { Bandits, CAMP_BACK_DAYS, HOLD_RADIUS } from './bandits';
import { HEALTH_MAX, Land, type LandEvent } from './Land';
import { WALK_SPEED } from './walker';

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
export function banditIslet(size = 3, seed = 5) {
  const world = new VoxelWorld();
  for (let x = -40; x < 40; x++) for (let z = -40; z < 40; z++) for (let y = 0; y <= SEA_LEVEL; y++) world.setVoxel(x, y, z, y === SEA_LEVEL ? Block.Grass : Block.Dirt);
  const camp: BanditCamp = { id: 7, x: 0, y: GROUND, z: 0, islandX: 0, islandZ: 0, islandRadius: 36, tier: 1, size, chest: { x: 2, y: GROUND, z: 2 } };
  world.setVoxel(0, GROUND, 0, Block.Embers);
  world.setVoxel(2, GROUND, 2, Block.Chest);
  const sea = new Sea(world, new Weather({ cells: [] }), CLASSES, SLOOP, [FAR_PORT], 1, false);
  Object.assign(sea.player.ship, { x: 50, z: 0, heading: 0, surge: 0 });
  const land = new Land(world, sea, seed);
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

  it('a campfire built as near them as is allowed doesn’t leave their camp gone when the game is loaded', () => {
    const { world, land, sea, camp } = banditIslet();
    // The islet runs on west, out past 60 from the bandits' fire.
    for (let x = -70; x < -40; x++) for (let z = -5; z < 5; z++) for (let y = 0; y <= SEA_LEVEL; y++) world.setVoxel(x, y, z, y === SEA_LEVEL ? Block.Grass : Block.Dirt);
    sea.player.cargo.timber = 50;
    land.goAshore();
    let cx = -55;
    while (cx > -65 && !land.placement('campfire', cx, 0, 0).ok) cx--;
    expect(land.placement('campfire', cx + 1, 0, 0).reason).toBe('Bandits hold this ground: clear their camp first.');
    expect(land.build('campfire', cx, 0, 0).ok).toBe(true);
    land.restore(JSON.parse(JSON.stringify(land.snapshot())));
    expect(land.bandits.state(camp.id).gone).toBe(false);
    expect(land.bandits.manned(camp)).toBe(true);
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

/** The captain ashore on the bandits' islet at (x, z), at noon, a rifle and cartridges to hand. */
function ashore(x: number, z: number, size = 3, seed = 5) {
  const setup = banditIslet(size, seed);
  const { land, sea } = setup;
  sea.clock.phase = phaseOf(12);
  sea.captain.guns.push('pistol', 'rifle');
  sea.player.cargo.cartridges = 40;
  land.goAshore();
  Object.assign(land.walker!, { x, z, y: GROUND });
  return setup;
}
const run = (land: Land, seconds: number, keepAlive = true) => {
  for (let t = 0; t < seconds; t += 1 / 20) {
    land.step(1 / 20);
    if (keepAlive && land.walker) land.health = HEALTH_MAX;
  }
};
const shots = (land: Land) => land.takeEvents().filter((e) => e.kind === 'shot' && e.gun === 'musket');
/** A wall of stone across z = 10, x -40..40, ten high: out of sight to the south of it. */
const wall = (world: VoxelWorld) => {
  for (let x = -40; x < 40; x++) for (let y = GROUND; y < GROUND + 10; y++) world.setVoxel(x, y, 10, Block.Stone);
};

describe('bandits', () => {
  it('muster at their camp at ease, as many as it holds', () => {
    const { land } = ashore(0.5, 30.5);
    wall(land.world);
    run(land, 1);
    expect(land.bandits.live).toHaveLength(3);
    for (const b of land.bandits.live) expect(b.mode).toBe('ease');
  });

  it('see the captain within about 18 blocks by day, and the whole camp is alerted', () => {
    const { land } = ashore(0.5, 30.5);
    run(land, 2);
    expect(land.bandits.live.every((b) => b.mode === 'ease')).toBe(true);
    Object.assign(land.walker!, { x: 0.5, z: 12.5 });
    run(land, 1);
    expect(land.bandits.live.every((b) => b.mode === 'fight')).toBe(true);
  });

  it('give the captain a warning before their first volley, once a fight', () => {
    const { land } = ashore(0.5, 30.5);
    run(land, 1);
    land.takeEvents();
    Object.assign(land.walker!, { x: 0.5, z: 12.5 });
    run(land, 1.9);
    expect(land.bandits.fighting()).toBe(true);
    const warned = (events: LandEvent[]) => events.filter((e) => e.kind === 'notice' && e.text === 'Bandits! They’ve seen you.');
    let events = land.takeEvents();
    expect(events.filter((e) => e.kind === 'shot' && e.gun === 'musket')).toHaveLength(0);
    expect(warned(events)).toEqual([{ kind: 'notice', text: 'Bandits! They’ve seen you.', tone: 'bad' }]);
    // The fight goes on: no second warning, whether they're shot at, hear a shot, or fire.
    land.fire('pistol', { x: land.bandits.live[0].walker.x, y: GROUND + 1.2, z: land.bandits.live[0].walker.z });
    run(land, 10);
    events = land.takeEvents();
    expect(events.some((e) => e.kind === 'shot' && e.gun === 'musket')).toBe(true);
    expect(warned(events)).toHaveLength(0);
  });

  it('at night see only half as far', () => {
    const { land, sea } = ashore(0.5, 13.5);
    sea.clock.phase = phaseOf(23);
    run(land, 1);
    expect(land.bandits.live.every((b) => b.mode === 'ease')).toBe(true);
  });

  it('hear a shot within about 30 blocks, out of sight', () => {
    const { land, world } = ashore(0.5, 25.5);
    wall(world);
    run(land, 1);
    expect(land.bandits.live.every((b) => b.mode === 'ease')).toBe(true);
    land.fire('pistol');
    run(land, 0.1);
    expect(land.bandits.live.every((b) => b.mode === 'fight')).toBe(true);
  });

  it('need a clear line to fire', () => {
    const { land, world } = ashore(0.5, 25.5);
    wall(world);
    run(land, 0.5);
    land.bandits.alertAll();
    expect(land.bandits.fighting()).toBe(true);
    land.takeEvents();
    run(land, 12);
    expect(shots(land)).toHaveLength(0);
  });

  it('keep 8 to 16 off, and load between shots', () => {
    const { land } = ashore(0.5, 12.5);
    run(land, 0.5);
    land.bandits.alertAll();
    land.takeEvents();
    run(land, 20);
    const fired = shots(land);
    // Three muskets, the first two seconds after the alert and seven to load after: no more than three shots each in 20 s.
    expect(fired.length).toBeGreaterThan(0);
    expect(fired.length).toBeLessThanOrEqual(9);
    const w = land.walker!;
    const off = land.bandits.live.map((b) => Math.hypot(b.walker.x - w.x, b.walker.z - w.z));
    expect(off.filter((d) => d >= 6 && d <= 18).length).toBeGreaterThanOrEqual(2);
  });

  it('wear the captain down, and bring them down', () => {
    const { land } = ashore(0.5, 12.5, 4);
    run(land, 0.5);
    land.bandits.alertAll();
    for (let t = 0; t < 120 && land.walker; t += 1 / 20) land.step(1 / 20);
    expect(land.walker).toBeNull();
    expect(land.takeEvents().some((e) => e.kind === 'downed')).toBe(true);
  });

  it('a wounded bandit breaks and runs, and is gone once out of sight', () => {
    const { land, camp } = ashore(0.5, 12.5);
    run(land, 0.5);
    const b = land.bandits.live[0];
    b.hp = 3;
    land.fire('pistol', { x: b.walker.x, y: b.walker.y + 1.2, z: b.walker.z });
    // A hit leaves 1 hp; a miss leaves them fighting. Try again until they're hit.
    for (let i = 0; i < 12 && b.mode !== 'flee' && land.bandits.live.includes(b); i++) {
      run(land, 2.6);
      land.fire('pistol', { x: b.walker.x, y: b.walker.y + 1.2, z: b.walker.z });
    }
    expect(b.mode === 'flee' || !land.bandits.live.includes(b)).toBe(true);
    run(land, 30);
    expect(land.bandits.live).not.toContain(b);
    expect(land.bandits.state(camp.id).left).toBeLessThan(3);
  });

  it('a wounded bandit limps: slower than the captain walks, so they can be run down', () => {
    const { land } = ashore(0.5, 12.5);
    run(land, 0.5);
    const b = land.bandits.live[0];
    Object.assign(b, { hp: 1, mode: 'flee', path: null });
    const from = { x: b.walker.x, z: b.walker.z };
    run(land, 2);
    expect(land.bandits.live).toContain(b);
    const pace = Math.hypot(b.walker.x - from.x, b.walker.z - from.z) / 2;
    expect(pace).toBeGreaterThan(WALK_SPEED / 2);
    expect(pace).toBeLessThan(WALK_SPEED);
  });

  it('a runaway stops at the water: they never wade in, and are gone at the shore', () => {
    const { land, world, camp } = ashore(22.5, 0.5);
    // East of x = 30 the islet shelves into the sea: dry sand, then shallows to wade in, then deep water.
    for (let x = 30; x < 40; x++) {
      for (let z = -40; z < 40; z++) {
        world.setVoxel(x, SEA_LEVEL, z, Block.Air);
        if (x >= 34) world.setVoxel(x, SEA_LEVEL - 1, z, Block.Air);
        world.setVoxel(x, x < 34 ? SEA_LEVEL - 1 : SEA_LEVEL - 2, z, Block.Sand);
      }
    }
    run(land, 0.5);
    const b = land.bandits.live[0];
    Object.assign(b.walker, { x: 26.5, y: GROUND, z: 0.5 });
    Object.assign(b, { hp: 1, mode: 'flee', path: null });
    let last = { x: b.walker.x, y: b.walker.y };
    for (let t = 0; t < 10 && land.bandits.live.includes(b); t += 1 / 20) {
      land.step(1 / 20);
      land.health = HEALTH_MAX;
      if (land.bandits.live.includes(b)) last = { x: b.walker.x, y: b.walker.y };
      expect(b.walker.y, `in the water at x ${b.walker.x.toFixed(2)}`).toBeGreaterThan(WATER_LEVEL);
    }
    expect(land.bandits.live).not.toContain(b);
    expect(land.bandits.state(camp.id).left).toBe(2);
    // They ran on over the dry sand (feet at sea level), and were gone as the shallows came up.
    expect(last.x).toBeGreaterThan(30.5);
    expect(last.x).toBeLessThan(34);
    expect(last.y).toBeCloseTo(SEA_LEVEL, 5);
  });

  it('a shot that fells the last of them, at ease, brings no warning: only word the camp is cleared', () => {
    // Out of their sight by day, a rifle shot at the camp's one bandit: on the first seed it hits, it fells them.
    for (let seed = 1; seed <= 20; seed++) {
      const { land } = ashore(0.5, 22.5, 1, seed);
      run(land, 0.5);
      const b = land.bandits.live[0];
      expect(b.mode).toBe('ease');
      land.takeEvents();
      land.fire('rifle', { x: b.walker.x, y: b.walker.y + 1.2, z: b.walker.z });
      if (land.bandits.live.length > 0) continue;
      const notices = land.takeEvents().flatMap((e) => (e.kind === 'notice' ? [e.text] : []));
      expect(notices).toEqual([expect.stringMatching(/^The bandits’ camp is cleared/)]);
      return;
    }
    expect.unreachable('the rifle never felled the bandit');
  });

  it('a fallen bandit leaves cartridges and a few gold, and the last one gone clears the camp', () => {
    const { land, sea, camp } = ashore(0.5, 12.5, 2);
    run(land, 0.5);
    const gold = sea.captain.gold;
    for (const b of [...land.bandits.live]) land.banditGone(b, 'fell');
    expect(land.bandits.manned(camp)).toBe(false);
    expect(land.bandits.state(camp.id).cleared).not.toBeNull();
    expect(land.takeEvents().some((e) => e.kind === 'notice' && /camp is cleared/.test(e.text))).toBe(true);
    // (banditGone doesn't pay: the shot that fells them does. See Land.wound.)
    expect(sea.captain.gold).toBe(gold);
  });

  it('a rifle shot fells a bandit; they drop cartridges and pay a few gold', () => {
    const { land, sea } = ashore(0.5, 12.5);
    run(land, 0.5);
    const gold = sea.captain.gold;
    const b = land.bandits.live[0];
    for (let i = 0; i < 12 && land.bandits.live.includes(b); i++) {
      land.fire('rifle', { x: b.walker.x, y: b.walker.y + 1.2, z: b.walker.z });
      run(land, 5.1);
    }
    expect(land.bandits.live).not.toContain(b);
    expect(sea.captain.gold).toBeGreaterThan(gold);
    expect(land.drops.some((d) => d.good === 'cartridges')).toBe(true);
  });

  it('a save made mid-fight loads with the bandits at ease, as many as were left', () => {
    const { land, camp } = ashore(0.5, 12.5);
    run(land, 0.5);
    land.bandits.alertAll();
    land.hurt(4);
    land.banditGone(land.bandits.live[0], 'fell');
    const saved = JSON.parse(JSON.stringify(land.snapshot()));
    const loaded = banditIslet().land;
    loaded.restore(saved);
    expect(loaded.health).toBe(HEALTH_MAX);
    expect(loaded.bandits.live).toHaveLength(0);
    loaded.step(1 / 20);
    expect(loaded.bandits.live).toHaveLength(2);
    expect(loaded.bandits.live.every((b) => b.mode === 'ease')).toBe(true);
    expect(loaded.bandits.state(camp.id).left).toBe(2);
  });
});

describe('bandits never set foot on the captain’s claimed ground', () => {
  /**
   * A campfire of the captain's 60 from the bandits' fire, as near as one can be built to a
   * manned camp: its claim (32 round it) reaches to within 28 of their fire, over the east of the islet.
   */
  function claimed(x: number, z: number, size = 3) {
    const setup = ashore(x, z, size);
    setup.land.buildings.push({ id: 90, kind: 'campfire', x0: 59, z0: -1, w: 3, d: 3, y: GROUND, rot: 0 });
    expect(setup.land.claimed(28.6, 0.5)).toBe(true);
    expect(setup.land.claimed(28.4, 0.5)).toBe(false);
    return setup;
  }
  /** Steps on, the captain kept alive; the furthest east any bandit got, and whether one ever stood on claimed ground. */
  function watch(land: Land, seconds: number): { east: number; trespassed: boolean } {
    let east = -Infinity;
    let trespassed = false;
    for (let t = 0; t < seconds; t += 1 / 20) {
      land.step(1 / 20);
      if (land.walker) land.health = HEALTH_MAX;
      for (const b of land.bandits.live) {
        east = Math.max(east, b.walker.x);
        if (land.claimed(b.walker.x, b.walker.z)) trespassed = true;
      }
    }
    return { east, trespassed };
  }

  it('wandering at ease', () => {
    // The camp sits on the west of a wide islet whose middle (where wanderers range about) is
    // toward the claim; the captain is out of sight beyond a wall, all morning.
    const { land, sea, camp } = claimed(0.5, 30.5);
    sea.clock.phase = phaseOf(8);
    Object.assign(camp, { islandX: 20, islandRadius: 50 });
    wall(land.world);
    const seen = watch(land, 240);
    expect(land.bandits.live.every((b) => b.mode === 'ease')).toBe(true);
    expect(seen.east).toBeGreaterThan(20);
    expect(seen.trespassed).toBe(false);
  });

  it('fighting the captain who stands on it', () => {
    const { land } = claimed(37.5, 0.5, 4);
    run(land, 0.5);
    land.bandits.alertAll();
    land.takeEvents();
    const seen = watch(land, 40);
    expect(land.bandits.fighting()).toBe(true);
    expect(seen.east).toBeGreaterThan(24);
    expect(seen.trespassed).toBe(false);
    // From the edge of the claim they're still in range, and fire.
    expect(shots(land).length).toBeGreaterThan(0);
  });

  it('running from the captain toward it', () => {
    const { land } = claimed(4.5, 0.5);
    run(land, 0.5);
    for (const b of land.bandits.live) Object.assign(b.walker, { x: 20.5, z: b.walker.z });
    for (const b of land.bandits.live) b.mode = 'flee';
    const seen = watch(land, 20);
    expect(seen.east).toBeGreaterThan(24);
    expect(seen.trespassed).toBe(false);
  });

  it('and walk off it if a camp is made round them', () => {
    const { land, world } = ashore(0.5, 30.5);
    wall(world);
    run(land, 0.5);
    land.buildings.push({ id: 90, kind: 'campfire', x0: 29, z0: -1, w: 3, d: 3, y: GROUND, rot: 0 });
    expect(land.bandits.live.some((b) => land.claimed(b.walker.x, b.walker.z))).toBe(true);
    run(land, 15);
    expect(land.bandits.live).toHaveLength(3);
    for (const b of land.bandits.live) expect(land.claimed(b.walker.x, b.walker.z)).toBe(false);
  });

  it('and walk off both where two camps’ claims overlap round them, away from the nearer fire', () => {
    const { land, world } = ashore(0.5, 30.5, 1);
    wall(world);
    // A rock face just east of the bandit's fire, and the bandit beside it.
    for (let z = -12; z < 10; z++) for (let y = GROUND; y < GROUND + 10; y++) world.setVoxel(2, y, z, Block.Stone);
    run(land, 0.5);
    const b = land.bandits.live[0];
    Object.assign(b.walker, { x: 0.5, y: GROUND, z: 3.5 });
    // Two fires: one 32 off to the west (its claim's berth takes the bandit in), one 27 off to the south (its claim does).
    land.buildings.push({ id: 90, kind: 'campfire', x0: -33, z0: -1, w: 3, d: 3, y: GROUND, rot: 0 });
    land.buildings.push({ id: 91, kind: 'campfire', x0: -1, z0: 29, w: 3, d: 3, y: GROUND, rot: 0 });
    expect(land.claimed(b.walker.x, b.walker.z)).toBe(true);
    run(land, 15);
    expect(land.bandits.live).toEqual([b]);
    expect(land.claimed(b.walker.x, b.walker.z), `at ${b.walker.x.toFixed(1)}, ${b.walker.z.toFixed(1)}`).toBe(false);
  });

  it('and pinned at a claim’s edge, they give up getting off it, but aren’t deaf and blind there', () => {
    const { land, world } = ashore(0.5, 30.5, 1);
    wall(world);
    // A rock face just east of the bandit, and a fire due west whose claim's edge they stand at:
    // the way off it is straight into the rock.
    for (let z = -12; z < 10; z++) for (let y = GROUND; y < GROUND + 10; y++) world.setVoxel(1, y, z, Block.Stone);
    run(land, 0.5);
    const b = land.bandits.live[0];
    Object.assign(b.walker, { x: 0.5, y: GROUND, z: -3.5 });
    land.buildings.push({ id: 90, kind: 'campfire', x0: -33, z0: -5, w: 3, d: 3, y: GROUND, rot: 0 });
    run(land, 3);
    expect(b.pinned).toBeGreaterThan(1.5);
    expect(b.mode).toBe('ease');
    // The captain comes into sight, and they take up the fight where they stand.
    Object.assign(land.walker!, { x: -8.5, z: -3.5 });
    run(land, 0.5);
    expect(b.mode).toBe('fight');
  });
});
