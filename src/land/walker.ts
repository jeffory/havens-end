import { WATER_LEVEL } from '../ocean/waves';
import { blocksWalker } from '../voxel/blocks';
import type { VoxelReader } from '../voxel/raycast';

/**
 * Someone on foot: the captain ashore. Feet at (x, y, z), a box HALF_WIDTH either
 * side and HEIGHT tall. `facing` is heading-style: forward is (sin, cos).
 */
export interface Walker {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  vy: number;
  facing: number;
  onGround: boolean;
  /** Pose at the previous step, for render interpolation. */
  prev: { x: number; y: number; z: number };
}

export const HALF_WIDTH = 0.3;
export const HEIGHT = 1.7;
export const WALK_SPEED = 4.6;
/** How quickly the walker reaches the speed asked for (1/s). */
const RESPONSE = 14;
const GRAVITY = 28;
const MAX_FALL = 30;
/** Water deeper than this over the ground stops you wading further. */
export const WADE_DEPTH = 1;
const TURN_RATE = 14;
/** The highest ledge the walker scrambles up without stopping. */
export const STEP_UP = 2;
const EPSILON = 1e-4;

export function createWalker(x: number, y: number, z: number, facing = 0): Walker {
  return { x, y, z, vx: 0, vz: 0, vy: 0, facing, onGround: false, prev: { x, y, z } };
}

/**
 * One fixed step on foot. `moveX, moveZ` is the wanted direction in world space, of
 * length up to 1 (an analogue stick's tilt). Movement is axis by axis against the
 * voxels, climbing any ledge up to `stepUp` it walks into, and it stops at water too
 * deep to wade. Deterministic: same inputs, same result. Animals pass their own pace
 * and a lower climb.
 */
export function stepWalker(w: Walker, moveX: number, moveZ: number, world: VoxelReader, dt: number, speed = WALK_SPEED, stepUp = STEP_UP): void {
  w.prev.x = w.x;
  w.prev.y = w.y;
  w.prev.z = w.z;
  const length = Math.hypot(moveX, moveZ);
  const scale = length > 1 ? 1 / length : 1;
  const k = 1 - Math.exp(-RESPONSE * dt);
  w.vx += (moveX * scale * speed - w.vx) * k;
  w.vz += (moveZ * scale * speed - w.vz) * k;
  if (length > 0.1) {
    const target = Math.atan2(moveX, moveZ);
    const turn = Math.atan2(Math.sin(target - w.facing), Math.cos(target - w.facing));
    w.facing += turn * Math.min(1, TURN_RATE * dt);
  }

  moveAxis(w, world, w.vx * dt, 0, stepUp);
  moveAxis(w, world, 0, w.vz * dt, stepUp);

  w.vy = Math.max(-MAX_FALL, w.vy - GRAVITY * dt);
  const y = w.y + w.vy * dt;
  if (collides(world, w.x, y, w.z)) {
    if (w.vy < 0) {
      w.y = Math.floor(y) + 1; // onto the top of what we hit
      w.onGround = true;
    }
    w.vy = 0;
  } else {
    w.y = y;
    w.onGround = false;
  }
  // Something appeared around us (a block placed, a wall built): climb out.
  for (let i = 0; i < 4 && collides(world, w.x, w.y, w.z); i++) w.y = Math.floor(w.y) + 1;
}

function moveAxis(w: Walker, world: VoxelReader, dx: number, dz: number, stepUp: number): void {
  if (dx === 0 && dz === 0) return;
  const x = w.x + dx;
  const z = w.z + dz;
  if (!collides(world, x, w.y, z)) {
    if (tooDeep(world, x, w.y, z)) return stop(w, dx);
    w.x = x;
    w.z = z;
    return;
  }
  // A step, or a scramble up a ledge of up to `stepUp` voxels, if there's headroom.
  if (w.onGround) {
    for (let rise = 1; rise <= stepUp; rise++) {
      const up = Math.floor(w.y + EPSILON) + rise;
      if (collides(world, w.x, up, w.z)) break; // no headroom to climb higher
      if (!collides(world, x, up, z)) {
        w.x = x;
        w.z = z;
        w.y = up;
        return;
      }
    }
  }
  stop(w, dx);
}

function stop(w: Walker, dx: number): void {
  if (dx !== 0) w.vx = 0;
  else w.vz = 0;
}

/** Does the walker's box at these feet overlap anything they can't walk through? */
export function collides(world: VoxelReader, x: number, y: number, z: number): boolean {
  const x0 = Math.floor(x - HALF_WIDTH + EPSILON);
  const x1 = Math.floor(x + HALF_WIDTH - EPSILON);
  const z0 = Math.floor(z - HALF_WIDTH + EPSILON);
  const z1 = Math.floor(z + HALF_WIDTH - EPSILON);
  const y0 = Math.floor(y + EPSILON);
  const y1 = Math.floor(y + HEIGHT - EPSILON);
  for (let cy = y0; cy <= y1; cy++) {
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) if (blocksWalker(world.getVoxel(cx, cy, cz))) return true;
    }
  }
  return false;
}

/** Top of the ground under a point, looking down from `fromY` (0 if there's none). */
export function groundBelow(world: VoxelReader, x: number, z: number, fromY: number): number {
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  for (let y = Math.floor(fromY); y >= 0; y--) if (blocksWalker(world.getVoxel(cx, y, cz))) return y + 1;
  return 0;
}

/** Would stepping here put the walker in water over their depth? */
function tooDeep(world: VoxelReader, x: number, y: number, z: number): boolean {
  return groundBelow(world, x, z, y + 0.5) < WATER_LEVEL - WADE_DEPTH;
}

/** Somewhere a walker could stand in this column: on dry land or in wading-depth water. */
export function standable(world: VoxelReader, x: number, z: number, fromY = 64): number | null {
  const y = groundBelow(world, x, z, fromY);
  if (y < WATER_LEVEL - WADE_DEPTH || collides(world, x, y, z)) return null;
  return y;
}
