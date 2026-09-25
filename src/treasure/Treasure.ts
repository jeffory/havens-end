import type { Sea } from '../combat/sea';
import type { Faction } from '../combat/vessel';
import { isNight } from '../core/clock';
import type { Captain } from '../economy/captain';
import type { Notice, Outcome } from '../economy/economy';
import { type Cargo, GOOD_INFO, type Good, STAPLES } from '../economy/goods';
import type { Port } from '../economy/ports';
import type { Land } from '../land/Land';
import { Block } from '../voxel/blocks';
import type { VoxelWorld } from '../voxel/VoxelWorld';
import { type IslandPlan, islandName } from '../worldgen/archipelago';
import { mulberry32 } from '../worldgen/noise';
import { RELIC_LIST, RELICS, type RelicId } from './relics';
import { clueFor, planSite, raiseLandmark, type Site } from './sites';

/** How hard a map is to follow, from how far out its islet lies (or what haunts it). */
export type Tier = 'near' | 'mid' | 'far' | 'cursed' | 'legend';
/** How a map shows the way: a coastline with an X, a coastline and directions, or words alone. */
export type MapStyle = 'chart' | 'sketch' | 'riddle';
export const MAP_STYLES: Record<Tier, MapStyle> = { near: 'chart', mid: 'sketch', far: 'riddle', cursed: 'riddle', legend: 'riddle' };

/** What's in a chest: rolled when the map is made, found out when it's dug up. */
export interface Loot {
  gold: number;
  goods: Cargo;
  /** One of the unique finds, if there are any still to find. */
  relic: boolean;
  /** A piece of Blackwood's chart (the cursed hoards each hold one). */
  piece: boolean;
  /** The letter in Blackwood's hoard. */
  letter?: boolean;
}

export interface TreasureMap {
  id: number;
  tier: Tier;
  site: Site;
  /** Where it came from: "Bought from Old Marta in Haven". */
  from: string;
  clue: string;
  loot: Loot;
}

export interface Offer {
  map: TreasureMap;
  price: number;
}

export type TreasureEvent =
  /** A cursed hoard struck at night: its guardian rises. */
  | { kind: 'guardian'; map: number; x: number; y: number; z: number }
  | { kind: 'found'; map: number; x: number; y: number; z: number; gold: number };

export interface TreasureSnapshot {
  offers: Array<{ port: number; day: number; offers: Offer[] }>;
  taken: number[];
  heard: Array<{ port: number; day: number }>;
  nextId: number;
}

/** How many maps the captain's case holds. */
export const MAP_CASE = 8;
/** Blackwood's chart is torn in this many pieces, one in each cursed hoard. */
export const PIECES = 3;
/** Distances from Haven that mark home waters and the contested seas. */
const NEAR = 700;
const MID = 1500;
/** The shovel finds a chest this close to the X (a block either way), and loose earth this close. */
const FIND_RANGE = 1;
const LOOSE_RANGE = 3;
const OFFERS_PER_NIGHT = 2;
const PRICES: Record<Tier, [number, number]> = { near: [80, 120], mid: [180, 260], far: [320, 450], cursed: [550, 700], legend: [0, 0] };
const GOLD: Record<Tier, [number, number]> = { near: [80, 200], mid: [200, 450], far: [450, 800], cursed: [600, 1000], legend: [3000, 3000] };
const GOODS: Record<Tier, [number, number]> = { near: [3, 6], mid: [6, 10], far: [10, 16], cursed: [12, 18], legend: [20, 20] };
const RELIC_CHANCE: Record<Tier, number> = { near: 0.1, mid: 0.3, far: 0.6, cursed: 1, legend: 1 };
/** Chance a prize's papers include a map, by her flag. */
const PRIZE_CHANCE: Record<Faction, number> = { pirate: 0.4, merchant: 0.25, imperial: 0.15, player: 0 };
/** Chance a round in the tavern turns up a treasure rumour (by day, and after dark). */
const RUMOUR_CHANCE = { day: 0.3, night: 0.45 };
/** A guardian that wins takes this share of your gold. */
export const GUARDIAN_TOLL = 0.1;
/** Goods come out of a chest in piles this big. */
const PILE = 5;

const TELLERS = ['A one-eyed sailor', 'An old hand at the bar', 'A drunk bosun', 'A pedlar in the corner', 'A deckhand with a scar'];

/**
 * Buried treasure: the maps on offer and in the captain's case, the chests they lead to,
 * and digging them up. Pure simulation beside the `Economy` and the `Land`: it writes
 * landmarks into the world, puts goods on the ground through the land, and reports
 * what happened as notices and events.
 */
