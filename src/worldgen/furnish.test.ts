import { describe, expect, it } from 'vitest';
import { PROP_SHAPES, shapeCells } from '../props/shapes';
import type { PropPlacement } from '../props/types';
import { Block } from '../voxel/blocks';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { buildHouse, type Footprint } from './buildings';
import { furnish, plotCells, standProp } from './furnish';

describe('standing a prop', () => {
  it('sets it over its cells, anchored where its top is, and keeps people out of them three high', () => {
    const world = new VoxelWorld();
    world.setVoxel(5, 11, 7, Block.Stone); // what's there already stays
    const decor: PropPlacement[] = [];
    const p = standProp(world, decor, 'barrel', { x0: 5, z0: 7, x1: 5, z1: 7 }, 10, 2);
    expect(decor).toEqual([p]);
    expect(p).toEqual({ kind: 'barrel', x: 5.5, y: 10, z: 7.5, facing: 2, anchor: { x: 5, y: 10, z: 7 } });
    expect([10, 11, 12, 13].map((y) => world.getVoxel(5, y, 7))).toEqual([Block.Blocker, Block.Stone, Block.Blocker, Block.Air]);
  });

  it('refuses cells that aren’t its shape', () => {
    expect(() => standProp(new VoxelWorld(), [], 'crate', { x0: 0, z0: 0, x1: 1, z1: 0 }, 10, 0)).toThrow();
  });

  it('turns a prop that isn’t square with its facing', () => {
    const decor: PropPlacement[] = [];
    // A stall is three across and two deep: facing east, it takes two cells along x and three along z.
    const p = standProp(new VoxelWorld(), decor, 'stallProduceRed', { x0: 0, z0: 0, x1: 1, z1: 2 }, 10, 1);
    expect([p.x, p.z]).toEqual([1, 1.5]);
    expect(p.anchor).toEqual({ x: 0, y: 12, z: 1 });
    expect(() => standProp(new VoxelWorld(), decor, 'stallProduceRed', { x0: 0, z0: 0, x1: 1, z1: 2 }, 10, 0)).toThrow();
  });

  it('gives a plot’s cells as standProp takes them', () => {
    expect(plotCells({ x0: 4, z0: -2, w: 3, d: 2 })).toEqual({ x0: 4, z0: -2, x1: 6, z1: -1 });
  });
});

describe('furnishing a building', () => {
  const GROUND = 10;
  const BASE = GROUND + 1;
  /** A two-storey building seven by six on flat grass, its door toward (towardX, towardZ), its floor boarded. */
  function plot(towardX: number, towardZ: number) {
    const world = new VoxelWorld();
    for (let x = -12; x < 20; x++) for (let z = -12; z < 20; z++) for (let y = 0; y <= GROUND; y++) world.setVoxel(x, y, z, Block.Grass);
    const fp: Footprint = { x0: 0, z0: 0, w: 7, d: 6 };
    const door = buildHouse(world, fp, BASE, { walls: Block.Plaster, roof: Block.Thatch }, towardX, towardZ, 2);
    for (let x = 1; x < 6; x++) for (let z = 1; z < 5; z++) world.setVoxel(x, BASE - 1, z, Block.Planks);
    return { world, fp, door };
  }

  it('sets the room’s pieces inside its walls, keeps people out of them, and leaves the doorway clear, whichever way the door looks', () => {
    for (const [tx, tz] of [[3.5, -10], [3.5, 20], [-10, 2.5], [20, 2.5]]) {
      const { world, fp, door } = plot(tx, tz);
      const decor: PropPlacement[] = [];
      furnish(world, fp, door, 'tavern', decor);
      expect(decor.length, `door toward ${tx},${tz}`).toBeGreaterThan(5);
      for (const p of decor) {
        for (const c of shapeCells(p, PROP_SHAPES[p.kind]!)) {
          expect(c.x > fp.x0 && c.x < fp.x0 + fp.w - 1 && c.z > fp.z0 && c.z < fp.z0 + fp.d - 1, `${p.kind} at ${c.x},${c.z} inside`).toBe(true);
          if (PROP_SHAPES[p.kind]!.blocks) expect(world.getVoxel(c.x, BASE, c.z), `${p.kind} at ${c.x},${c.z} keeps people out`).toBe(Block.Blocker);
        }
      }
      const [ix, iz] = [Math.sign(door.x - door.outX), Math.sign(door.z - door.outZ)];
      for (const k of [1, 2]) expect(world.getVoxel(door.x + ix * k, BASE, door.z + iz * k), `${k} in from the door toward ${tx},${tz}`).toBe(Block.Air);
    }
  });

  it('anchors every piece at the floor, so it stays when the roof lifts, however low the cut', () => {
    const { world, fp, door } = plot(3.5, -10);
    for (const role of ['house', 'tavern', 'office', 'market'] as const) {
      const decor: PropPlacement[] = [];
      furnish(world, fp, door, role, decor);
      // The lifter cuts at half a block over the floor at the lowest; a hearth, a shelf, the bar or a counter hung by its top would go.
      for (const p of decor) expect(p.anchor?.y, `${role} ${p.kind}`).toBe(BASE);
    }
  });

  it('stands the keeper behind the bar, against the back wall, facing the door; and none in a house', () => {
    const { world, fp, door } = plot(3.5, -10); // the door in the north wall
    const decor: PropPlacement[] = [];
    const post = furnish(world, fp, door, 'tavern', decor)!;
    expect(post.y).toBe(BASE);
    expect(Math.floor(post.z)).toBe(fp.z0 + fp.d - 2); // the back row, against the south wall
    expect(world.getVoxel(Math.floor(post.x), BASE, Math.floor(post.z))).toBe(Block.Air);
    expect(Math.cos(post.facing)).toBeCloseTo(-1); // looking north, to the door
    const before = decor.find((d) => Math.floor(d.x) === Math.floor(post.x) && Math.floor(d.z) === Math.floor(post.z) - 1);
    expect(['bar', 'barCask']).toContain(before?.kind);
    expect(furnish(world, fp, door, 'house', [])).toBeNull();
  });
});
