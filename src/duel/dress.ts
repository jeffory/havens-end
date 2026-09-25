import { hash2 } from '../util/hash';

/** What's worn on the head. */
export type Headwear = 'bare' | 'straw' | 'cap' | 'scarf' | 'bandana' | 'tricorn';
/** What's worn over the shirt: a waistcoat, an apron, a fisherman's smock, or a long coat. */
export type Overwear = 'none' | 'waistcoat' | 'apron' | 'smock' | 'coat';

/** How someone is dressed, head to boots: what `buildSettlerModel` puts on them. */
export interface Dress {
  /** What's on their head, its colour, and the colour of its band or trim. */
  head: { kind: Headwear; colour: number; band: number };
  shirt: number;
  /** A second colour in bands round the shirt: a striped shirt. */
  stripe?: number;
  /** Sleeves torn off short, and the neck torn open. */
  ragged?: boolean;
  /** What's over the shirt, and its colour. */
  over: { kind: Overwear; colour: number };
  trousers: number;
  /** The belt: leather, or a coloured sash knotted at the hip. */
  belt: number;
  sash?: boolean;
  boots: number;
  /** A soldier of the Crown: white belts crossed over the chest, and a musket to hand. */
  soldier?: boolean;
}

/** Who's being dressed: the folk of Haven, a free port, an Imperial port or a pirate haven, or a soldier of the Crown. */
export type DressKind = 'haven' | 'merchant' | 'imperial' | 'pirate' | 'soldier';
export const DRESS_KINDS: readonly DressKind[] = ['haven', 'merchant', 'imperial', 'pirate', 'soldier'];

const STRAW = 0xd8bd72;
const STRAW_BAND = 0x7a2a1a;
const LEATHER_BELT = 0x2a1a0e;
const BOOTS = 0x3a2616;
/** Oilskin: the fisherfolk's yellow, proof against the spray. */
export const OILSKIN = 0xe0b43a;

/** The hired settlers' shirts and trousers (their looks don't change: saves and memories depend on them). */
const SETTLER_SHIRTS = [0xf2ede0, 0x6d8fb3, 0xa6423a, 0x5f7d4a, 0xc9a24a, 0x7b5e8f];
const SETTLER_TROUSERS = [0x6b4a2b, 0x2f3d5c, 0x5a5a52, 0x8a7a5a];

/** A settler as they've always been: a straw hat half the time, a shirt, trousers and boots. */
export function settlerDress(look: number): Dress {
  const pick = (list: readonly number[], salt: number) => list[Math.floor(hash2(look, salt) * list.length)];
  return {
    head: { kind: hash2(look, 5) < 0.5 ? 'straw' : 'bare', colour: STRAW, band: STRAW_BAND },
    shirt: pick(SETTLER_SHIRTS, 3),
    over: { kind: 'none', colour: 0 },
    trousers: pick(SETTLER_TROUSERS, 4),
    belt: LEATHER_BELT,
    boots: BOOTS,
  };
}

/** Options with their weights. */
type Weighted<T> = ReadonlyArray<readonly [T, number]>;

/** How one kind of townsfolk dresses: the chances of each hat and garment, and the colours they come in. */
interface Wardrobe {
  heads: Weighted<Headwear>;
  /** Colours of each kind of headwear worn here (a bare head needs none), and of its band. */
  hats: Partial<Record<Headwear, readonly number[]>>;
  bands?: Partial<Record<Headwear, readonly number[]>>;
  shirts: readonly number[];
  /** Striped and ragged shirts, as shares of all shirts. */
  striped?: { share: number; base: readonly number[]; stripes: readonly number[] };
  ragged?: { share: number; colours: readonly number[] };
  overs: Weighted<Overwear>;
  overColours: Partial<Record<Overwear, readonly number[]>>;
  trousers: readonly number[];
  belts: readonly number[];
  sash?: boolean;
  boots: number;
}

