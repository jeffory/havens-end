import { describe, expect, it } from 'vitest';
import { phaseOf } from '../core/clock';
import { Sea } from '../combat/sea';
import { shipClass } from '../combat/vessel';
import { footprintSamples } from '../sailing/hull';
import { BRIG, MERCHANT_BRIG, MERCHANT_SLOOP, SLOOP } from '../sailing/ships';
import { Weather } from '../sailing/weather';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { PASSENGER_BERTHS } from './captain';
import { contractTitle, type Delivery } from './contracts';
import { Economy, ROOM_COST } from './economy';
import { cargoCount, STAPLES } from './goods';
import { knownRoutes } from './logbook';
import { buyCost, findLine, sellValue, stepMarket, unitPrice } from './market';
import type { Port } from './ports';
import { applyDeed, bribeCost, portOpen, priceFactor, standingNews, startingStanding } from './reputation';
import { tradeInValue } from './shipyard';

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

const port = (id: number, name: string, faction: Port['faction'], x: number): Port => ({
  id,
  name,
  faction,
  x,
  z: 0,
  heading: 0,
  islandX: x,
  islandZ: 100,
  pier: { x, y: 13, z: 8 },
  places: [],
  lamps: [],
});
const PORTS: Port[] = [
  port(0, 'Haven', 'merchant', 0),
  port(1, 'Port Clemency', 'merchant', 500),
  port(2, "Rook's Nest", 'pirate', -900),
  port(3, 'Kingsreach', 'imperial', 1100),
  port(4, 'Castell Sorn', 'imperial', -1700),
];
const [HAVEN, CLEMENCY, NEST, KINGSREACH] = PORTS;

function setup(seed = 1) {
  const sea = new Sea(new VoxelWorld(), new Weather({ cells: [] }), CLASSES, SLOOP, PORTS, seed, false);
  const economy = new Economy(sea, PORTS, seed);
  sea.captain.gold = 5000;
  return { sea, economy };
}

describe('markets', () => {
  it('each staple is made in two ports and wanted in two others: the trade routes', () => {
    const { economy } = setup();
    for (const good of STAPLES) {
      const roles = PORTS.map((p) => findLine(economy.lines(p), good)!.role);
      expect(roles.filter((r) => r === 'produces')).toHaveLength(2);
      expect(roles.filter((r) => r === 'demands')).toHaveLength(2);
    }
  });

  it('muskets are sold openly in free ports, wanted in pirate havens, and only on the black market in Imperial ports', () => {
    const { economy } = setup();
    expect(findLine(economy.lines(HAVEN), 'muskets')!.role).toBe('produces');
    expect(findLine(economy.lines(NEST), 'muskets')!.role).toBe('demands');
    expect(findLine(economy.lines(KINGSREACH), 'muskets')).toBeUndefined();
    expect(findLine(economy.lines(KINGSREACH, true), 'muskets')).toBeDefined();
  });

  it('prices climb as you buy and fall as you sell, then recover', () => {
    const { economy } = setup();
    const line = economy.lines(HAVEN)[0];
    const before = unitPrice(line);
    expect(buyCost(line, 20)).toBeGreaterThan(20 * buyCost(line, 1) - 1);
    expect(sellValue(line, 20)).toBeLessThan(20 * sellValue(line, 1) + 1);
    line.stock -= 40;
    expect(unitPrice(line)).toBeGreaterThan(before);
    for (let t = 0; t < 1200; t++) stepMarket(economy.states[0].market, 1);
    expect(unitPrice(line)).toBeCloseTo(before, 0);
  });

  it('buying is limited by the hold and the purse; the price book remembers what you saw', () => {
    const { sea, economy } = setup();
    const good = economy.lines(HAVEN).find((l) => l.role === 'produces')!.good;
    expect(economy.buy(HAVEN, good, 100).ok).toBe(true);
    expect(cargoCount(sea.player.cargo)).toBe(SLOOP.hold);
    expect(economy.buy(HAVEN, good, 1)).toMatchObject({ ok: false, message: 'Your hold is full.' });
    expect(sea.captain.logbook[0][good]).toBeDefined();

    const poor = setup();
    poor.sea.captain.gold = 30;
    poor.economy.buy(HAVEN, 'spice', 10);
    expect(poor.sea.captain.gold).toBeGreaterThanOrEqual(0);
    expect(poor.sea.player.cargo.spice ?? 0).toBeLessThan(2);
  });

  it('a bad name costs you at the counter', () => {
    const { sea, economy } = setup();
    const line = economy.lines(KINGSREACH)[0];
    const fair = economy.quote(KINGSREACH, line);
    sea.captain.standing.imperial = -40;
    const unfair = economy.quote(KINGSREACH, line);
    expect(unfair.buy).toBeGreaterThan(fair.buy);
    expect(unfair.sell).toBeLessThan(fair.sell);
  });

  it("won't take contraband on the open market in the Crown's ports, but the back room will", () => {
    const { sea, economy } = setup();
    sea.player.cargo.muskets = 10;
    expect(economy.sell(KINGSREACH, 'muskets', 10).ok).toBe(false);
    expect(economy.sell(KINGSREACH, 'muskets', 10, true).message).toMatch(/after dark/);
    sea.clock.phase = phaseOf(22);
    const gold = sea.captain.gold;
    expect(economy.sell(KINGSREACH, 'muskets', 10, true).ok).toBe(true);
    expect(sea.captain.gold).toBeGreaterThan(gold + 10 * 75);
  });
});