export class Treasure {
  private readonly offers = new Map<number, { day: number; offers: Offer[] }>();
  /** Islands whose hoard is taken for good (the cursed ones, and Blackwood's). */
  private readonly taken = new Set<number>();
  /** The day a rumour map was last heard in each port (one a day). */
  private readonly heard = new Map<number, number>();
  private nextId = 1;
  private notices: Notice[] = [];
  private events: TreasureEvent[] = [];
  private readonly random: () => number;
  /** Where Blackwood buried his hoard: the islet farthest from Haven that isn't cursed. */
  readonly legendIsland: number;

  constructor(
    private readonly world: VoxelWorld,
    private readonly sea: Sea,
    private readonly land: Land,
    readonly islands: readonly IslandPlan[],
    /** Each port's fixer, by port id: who a map was bought from. */
    private readonly fixers: readonly string[],
    seed: number,
  ) {
    this.random = mulberry32(seed ^ 0x7ea5);
    const plain = islands.map((plan, i) => ({ plan, i })).filter(({ plan }) => !plan.port && !plan.cursed);
    this.legendIsland = plain.reduce((far, o) => (Math.hypot(o.plan.centerX, o.plan.centerZ) > Math.hypot(far.plan.centerX, far.plan.centerZ) ? o : far), plain[0]).i;
    land.buried = this;
  }

  get captain(): Captain {
    return this.sea.captain;
  }

  takeNotices(): Notice[] {
    const n = this.notices;
    this.notices = [];
    return n;
  }

  takeEvents(): TreasureEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  snapshot(): TreasureSnapshot {
    return {
      offers: [...this.offers].map(([port, o]) => ({ port, day: o.day, offers: structuredClone(o.offers) })),
      taken: [...this.taken],
      heard: [...this.heard].map(([port, day]) => ({ port, day })),
      nextId: this.nextId,
    };
  }

  restore(s: TreasureSnapshot): void {
    this.offers.clear();
    for (const o of s.offers) this.offers.set(o.port, { day: o.day, offers: structuredClone(o.offers) });
    this.taken.clear();
    for (const i of s.taken) this.taken.add(i);
    this.heard.clear();
    for (const h of s.heard) this.heard.set(h.port, h.day);
    this.nextId = s.nextId;
  }

  /** How far out an islet is, as a map's difficulty. */
  tierOf(island: number): Tier {
    const plan = this.islands[island];
    if (plan.cursed) return 'cursed';
    const d = Math.hypot(plan.centerX, plan.centerZ);
    return d < NEAR ? 'near' : d < MID ? 'mid' : 'far';
  }

  // ---- Where maps come from ----

  /** The fixer's maps for sale tonight (none by day). A fresh pair each night. */
  offersFor(port: Port): Offer[] {
    if (!isNight(this.sea.clock.phase)) return [];
    // Night falls late in the day, so each night has its day's number.
    const day = this.sea.clock.day;
    const held = this.offers.get(port.id);
    if (held?.day === day) return held.offers;
    const offers: Offer[] = [];
    for (let i = 0; i < OFFERS_PER_NIGHT; i++) {
      // Pirate havens always have a line on the cursed isles; elsewhere, now and then.
      const cursed = i === 0 && (port.faction === 'pirate' || this.random() < 0.25);
      const map = this.makeMap(cursed ? ['cursed'] : ['near', 'mid', 'far'], `Bought from ${this.fixers[port.id] ?? 'the fixer'} in ${port.name}`, offers.map((o) => o.map));
      if (!map) continue;
      const [lo, hi] = PRICES[map.tier];
      offers.push({ map, price: Math.round((lo + this.random() * (hi - lo)) / 10) * 10 });
    }
    this.offers.set(port.id, { day, offers });
    return offers;
  }

  /** Buys one of the fixer's maps. */
  buy(port: Port, id: number): Outcome {
    if (!isNight(this.sea.clock.phase)) return fail('The fixer only does business after dark.');
    const offers = this.offersFor(port);
    const offer = offers.find((o) => o.map.id === id);
    if (!offer) return fail('That map has gone.');
    if (this.captain.maps.length >= MAP_CASE) return fail(`Your map case is full: it holds ${MAP_CASE}.`);
    if (this.captain.gold < offer.price) return fail(`The map is ${offer.price} gold, and the fixer doesn't haggle.`);
    this.captain.gold -= offer.price;
    offers.splice(offers.indexOf(offer), 1);
    this.keep(offer.map);
    return done(`The map is yours: ${islandName(this.islands[offer.map.site.island])}. Study it on the chart (M, then Maps).`);
  }

