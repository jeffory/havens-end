import type { ShipClass, Vessel } from '../combat/vessel';
import { BRIG, MERCHANT_BRIG, MERCHANT_SLOOP, SLOOP, type ShipType } from '../sailing/ships';
import type { PortFaction } from './ports';

export type Upgrade = 'copper' | 'hull' | 'hold' | 'guns';
export const UPGRADE_LIST: readonly Upgrade[] = ['copper', 'hull', 'hold', 'guns'];

export const UPGRADES: Record<Upgrade, { label: string; detail: string; cost: number }> = {
  copper: { label: 'Copper sheathing', detail: '+8% speed, and she gathers way faster', cost: 700 },
  hull: { label: 'Reinforced hull', detail: '+25% hull strength', cost: 900 },
  hold: { label: 'Expanded hold', detail: '+33% cargo space', cost: 600 },
  guns: { label: 'Gun drill and new carriages', detail: 'broadsides reload 15% faster', cost: 800 },
};

/** Bigger ships cost more to refit. */
export const upgradeCost = (upgrade: Upgrade, design: ShipType): number =>
  Math.round((UPGRADES[upgrade].cost * (0.6 + (0.4 * design.hull) / 100)) / 10) * 10;

/** A ship class with refits applied. The design (and so the art) stays the same. */
export function withUpgrades(cls: ShipClass, upgrades: readonly Upgrade[]): ShipClass {
  if (upgrades.length === 0) return cls;
  const has = (u: Upgrade) => upgrades.includes(u);
  const type: ShipType = {
    ...cls.design,
    topSpeed: cls.design.topSpeed * (has('copper') ? 1.08 : 1),
    acceleration: cls.design.acceleration * (has('copper') ? 1.12 : 1),
    hull: Math.round(cls.design.hull * (has('hull') ? 1.25 : 1)),
    hold: Math.round(cls.design.hold * (has('hold') ? 4 / 3 : 1)),
    reload: cls.design.reload * (has('guns') ? 0.85 : 1),
  };
  return { ...cls, type, spec: { ...cls.spec, topSpeed: type.topSpeed, acceleration: type.acceleration } };
}

export const SHIP_PRICES: ReadonlyMap<ShipType, number> = new Map([
  [SLOOP, 1200],
  [MERCHANT_SLOOP, 900],
  [MERCHANT_BRIG, 2600],
  [BRIG, 3800],
]);

export const SHIP_LABELS: ReadonlyMap<ShipType, string> = new Map([
  [SLOOP, 'Sloop'],
  [MERCHANT_SLOOP, 'Merchant sloop'],
  [MERCHANT_BRIG, 'Merchant brig'],
  [BRIG, 'Brig'],
]);

/** What each kind of port's yard builds: navy brigs for the Crown and the Brethren, roomy traders in free ports. */
export const SHIPYARDS: Record<PortFaction, readonly ShipType[]> = {
  imperial: [SLOOP, BRIG],
  merchant: [SLOOP, MERCHANT_BRIG],
  pirate: [SLOOP, BRIG],
};

/** What the yard gives for your ship in part-exchange: half her price, less damage, plus some of her refits. */
export function tradeInValue(v: Vessel): number {
  const price = SHIP_PRICES.get(v.cls.design) ?? 0;
  const condition = 0.4 + 0.6 * (v.hull / v.cls.type.hull);
  const refits = v.upgrades.reduce((sum, u) => sum + upgradeCost(u, v.cls.design), 0);
  return Math.round((price * 0.5 * condition + refits * 0.3) / 10) * 10;
}

const HULL_RATE = 3;
const SAIL_RATE = 2;

/** Gold to make good all the hull and all the sail damage. */
export function repairCosts(v: Vessel): { hull: number; sails: number } {
  const type = v.cls.type;
  return { hull: Math.ceil((type.hull - v.hull) * HULL_RATE), sails: Math.ceil((type.sails - v.sails) * SAIL_RATE) };
}