describe('camp goods', () => {
  it("every port deals in planks and provisions; pirate havens want arms and provisions, the Crown's yards planks", () => {
    const { economy } = setup();
    for (const port of economy.ports) {
      const goods = economy.lines(port).map((l) => l.good);
      expect(goods).toContain('planks');
      expect(goods).toContain('provisions');
      expect(goods).toContain('iron');
    }
    const role = (port: Port, good: string) => economy.lines(port).find((l) => l.good === good)?.role;
    const nest = economy.ports.find((p) => p.faction === 'pirate')!;
    const crown = economy.ports.find((p) => p.faction === 'imperial')!;
    expect(role(nest, 'cutlasses')).toBe('demands');
    expect(role(nest, 'provisions')).toBe('demands');
    expect(role(crown, 'planks')).toBe('demands');
    expect(role(crown, 'iron')).toBe('produces');
  });

  it("leave the older lines as they were, so earlier saves' stocks still line up", () => {
    const { economy } = setup();
    const lines = economy.lines(economy.ports[0]);
    expect(lines.slice(0, 5).map((l) => l.good)).toEqual(['sugar', 'rum', 'tobacco', 'cloth', 'spice']);
    expect(lines.findIndex((l) => l.good === 'pepperSeed')).toBeLessThan(lines.findIndex((l) => l.good === 'planks'));
  });
});

describe('customs', () => {
  it('sometimes find smuggled muskets: seized, a fine, and the Crown remembers', () => {
    let seized = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { sea, economy } = setup(seed);
      sea.player.cargo.muskets = 10;
      economy.arrive(KINGSREACH);
      if (!sea.player.cargo.muskets) {
        seized++;
        expect(sea.captain.gold).toBe(5000 - 150);
        expect(sea.captain.standing.imperial).toBeLessThan(0);
      }
    }
    expect(seized).toBeGreaterThan(4);
    expect(seized).toBeLessThan(26);
  });

  it("don't bother anyone in free ports", () => {
    const { sea, economy } = setup();
    sea.player.cargo.muskets = 10;
    economy.arrive(CLEMENCY);
    expect(sea.player.cargo.muskets).toBe(10);
  });
});

