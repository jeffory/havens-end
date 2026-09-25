import { describe, expect, it } from 'vitest';
import { footprintSamples } from '../sailing/hull';
import { hullContacts } from '../sailing/ship';
import { BRIG, MERCHANT_BRIG, MERCHANT_SLOOP, SLOOP, type ShipType } from '../sailing/ships';
import { Weather } from '../sailing/weather';
import { Block } from '../voxel/blocks';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { createAi } from './ai';
import { AMMO, type Ammo, landingDistance } from './ammo';
import { dropBarrel } from './barrels';
import { planGroup, planNightGroup, regionTier } from './encounters';
import { fireBroadside } from './gunnery';
import { cargoCount, plunder } from '../economy/goods';
import type { Port } from '../economy/ports';
import { JAIL_FINE, type PlayerOrders, Sea } from './sea';
import { applyDamage, createVessel, distanceToBody, type Faction, gunsManned, reloadTime, shipClass, type Vessel } from './vessel';

function box(length: number, beam: number): Float32Array {
  const cells: Array<[number, number]> = [];
  for (let x = 0; x < beam; x++) for (let z = 0; z < length; z++) cells.push([x - beam / 2, z - length / 2]);
  return footprintSamples(cells);
}

const CLASSES = new Map(
  [SLOOP, BRIG, MERCHANT_SLOOP, MERCHANT_BRIG].map((type) => {
    const big = type.model.includes('brig');
    return [type, shipClass(type, big ? box(21, 7) : box(15, 5), big ? 3 : 2.5, big ? 20 : 16)] as const;
  }),
);

const EAST = Math.PI / 2; // heading +x; port side faces north (-z)
const HOLD: PlayerOrders = { rudder: 0, sails: 0, ammo: 'round', fire: [], board: false };

const HOME: Port = { id: 0, name: 'Haven', faction: 'merchant', x: 0, z: 0, heading: EAST, islandX: 0, islandZ: 300, pier: { x: 0, y: 13, z: 8 }, places: [], lamps: [] };

function newSea(world = new VoxelWorld(), spawning = false, seed = 1, ports: Port[] = [HOME]): Sea {
  return new Sea(world, new Weather({ cells: [] }), CLASSES, SLOOP, ports, seed, spawning);
}

function place(sea: Sea, type: ShipType, faction: Faction, x: number, z: number, heading = EAST): Vessel {
  const v = createVessel(sea.nextId++, `${faction} ${type.name}`, faction, sea.classFor(type), x, z, heading, sea.nextId);
  sea.add(v);
  return v;
}

function run(sea: Sea, seconds: number, orders: Partial<PlayerOrders> = {}) {
  const once = { ...HOLD, ...orders };
  for (let t = 0; t < seconds; t += 1 / 60) {
    sea.step(1 / 60, once);
    // Fire and board orders are one-shot, like a key press.
    once.fire = [];
    once.board = false;
  }
}

describe('broadsides', () => {
  it('hit a ship lying abeam within range, and fall short of one beyond it', () => {
    const sea = newSea();
    const near = place(sea, MERCHANT_SLOOP, 'merchant', 0, -30);
    const far = place(sea, MERCHANT_SLOOP, 'merchant', 20, -120);
    run(sea, 4, { fire: ['port'] });
    expect(near.hull).toBeLessThan(near.cls.type.hull);
    expect(far.hull).toBe(far.cls.type.hull);
  });

  it('fire straight out of the side, not ahead', () => {
    const sea = newSea();
    const ahead = place(sea, MERCHANT_SLOOP, 'merchant', 40, 0);
    run(sea, 4, { fire: ['port', 'starboard'] });
    expect(ahead.hull).toBe(ahead.cls.type.hull);
  });

  it('need reloading between shots', () => {
    const sea = newSea();
    expect(fireBroadside(sea, sea.player, 'port')).toBe(true);
    expect(fireBroadside(sea, sea.player, 'port')).toBe(false);
    expect(fireBroadside(sea, sea.player, 'starboard')).toBe(true);
    run(sea, reloadTime(sea.player) + 0.1);
    expect(fireBroadside(sea, sea.player, 'port')).toBe(true);
  });

  it('reach further with round shot than chain, and further with chain than grape', () => {
    expect(landingDistance('round', 2)).toBeGreaterThan(landingDistance('chain', 2));
    expect(landingDistance('chain', 2)).toBeGreaterThan(landingDistance('grape', 2));
    expect(landingDistance('round', 2)).toBeGreaterThan(AMMO.round.range);
  });

  it('do different work: round holes the hull, chain tears sails, grape kills crew', () => {
    const loss = (ammo: Ammo) => {
      const sea = newSea();
      const target = place(sea, BRIG, 'imperial', 0, -18);
      for (let volley = 0; volley < 3; volley++) run(sea, reloadTime(sea.player) + 0.1, { fire: ['port'], ammo });
      const t = target.cls.type;
      return { hull: 1 - target.hull / t.hull, sails: 1 - target.sails / t.sails, crew: 1 - target.crew / t.crew };
    };
    const round = loss('round');
    const chain = loss('chain');
    const grape = loss('grape');
    expect(round.hull).toBeGreaterThan(Math.max(round.sails, round.crew));
    expect(chain.sails).toBeGreaterThan(Math.max(chain.hull, chain.crew));
    expect(grape.crew).toBeGreaterThan(Math.max(grape.hull, grape.sails));
  });
});

