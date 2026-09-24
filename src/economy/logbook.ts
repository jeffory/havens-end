import type { Good } from './goods';

/** What a good cost in a port when the captain last saw (or heard): unit prices to buy and to sell. */
export interface PriceNote {
  buy: number;
  sell: number;
  /** Sea time the note was made. */
  time: number;
}

/**
 * The captain's price book, by port id: filled in on every visit and from tavern
 * rumours. It's how trade routes are found: buy where the book says cheap, sell where
 * it says dear. Notes age, and markets move.
 */
export type Logbook = Record<number, Partial<Record<Good, PriceNote>>>;

export function note(book: Logbook, port: number, good: Good, buy: number, sell: number, time: number): void {
  (book[port] ??= {})[good] = { buy, sell, time };
}

export interface KnownPrice {
  port: number;
  price: number;
  time: number;
}

/** The best price the book knows for selling a good, leaving out one port (usually where you are). */
export function bestSale(book: Logbook, good: Good, except = -1): KnownPrice | null {
  let best: KnownPrice | null = null;
  for (const [port, notes] of Object.entries(book)) {
    const n = notes[good];
    if (!n || Number(port) === except || n.sell <= 0) continue;
    if (!best || n.sell > best.price) best = { port: Number(port), price: n.sell, time: n.time };
  }
  return best;
}

/** The cheapest place the book knows to buy a good. */
export function bestBuy(book: Logbook, good: Good, except = -1): KnownPrice | null {
  let best: KnownPrice | null = null;
  for (const [port, notes] of Object.entries(book)) {
    const n = notes[good];
    if (!n || Number(port) === except || n.buy <= 0) continue;
    if (!best || n.buy < best.price) best = { port: Number(port), price: n.buy, time: n.time };
  }
  return best;
}

export interface Route {
  good: Good;
  from: KnownPrice;
  to: KnownPrice;
  /** Gold per unit, by the book. */
  margin: number;
}

/** The most profitable runs the book knows of, best first. */
export function knownRoutes(book: Logbook, goods: readonly Good[], limit = 3): Route[] {
  const routes: Route[] = [];
  for (const good of goods) {
    const from = bestBuy(book, good);
    if (!from) continue;
    const to = bestSale(book, good, from.port);
    if (to && to.price > from.price) routes.push({ good, from, to, margin: to.price - from.price });
  }
  return routes.sort((a, b) => b.margin - a.margin).slice(0, limit);
}
