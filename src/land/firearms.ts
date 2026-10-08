import { raycastVoxels, type VoxelReader } from '../voxel/raycast';

export type Gun = 'pistol' | 'rifle';
export const GUN_LIST: readonly Gun[] = ['pistol', 'rifle'];

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface GunSpec {
  label: string;
  /** What the gunsmith says of it. */
  detail: string;
  /** Gold at the gunsmith's counter, before the house's price for your name. */
  price: number;
  /** Blocks: no hope of a hit beyond this. */
  range: number;
  /** Health a hit takes: a bandit has 4, a boar 3, a goat 2, a crab 1. */
  damage: number;
  /** Seconds to load again after a shot. */
  reload: number;
}

/** The captain's guns: the pistol quick and good close in, the rifle slow and deadly far out. */
export const GUNS: Record<Gun, GunSpec> = {
  pistol: { label: 'Pistol', detail: 'Quick to load and good close in: two shots bring a bandit down.', price: 120, range: 12, damage: 2, reload: 2.5 },
  rifle: { label: 'Rifle', detail: 'Slow to load and clumsy close in, but deadly far out: one shot brings a bandit down.', price: 350, range: 30, damage: 4, reload: 5 },
};

/** The bandits' muskets: poor shots even at 8 blocks, and slow to load. */
export const MUSKET = { range: 24, damage: 2, reload: 7 } as const;

export const isGun = (held: string): held is Gun => (GUN_LIST as readonly string[]).includes(held);

/** The chance a shot at this distance hits. */
export function hitChance(gun: Gun | 'musket', distance: number): number {
  const d = Math.max(0, distance);
  switch (gun) {
    case 'pistol':
      return d > GUNS.pistol.range ? 0 : 0.9 - 0.55 * (d / GUNS.pistol.range);
    case 'rifle': {
      const range = GUNS.rifle.range;
      if (d > range) return 0;
      // A long barrel is slow to bring round on something right in front of you.
      return d < 5 ? 0.45 + 0.08 * d : 0.85 - 0.15 * ((d - 5) / (range - 5));
    }
    case 'musket':
      return d > MUSKET.range ? 0 : 0.5 - 0.3 * (d / MUSKET.range);
  }
}

/** With keys or a pad, a gun aims at the nearest target within this of straight ahead. */
export const AIM_CONE = Math.PI / 5;
/** With the mouse, something this close to the cursor is what it's aimed at. */
const CURSOR_SLACK = 1.5;

/** Something a shot can hit: a creature or a bandit, by its feet. */
export interface Shootable {
  kind: 'creature' | 'bandit';
  id: number;
  x: number;
  y: number;
  z: number;
}

/** Where a shot at it is aimed: a bandit's chest, a beast's flank. */
export function aimPoint(t: Shootable): Point3 {
  return { x: t.x, y: t.y + (t.kind === 'bandit' ? 1.2 : 0.4), z: t.z };
}

/**
 * What a shot is aimed at. With the mouse (`toward`): whatever is at the cursor. With keys
 * or a pad: the nearest target within range and within `AIM_CONE` of the way the shooter faces.
 */
export function pickTarget(from: { x: number; z: number; facing: number }, targets: readonly Shootable[], range: number, toward: { x: number; z: number } | null = null): Shootable | null {
  let best: Shootable | null = null;
  let score = Infinity;
  for (const t of targets) {
    if (toward) {
      const off = Math.hypot(t.x - toward.x, t.z - toward.z);
      if (off <= CURSOR_SLACK && off < score) [best, score] = [t, off];
      continue;
    }
    const dx = t.x - from.x;
    const dz = t.z - from.z;
    const d = Math.hypot(dx, dz);
    if (d > range || d >= score) continue;
    const bearing = Math.atan2(dx, dz) - from.facing;
    if (Math.abs(Math.atan2(Math.sin(bearing), Math.cos(bearing))) > AIM_CONE) continue;
    [best, score] = [t, d];
  }
  return best;
}

export interface ShotResult {
  /** What it hit, if anything. */
  hit: Shootable | null;
  /** Where the shot ended: at what it hit, at cover, in the ground, or spent at the end of its reach. */
  end: Point3;
  /** Stopped by rock, a tree or a wall before it got there. */
  blocked: boolean;
}

/**
 * A shot from `from` at `to` (the target's aim point, or wherever it's fired): an instant
 * line, stopped by the first solid block, and otherwise a hit on the roll if `roll` is
 * under `chance`. A miss flies on to the end of the gun's `range`, or into what it meets.
 */
export function resolveShot(world: VoxelReader, from: Point3, to: Point3, range: number, target: Shootable | null, chance: number, roll: number): ShotResult {
  const length = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) || 1;
  const ux = (to.x - from.x) / length;
  const uy = (to.y - from.y) / length;
  const uz = (to.z - from.z) / length;
  const along = (d: number): Point3 => ({ x: from.x + ux * d, y: from.y + uy * d, z: from.z + uz * d });
  const cover = raycastVoxels(world, from.x, from.y, from.z, ux, uy, uz, target ? Math.min(length, range) : range);
  if (cover) return { hit: null, end: along(cover.distance), blocked: true };
  if (target && length <= range && roll < chance) return { hit: target, end: { ...to }, blocked: false };
  const beyond = raycastVoxels(world, from.x, from.y, from.z, ux, uy, uz, range);
  return { hit: null, end: along(beyond ? beyond.distance : range), blocked: false };
}

/** Can one see (or shoot) from `from` to `to`, with nothing solid between? */
export function clearLine(world: VoxelReader, from: Point3, to: Point3): boolean {
  const length = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  if (length < 0.01) return true;
  return raycastVoxels(world, from.x, from.y, from.z, (to.x - from.x) / length, (to.y - from.y) / length, (to.z - from.z) / length, length) === null;
}
