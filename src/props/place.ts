import { Matrix4 } from 'three';
import { FACING_DIRS } from '../voxel/blocks';
import type { Point, PropModel, PropPlacement } from './types';

/**
 * Where a point of a model (in its own voxels) lands in the world: less the model's
 * origin, scaled, turned so its +z faces the placement's way (its +x then runs along
 * (dz, −dx)), and moved to the placement.
 */
export function toWorld(p: PropPlacement, m: PropModel, vx: number, vy: number, vz: number): Point {
  const [dx, dz] = FACING_DIRS[p.facing];
  const x = (vx - m.origin.x) * m.scale;
  const y = (vy - m.origin.y) * m.scale;
  const z = (vz - m.origin.z) * m.scale;
  return { x: p.x + x * dz + z * dx, y: p.y + y, z: p.z - x * dx + z * dz };
}

/** The same as a matrix, for drawing: the model's x, y and z axes, then where its origin goes. */
export function placementMatrix(p: PropPlacement, m: PropModel, out = new Matrix4()): Matrix4 {
  const [dx, dz] = FACING_DIRS[p.facing];
  const s = m.scale;
  const { x: ox, y: oy, z: oz } = m.origin;
  return out.set(
    dz * s, 0, dx * s, p.x - (ox * dz + oz * dx) * s,
    0, s, 0, p.y - oy * s,
    -dx * s, 0, dz * s, p.z - (-ox * dx + oz * dz) * s,
    0, 0, 0, 1,
  );
}
