import { blocksWalker, type BlockId, shapeOf } from './blocks';
import type { VoxelReader } from './raycast';

/**
 * How high a block's solid part stands at a point in its cell (fx, fz from 0 to 1): a
 * whole cube 1, a slab 0.5, a stair 0.5 on its low step and 1 on its top half (the
 * higher, on the line between them).
 */
export function topIn(id: BlockId, fx: number, fz: number): number {
  const boxes = shapeOf(id);
  if (!boxes) return 1;
  let top = 0;
  for (const b of boxes) if (fx >= b.x0 && fx <= b.x1 && fz >= b.z0 && fz <= b.z1) top = Math.max(top, b.y1);
  return top;
}

/**
 * Does anything someone on foot can't walk through fill part of this box (world units,
 * x0 < x1 and so on)? A whole block blocks its whole cell; a stair or slab only its own boxes.
 */
export function boxBlocked(world: VoxelReader, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
  for (let cy = Math.floor(y0); cy <= Math.floor(y1); cy++) {
    for (let cz = Math.floor(z0); cz <= Math.floor(z1); cz++) {
      for (let cx = Math.floor(x0); cx <= Math.floor(x1); cx++) {
        const id = world.getVoxel(cx, cy, cz);
        if (!blocksWalker(id)) continue;
        const boxes = shapeOf(id);
        if (!boxes) return true;
        for (const b of boxes) {
          if (x0 < cx + b.x1 && x1 > cx + b.x0 && y0 < cy + b.y1 && y1 > cy + b.y0 && z0 < cz + b.z1 && z1 > cz + b.z0) return true;
        }
      }
    }
  }
  return false;
}

/** Is this point inside something that stops someone on foot (for a stair or slab, inside one of its boxes)? */
export function pointBlocked(world: VoxelReader, x: number, y: number, z: number): boolean {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const cz = Math.floor(z);
  const id = world.getVoxel(cx, cy, cz);
  if (!blocksWalker(id)) return false;
  const boxes = shapeOf(id);
  if (!boxes) return true;
  const [fx, fy, fz] = [x - cx, y - cy, z - cz];
  return boxes.some((b) => fx >= b.x0 && fx < b.x1 && fy >= b.y0 && fy < b.y1 && fz >= b.z0 && fz < b.z1);
}
