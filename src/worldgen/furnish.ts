import { PROP_SHAPES, shapeCells } from '../props/shapes';
import type { PropKind, PropPlacement } from '../props/types';
import { Block, FACING_DIRS, isSolid } from '../voxel/blocks';
import type { VoxelWorld } from '../voxel/VoxelWorld';
import type { Door, Footprint } from './buildings';
import { layRoom, type RoomRole, type Toward, type TownDress } from './rooms';

/** A block of grid cells, from (x0, z0) to (x1, z1), both included. */
export interface Cells {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** How high a prop that keeps people out takes its cells: the walker scrambles up two, never three. */
export const KEEP_OUT = 3;

/** A plot's cells, as standProp takes them. */
export const plotCells = (fp: Footprint): Cells => ({ x0: fp.x0, z0: fp.z0, x1: fp.x0 + fp.w - 1, z1: fp.z0 + fp.d - 1 });

/**
 * Stands a prop drawn finer than a block on the floor at `y`, over these cells, its front
 * (+z) looking along `facing` (as FACING_DIRS). Its anchor is the cell its top is in, so it
 * goes when that's lifted away on foot (a stall in the way, say). One that keeps people out
 * takes its cells KEEP_OUT high with the blocker, where there's air. Throws if the cells
 * aren't its shape, turned that way.
 */
export function standProp(world: VoxelWorld, decor: PropPlacement[], kind: PropKind, cells: Cells, y: number, facing: number): PropPlacement {
  const shape = PROP_SHAPES[kind];
  if (!shape) throw new Error(`standProp: ${kind} has no shape`);
  const p: PropPlacement = { kind, x: (cells.x0 + cells.x1 + 1) / 2, y, z: (cells.z0 + cells.z1 + 1) / 2, facing, anchor: null };
  const covered = shapeCells(p, shape);
  const wanted = (cells.x1 - cells.x0 + 1) * (cells.z1 - cells.z0 + 1);
  if (covered.length !== wanted || covered.some(({ x, z }) => x < cells.x0 || x > cells.x1 || z < cells.z0 || z > cells.z1)) {
    throw new Error(`standProp: ${kind} facing ${facing} doesn't fit ${cells.x0},${cells.z0} to ${cells.x1},${cells.z1}`);
  }
  p.anchor = { x: Math.floor((cells.x0 + cells.x1) / 2), y: y + Math.max(0, Math.ceil(shape.h) - 1), z: Math.floor((cells.z0 + cells.z1) / 2) };
  decor.push(p);
  if (shape.blocks) {
    for (const { x, z } of covered) for (let dy = 0; dy < KEEP_OUT; dy++) if (world.getVoxel(x, y + dy, z) === Block.Air) world.setVoxel(x, y + dy, z, Block.Blocker);
  }
  return p;
}

/** Where someone stands, and which way they look: an angle, as a walker's facing. */
export interface Post {
  x: number;
  y: number;
  z: number;
  facing: number;
}

const facingOf = (dx: number, dz: number): number => FACING_DIRS.findIndex(([fx, fz]) => fx === dx && fz === dz);

/** The banner over a seat of power, by the port: the Guild's (at Haven and the free port), the Crown's, the Brethren's. */
const BANNERS: Record<TownDress, PropKind> = { haven: 'bannerGuild', free: 'bannerGuild', crown: 'bannerCrown', brethren: 'bannerBrethren' };

/**
 * Furnishes a building's ground floor with props, seen when its roof lifts, laid out by what
 * it's for, its size and the port's dress (`layRoom`), keeping the doorway and the way in
 * clear. Each piece keeps people out of its cells, and is anchored at the floor: the lifter
 * cuts a room as low as half a block over it (where a line of sight meets a wall at the
 * captain's chest), and a hearth, a shelf, the bar or a counter hung by its top would go with
 * the walls. In an office the port's banner hangs on the back wall over the clerk's head,
 * anchored to that wall's second course, so it goes when that wall is cut low (it faces the
 * camera) and shows when it stands to head height. Returns where the keeper stands: behind
 * the counter against the back wall, looking toward the door's wall (none in a house).
 */
export function furnish(world: VoxelWorld, fp: Footprint, door: Door, role: RoomRole, decor: PropPlacement[], look = 0, dress: TownDress = 'haven'): Post | null {
  const ix = Math.sign(door.x - door.outX);
  const iz = Math.sign(door.z - door.outZ);
  const deep = ix !== 0 ? fp.w - 2 : fp.d - 2;
  const wide = ix !== 0 ? fp.d - 2 : fp.w - 2;
  /** The cell `k` in from the door's wall and `a` across the room. */
  const cell = (a: number, k: number) =>
    ix !== 0
      ? { x: ix > 0 ? fp.x0 + 1 + k : fp.x0 + fp.w - 2 - k, z: fp.z0 + 1 + a }
      : { x: fp.x0 + 1 + a, z: iz > 0 ? fp.z0 + 1 + k : fp.z0 + fp.d - 2 - k };
  const doorA = ix !== 0 ? door.z - (fp.z0 + 1) : door.x - (fp.x0 + 1);
  // Across the room (+a), and the four ways a piece can look, in the world.
  const [ax, az] = ix !== 0 ? [0, 1] : [1, 0];
  const ways: Record<Toward, readonly [number, number]> = { in: [ix, iz], out: [-ix, -iz], right: [ax, az], left: [-ax, -az] };
  const { pieces, keeper } = layRoom({ wide, deep, door: doorA }, role, look, dress);
  for (const p of pieces) {
    const c0 = cell(p.a, p.k);
    const c1 = cell(p.a + p.wa - 1, p.k + p.dk - 1);
    const [dx, dz] = ways[p.toward];
    const placed = standProp(world, decor, p.kind, { x0: Math.min(c0.x, c1.x), z0: Math.min(c0.z, c1.z), x1: Math.max(c0.x, c1.x), z1: Math.max(c0.z, c1.z) }, door.y, facingOf(dx, dz));
    placed.anchor = { ...placed.anchor!, y: door.y };
  }
  if (!keeper) return null;
  const c = cell(keeper.a, keeper.k);
  const wall = cell(keeper.a, deep);
  if (role === 'office' && isSolid(world.getVoxel(wall.x, door.y + 1, wall.z))) {
    const [ox, oz] = ways.out;
    decor.push({ kind: BANNERS[dress], x: wall.x + 0.5 + ox * 0.5, y: door.y + 1, z: wall.z + 0.5 + oz * 0.5, facing: facingOf(ox, oz), anchor: { x: wall.x, y: door.y + 1, z: wall.z } });
  }
  return { x: c.x + 0.5, y: door.y, z: c.z + 0.5, facing: Math.atan2(-ix, -iz) };
}