  /** A prize taken: sometimes there's a map among her papers. */
  prize(faction: Faction, ship: string): void {
    if (this.random() >= PRIZE_CHANCE[faction] || this.captain.maps.length >= MAP_CASE) return;
    const map = this.makeMap(this.random() < 0.6 ? ['near'] : ['mid'], `Found aboard the ${ship}`);
    if (!map) return;
    this.keep(map);
    this.notices.push({ text: `Among the ${ship}'s papers: a treasure map to ${islandName(this.islands[map.site.island])}! (M, then Maps.)`, tone: 'good' });
  }

  /** A treasure rumour for a round in the tavern, if one's going (at most one a day in each port). Writes the map into the case. */
  rumour(port: Port): string | null {
    const night = isNight(this.sea.clock.phase);
    const day = this.sea.clock.day;
    if (this.heard.get(port.id) === day || this.captain.maps.length >= MAP_CASE) return null;
    if (this.random() >= (night ? RUMOUR_CHANCE.night : RUMOUR_CHANCE.day)) return null;
    const map = this.makeMap(this.random() < 0.2 ? ['cursed'] : ['mid', 'far'], `Heard in the tavern at ${port.name}`);
    if (!map) return null;
    this.heard.set(port.id, day);
    this.keep(map);
    const teller = TELLERS[Math.floor(this.random() * TELLERS.length)];
    const island = islandName(this.islands[map.site.island]);
    return map.tier === 'cursed'
      ? `${teller} lowers his voice: the dead guard a hoard on ${island}. You write down every word. (M, then Maps.)`
      : `${teller} swears there's gold buried on ${island}, and tells you how to find it. You write it down. (M, then Maps.)`;
  }

  // ---- Digging it up ----

  /**
   * The shovel has just dug out (x, y, z): is there treasure? Returns what to tell the
   * player, if anything. A chest comes up here; a cursed one raises its guardian instead.
   */
  dig(x: number, y: number, z: number): string | null {
    let loose = false;
    for (const map of this.captain.maps) {
      const s = map.site;
      const off = Math.max(Math.abs(x - s.x), Math.abs(z - s.z));
      if (off > LOOSE_RANGE) continue;
      if (off > FIND_RANGE || y > s.y) {
        loose = true;
        continue;
      }
      if (map.tier === 'cursed') {
        if (!isNight(this.sea.clock.phase)) return 'The ground won’t give here. Whatever’s buried keeps to the dark.';
        this.events.push({ kind: 'guardian', map: map.id, x, y, z });
        return 'Your spade strikes wood, and the air turns cold…';
      }
      this.open(map, x, y, z);
      return 'Your spade strikes wood: a chest!';
    }
    return loose ? 'The earth here is loose, as if it has been dug before.' : null;
  }

  /** The guardian of a cursed hoard is beaten: the chest is yours. */
  guardianBeaten(id: number, x: number, y: number, z: number): void {
    const map = this.captain.maps.find((m) => m.id === id);
    if (map) this.open(map, x, y, z);
  }

  /** The guardian won: it takes its toll, and the hoard stays where it is. */
  guardianWon(): number {
    const toll = Math.round(this.captain.gold * GUARDIAN_TOLL);
    this.captain.gold -= toll;
    return toll;
  }

  /** A map by its id. */
  map(id: number): TreasureMap | undefined {
    return this.captain.maps.find((m) => m.id === id);
  }

  /** Which way the lodestone pulls from (x, z): toward the nearest chest the captain has a map for, within `range`. */
  pull(x: number, z: number, range: number): { dx: number; dz: number; distance: number } | null {
    let best: { dx: number; dz: number; distance: number } | null = null;
    for (const map of this.captain.maps) {
      const dx = map.site.x + 0.5 - x;
      const dz = map.site.z + 0.5 - z;
      const distance = Math.hypot(dx, dz);
      if (distance <= range && (!best || distance < best.distance)) best = { dx, dz, distance };
    }
    return best;
  }