describe('damage', () => {
  it('slows a ship whose rigging is shot away', () => {
    const sea = newSea();
    const v = place(sea, SLOOP, 'pirate', 0, 0);
    applyDamage(v, 0, 70, 0);
    expect(v.ship.rig).toBeCloseTo(0.3);
  });

  it('mans fewer guns and reloads slower with a thinned crew', () => {
    const sea = newSea();
    const v = place(sea, BRIG, 'imperial', 0, 0);
    const fullReload = reloadTime(v);
    applyDamage(v, 0, 0, v.crew * 0.6);
    expect(gunsManned(v)).toBeLessThan(BRIG.gunsPerSide);
    expect(reloadTime(v)).toBeGreaterThan(fullReload * 1.3);
  });

  it('makes a ship strike her colours when most of her crew is gone', () => {
    const sea = newSea();
    const v = place(sea, SLOOP, 'pirate', 0, 0);
    applyDamage(v, 0, 0, v.crew * 0.85);
    expect(v.status).toBe('struck');
  });

  it('sinks a ship at zero hull, and she is gone a few seconds later', () => {
    const sea = newSea();
    const v = place(sea, SLOOP, 'pirate', 0, -40);
    applyDamage(v, 1000, 0, 0);
    expect(v.status).toBe('sinking');
    run(sea, 8);
    expect(sea.vessels).not.toContain(v);
  });

  it('gives the player a fresh ship at home after sinking', () => {
    const sea = newSea();
    applyDamage(sea.player, 1000, 0, 0);
    run(sea, 6);
    expect(sea.player.status).toBe('afloat');
    expect(sea.player.hull).toBe(SLOOP.hull);
    expect(sea.takeEvents().some((e) => e.kind === 'respawn')).toBe(true);
  });
});

describe('boarding', () => {
  it('takes a ship that has struck, and some of her crew sign on', () => {
    const sea = newSea();
    sea.player.crew = 15;
    const prize = place(sea, MERCHANT_BRIG, 'merchant', 0, -8);
    applyDamage(prize, 0, 0, prize.crew * 0.85);
    expect(sea.boardingTarget()).toBe(prize);
    run(sea, 0.1, { board: true });
    expect(prize.status).toBe('captured');
    expect(sea.player.crew).toBeGreaterThan(15);
  });

  it('only works alongside', () => {
    const sea = newSea();
    place(sea, MERCHANT_SLOOP, 'merchant', 0, -30);
    expect(sea.boardingTarget()).toBeNull();
  });
});

describe('barrels', () => {
  it('spare the ship that dropped them but blow up under a pursuer', () => {
    const sea = newSea();
    const merchant = place(sea, MERCHANT_SLOOP, 'merchant', 30, 0);
    merchant.helm.sails = 1;
    merchant.ship.surge = 8;
    sea.player.ship.surge = 8;
    const dropped = sea.barrels.length;
    // The merchant runs east with the player close behind; she drops a barrel in the player's path.
    run(sea, 0.5, { sails: 1 });
    expect(merchant.barrels).toBe(MERCHANT_SLOOP.barrels);
    expect(dropBarrel(sea, merchant)).toBe(true);
    expect(sea.barrels.length).toBe(dropped + 1);
    const before = sea.player.hull;
    run(sea, 6, { sails: 1 });
    expect(merchant.hull).toBe(MERCHANT_SLOOP.hull);
    expect(sea.player.hull).toBeLessThan(before);
    expect(sea.barrels.length).toBe(dropped);
  });

  it('can be set off by a round shot, where it comes down near the end of its flight', () => {
    const sea = newSea();
    const reach = landingDistance('round', 2.5 - 0.7); // from the test sloop's gun deck
    for (const x of [-4, 0, 4]) sea.barrels.push({ id: 90 + x, x, z: -(reach - 2), arm: 0, age: 0 });
    run(sea, 4, { fire: ['port'] });
    expect(sea.takeEvents().some((e) => e.kind === 'explosion')).toBe(true);
  });
});

