import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { meshCells } from '../render/voxelGeometry';
import { buildShipModel, type ShipModel } from '../sailing/shipModel';
import { SLOOP } from '../sailing/ships';
import { FLAG_GLOW, srgbToLinear } from '../voxel/palette';
import { parseVox, type VoxFile } from '../vox/parseVox';
import { writeVox } from '../vox/writeVox';
import { HULL_ON_STOCKS_LENGTH } from '../worldgen/town';
import { hullOnStocks, propCatalog, propFromVox } from './catalog';
import { hearth } from './furniture';
import { type Colour, COLOURS } from './kit';
import { clock, lantern, signboard, wallLantern } from './models';
import { PROP_SHAPES } from './shapes';
import { PROP_KINDS, type PropKind, type PropModel } from './types';

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

/** Every port's rugs and runners. */
const RUGS = ['rug', 'runner', 'rugGuild', 'runnerGuild', 'rugSea', 'runnerSea', 'rugBrethren', 'runnerBrethren'] as const;

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

  it('load a .vox prop from its bytes and mesh it as ships are meshed', () => {
    // A little post and its cap, written out as a MagicaVoxel file and read back.
    const rgba = new Uint8Array(256 * 4);
    rgba.set([120, 80, 40, 255], 1 * 4);
    rgba.set([200, 180, 60, 255], 2 * 4);
    const bytes = writeVox([{ name: 'post', size: [1, 1, 3], min: [0, 0, 0], voxels: [[0, 0, 0, 1], [0, 0, 1, 1], [0, 0, 2, 2]] }], rgba);
    const m = propFromVox(parseVox(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer));
    expect(m.cells.length).toBe(12);
    expect(bounds(m).maxY - bounds(m).minY).toBe(2); // MagicaVoxel's z is the game's y: it stands up
    const geometry = meshCells(m.cells, m.palette);
    expect(geometry.getAttribute('position').count).toBeGreaterThan(0);
    expect(geometry.getIndex()!.count).toBeGreaterThan(0);
    // The whole post, three voxels tall.
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.max.y - geometry.boundingBox!.min.y).toBeCloseTo(3);
  });

  /** What furnishes a room or stands in the market hall: under its walls when the roof's lifted. */
  const ROOM_KINDS: readonly PropKind[] = [
    ...['bed', 'table', 'stool', 'chair', 'shelfCrockery', 'shelfBottles', 'shelfBooks', 'chest', 'hearth', 'barrel', 'crate', 'bar', 'barCask', 'desk', 'counterProduce', 'counterCloth'] as const,
    ...['deskGrand', 'strongbox', 'ledgerChest', 'treasureChest', 'mapTable'] as const,
    ...RUGS,
  ];

  it('shape every piece of furniture', () => {
    for (const kind of ROOM_KINDS) expect(PROP_SHAPES[kind], kind).toBeDefined();
  });

  it('keep a room’s furniture to head height, where the walls are cut, so none of it pokes up when the roof lifts', () => {
    for (const kind of ROOM_KINDS) expect(PROP_SHAPES[kind]!.h, kind).toBeLessThanOrEqual(2);
  });

  it('light only the hearth’s fire and the desks’ candles after dark, of all that’s drawn finer', () => {
    const catalog = propCatalog(loadSloop());
    const glows = (kind: PropKind) => {
      const m = catalog[kind];
      for (let i = 3; i < m.cells.length; i += 4) if (m.palette.flags![m.cells[i]] & FLAG_GLOW) return true;
      return false;
    };
    expect((Object.keys(PROP_SHAPES) as PropKind[]).filter(glows).sort()).toEqual(['desk', 'deskGrand', 'hearth']);
  });

  /** The top voxel of each column of a model, as seen from straight above: its colour index. */
  function fromAbove(m: PropModel): number[] {
    const top = new Map<string, { y: number; c: number }>();
    for (let i = 0; i < m.cells.length; i += 4) {
      const k = `${m.cells[i]},${m.cells[i + 2]}`;
      const seen = top.get(k);
      if (!seen || m.cells[i + 1] > seen.y) top.set(k, { y: m.cells[i + 1], c: m.cells[i + 3] });
    }
    return [...top.values()].map((t) => t.c);
  }
  /** Is a model's colour index painted in one of these? */
  const paintedIn = (m: PropModel, c: number, names: readonly Colour[]) =>
    names.some((name) => [16, 8, 0].every((shift, i) => Math.abs(m.palette.colors[c * 3 + i] - srgbToLinear(((COLOURS[name] >> shift) & 0xff) / 255)) < 1e-6));

  it('draw the hearth to read from above, not as a block of stone: its fire open to the sky, and under half its top stone', () => {
    const m = hearth();
    const tops = fromAbove(m);
    expect(tops.filter((c) => (m.palette.flags![c] & FLAG_GLOW) !== 0).length, 'fire seen from above').toBeGreaterThanOrEqual(4);
    expect(tops.filter((c) => paintedIn(m, c, ['stone', 'stoneDark', 'soot'])).length, 'stone seen from above').toBeLessThan(tops.length / 2);
  });

  it('lay rugs flat on the floor, a voxel thick, keeping nobody out', () => {
    for (const kind of RUGS) expect(PROP_SHAPES[kind], kind).toMatchObject({ h: 1 / 8, blocks: false });
  });

  it('hang each port’s banner on a wall: flat against it, in its owners’ colours, and below head height', () => {
    const catalog = propCatalog(loadSloop());
    const colours = new Set<string>();
    for (const kind of ['bannerCrown', 'bannerGuild', 'bannerBrethren'] as const) {
      const m = catalog[kind];
      const b = bounds(m);
      expect(b.minZ, kind).toBeGreaterThanOrEqual(m.origin.z); // out from the wall, not into it
      expect(b.maxZ - b.minZ, kind).toBe(0);
      // Hung from the second course: its top under the first-storey wall's top, two blocks up.
      expect(1 + (b.maxY + 1 - m.origin.y) * m.scale, kind).toBeLessThanOrEqual(2);
      const own = new Set<string>();
      for (let i = 3; i < m.cells.length; i += 4) own.add([0, 1, 2].map((j) => m.palette.colors[m.cells[i] * 3 + j].toFixed(3)).join());
      colours.add([...own].sort().join('|'));
    }
    expect(colours.size).toBe(3);
  });
});