describe('jobs', () => {
  it('freight: the cargo is loaded against a bond, and paid for (bond and all) at the other end', () => {
    const { sea, economy } = setup();
    economy.arrive(HAVEN);
    const job = economy.offers(HAVEN, 'office').find((c): c is Delivery => c.kind === 'delivery')!;
    expect(job).toBeDefined();
    const gold = sea.captain.gold;
    expect(economy.accept(HAVEN, job.id).ok).toBe(true);
    expect(sea.captain.gold).toBe(gold - job.bond);
    expect(sea.player.cargo[job.good]).toBe(job.amount);
    expect(economy.turnIn(HAVEN, job.id).ok).toBe(false);

    const dest = PORTS[job.port];
    const standing = sea.captain.standing[job.faction];
    expect(economy.turnIn(dest, job.id).ok).toBe(true);
    expect(sea.captain.gold).toBe(gold + job.reward);
    expect(sea.player.cargo[job.good]).toBeUndefined();
    expect(sea.captain.standing[job.faction]).toBeGreaterThan(standing);
    expect(sea.captain.contracts).toHaveLength(0);
  });

  it('fail if not done in time: the bond is lost and so is some goodwill', () => {
    const { sea, economy } = setup();
    economy.arrive(HAVEN);
    const job = economy.offers(HAVEN, 'office')[0];
    economy.accept(HAVEN, job.id);
    const standing = sea.captain.standing[job.faction];
    sea.time = job.deadline + 1;
    economy.step(1);
    expect(sea.captain.contracts).toHaveLength(0);
    expect(sea.captain.standing[job.faction]).toBeLessThan(standing);
    expect(economy.takeNotices()[0].tone).toBe('bad');
  });

  it('bounties are collected where they were posted, once the ships are taken', () => {
    const { sea, economy } = setup();
    economy.arrive(HAVEN);
    const job = economy.offers(HAVEN, 'office').find((c) => c.kind === 'bounty')!;
    economy.accept(HAVEN, job.id);
    expect(economy.turnIn(HAVEN, job.id).ok).toBe(false);
    if (job.kind === 'bounty') job.progress = job.count;
    const gold = sea.captain.gold;
    expect(economy.turnIn(HAVEN, job.id).ok).toBe(true);
    expect(sea.captain.gold).toBe(gold + job.reward);
  });

  it('the fixer in a free port offers smuggling runs into Imperial ports; none in the Crown’s own', () => {
    const { economy } = setup();
    economy.arrive(HAVEN);
    economy.arrive(KINGSREACH);
    const run = economy.offers(HAVEN, 'fixer')[0] as Delivery;
    expect(run).toMatchObject({ kind: 'delivery', good: 'muskets', black: true });
    expect(PORTS[run.port].faction).toBe('imperial');
    expect(contractTitle(run, PORTS)).toMatch(/^Smuggle \d+ muskets into /);
    expect(economy.offers(KINGSREACH, 'fixer')).toHaveLength(0);
  });

  it('no more than three at once', () => {
    const { sea, economy } = setup();
    economy.arrive(HAVEN);
    economy.arrive(CLEMENCY);
    const all = [HAVEN, CLEMENCY].flatMap((p) => [...economy.offers(p, 'office'), ...economy.offers(p, 'fixer')].map((c) => [p, c] as const));
    // Bounties first: they take no hold space.
    all.sort(([, a], [, b]) => (a.kind === 'bounty' ? -1 : 1) - (b.kind === 'bounty' ? -1 : 1));
    for (const [p, c] of all) if (sea.captain.contracts.length < 3 && economy.canAccept(c)) economy.accept(p, c.id);
    expect(sea.captain.contracts).toHaveLength(3);
    const [p, rest] = all.find(([, c]) => !sea.captain.contracts.includes(c))!;
    expect(economy.accept(p, rest.id)).toMatchObject({ ok: false, message: 'You can take on only 3 jobs at once.' });
  });
});

describe('the tavern', () => {
  it('hires hands up to a full crew', () => {
    const { sea, economy } = setup();
    sea.player.crew = 20;
    expect(economy.hire(HAVEN, 100).ok).toBe(true);
    expect(sea.player.crew).toBe(SLOOP.crew);
    expect(economy.hire(HAVEN, 1).ok).toBe(false);
  });

  it('signs settlers on as passengers, as many as there are berths for', () => {
    const { sea, economy } = setup();
    sea.captain.gold = 1000;
    const { available, fee } = economy.settlersFor(HAVEN);
    expect(available).toBeGreaterThan(2);
    expect(economy.hireSettlers(HAVEN, 2).ok).toBe(true);
    expect(sea.captain.passengers).toBe(2);
    expect(sea.captain.gold).toBe(1000 - 2 * fee);
    sea.captain.passengers = PASSENGER_BERTHS;
    expect(economy.hireSettlers(HAVEN, 1).message).toMatch(/berths/);
  });

  it('lets a room, and the fixer keeps to the dark', () => {
    const { sea, economy } = setup();
    sea.clock.phase = phaseOf(10);
    expect(economy.afterDark()).toBe(false);
    const gold = sea.captain.gold;
    expect(economy.takeRoom().ok).toBe(true);
    expect(sea.captain.gold).toBe(gold - ROOM_COST);
    sea.clock.phase = phaseOf(22);
    expect(economy.afterDark()).toBe(true);
  });

  it('a round for the house brings news of prices elsewhere, into the price book', () => {
    const { sea, economy } = setup();
    expect(economy.buyRound(HAVEN).ok).toBe(true);
    expect(economy.states[0].rumours.length).toBeGreaterThan(0);
    expect(Object.keys(sea.captain.logbook).some((id) => Number(id) !== HAVEN.id)).toBe(true);
  });

  it('the fixer mends a bad name for gold, but only so far', () => {
    const { sea, economy } = setup();
    sea.captain.standing.imperial = -60;
    const cost = economy.bribeCost('imperial')!;
    const gold = sea.captain.gold;
    expect(economy.bribe(NEST, 'imperial').message).toMatch(/after dark/);
    sea.clock.phase = phaseOf(23);
    expect(economy.bribe(NEST, 'imperial').ok).toBe(true);
    expect(sea.captain.standing.imperial).toBe(-45);
    expect(sea.captain.gold).toBe(gold - cost);
    for (let i = 0; i < 10; i++) economy.bribe(NEST, 'imperial');
    expect(sea.captain.standing.imperial).toBe(25);
    expect(economy.bribe(NEST, 'imperial').ok).toBe(false);
  });
});