describe('captains', () => {
  function withAi(sea: Sea, type: ShipType, faction: Faction, x: number, z: number, heading: number): Vessel {
    const v = place(sea, type, faction, x, z, heading);
    v.ai = createAi(x + Math.sin(heading) * 600, z + Math.cos(heading) * 600, heading);
    v.helm.sails = 0.5;
    return v;
  }

  it('merchants run from the player', () => {
    const sea = newSea();
    const merchant = withAi(sea, MERCHANT_SLOOP, 'merchant', 0, -70, -EAST); // heading west, toward the player's bow
    let fled = false;
    for (let t = 0; t < 25; t += 1 / 60) {
      sea.step(1 / 60, HOLD);
      fled ||= merchant.ai!.mode === 'flee';
    }
    expect(fled).toBe(true);
    // Once clear she goes back to her business.
    expect(Math.hypot(merchant.ship.x, merchant.ship.z)).toBeGreaterThan(110);
  });

  it('warships close in and fire a broadside', () => {
    const sea = newSea();
    withAi(sea, SLOOP, 'pirate', 0, -120, 0);
    run(sea, 45);
    expect(sea.player.hull).toBeLessThan(SLOOP.hull);
  });

  it('Imperial warships leave an honest captain be, but hunt an outlaw', () => {
    const honest = newSea();
    const patrol = withAi(honest, SLOOP, 'imperial', 0, -100, 0);
    run(honest, 10);
    expect(patrol.ai!.mode).toBe('cruise');

    const outlaw = newSea();
    outlaw.captain.standing.imperial = -40;
    const hunter = withAi(outlaw, SLOOP, 'imperial', 0, -100, 0);
    run(outlaw, 10);
    expect(hunter.ai!.mode).toBe('engage');
  });

  it("pirates don't prey on friends of the Brethren", () => {
    const sea = newSea();
    sea.captain.standing.pirate = 30;
    const pirate = withAi(sea, SLOOP, 'pirate', 0, -100, 0);
    run(sea, 10);
    expect(pirate.ai!.mode).toBe('cruise');
  });

  it('steer clear of land', () => {
    const world = new VoxelWorld();
    for (let x = 60; x < 66; x++) for (let z = -80; z < 80; z++) for (let y = 0; y < 16; y++) world.setVoxel(x, y, z, Block.Stone);
    const sea = newSea(world);
    const merchant = withAi(sea, MERCHANT_SLOOP, 'merchant', 0, -200, EAST); // cruising east, straight at the wall
    merchant.ai!.destX = 400;
    merchant.ai!.destZ = -200;
    // Keep the player out of the way so she just cruises.
    sea.player.ship.x = -500;
    let touched = false;
    for (let t = 0; t < 40; t += 1 / 60) {
      sea.step(1 / 60, HOLD);
      if (hullContacts(world, merchant.cls.spec, merchant.ship.x, merchant.ship.z, merchant.ship.heading) > 0 || merchant.ship.grounded) touched = true;
    }
    expect(touched).toBe(false);
  });
});

