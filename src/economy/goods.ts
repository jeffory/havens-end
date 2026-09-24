import type { Faction } from '../combat/vessel';
import type { ShipType } from '../sailing/ships';

/** Trade goods. Phase 4 gives them prices in each port; for now they're plunder. */
export const GOODS = ['sugar', 'rum', 'tobacco', 'cloth', 'spice'] as const;
export type Good = (typeof GOODS)[number];
export type Cargo = Partial<Record<Good, number>>;

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

/** What a ship is carrying when she's met: merchants have holds worth taking, warships a paymaster's chest. */
export function plunder(type: ShipType, faction: Faction, random: () => number): { gold: number; cargo: Cargo } {
  if (faction !== 'merchant') return { gold: Math.round(40 + random() * 80 + type.crew * 2), cargo: {} };
  const cargo: Cargo = {};
  let room = Math.round(type.hold * (0.5 + random() * 0.4));
  // Two or three kinds of goods per hold.
  const kinds = 2 + Math.floor(random() * 2);
  for (let k = 0; k < kinds && room > 0; k++) {
    const good = GOODS[Math.floor(random() * GOODS.length)];
    const amount = k === kinds - 1 ? room : Math.round(room * (0.3 + random() * 0.4));
    cargo[good] = (cargo[good] ?? 0) + amount;
    room -= amount;
  }
  return { gold: Math.round(60 + random() * 140), cargo };
}