describe('the shipyard', () => {
  it('repairs and refits', () => {
    const { sea, economy } = setup();
    sea.player.hull = 40;
    expect(economy.repair('hull').ok).toBe(true);
    expect(sea.player.hull).toBe(SLOOP.hull);
    expect(economy.upgrade('hold').ok).toBe(true);
    expect(sea.player.cls.type.hold).toBe(40);
    expect(sea.player.cls.design).toBe(SLOOP);
    expect(economy.upgrade('hull').ok).toBe(true);
    expect(sea.player.hull).toBe(125);
    expect(economy.upgrade('hull').ok).toBe(false);
  });

  it('sells ships in part-exchange, keeping crew and cargo that fit', () => {
    const { sea, economy } = setup();
    sea.docked = NEST;
    sea.player.cargo = { rum: 20 };
    const tradeIn = tradeInValue(sea.player);
    const gold = sea.captain.gold;
    expect(economy.buyShip(NEST, BRIG).ok).toBe(true);
    expect(sea.player.cls.design).toBe(BRIG);
    expect(sea.player.cargo.rum).toBe(20);
    expect(sea.captain.gold).toBe(gold - (3800 - tradeIn));
    // Pirate yards don't build merchant brigs.
    expect(economy.buyShip(NEST, MERCHANT_BRIG).ok).toBe(false);
  });
});

describe('reputation', () => {
  it('piracy angers the victims, and the Brethren approve', () => {
    const standing = startingStanding();
    applyDeed(standing, 'merchant', 'capture');
    expect(standing.merchant).toBeLessThan(15);
    expect(standing.pirate).toBeGreaterThan(-30);
    applyDeed(standing, 'pirate', 'sink');
    expect(standing.imperial).toBeGreaterThan(-3);
  });

  it('closes ports at rock bottom; pirate havens hold out longest', () => {
    const standing = { imperial: -50, merchant: -49, pirate: -79 };
    expect(portOpen(standing, 'imperial')).toBe(false);
    expect(portOpen(standing, 'merchant')).toBe(true);
    expect(portOpen(standing, 'pirate')).toBe(true);
    expect(priceFactor(standing, 'merchant')).toBeGreaterThan(1.1);
    // Pirate havens welcome anyone's gold.
    expect(priceFactor(standing, 'pirate')).toBe(1);
  });

  it('announces the lines that matter', () => {
    expect(standingNews({ faction: 'imperial', from: -20, to: -30 })[0]).toMatch(/price on your head/);
    expect(standingNews({ faction: 'merchant', from: -45, to: -55 })[0]).toBe('Free ports are now closed to you.');
    expect(standingNews({ faction: 'pirate', from: 15, to: 21 })[0]).toMatch(/one of their own/);
    expect(standingNews({ faction: 'pirate', from: 0, to: 5 })).toEqual([]);
  });

  it('bribes cost more the deeper the grudge', () => {
    expect(bribeCost(-80)!).toBeGreaterThan(bribeCost(-20)!);
    expect(bribeCost(25)).toBeNull();
  });
});

describe('the price book', () => {
  it('suggests the best known runs', () => {
    const book = { 0: { sugar: { buy: 8, sell: 7, time: 0 } }, 1: { sugar: { buy: 20, sell: 18, time: 0 } } };
    expect(knownRoutes(book, ['sugar'])).toEqual([{ good: 'sugar', from: { port: 0, price: 8, time: 0 }, to: { port: 1, price: 18, time: 0 }, margin: 10 }]);
  });
});

describe('determinism', () => {
  it('sets up the same markets and jobs from the same seed', () => {
    const a = setup(9);
    const b = setup(9);
    a.economy.arrive(HAVEN);
    b.economy.arrive(HAVEN);
    expect(JSON.stringify(a.economy.states)).toBe(JSON.stringify(b.economy.states));
  });
});