/** Straw hats and aprons in workaday colours: a town of traders. */
const FREE_PORT: Wardrobe = {
  heads: [['straw', 40], ['bare', 25], ['cap', 15], ['scarf', 20]],
  hats: { straw: [STRAW], cap: [0x7a2a1a, 0x5a4a3a, 0x3e5a3a], scarf: [0xe8e0cc, 0xc9a24a, 0xa6423a, 0x6d8fb3] },
  bands: { straw: [STRAW_BAND, 0x2e3f5f, 0x3e5a3a] },
  shirts: [0xe8e0cc, 0xcdbb94, 0x6d8fb3, 0xa6423a, 0x5f7d4a, 0xc9a24a, 0x8a6f8a, 0x9a8a70],
  overs: [['none', 40], ['apron', 35], ['waistcoat', 25]],
  overColours: { apron: [0xd9cfb4, 0x7a5236, 0x5b6b7a], waistcoat: [0x5a3a22, 0x3e5a3a, 0x2a2a2a, 0x6a2a2a, 0x4a4a6a] },
  trousers: SETTLER_TROUSERS,
  belts: [LEATHER_BELT],
  boots: BOOTS,
};

/** Haven's folk fish: oilskin yellow and blue smocks, knitted caps, and straw hats and aprons too. */
const HAVEN: Wardrobe = {
  heads: [['straw', 30], ['bare', 25], ['cap', 25], ['scarf', 20]],
  hats: { straw: [STRAW], cap: [0x2e3f5f, 0x8e2a22, 0x6a6a66, OILSKIN], scarf: [0xe8e0cc, 0x4a6f9a, 0xa6423a] },
  bands: { straw: [STRAW_BAND, 0x2e3f5f] },
  shirts: [0xe8e0cc, 0x4a6f9a, 0x3a5a86, 0x6d8fb3, 0x8a8a80, 0xcdbb94, 0xa6423a],
  overs: [['smock', 35], ['apron', 25], ['waistcoat', 10], ['none', 30]],
  overColours: { smock: [OILSKIN, 0x3f6590], apron: [0xd9cfb4, 0x3a3a34], waistcoat: [0x5a3a22, 0x2e3f5f] },
  trousers: [0x2f3d5c, 0x5a5a52, 0x6b4a2b, 0x3a4a5a],
  belts: [LEATHER_BELT],
  boots: BOOTS,
};

/** The Crown's subjects: plain, sober and dark. */
const IMPERIAL: Wardrobe = {
  heads: [['bare', 35], ['cap', 20], ['scarf', 20], ['tricorn', 15], ['straw', 10]],
  hats: { cap: [0x2a2a2a, 0x3a3a3a, 0x3d2a1c, 0x26324a], scarf: [0xeeeae0, 0xbdb8aa, 0x9a9a92], tricorn: [0x2a2420, 0x3a3a3a], straw: [0xc8bca0] },
  bands: { straw: [0x3a3a3a] },
  shirts: [0xeeeae0, 0xbdb8aa, 0x9a9a92, 0x6a6a66, 0x3a4252, 0xd8d0bc],
  overs: [['waistcoat', 40], ['coat', 15], ['apron', 10], ['none', 35]],
  overColours: { waistcoat: [0x262626, 0x3a3a3a, 0x26324a, 0x3d2a1c], coat: [0x2e2e34, 0x3a3226, 0x2a3040], apron: [0x8a8a82, 0xd8d0bc] },
  trousers: [0x2a2a2a, 0x3a3a3a, 0x5a5a52, 0x2f3d5c],
  belts: [0x1a1a1a],
  boots: 0x1c1c1c,
};

/** The Brethren: bandanas and the odd tricorn, striped or ragged shirts, and a sash for a belt. */
const PIRATE: Wardrobe = {
  heads: [['bandana', 50], ['bare', 25], ['tricorn', 15], ['scarf', 10]],
  hats: { bandana: [0xa62a22, 0x8a1a1a, 0x1c1c1c, 0x2e3f5f, 0x3e4a2a, 0x4a2a4a], tricorn: [0x1c1c1c, 0x2a1e14], scarf: [0x6a5a4a, 0x8e3b1f] },
  bands: { tricorn: [0x1c1c1c, 0xc9a24a] },
  shirts: [0x3a3a3a, 0x6a2a2a, 0x2e3f5f, 0xe8e2d0, 0x5a4a6a],
  striped: { share: 0.3, base: [0xe8e2d0, 0xd8cfb8], stripes: [0xa62a22, 0x2e3f5f, 0x1e1e1e] },
  ragged: { share: 0.35, colours: [0xcfc6ae, 0x8e8a78, 0x7a5e4a, 0x5a6a52, 0xb89a7a] },
  overs: [['none', 70], ['waistcoat', 30]],
  overColours: { waistcoat: [0x1c1c1c, 0x3d2a1c, 0x5a1e1e, 0x2e3a2a] },
  trousers: [0x3a3a3a, 0x5a4a3a, 0x6b4a2b, 0x2f3d5c, 0x8a7a5a],
  belts: [0xa62a22, 0x8a1a2a, 0xc9a24a, 0x3e6a3a, 0x5a2a6a, 0x2e4f8f],
  sash: true,
  boots: 0x2a1c12,
};

