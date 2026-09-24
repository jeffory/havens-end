import { mulberry32 } from '../worldgen/noise';
import { GOOD_INFO, type Good, HARVEST, SEEDS, STAPLES } from './goods';
import type { Port, PortFaction } from './ports';

/** What a port does with a good: grows or makes it (cheap), wants it (dear), or just deals in it. */
export type Role = 'produces' | 'trades' | 'demands';

const ROLES: Record<Role, { price: number; stock: number }> = {
  produces: { price: 0.62, stock: 140 },
  trades: { price: 1, stock: 70 },
  demands: { price: 1.5, stock: 30 },
};
/** Contraband on an Imperial black market: scarce, and priced for the risk. */
const BLACK = { price: 1.9, stock: 24 };

/** One good in one market. Price follows stock: buying drains it and the price climbs; selling floods it. */
export interface Line {
  good: Good;
  role: Role;
  /** Price when stock is at its usual level. */
  base: number;
  /** The stock the port's trade settles at. */
  target: number;
  stock: number;
}

export interface Market {
  /** The open market. */
  lines: Line[];
  /** The tavern's back room: contraband only (Imperial ports). */
  black: Line[];
}

/** How sharply price answers to stock. */
const ELASTICITY = 0.45;
/** The merchant's cut: buying costs this much more than selling fetches. */
export const SPREAD = 0.1;
/** Seconds for a market to recover most of the way from a glut or a run on stock. */
const RECOVERY = 240;

export function unitPrice(line: Line, stock = line.stock): number {
  const scarcity = Math.min(2.4, Math.max(0.5, (line.target / Math.max(stock, 1)) ** ELASTICITY));
  return line.base * scarcity;
}

/** Gold to buy `amount` (each unit dearer than the last as stock runs down). `factor` is the reputation markup. */
export function buyCost(line: Line, amount: number, factor = 1): number {
  let total = 0;
  for (let i = 0; i < amount; i++) total += unitPrice(line, line.stock - i) * (1 + SPREAD / 2) * factor;
  return Math.round(total);
}

/** Gold for selling `amount` (each unit fetching less than the last as the market fills). */
export function sellValue(line: Line, amount: number, factor = 1): number {
  let total = 0;
  for (let i = 0; i < amount; i++) total += (unitPrice(line, line.stock + i) * (1 - SPREAD / 2)) / factor;
  return Math.round(total);
}

/**
 * Sets up every port's market. Each staple is made in two ports and wanted in two
 * others, so every cargo has somewhere to go: those pairings are the trade routes.
 * Muskets come from free ports, are wanted in pirate havens, and fetch the most on
 * Imperial black markets. Every port also sells building materials and seed, and deals
 * in what camps grow and make (`CAMP_GOODS`). Deterministic in `random` and `campSeed`.
 */
export function planMarkets(ports: readonly Port[], random: () => number, campSeed = 0x6c0d): Market[] {
  const goods = shuffle(STAPLES, random);
  const order = shuffle(ports.map((p) => p.id), random);
  const jitter = () => 0.92 + random() * 0.16;
  const line = (good: Good, role: Role, shape = ROLES[role]): Line => {
    const target = Math.round(shape.stock * jitter());
    return { good, role, base: GOOD_INFO[good].price * shape.price * jitter(), target, stock: Math.round(target * (0.8 + random() * 0.4)) };
  };
  const markets = ports.map((port) => {
    const slot = order.indexOf(port.id);
    const roleOf = (good: Good): Role => {
      const k = (goods.indexOf(good) - slot + goods.length * 2) % goods.length;
      return k < 2 ? 'produces' : k < 4 ? 'demands' : 'trades';
    };
    const lines = STAPLES.map((good) => line(good, roleOf(good)));
    const arms = MUSKETS[port.faction];
    if (arms) lines.push(line('muskets', arms));
    lines.push(line('timber', TIMBER[port.faction]), line('stone', STONE[port.faction]));
    // Every chandler sells seed; it's cheapest where the crop grows.
    for (const seed of SEEDS) lines.push(line(seed, roleOf(HARVEST[seed]!) === 'produces' ? 'produces' : 'trades'));
    return { lines, black: port.faction === 'imperial' ? [line('muskets', 'demands', BLACK)] : [] };
  });
  // Camp goods come last, from their own numbers, so the older lines (and saves of them) stay as they were.
  const camp = mulberry32(campSeed);
  for (const [i, port] of ports.entries()) {
    for (const [good, roles] of Object.entries(CAMP_GOODS) as Array<[Good, Record<PortFaction, Role | null>]>) {
      const role = roles[port.faction];
      if (!role) continue;
      const shape = ROLES[role];
      const target = Math.round(shape.stock * (0.92 + camp() * 0.16));
      markets[i].lines.push({ good, role, base: GOOD_INFO[good].price * shape.price * (0.92 + camp() * 0.16), target, stock: Math.round(target * (0.8 + camp() * 0.4)) });
    }
  }
  return markets;
}

/**
 * What camps make, and who deals in it. Pirate havens want arms, rum-makings and
 * provisions; the Crown's yards want planks and its mines sell iron; the free ports
 * grow maize and buy a little of everything. Null: not dealt in there.
 */
const CAMP_GOODS: Partial<Record<Good, Record<PortFaction, Role | null>>> = {
  cutlasses: { merchant: 'trades', pirate: 'demands', imperial: 'trades' },
  planks: { merchant: 'trades', pirate: 'trades', imperial: 'demands' },
  iron: { merchant: 'trades', pirate: 'demands', imperial: 'produces' },
  cane: { merchant: 'trades', pirate: 'trades', imperial: 'trades' },
  leaf: { merchant: 'trades', pirate: null, imperial: 'trades' },
  molasses: { merchant: 'trades', pirate: 'demands', imperial: null },
  ore: { merchant: 'trades', pirate: null, imperial: 'trades' },
  maize: { merchant: 'produces', pirate: 'trades', imperial: 'trades' },
  provisions: { merchant: 'trades', pirate: 'demands', imperial: 'demands' },
};

const MUSKETS: Record<PortFaction, Role | null> = { merchant: 'produces', pirate: 'demands', imperial: null };
/** The haven's forests are cut freely; the Crown's shipyards eat timber and its quarries sell stone. */
const TIMBER: Record<PortFaction, Role> = { merchant: 'trades', pirate: 'produces', imperial: 'demands' };
const STONE: Record<PortFaction, Role> = { merchant: 'trades', pirate: 'trades', imperial: 'produces' };

/** Stock drifts back toward what the port's trade supports; `shock` scales that level (shortages and gluts). */
export function stepMarket(market: Market, dt: number, shock: (good: Good) => number = () => 1): void {
  const k = 1 - Math.exp(-dt / RECOVERY);
  for (const line of market.lines) line.stock += (line.target * shock(line.good) - line.stock) * k;
  for (const line of market.black) line.stock += (line.target - line.stock) * k;
}

export const findLine = (lines: readonly Line[], good: Good): Line | undefined => lines.find((l) => l.good === good);

function shuffle<T>(list: readonly T[], random: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
