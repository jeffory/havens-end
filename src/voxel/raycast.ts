import { isSolid, type BlockId } from './blocks';

export interface VoxelReader {
  getVoxel(x: number, y: number, z: number): BlockId;
}

export interface VoxelHit {
  x: number;
  y: number;
  z: number;
  /** Normal of the face the ray entered through (all zero if the ray started inside a solid voxel). */
  nx: number;
  ny: number;
  nz: number;
  /** Distance along the ray, in units of the direction vector's length. */
  distance: number;
}

/**
 * Walks the voxel grid cell by cell along a ray (Amanatides & Woo DDA). Exact and
 * cheap, and it reads the voxel data directly, so it never goes stale when terrain
 * is dug. Used for tool picking now, and for cannonball-vs-terrain later.
 */
export function raycastVoxels(
  world: VoxelReader,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDistance: number,
): VoxelHit | null {
  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  const stepZ = Math.sign(dz);
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = dx > 0 ? (x + 1 - ox) / dx : dx < 0 ? (ox - x) / -dx : Infinity;
  let tMaxY = dy > 0 ? (y + 1 - oy) / dy : dy < 0 ? (oy - y) / -dy : Infinity;
  let tMaxZ = dz > 0 ? (z + 1 - oz) / dz : dz < 0 ? (oz - z) / -dz : Infinity;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let t = 0;

  while (t <= maxDistance) {
    if (isSolid(world.getVoxel(x, y, z))) return { x, y, z, nx, ny, nz, distance: t };

    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
      nx = -stepX; ny = 0; nz = 0;
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
      nx = 0; ny = -stepY; nz = 0;
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      nx = 0; ny = 0; nz = -stepZ;
    }
  }
  return null;
}
