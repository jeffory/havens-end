import type { Faction } from '../combat/vessel';
import type { ShipType } from '../sailing/ships';

/** Trade goods, cheapest first. */
export const GOODS = ['sugar', 'rum', 'tobacco', 'cloth', 'spice', 'muskets'] as const;
export type Good = (typeof GOODS)[number];
export type Cargo = Partial<Record<Good, number>>;

/** The everyday cargoes every market deals in, and merchant holds carry. */
export const STAPLES: readonly Good[] = ['sugar', 'rum', 'tobacco', 'cloth', 'spice'];

export const GOOD_INFO: Record<Good, { label: string; price: number }> = {
  sugar: { label: 'Sugar', price: 12 },
  rum: { label: 'Rum', price: 22 },
  tobacco: { label: 'Tobacco', price: 30 },
  cloth: { label: 'Cloth', price: 38 },
  spice: { label: 'Spice', price: 60 },
  muskets: { label: 'Muskets', price: 75 },
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