  /** Hauls up a chest: gold to the captain, goods onto the ground, and whatever else it holds. */
  private open(map: TreasureMap, x: number, y: number, z: number): void {
    const captain = this.captain;
    captain.maps.splice(captain.maps.indexOf(map), 1);
    this.world.setVoxel(x, y, z, Block.Chest);
    const loot = map.loot;
    captain.gold += loot.gold;
    for (const [good, n] of Object.entries(loot.goods) as Array<[Good, number]>) {
      for (let left = n; left > 0; left -= PILE) this.land.drop(good, x + 0.5, y + 1.2, z + 0.5, Math.min(PILE, left));
    }
    const found: string[] = [`${loot.gold} gold`];
    for (const [good, n] of Object.entries(loot.goods) as Array<[Good, number]>) found.push(`${n} ${GOOD_INFO[good].label.toLowerCase()}`);
    const remaining = RELIC_LIST.filter((r) => !captain.relics.includes(r));
    // Blackwood's hoard holds every find still unfound; any other chest, one of them.
    const relics: RelicId[] = !loot.relic || remaining.length === 0 ? [] : map.tier === 'legend' ? remaining : [remaining[Math.floor(this.random() * remaining.length)]];
    captain.relics.push(...relics);
    this.events.push({ kind: 'found', map: map.id, x, y, z, gold: loot.gold });
    this.notices.push({ text: `The chest holds ${list(found)}!`, tone: 'good' });
    for (const r of relics) this.notices.push({ text: `And wrapped in oilcloth: ${RELICS[r].name}. ${RELICS[r].detail}`, tone: 'good' });
    if (map.tier === 'cursed' || map.tier === 'legend') this.taken.add(map.site.island);
    if (loot.piece) this.addPiece();
    if (loot.letter) {
      captain.letter = true;
      this.notices.push({ text: 'At the bottom, a letter in the Crown’s cipher, sealed with an admiral’s crest. You can’t read it… yet.', tone: 'info' });
    }
  }

  /** A piece of Blackwood's chart; with all of them, they join into the map to his hoard. */
  private addPiece(): void {
    const captain = this.captain;
    captain.pieces += 1;
    if (captain.pieces < PIECES) {
      this.notices.push({ text: `A torn piece of Blackwood's chart! ${captain.pieces} of ${PIECES}.`, tone: 'good' });
      return;
    }
    const map = this.makeMap(['legend'], 'Blackwood’s chart, pieced together');
    if (!map) return;
    captain.maps.push(map);
    raiseLandmark(this.world, map.site.landmark);
    this.notices.push({ text: 'The last piece of Blackwood’s chart fits the other two: it leads to the pirate king’s hoard! (M, then Maps.)', tone: 'good' });
  }

  // ---- Making maps ----

  /** A new map to an islet of one of these tiers that has no chest waiting on it already. Not yet the captain's. */
  private makeMap(tiers: readonly Tier[], from: string, pending: readonly TreasureMap[] = []): TreasureMap | null {
    const busy = this.reserved(pending);
    const candidates = this.islands
      .map((plan, i) => ({ plan, i }))
      .filter(({ plan, i }) => !plan.port && !busy.has(i) && !this.taken.has(i))
      .filter(({ i }) => (tiers.includes('legend') ? i === this.legendIsland : i !== this.legendIsland && tiers.includes(this.tierOf(i))));
    while (candidates.length > 0) {
      const { i } = candidates.splice(Math.floor(this.random() * candidates.length), 1)[0];
      const tier = tiers.includes('legend') ? 'legend' : this.tierOf(i);
      const legs = tier === 'near' || tier === 'mid' ? 1 : 2;
      const site = planSite(this.world, this.islands, i, legs, this.random, (x, z) => this.land.claimed(x, z) || this.land.inTown(x, z));
      if (!site) continue;
      const clueStyle = tier === 'near' ? 'chart' : tier === 'mid' ? 'sketch' : tier === 'far' ? 'riddle' : tier;
      return { id: this.nextId++, tier, site, from, clue: clueFor(site, this.islands, clueStyle), loot: this.rollLoot(tier) };
    }
    return null;
  }

  /** Islands that already have a chest waiting: in the captain's case, or on offer. */
  private reserved(pending: readonly TreasureMap[]): Set<number> {
    const busy = new Set<number>();
    for (const m of [...this.captain.maps, ...pending]) busy.add(m.site.island);
    for (const o of this.offers.values()) for (const offer of o.offers) if (!pending.includes(offer.map)) busy.add(offer.map.site.island);
    return busy;
  }

  private rollLoot(tier: Tier): Loot {
    const between = ([lo, hi]: [number, number]) => Math.round(lo + this.random() * (hi - lo));
    const goods: Cargo = {};
    const kinds: Good[] = tier === 'legend' ? ['spice', 'cloth'] : [STAPLES[Math.floor(this.random() * STAPLES.length)]];
    for (const good of kinds) goods[good] = between(GOODS[tier]);
    return {
      gold: Math.round(between(GOLD[tier]) / 5) * 5,
      goods,
      relic: this.random() < RELIC_CHANCE[tier],
      piece: tier === 'cursed',
      letter: tier === 'legend' || undefined,
    };
  }

  /** Makes a map the captain's, and raises its landmark where it can be found. */
  private keep(map: TreasureMap): void {
    this.captain.maps.push(map);
    raiseLandmark(this.world, map.site.landmark);
  }

}

/** "a, b and c". */
function list(items: readonly string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const done = (message: string): Outcome => ({ ok: true, message });
const fail = (message: string): Outcome => ({ ok: false, message });
