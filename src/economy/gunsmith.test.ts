import { describe, expect, it } from 'vitest';
import { Sea } from '../combat/sea';
import { shipClass } from '../combat/vessel';
import { footprintSamples } from '../sailing/hull';
import { BRIG, MERCHANT_BRIG, MERCHANT_SLOOP, SLOOP } from '../sailing/ships';
import { Weather } from '../sailing/weather';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { Economy, sellsGuns } from './economy';
import type { Port, PortFaction } from './ports';

const CLASSES = new Map(
  [SLOOP, BRIG, MERCHANT_SLOOP, MERCHANT_BRIG].map((type) => {
    const cells: Array<[number, number]> = [];
    for (let x = 0; x < 5; x++) for (let z = 0; z < 15; z++) cells.push([x - 2.5, z - 7.5]);
    return [type, shipClass(type, footprintSamples(cells), 2.5, 16)] as const;
  }),
);
const port = (faction: PortFaction): Port => ({ id: 0, name: 'Port', faction, x: 0, z: 0, heading: 0, islandX: 0, islandZ: 0, pier: { x: 0, y: 13, z: 0 }, places: [], lamps: [] });

function setup(faction: PortFaction) {
  const ports = [port(faction)];
  const sea = new Sea(new VoxelWorld(), new Weather({ cells: [] }), CLASSES, SLOOP, ports, 1, false);
  const economy = new Economy(sea, ports, 1);
  sea.captain.gold = 1000;
  return { sea, economy, port: ports[0] };
}

describe('the gunsmith', () => {
  it('keeps a counter in free ports and the pirate haven, not in the Crown’s', () => {
    expect(sellsGuns(port('merchant'))).toBe(true);
    expect(sellsGuns(port('pirate'))).toBe(true);
    expect(sellsGuns(port('imperial'))).toBe(false);
  });

  it('sells each gun once, at about its price, and the captain keeps it', () => {
    const { sea, economy, port: here } = setup('merchant');
    const price = economy.gunPrice(here, 'pistol');
    expect(price).toBeGreaterThan(90);
    expect(price).toBeLessThan(160);
    expect(economy.buyGun(here, 'pistol').ok).toBe(true);
    expect(sea.captain.guns).toEqual(['pistol']);
    expect(sea.captain.gold).toBe(1000 - price);
    expect(economy.buyGun(here, 'pistol').ok).toBe(false);
    expect(sea.captain.guns).toEqual(['pistol']);
  });

  it('won’t sell what the purse can’t pay for', () => {
    const { sea, economy, port: here } = setup('pirate');
    sea.captain.gold = 100;
    expect(economy.buyGun(here, 'rifle').ok).toBe(false);
    expect(sea.captain.guns).toEqual([]);
    expect(sea.captain.gold).toBe(100);
  });

  it('won’t sell in an Imperial port', () => {
    const { sea, economy, port: here } = setup('imperial');
    expect(economy.buyGun(here, 'pistol').ok).toBe(false);
    expect(sea.captain.guns).toEqual([]);
  });

  it('the guns are kept through a save, and an older save has none', () => {
    const { sea, economy, port: here } = setup('pirate');
    economy.buyGun(here, 'rifle');
    const saved = JSON.parse(JSON.stringify(sea.snapshot()));
    sea.captain.guns = [];
    sea.restore(saved);
    expect(sea.captain.guns).toEqual(['rifle']);
    delete saved.captain.guns;
    sea.restore(saved);
    expect(sea.captain.guns).toEqual([]);
  });
});
