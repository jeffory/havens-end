import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildShipModel, type ShipModel } from '../sailing/shipModel';
import { SLOOP } from '../sailing/ships';
import { parseVox } from '../vox/parseVox';
import { propCatalog } from './catalog';
import { PROP_SHAPES, shapeCells } from './shapes';
import type { PropKind, PropPlacement } from './types';

function loadSloop(): ShipModel {
  const bytes = readFileSync(`public/${SLOOP.model}`);
  return buildShipModel(parseVox(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), SLOOP.draft);
}

describe('prop shapes', () => {
  it('fit every model drawn finer than a block: an eighth a voxel, standing on its foot in its cells, as tall as it says', () => {
    const catalog = propCatalog(loadSloop());
    const kinds = Object.keys(PROP_SHAPES) as PropKind[];
    expect(kinds.length).toBeGreaterThan(0);
    for (const kind of kinds) {
      const shape = PROP_SHAPES[kind]!;
      const m = catalog[kind];
      expect(m.scale, kind).toBe(1 / 8);
      expect(m.origin, kind).toEqual({ x: 4 * shape.w, y: 0, z: 4 * shape.d });
      let [minY, maxY] = [Infinity, -Infinity];
      for (let i = 0; i < m.cells.length; i += 4) {
        const [x, y, z] = [m.cells[i], m.cells[i + 1], m.cells[i + 2]];
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        // What stands on the floor (its lowest block) keeps to its cells; an awning may reach out over them.
        if (y < 8) expect(x >= 0 && x < 8 * shape.w && z >= 0 && z < 8 * shape.d, `${kind} voxel at ${x},${y},${z} in its cells`).toBe(true);
      }
      expect(minY, `${kind} on the floor`).toBe(0);
      expect((maxY + 1) / 8, `${kind} as tall as it says`).toBe(shape.h);
    }
  });

  it('cover the cells round a placed prop, turned with it', () => {
    const shape = { w: 3, d: 2 };
    const box = (cells: Array<{ x: number; z: number }>) => ({
      x0: Math.min(...cells.map((c) => c.x)),
      x1: Math.max(...cells.map((c) => c.x)),
      z0: Math.min(...cells.map((c) => c.z)),
      z1: Math.max(...cells.map((c) => c.z)),
      n: cells.length,
    });
    const at = (x: number, z: number, facing: number): PropPlacement => ({ kind: 'crate', x, y: 4, z, facing, anchor: null });
    // Facing south or north: three across x, two along z.
    for (const facing of [0, 2]) expect(box(shapeCells(at(10.5, 20, facing), shape))).toEqual({ x0: 9, x1: 11, z0: 19, z1: 20, n: 6 });
    // Facing east or west: two along x, three along z.
    for (const facing of [1, 3]) expect(box(shapeCells(at(10, 20.5, facing), shape))).toEqual({ x0: 9, x1: 10, z0: 19, z1: 21, n: 6 });
  });
});
