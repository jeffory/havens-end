import { describe, expect, it } from 'vitest';
import { STRUCTURES } from '../land/structures';
import { ICONS } from '../render/itemIcons';
import { mulberry32 } from '../worldgen/noise';
import { GOOD_INFO, GOODS } from './goods';
import { planMarkets } from './market';
import type { Port, PortFaction } from './ports';

const port = (id: number, faction: PortFaction): Port => ({ id, name: `Port ${id}`, faction, x: id * 500, z: 0, heading: 0, islandX: id * 500, islandZ: 0, pier: { x: id * 500, y: 13, z: 0 }, places: [], lamps: [] });
const PORTS = [port(0, 'merchant'), port(1, 'merchant'), port(2, 'pirate'), port(3, 'imperial'), port(4, 'imperial')];

describe('cartridges and hides', () => {
  it('are goods, last in the list: cartridges about 2 gold, hides about 8', () => {
    expect(GOODS.slice(-2)).toEqual(['cartridges', 'hides']);
    expect(GOOD_INFO.cartridges).toMatchObject({ label: 'Cartridges', price: 2, kind: 'arms' });
    expect(GOOD_INFO.hides).toMatchObject({ label: 'Hides', price: 8, kind: 'produce' });
  });

  it('are sold in every market, hides wanted in the free ports', () => {
    const markets = planMarkets(PORTS, mulberry32(1));
    for (const [i, market] of markets.entries()) expect(market.lines.map((l) => l.good).slice(-2), PORTS[i].name).toEqual(['cartridges', 'hides']);
    expect(markets[0].lines.find((l) => l.good === 'hides')!.role).toBe('demands');
    expect(markets[2].lines.find((l) => l.good === 'cartridges')!.role).toBe('trades');
  });

  it('come after every older line, so saves keep their stock by line', () => {
    const merchant = planMarkets(PORTS, mulberry32(1))[0].lines.map((l) => l.good);
    // Phase 10's ores were the last lines before these two.
    expect(merchant.slice(-5, -2)).toEqual(['copperOre', 'silverOre', 'goldOre']);
  });

  it('are made at the forge: twelve cartridges from one iron, last of its recipes', () => {
    expect(STRUCTURES.forge.recipes!.at(-1)).toMatchObject({ label: 'Cartridges', inputs: { iron: 1 }, outputs: { cartridges: 12 } });
  });

  it('have pictures for when they lie on the ground', () => {
    expect(ICONS.cartridges).toBeDefined();
    expect(ICONS.hides).toBeDefined();
  });
});