describe('encounters', () => {
  it('get harder the further you sail from home', () => {
    expect(regionTier(100, 100)).toBe(0);
    expect(regionTier(1000, 0)).toBe(1);
    expect(regionTier(0, -2000)).toBe(2);
    // Out in Imperial waters, merchants sail in escorted convoys.
    const convoy = planGroup(2, 0.1);
    expect(convoy[0].faction).toBe('merchant');
    expect(convoy.length).toBeGreaterThan(1);
    expect(convoy.slice(1).every((m) => m.faction === 'imperial')).toBe(true);
  });

  it("favour a port's own ships in its waters", () => {
    expect(planGroup(0, 0.1, 'imperial', 0.2)[0].faction).toBe('imperial');
    expect(planGroup(1, 0.1, 'pirate', 0.2).every((m) => m.faction === 'pirate')).toBe(true);
    expect(planGroup(0, 0.1, 'imperial', 0.9)[0].faction).toBe('merchant');
  });

  it('at night, bring raiders rather than lone merchants', () => {
    for (const tier of [0, 1, 2] as const) {
      for (let roll = 0; roll < 1; roll += 0.05) {
        const plan = planNightGroup(tier, roll);
        expect(plan.length === 1 && plan[0].faction === 'merchant').toBe(false);
      }
      const pirates = Array.from({ length: 20 }, (_, i) => planNightGroup(tier, i / 20)).filter((p) => p[0].faction === 'pirate').length;
      const byDay = Array.from({ length: 20 }, (_, i) => planGroup(tier, i / 20)).filter((p) => p[0].faction === 'pirate').length;
      expect(pirates).toBeGreaterThan(byDay);
    }
  });

  it('bring a merchant first, out of sight and in open water', () => {
    const sea = newSea(new VoxelWorld(), true);
    run(sea, 5);
    const newcomer = sea.vessels[1];
    expect(newcomer.faction).toBe('merchant');
    const d = Math.hypot(newcomer.ship.x - sea.player.ship.x, newcomer.ship.z - sea.player.ship.z);
    expect(d).toBeGreaterThan(200);
    expect(d).toBeLessThan(320);
  });
});

describe('determinism', () => {
  it('plays out identically from the same seed and orders', () => {
    const play = () => {
      const sea = newSea(new VoxelWorld(), true, 42);
      run(sea, 20, { sails: 1, rudder: 0.2 });
      run(sea, 1, { fire: ['port', 'starboard'], ammo: 'chain' });
      run(sea, 20, { sails: 1, rudder: -0.3 });
      return JSON.stringify(sea.vessels.map((v) => [v.name, v.ship, v.hull, v.sails, v.crew]));
    };
    expect(play()).toBe(play());
  });
});

describe('the player', () => {
  it('is taken when her last hands fall, and starts again at home', () => {
    const sea = newSea();
    applyDamage(sea.player, 0, 0, 1000);
    expect(sea.player.status).toBe('captured');
    run(sea, 6);
    expect(sea.player.status).toBe('afloat');
    expect(sea.player.crew).toBe(SLOOP.crew);
  });
});

describe('fleets', () => {
  it('give way to each other instead of colliding head-on', () => {
    const sea = newSea();
    sea.player.ship.x = -3000; // far away, so both simply cruise
    // A collision course square across the trade wind, so both ships can actually hold it.
    const trade = sea.weather.windAt(0, 0, 0);
    const [dx, dz] = [-trade.dirZ, trade.dirX];
    const heading = Math.atan2(dx, dz);
    const west = place(sea, BRIG, 'imperial', -60 * dx, -60 * dz, heading);
    const east = place(sea, BRIG, 'imperial', 60 * dx, 60 * dz, heading + Math.PI);
    west.ai = createAi(1000 * dx, 1000 * dz, heading);
    east.ai = createAi(-1000 * dx, -1000 * dz, heading + Math.PI);
    // Hulls touch when any point of one's waterline footprint is inside (or grazing) the other.
    const touching = (a: Vessel, b: Vessel) => {
      const o = a.cls.spec.footprint;
      const s = Math.sin(a.ship.heading);
      const c = Math.cos(a.ship.heading);
      for (let i = 0; i < o.length; i += 2) {
        if (distanceToBody(b, a.ship.x + o[i] * c + o[i + 1] * s, 0, a.ship.z - o[i] * s + o[i + 1] * c) < 0.5) return true;
      }
      return false;
    };
    let contact = 0;
    for (let t = 0; t < 40; t += 1 / 60) {
      sea.step(1 / 60, HOLD);
      if (touching(west, east)) contact++;
    }
    expect(contact).toBe(0);
  });
});

