import type { Good } from '../economy/goods';
import { WATER_LEVEL } from '../ocean/waves';
import { blocksWalker } from '../voxel/blocks';
import type { VoxelReader } from '../voxel/raycast';
import type { Land } from './Land';

/**
 * Something lying about to be picked up: timber and saplings from a felled tree, a
 * lump of rock, a spadeful of earth, a crop just cut. It pops out, falls, and waits
 * where it lands until the captain comes near.
 */
export interface Drop {
  id: number;
  good: Good;
  amount: number;
  /** Where its bottom is. */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Where it was at the last step, to draw it between steps. */
  prev: { x: number; y: number; z: number };
  /** Seconds since it fell: it's gone after `DROP_SECONDS`. */
  age: number;
  /** Lying still on the ground (or bobbing in the shallows). */
  still: boolean;
}

/** What's left lying about goes after this long. */
export const DROP_SECONDS = 600;
const GRAVITY = 22;
/** Things fly to the captain from this far away (from the middle of them), and are in the pack from this close. */
export const MAGNET = 2.2;
const PICKUP = 0.6;
const FLY_SPEED = 9;
/** A moment to see what broke off lying there before it's snatched up: once it's landed, or anyway after a while. */
const SETTLED_DELAY = 0.7;
const PICKUP_DELAY = 1.6;
/** Two of the same lying this close together become one pile. */
const MERGE = 0.8;
/** Sliding along the ground, speed falls off this fast (per second). */
const FRICTION = 7;
/** Floating in the sea: just under the surface. */
const FLOAT = WATER_LEVEL - 0.15;
/** Not more than once in this long: "your pack is full". */
const FULL_NOTICE_SECONDS = 30;

const solidAt = (world: VoxelReader, x: number, y: number, z: number) => blocksWalker(world.getVoxel(Math.floor(x), Math.floor(y), Math.floor(z)));

/** Something breaks off at (x, y, z) and pops out a little way. */
export function dropItem(land: Land, good: Good, amount: number, x: number, y: number, z: number, random: () => number): void {
  const angle = random() * Math.PI * 2;
  const speed = 0.8 + random() * 1.8;
  land.drops.push({
    id: land.nextDrop++,
    good,
    amount,
    x,
    y,
    z,
    vx: Math.sin(angle) * speed,
    vy: 3 + random() * 2.5,
    vz: Math.cos(angle) * speed,
    prev: { x, y, z },
    age: 0,
    still: false,
  });
}

/**
 * One step of everything lying about: it falls and settles, flies to the captain when
 * they come near and goes in the pack if there's room, and in time it's gone.
 */
export function stepDrops(land: Land, dt: number): void {
  const w = land.walker;
  const list = land.drops;
  let full = false;
  for (let i = list.length - 1; i >= 0; i--) {
    const d = list[i];
    d.prev.x = d.x;
    d.prev.y = d.y;
    d.prev.z = d.z;
    d.age += dt;
    if (d.age > DROP_SECONDS) {
      list.splice(i, 1);
      continue;
    }
    if (w && d.age > (d.still ? SETTLED_DELAY : PICKUP_DELAY)) {
      const dx = w.x - d.x;
      const dy = w.y + 0.9 - (d.y + 0.2);
      const dz = w.z - d.z;
      const distance = Math.hypot(dx, dy, dz);
      if (distance < MAGNET && land.packRoom() > 0) {
        if (distance < PICKUP) {
          const taken = land.pocket(d.good, d.amount);
          land.emit({ kind: 'pickup', good: d.good, amount: taken });
          d.amount -= taken;
          if (d.amount <= 0) list.splice(i, 1);
          continue;
        }
        // Flying to hand, through anything in the way.
        const step = Math.min(distance, FLY_SPEED * dt);
        d.x += (dx / distance) * step;
        d.y += (dy / distance) * step;
        d.z += (dz / distance) * step;
        d.vx = d.vy = d.vz = 0;
        d.still = false;
        continue;
      }
      if (distance < MAGNET) full = true;
    }
    fall(land, d, dt);
  }
  if (full && land.sea.time - land.fullToldAt > FULL_NOTICE_SECONDS) {
    land.fullToldAt = land.sea.time;
    land.emit({ kind: 'notice', text: 'Your pack is full: what you can’t carry stays on the ground.', tone: 'bad' });
  }
}

/** Falls, slides and comes to rest; floats if it lands in the sea. */
function fall(land: Land, d: Drop, dt: number): void {
  const world = land.world;
  // Buried (earth put down on top of it, or left inside a wall by the captain walking off): up it comes.
  if (solidAt(world, d.x, d.y + 0.05, d.z)) {
    d.y = Math.floor(d.y + 0.05) + 1;
    d.vy = 0;
    d.still = false;
  }
  if (d.still) {
    if (d.y > FLOAT + 0.01 && !solidAt(world, d.x, d.y - 0.05, d.z)) d.still = false; // the ground went
    else return;
  }
  d.vy -= GRAVITY * dt;
  const nx = d.x + d.vx * dt;
  if (solidAt(world, nx, d.y + 0.05, d.z)) d.vx *= -0.3;
  else d.x = nx;
  const nz = d.z + d.vz * dt;
  if (solidAt(world, d.x, d.y + 0.05, nz)) d.vz *= -0.3;
  else d.z = nz;
  let ny = d.y + d.vy * dt;
  if (d.vy > 0 && solidAt(world, d.x, ny + 0.3, d.z)) {
    ny = d.y;
    d.vy = 0;
  }
  let landed = false;
  if (d.vy <= 0 && solidAt(world, d.x, ny, d.z)) {
    ny = Math.floor(ny) + 1;
    landed = true;
  } else if (ny < FLOAT) {
    ny = FLOAT;
    landed = true;
  }
  d.y = ny;
  if (!landed) return;
  d.vy = 0;
  const slow = Math.exp(-FRICTION * dt);
  d.vx *= slow;
  d.vz *= slow;
  if (Math.hypot(d.vx, d.vz) > 0.15) return;
  d.vx = d.vz = 0;
  d.still = true;
  settle(land, d);
}

/** Just come to rest: it joins a pile of the same lying close by. */
function settle(land: Land, d: Drop): void {
  const pile = land.drops.find((o) => o !== d && o.still && o.good === d.good && Math.hypot(o.x - d.x, o.y - d.y, o.z - d.z) < MERGE);
  if (!pile) return;
  pile.amount += d.amount;
  pile.age = Math.min(pile.age, d.age);
  land.drops.splice(land.drops.indexOf(d), 1);
}
