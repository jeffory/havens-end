import { WATER_LEVEL } from '../ocean/waves';
import type { VoxelReader } from '../voxel/raycast';
import { collides, groundBelow, STEP_UP, WADE_DEPTH } from './walker';

/** A point on a path: the middle of a cell, at the height of the ground there. */
export interface PathPoint {
  x: number;
  y: number;
  z: number;
}

/** The furthest drop a walker takes without looking for another way down. */
const MAX_DROP = 4;
/** Cells searched before giving up: a camp is about 64 across. */
const MAX_NODES = 6000;
const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * Where a walker standing at feet height `y` in one column ends up in the next one, by
 * the walker's own rules: walk across at this height and drop to the ground (not too
 * far, nor into deep water), or else scramble up the lowest ledge with room, up to
 * STEP_UP, if there's headroom to climb. Null if they can't get there.
 */
export function stepTo(world: VoxelReader, x: number, y: number, z: number, nx: number, nz: number): number | null {
  if (!collides(world, nx + 0.5, y, nz + 0.5)) {
    const ground = groundBelow(world, nx + 0.5, nz + 0.5, y + 0.5);
    return ground < WATER_LEVEL - WADE_DEPTH || y - ground > MAX_DROP ? null : ground;
  }
  for (let up = y + 1; up <= y + STEP_UP; up++) {
    if (collides(world, x + 0.5, up, z + 0.5)) return null;
    if (!collides(world, nx + 0.5, up, nz + 0.5)) return groundBelow(world, nx + 0.5, nz + 0.5, up + 0.5);
  }
  return null;
}

/**
 * A* over the surface, cell to cell, by the walker's rules. Diagonal steps need both
 * cells beside them to be passable, so paths never clip a corner. Returns the cells to
 * walk through (not including the start), or null if `to` can't be reached. `near`
 * accepts any cell within that distance of the target (to stand beside a tree).
 */
export function findPath(world: VoxelReader, from: PathPoint, to: { x: number; z: number }, near = 0, maxNodes = MAX_NODES): PathPoint[] | null {
  const sx = Math.floor(from.x);
  const sz = Math.floor(from.z);
  const tx = Math.floor(to.x);
  const tz = Math.floor(to.z);
  const key = (x: number, z: number) => (x + 32768) * 65536 + (z + 32768);
  const heuristic = (x: number, z: number) => Math.hypot(x - tx, z - tz);
  const done = (x: number, z: number) => (near > 0 ? Math.hypot(x - tx, z - tz) <= near : x === tx && z === tz);

  interface Node {
    x: number;
    z: number;
    y: number;
    g: number;
    f: number;
    parent: Node | null;
  }
  const start: Node = { x: sx, z: sz, y: Math.round(from.y), g: 0, f: heuristic(sx, sz), parent: null };
  const open = new Heap<Node>();
  open.push(start);
  const best = new Map<number, number>([[key(sx, sz), 0]]);
  const closed = new Set<number>();
  while (open.size > 0 && closed.size < maxNodes) {
    const node = open.pop();
    const k = key(node.x, node.z);
    if (closed.has(k)) continue;
    closed.add(k);
    if (done(node.x, node.z)) return unwind(node);
    for (const [dx, dz, cost] of NEIGHBOURS) {
      const nx = node.x + dx;
      const nz = node.z + dz;
      const nk = key(nx, nz);
      if (closed.has(nk)) continue;
      if (dx !== 0 && dz !== 0) {
        const a = stepTo(world, node.x, node.y, node.z, nx, node.z);
        const b = stepTo(world, node.x, node.y, node.z, node.x, nz);
        if (a === null || b === null || Math.abs(a - node.y) > 1 || Math.abs(b - node.y) > 1) continue;
      }
      const y = stepTo(world, node.x, node.y, node.z, nx, nz);
      if (y === null) continue;
      // Climbing is slower than walking on the level.
      const g = node.g + cost + Math.max(0, y - node.y) * 0.5;
      if (g >= (best.get(nk) ?? Infinity)) continue;
      best.set(nk, g);
      open.push({ x: nx, z: nz, y, g, f: g + heuristic(nx, nz), parent: node });
    }
  }
  return null;

  function unwind(end: Node): PathPoint[] {
    const out: PathPoint[] = [];
    for (let n: Node | null = end; n && n !== start; n = n.parent) out.push({ x: n.x + 0.5, y: n.y, z: n.z + 0.5 });
    return out.reverse();
  }
}

/** A binary min-heap on `f`: the open list. */
class Heap<T extends { f: number }> {
  private readonly items: T[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: T): void {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (a[up].f <= a[i].f) break;
      [a[up], a[i]] = [a[i], a[up]];
      i = up;
    }
  }

  pop(): T {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Walking distance along a path from a point. */
export function pathLength(from: { x: number; z: number }, path: readonly PathPoint[]): number {
  let length = 0;
  let x = from.x;
  let z = from.z;
  for (const p of path) {
    length += Math.hypot(p.x - x, p.z - z);
    x = p.x;
    z = p.z;
  }
  return length;
}
