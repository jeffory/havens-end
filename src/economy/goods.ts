import type { Faction } from '../combat/vessel';
import type { ShipType } from '../sailing/ships';

/** Trade goods, in the order the markets list them. */
export const GOODS = [
  'sugar',
  'rum',
  'tobacco',
  'cloth',
  'spice',
  'muskets',
  'cutlasses',
  'timber',
  'stone',
  'planks',
  'iron',
  'cane',
  'leaf',
  'molasses',
  'ore',
  'maize',
  'fish',
  'meat',
  'provisions',
  'caneCuttings',
  'tobaccoSeed',
  'pepperSeed',
  'earth',
  'sand',
  'sapling',
] as const;
export type Good = (typeof GOODS)[number];
export type Cargo = Partial<Record<Good, number>>;

/** What a good is for: how markets group it and who deals in it. */
export type GoodKind = 'cargo' | 'arms' | 'material' | 'produce' | 'food' | 'seed';

/** The everyday cargoes every market deals in, and merchant holds carry. */
export const STAPLES: readonly Good[] = ['sugar', 'rum', 'tobacco', 'cloth', 'spice'];
/** What you plant. */
export const SEEDS: readonly Good[] = ['caneCuttings', 'tobaccoSeed', 'pepperSeed'];
/** The staple each seed's crop ends up as: seed is cheap where that's made. */
export const HARVEST: Partial<Record<Good, Good>> = { caneCuttings: 'sugar', tobaccoSeed: 'tobacco', pepperSeed: 'spice' };
/** What settlers eat, the most filling first. */
export const FOOD: readonly Good[] = ['provisions', 'fish', 'meat', 'maize'];

export const GOOD_INFO: Record<Good, { label: string; price: number; kind: GoodKind }> = {
  sugar: { label: 'Sugar', price: 12, kind: 'cargo' },
  rum: { label: 'Rum', price: 22, kind: 'cargo' },
  tobacco: { label: 'Tobacco', price: 30, kind: 'cargo' },
  cloth: { label: 'Cloth', price: 38, kind: 'cargo' },
  spice: { label: 'Spice', price: 60, kind: 'cargo' },
  muskets: { label: 'Muskets', price: 75, kind: 'arms' },
  cutlasses: { label: 'Cutlasses', price: 45, kind: 'arms' },
  timber: { label: 'Timber', price: 6, kind: 'material' },
  stone: { label: 'Stone', price: 5, kind: 'material' },
  planks: { label: 'Planks', price: 14, kind: 'material' },
  iron: { label: 'Iron', price: 22, kind: 'material' },
  cane: { label: 'Cane', price: 5, kind: 'produce' },
  leaf: { label: 'Tobacco leaf', price: 9, kind: 'produce' },
  molasses: { label: 'Molasses', price: 8, kind: 'produce' },
  ore: { label: 'Iron ore', price: 6, kind: 'produce' },
  maize: { label: 'Maize', price: 3, kind: 'food' },
  fish: { label: 'Fish', price: 4, kind: 'food' },
  meat: { label: 'Meat', price: 6, kind: 'food' },
  provisions: { label: 'Provisions', price: 10, kind: 'food' },
  caneCuttings: { label: 'Cane cuttings', price: 8, kind: 'seed' },
  tobaccoSeed: { label: 'Tobacco seed', price: 14, kind: 'seed' },
  pepperSeed: { label: 'Pepper seed', price: 24, kind: 'seed' },
  // Dug and felled on your own land: no market deals in them.
  earth: { label: 'Earth', price: 1, kind: 'material' },
  sand: { label: 'Sand', price: 1, kind: 'material' },
  sapling: { label: 'Sapling', price: 2, kind: 'seed' },
};

/**
 * Arms are the Crown's monopoly: muskets trade openly in free ports and pirate havens,
 * but in an Imperial port only the black market will touch them, and customs officers
 * seize any they find.
 */
export const isContraband = (good: Good, portFaction: Faction): boolean => good === 'muskets' && portFaction === 'imperial';

export const cargoCount = (cargo: Cargo): number => Object.values(cargo).reduce((a, b) => a + (b ?? 0), 0);

/** Moves as much of `from` into `to` as fits in `space`; returns what moved. */
export function loadCargo(to: Cargo, from: Cargo, space: number): Cargo {
  const moved: Cargo = {};
  for (const good of GOODS) {
    const take = Math.min(from[good] ?? 0, Math.max(0, space));
    if (take <= 0) continue;
    to[good] = (to[good] ?? 0) + take;
    moved[good] = take;
    space -= take;
  }
  return moved;
}

/** Takes `amount` of a good out of the hold (never below zero); returns how many came out. */
export function unload(cargo: Cargo, good: Good, amount: number): number {
  const take = Math.min(cargo[good] ?? 0, Math.max(0, amount));
  const left = (cargo[good] ?? 0) - take;
  if (left > 0) cargo[good] = left;
  else delete cargo[good];
  return take;
}

/** What a ship is carrying when she's met: merchants have holds worth taking, warships a paymaster's chest. */
export function plunder(type: ShipType, faction: Faction, random: () => number): { gold: number; cargo: Cargo } {
  if (faction !== 'merchant') return { gold: Math.round(40 + random() * 80 + type.crew * 2), cargo: {} };
  const cargo: Cargo = {};
  let room = Math.round(type.hold * (0.5 + random() * 0.4));
  // Two or three kinds of goods per hold.
  const kinds = 2 + Math.floor(random() * 2);
  for (let k = 0; k < kinds && room > 0; k++) {
    const good = STAPLES[Math.floor(random() * STAPLES.length)];
    const amount = k === kinds - 1 ? room : Math.round(room * (0.3 + random() * 0.4));
    cargo[good] = (cargo[good] ?? 0) + amount;
    room -= amount;
  }
  return { gold: Math.round(60 + random() * 140), cargo };
}