describe('boarding, plunder and jail', () => {
  function alongside(sea: Sea, faction: Faction = 'merchant') {
    const prize = place(sea, MERCHANT_BRIG, faction, 0, -8);
    prize.gold = 150;
    prize.cargo = { sugar: 50, rum: 40 };
    return prize;
  }

  it('boarding a ship that has not struck starts the captains’ duel', () => {
    const sea = newSea();
    const prize = alongside(sea);
    run(sea, 0.1, { board: true });
    expect(sea.boarding).toBe(prize.id);
    expect(sea.takeEvents().some((e) => e.kind === 'boardingFight')).toBe(true);
    expect(prize.status).toBe('afloat');
  });

  it('winning the duel takes the ship, her gold, and as much cargo as the hold takes', () => {
    const sea = newSea();
    const prize = alongside(sea);
    run(sea, 0.1, { board: true });
    const gold = sea.captain.gold;
    sea.finishBoarding(true);
    expect(prize.status).toBe('captured');
    expect(sea.captain.gold).toBe(gold + 150);
    expect(cargoCount(sea.player.cargo)).toBe(SLOOP.hold); // 90 aboard her, room for 30
    expect(sea.boarding).toBeNull();
  });

  it('losing it means jail: fined, hold emptied, released at the last port', () => {
    const sea = newSea();
    alongside(sea);
    sea.player.cargo = { cloth: 12 };
    sea.player.ship.x = 300; // wherever the fight happened
    sea.captain.gold = 1000;
    sea.boarding = sea.vessels[1].id;
    sea.finishBoarding(false);
    expect(sea.captain.gold).toBe(1000 * (1 - JAIL_FINE));
    expect(cargoCount(sea.player.cargo)).toBe(0);
    expect(sea.player.ship.x).toBe(sea.captain.lastPort.x);
    expect(sea.takeEvents().find((e) => e.kind === 'jailed')).toMatchObject({ fine: 300, goods: 12, port: 'Haven' });
  });

  it('a sunk ship takes her cargo down with her, but the captain keeps their purse', () => {
    const sea = newSea();
    sea.player.cargo = { rum: 20 };
    sea.captain.gold = 500;
    applyDamage(sea.player, 1000, 0, 0);
    run(sea, 6);
    expect(sea.captain.gold).toBe(500);
    expect(cargoCount(sea.player.cargo)).toBe(0);
  });

  it('merchants carry cargo worth taking; warships carry a paymaster’s chest', () => {
    const random = () => 0.5;
    expect(cargoCount(plunder(MERCHANT_BRIG, 'merchant', random).cargo)).toBeGreaterThan(20);
    const warship = plunder(BRIG, 'imperial', random);
    expect(cargoCount(warship.cargo)).toBe(0);
    expect(warship.gold).toBeGreaterThan(0);
  });
});

describe('reputation at sea', () => {
  it('firing first on a merchant costs standing with the guild and the Crown, and pleases the Brethren', () => {
    const sea = newSea();
    place(sea, MERCHANT_SLOOP, 'merchant', 0, -30).ai = createAi(0, -600, EAST);
    run(sea, 4, { fire: ['port'] });
    const { standing } = sea.captain;
    expect(standing.merchant).toBeLessThan(15);
    expect(standing.imperial).toBeLessThan(0);
    expect(standing.pirate).toBeGreaterThan(-30);
    expect(sea.takeEvents().some((e) => e.kind === 'standing' && e.faction === 'merchant')).toBe(true);
  });

  it("returning fire on a pirate who came for you isn't an attack; sinking her is", () => {
    const sea = newSea();
    const pirate = place(sea, SLOOP, 'pirate', 0, -30);
    pirate.ai = createAi(0, -600, EAST);
    run(sea, 0.5); // she sees the player and comes on
    expect(pirate.ai.mode).toBe('engage');
    run(sea, 4, { fire: ['port'] });
    expect(pirate.hull).toBeLessThan(SLOOP.hull);
    expect(sea.captain.standing.pirate).toBe(-30);
    applyDamage(pirate, 1000, 0, 0);
    sea.reportStatusChange(pirate, 'afloat');
    expect(sea.captain.standing.pirate).toBeLessThan(-30);
    expect(sea.captain.standing.imperial).toBeGreaterThan(0);
  });

  it('sinking or taking a ship counts toward a bounty on her flag', () => {
    const sea = newSea();
    sea.captain.contracts.push({ id: 7, kind: 'bounty', issuer: 0, faction: 'imperial', target: 'pirate', count: 2, progress: 0, reward: 500, standing: 10, deadline: 1e6 });
    const prize = place(sea, SLOOP, 'pirate', 0, -8);
    prize.status = 'struck';
    run(sea, 0.1, { board: true });
    expect(prize.status).toBe('captured');
    expect(sea.captain.contracts[0]).toMatchObject({ progress: 1 });
    expect(sea.takeEvents().find((e) => e.kind === 'bounty')).toMatchObject({ contract: 7, progress: 1, count: 2 });
  });
});