const WARDROBES: Record<Exclude<DressKind, 'soldier'>, Wardrobe> = { haven: HAVEN, merchant: FREE_PORT, imperial: IMPERIAL, pirate: PIRATE };

/** This share of the Crown's townsfolk are soldiers about the town. */
const SOLDIERS = 0.2;
const RED_COAT = 0xa8231c;
/** Soldiers' whites: breeches, belts and the lace on their hats. */
const WHITES = 0xe0dccf;

/**
 * How someone in town is dressed, by where they are and their `look` (which also picks
 * their face): the same look always dresses the same.
 */
export function townDress(kind: DressKind, look: number): Dress {
  if (kind === 'soldier' || (kind === 'imperial' && hash2(look, 20) < SOLDIERS)) return soldierDress();
  const w = WARDROBES[kind];
  const r = (salt: number) => hash2(look, salt);
  const pick = <T>(list: readonly T[] | undefined, salt: number, fallback: T): T => (list?.length ? list[Math.floor(r(salt) * list.length)] : fallback);

  const head = choose(w.heads, r(21));
  const dress: Dress = {
    head: { kind: head, colour: pick(w.hats[head], 22, STRAW), band: STRAW_BAND },
    shirt: pick(w.shirts, 23, 0xe8e0cc),
    over: { kind: 'none', colour: 0 },
    trousers: pick(w.trousers, 24, SETTLER_TROUSERS[0]),
    belt: pick(w.belts, 25, LEATHER_BELT),
    boots: w.boots,
  };
  // A band the same as the hat (a cap's turned-up brim a shade darker), unless this wardrobe trims them.
  dress.head.band = pick(w.bands?.[head], 26, head === 'straw' ? STRAW_BAND : head === 'cap' ? darker(dress.head.colour) : dress.head.colour);
  const shirt = r(27);
  if (w.striped && shirt < w.striped.share) {
    dress.shirt = pick(w.striped.base, 28, dress.shirt);
    dress.stripe = pick(w.striped.stripes, 29, dress.shirt);
  } else if (w.ragged && shirt < (w.striped?.share ?? 0) + w.ragged.share) {
    dress.shirt = pick(w.ragged.colours, 28, dress.shirt);
    dress.ragged = true;
  }
  const over = choose(w.overs, r(30));
  if (over !== 'none') dress.over = { kind: over, colour: pick(w.overColours[over], 31, dress.shirt) };
  if (w.sash) dress.sash = true;
  return dress;
}

/** A soldier of the Crown: red coat, white breeches and cross-belts, black gaiters and a black tricorn laced white. */
function soldierDress(): Dress {
  return {
    head: { kind: 'tricorn', colour: 0x1a1a1a, band: WHITES },
    shirt: 0xeeeae0,
    over: { kind: 'coat', colour: RED_COAT },
    trousers: WHITES,
    belt: WHITES,
    boots: 0x1a1a1a,
    soldier: true,
  };
}

/**
 * Would these two pass for each other at a glance: the same on their heads, and the
 * same shirt or the same coat, waistcoat or apron over it?
 */
export function alike(a: Dress, b: Dress): boolean {
  const head = a.head.kind === b.head.kind && (a.head.kind === 'bare' || a.head.colour === b.head.colour);
  const shirt = a.shirt === b.shirt && a.stripe === b.stripe;
  const over = a.over.kind !== 'none' && a.over.kind === b.over.kind && a.over.colour === b.over.colour;
  return head && (shirt || over);
}

/** A colour a shade darker. */
function darker(hex: number): number {
  const channel = (shift: number) => Math.round(((hex >> shift) & 255) * 0.75) << shift;
  return channel(16) | channel(8) | channel(0);
}

/** One of the options, by weight, for `r` in [0, 1). */
function choose<T>(options: Weighted<T>, r: number): T {
  const total = options.reduce((n, [, weight]) => n + weight, 0);
  let left = r * total;
  for (const [option, weight] of options) {
    left -= weight;
    if (left < 0) return option;
  }
  return options[options.length - 1][0];
}
