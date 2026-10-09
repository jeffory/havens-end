import { WATER_LEVEL } from '../ocean/waves';
import { Block, blocksWalker } from '../voxel/blocks';
import type { VoxelReader } from '../voxel/raycast';
import { boxBlocked, topIn } from '../voxel/shapes';

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

/** Stairs and slabs are half a block: heights on foot come in steps of this. */
export const HALF_STEP = 0.5;

/** The next half-block height above `y`: the tops of blocks, stairs and slabs all fall on these. */
const nextHalf = (y: number) => Math.floor(y * 2 + EPSILON) / 2 + HALF_STEP;

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
      w.y = settle(world, w.x, y, w.z); // onto the top of what we hit: a block, a slab or a stair
      w.onGround = true;
    }
    w.vy = 0;
  } else {
    w.y = y;
    w.onGround = false;
  }
  // Something appeared around us (a block placed, a wall built): climb out, half a block at a time.
  for (let i = 0; i < 8 && collides(world, w.x, w.y, w.z); i++) w.y = nextHalf(w.y);
}

/** Where the walker comes to rest falling into something at `y`: the lowest half-block height above it that's clear. */
function settle(world: VoxelReader, x: number, y: number, z: number): number {
  let h = nextHalf(y);
  for (let i = 0; i < 4 && collides(world, x, h, z); i++) h += HALF_STEP;
  return h;
}

function moveAxis(w: Walker, world: VoxelReader, dx: number, dz: number, stepUp: number): void {
  if (dx === 0 && dz === 0) return;
  const x = w.x + dx;
  const z = w.z + dz;
  if (!collides(world, x, w.y, z) && !blockerColumn(world, w, x, w.y, z)) {
    if (tooDeep(world, x, w.y, z)) return stop(w, dx);
    w.x = x;
    w.z = z;
    return;
  }
  // A step, or a scramble up a ledge of up to `stepUp`, if there's headroom: tried half a
  // block at a time, so a stair or a slab is climbed as the half-step it is.
  if (w.onGround) {
    for (let up = nextHalf(w.y); up <= w.y + stepUp + EPSILON; up += HALF_STEP) {
      if (collides(world, w.x, up, w.z)) break; // no headroom to climb higher
      if (!collides(world, x, up, z) && !blockerColumn(world, w, x, up, z)) {
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

/** Does the walker's box at these feet overlap anything they can't walk through (a stair or slab by its own boxes)? */
export function collides(world: VoxelReader, x: number, y: number, z: number): boolean {
  return boxBlocked(world, x - HALF_WIDTH + EPSILON, y + EPSILON, z - HALF_WIDTH + EPSILON, x + HALF_WIDTH - EPSILON, y + HEIGHT - EPSILON, z + HALF_WIDTH - EPSILON);
}

/** Top of the ground under a point, looking down from `fromY` (0 if there's none): half a block up on a slab, or on a stair's low step. */
export function groundBelow(world: VoxelReader, x: number, z: number, fromY: number): number {
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  for (let y = Math.floor(fromY); y >= 0; y--) {
    const id = world.getVoxel(cx, y, cz);
    if (blocksWalker(id)) return y + topIn(id, x - cx, z - cz);
  }
  return 0;
}

/**
 * Is the ground right under feet at (x, y, z) a prop's blocker? Nobody stands on one: a
 * stall's post or a cart's bed is no floor, whatever ledge, corner or roof's edge got
 * someone up beside it. Checked across the walker's own width, not just its centre, so
 * resting half on a blocker's edge (a corner, a lamp post right beside one) counts too.
 * For `standable` and pathfinding's `stepTo`: where a cell's ground is, were someone to
 * stand there outright.
 */
export function blockerGround(world: VoxelReader, x: number, y: number, z: number): boolean {
  const cy = Math.floor(y - EPSILON);
  for (let cz = Math.floor(z - HALF_WIDTH + EPSILON); cz <= Math.floor(z + HALF_WIDTH - EPSILON); cz++) {
    for (let cx = Math.floor(x - HALF_WIDTH + EPSILON); cx <= Math.floor(x + HALF_WIDTH - EPSILON); cx++) {
      if (world.getVoxel(cx, cy, cz) === Block.Blocker) return true;
    }
  }
  return false;
}

/** How far below the walker's feet a column's blocker is still walled off: well past any prop. */
const BLOCKER_REACH = 8;

/** The cells the walker's box spans along one axis, centred at `c`. */
const spanOf = (c: number): readonly [number, number] => [Math.floor(c - HALF_WIDTH + EPSILON), Math.floor(c + HALF_WIDTH - EPSILON)];

/**
 * Would the walker's box at (x, y, z) reach into a column whose ground is a prop's blocker:
 * the first thing below the feet that stops a walker, within `BLOCKER_REACH`, being one?
 * Checked across the walker's own width, not just its centre. Moving into such a column is
 * refused in `moveAxis`, exactly as if it met a wall: nobody walks, steps or drops onto a
 * prop — from a roof's edge, a bank behind the square or a corner off a bench alike — they
 * stop at the column's edge, or fall beside it, instead. A floor or a roof over a prop is
 * ground of its own, so the air above it is open. Columns the box at `from` already reaches
 * into don't count, so whoever's over a prop already (loaded from a save made where one
 * now stands) can walk off it.
 */
function blockerColumn(world: VoxelReader, from: { x: number; z: number }, x: number, y: number, z: number): boolean {
  const top = Math.floor(y + EPSILON);
  const [fx0, fx1] = spanOf(from.x);
  const [fz0, fz1] = spanOf(from.z);
  const [x0, x1] = spanOf(x);
  const [z0, z1] = spanOf(z);
  for (let cz = z0; cz <= z1; cz++) {
    for (let cx = x0; cx <= x1; cx++) {
      if (cx >= fx0 && cx <= fx1 && cz >= fz0 && cz <= fz1) continue; // already in it
      for (let cy = top; cy > top - BLOCKER_REACH && cy >= 0; cy--) {
        const id = world.getVoxel(cx, cy, cz);
        if (id === Block.Blocker) return true;
        if (blocksWalker(id)) break; // real ground, or a floor, first
      }
    }
  }
  return false;
}

/** Would stepping here put the walker in water over their depth? */
function tooDeep(world: VoxelReader, x: number, y: number, z: number): boolean {
  return groundBelow(world, x, z, y + 0.5) < WATER_LEVEL - WADE_DEPTH;
}

/** Somewhere a walker could stand in this column: on dry land or in wading-depth water, never on a prop's blocker. */
export function standable(world: VoxelReader, x: number, z: number, fromY = 64): number | null {
  const y = groundBelow(world, x, z, fromY);
  if (y < WATER_LEVEL - WADE_DEPTH || collides(world, x, y, z) || blockerGround(world, x, y, z)) return null;
  return y;
}