describe('harbours', () => {
  const FAR: Port = { id: 1, name: 'Kingsreach', faction: 'imperial', x: 400, z: 0, heading: EAST, islandX: 400, islandZ: 300, pier: { x: 400, y: 13, z: 8 }, places: [], lamps: [] };

  it('take a ship that comes in slowly, and remember her captain', () => {
    const sea = newSea(new VoxelWorld(), false, 1, [HOME, FAR]);
    sea.player.ship.x = 390;
    run(sea, 0.1, { board: true });
    expect(sea.docked).toBe(FAR);
    expect(sea.captain.lastPort).toBe(FAR);
    expect(sea.player.ship).toMatchObject({ x: FAR.x, z: FAR.z, surge: 0 });
    expect(sea.takeEvents().some((e) => e.kind === 'docked' && e.port === 1)).toBe(true);
  });

  it('turn away captains going too fast, with enemies on their tail, or on bad terms with the port', () => {
    const tryDock = (setup: (sea: Sea) => void) => {
      const sea = newSea(new VoxelWorld(), false, 1, [HOME, FAR]);
      sea.player.ship.x = 390;
      setup(sea);
      sea.step(1 / 60, { ...HOLD, board: true });
      return { docked: sea.docked, refused: sea.takeEvents().find((e) => e.kind === 'refused') };
    };
    expect(tryDock((sea) => (sea.player.ship.surge = 8))).toMatchObject({ docked: null, refused: { reason: 'fast' } });
    expect(tryDock((sea) => (sea.captain.standing.imperial = -60))).toMatchObject({ docked: null, refused: { reason: 'closed' } });
    expect(
      tryDock((sea) => {
        const hunter = place(sea, SLOOP, 'pirate', 390, -50);
        hunter.ai = createAi(0, 0, 0);
        hunter.ai.mode = 'engage';
      }),
    ).toMatchObject({ docked: null, refused: { reason: 'enemies' } });
    // Nowhere near a harbour, the order does nothing.
    const sea = newSea(new VoxelWorld(), false, 1, [HOME, FAR]);
    sea.player.ship.x = 200;
    run(sea, 0.1, { board: true });
    expect(sea.docked).toBeNull();
  });

  it('know a fight when there is one: a ship close by fighting you, or running from your guns', () => {
    const sea = newSea();
    Object.assign(sea.player.ship, { x: 200, z: 0 });
    const hunter = place(sea, SLOOP, 'pirate', 200, -80);
    hunter.ai = createAi(0, 0, 0);
    expect(sea.inBattle()).toBe(false); // just sailing by
    hunter.ai.mode = 'engage';
    expect(sea.inBattle()).toBe(true);
    hunter.ship.z = -400;
    expect(sea.inBattle()).toBe(false); // too far off to count
    const prize = place(sea, MERCHANT_SLOOP, 'merchant', 200, 60);
    prize.ai = createAi(0, 0, 0);
    prize.ai.mode = 'flee';
    expect(sea.inBattle()).toBe(false); // only wary
    prize.ai.alerted = true; // fired on
    expect(sea.inBattle()).toBe(true);
    prize.status = 'struck';
    expect(sea.inBattle()).toBe(false);
    const friend = place(sea, SLOOP, 'pirate', 200, 40);
    friend.ai = { ...createAi(0, 0, 0), mode: 'engage', alerted: true, ally: true };
    expect(sea.inBattle()).toBe(false); // an ally, fighting on your side
  });

  it('after losing her ship the captain starts again in a sloop, whatever she sailed before', () => {
    const sea = newSea();
    sea.refit(sea.classFor(BRIG), 'Your brig');
    applyDamage(sea.player, 1000, 0, 0);
    run(sea, 6);
    expect(sea.player.cls.design).toBe(SLOOP);
  });
});

describe('the carpenter', () => {
  it('mends the hull with planks from the hold, out of a fight', () => {
    const sea = newSea(new VoxelWorld());
    const p = sea.player;
    p.hull -= 20;
    p.cargo = { planks: 3 };
    const damaged = p.hull;
    run(sea, 10);
    expect(p.hull).toBeGreaterThan(damaged + 12);
    expect(p.cargo.planks ?? 0).toBeLessThan(3);
    // No planks, no mending.
    p.cargo = {};
    const now = p.hull;
    run(sea, 5);
    expect(p.hull).toBe(now);
    expect(sea.takeEvents().some((e) => e.kind === 'mending')).toBe(true);
  });
});
