import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildShipModel, type ShipModel } from '../sailing/shipModel';
import { SLOOP } from '../sailing/ships';
import { FLAG_GLOW } from '../voxel/palette';
import { parseVox, type VoxFile } from '../vox/parseVox';
import { HULL_ON_STOCKS_LENGTH } from '../worldgen/town';
import { hullOnStocks, propCatalog, propFromVox } from './catalog';
import { clock, lantern, signboard, wallLantern } from './models';
import { PROP_KINDS, type PropModel } from './types';

function loadSloop(): ShipModel {
  const bytes = readFileSync(`public/${SLOOP.model}`);
  return buildShipModel(parseVox(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), SLOOP.draft);
}

function bounds(m: PropModel) {
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i < m.cells.length; i += 4) {
    b.minX = Math.min(b.minX, m.cells[i]);
    b.maxX = Math.max(b.maxX, m.cells[i]);
    b.minY = Math.min(b.minY, m.cells[i + 1]);
    b.maxY = Math.max(b.maxY, m.cells[i + 1]);
    b.minZ = Math.min(b.minZ, m.cells[i + 2]);
    b.maxZ = Math.max(b.maxZ, m.cells[i + 2]);
  }
  return b;
}

describe('prop models', () => {
  it('build every kind, each voxel in a colour of its own palette', () => {
    const catalog = propCatalog(loadSloop());
    for (const kind of PROP_KINDS) {
      const model = catalog[kind];
      expect(model.cells.length, kind).toBeGreaterThan(0);
      for (let i = 3; i < model.cells.length; i += 4) expect(model.palette.solid[model.cells[i]], kind).toBe(1);
      expect(model.palette.flags, kind).toBeDefined();
    }
  });

  it('are a quarter of a block a voxel; lanterns an eighth, and the ship a block', () => {
    const catalog = propCatalog(loadSloop());
    expect(catalog.signTavern.scale).toBe(0.25);
    expect(catalog.clock.scale).toBe(0.25);
    expect(catalog.lantern.scale).toBe(0.125);
    expect(catalog.wallLantern.scale).toBe(0.125);
    expect(catalog.hullOnStocks.scale).toBe(1);
  });

  it('light the lantern glass after dark, and nothing else', () => {
    const { cells, palette } = lantern();
    const glowing = new Set<number>();
    for (let i = 3; i < cells.length; i += 4) if (palette.flags![cells[i]] & FLAG_GLOW) glowing.add(cells[i]);
    expect(glowing.size).toBe(1);
    expect([...clock().palette.flags!].some((f) => (f & FLAG_GLOW) !== 0)).toBe(false);
  });

  it('glaze the lanterns all round, with no bars across the glass: after dark, bars made two panes read as eyes', () => {
    for (const m of [lantern(), wallLantern()]) {
      const glass = (i: number) => (m.palette.flags![m.cells[i + 3]] & FLAG_GLOW) !== 0;
      const rows = new Set<number>();
      for (let i = 0; i < m.cells.length; i += 4) if (glass(i)) rows.add(m.cells[i + 1]);
      expect(rows.size).toBe(4);
      // Round the glass rows, nothing but glass: the wall lantern's bracket is above them.
      for (let i = 0; i < m.cells.length; i += 4) if (rows.has(m.cells[i + 1])) expect(glass(i)).toBe(true);
    }
  });

  it('stand a lantern on the middle of its foot', () => {
    const m = lantern();
    const b = bounds(m);
    expect((b.minX + b.maxX + 1) / 2).toBe(m.origin.x);
    expect((b.minZ + b.maxZ + 1) / 2).toBe(m.origin.z);
    expect(b.minY).toBe(m.origin.y);
  });

  it('hang signs and the clock out from the wall, not into it', () => {
    for (const m of [signboard('tavern'), clock()]) expect(bounds(m).minZ).toBeGreaterThanOrEqual(m.origin.z);
  });

  it('set the sloop on the stocks from her stern, on her keel, without sails or flag', () => {
    const sloop = loadSloop();
    const hull = hullOnStocks(sloop);
    expect(hull.reserve).toBe(true);
    expect(hull.cells).toBe(sloop.hull.cells);
    const b = bounds(hull);
    expect(hull.origin.z).toBe(b.minZ);
    expect(hull.origin.y).toBe(b.minY);
    expect(hull.origin.x).toBe((b.minX + b.maxX + 1) / 2);
  });

  it('lay the stocks for the sloop’s own length', () => {
    const hull = hullOnStocks(loadSloop());
    let maxZ = -Infinity;
    for (let i = 2; i < hull.cells.length; i += 4) maxZ = Math.max(maxZ, hull.cells[i]);
    expect(maxZ + 1 - hull.origin.z).toBe(HULL_ON_STOCKS_LENGTH);
  });

  it('make a prop of a MagicaVoxel file, standing on the middle of its foot', () => {
    const file: VoxFile = {
      models: [{ sizeX: 2, sizeY: 2, sizeZ: 3, voxels: Uint8Array.of(0, 0, 0, 5, 1, 1, 2, 5) }],
      instances: [{ name: '', model: 0, rotation: Int8Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1), translation: [0, 0, 0] }],
      palette: new Uint8Array(256 * 4).fill(200),
    };
    const m = propFromVox(file);
    expect(m.cells.length).toBe(8);
    expect(m.scale).toBe(0.25);
    const b = bounds(m);
    expect(m.origin.y).toBe(b.minY);
    expect(m.origin.x).toBe((b.minX + b.maxX + 1) / 2);
  });
});
