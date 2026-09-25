import { WATER_LEVEL, waterSurfaceY } from '../ocean/waves';
import { raycastVoxels } from '../voxel/raycast';
import { AMMO, type Ammo, ELEVATION, GRAVITY, muzzleSpeed } from './ammo';
import { explodeBarrel } from './barrels';
import type { Sea } from './sea';
import { applyDamage, distanceToBody, gunsManned, reloadTime, type Side, sideVector, type Vessel } from './vessel';

export interface Shot {
  ammo: Ammo;
  /** Vessel that fired it (it can't hit its own ship). */
  owner: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

const BARREL_HIT_RADIUS = 1.3;

/** Seconds a gun takes to fly back inboard when it fires, and to be run out again at the end of loading. */
const RECOIL_SECONDS = 0.12;
const RUN_OUT_SECONDS = 0.6;

/** Where every gun sits along one side, manned or not: muzzles in ship-local space (x port, y above the waterline, z bow). */
export function gunSlots(v: Vessel, side: Side): Array<[number, number, number]> {
  const b = v.cls.body;
  const count = v.cls.type.gunsPerSide;
  const sign = side === 'port' ? 1 : -1;
  const first = b.stern + 2.5;
  const span = b.bow - 3 - first;
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < count; i++) out.push([sign * (b.halfBeam - 0.2), b.deck - 0.7, first + ((i + 0.5) * span) / count]);
  return out;
}

/** Which of a side's `slots` guns `manned` hands work: spread along the side, all of them with a full crew. */
export function mannedSlots(slots: number, manned: number): number[] {
  const n = Math.min(slots, manned);
  return Array.from({ length: n }, (_, i) => Math.floor(((i + 0.5) * slots) / n));
}

/** The muzzles of the guns that are manned along one side. */
export function gunPositions(v: Vessel, side: Side, count = gunsManned(v)): Array<[number, number, number]> {
  const slots = gunSlots(v, side);
  return mannedSlots(slots.length, count).map((i) => slots[i]);
}

/**
 * How far a side's guns are run out (1) or in (0), from the seconds of loading `left`
 * out of `total`: they fly back inboard as they fire, stay in to be loaded, and are
 * hauled out again as the loading finishes.
 */
export function gunsRunOut(left: number, total: number): number {
  if (left <= 0) return 1;
  const since = total - left;
  if (since < RECOIL_SECONDS) return 1 - since / RECOIL_SECONDS;
  return left < RUN_OUT_SECONDS ? 1 - left / RUN_OUT_SECONDS : 0;
}

/**
 * Fires every manned gun on one side, straight out of the side at the fixed elevation,
 * with a little scatter. Returns false if that side isn't loaded or has no gunners.
 */
export function fireBroadside(sea: Sea, v: Vessel, side: Side): boolean {
  if (v.status !== 'afloat' || v.reload[side] > 0) return false;
  const guns = gunPositions(v, side);
  if (guns.length === 0) return false;

  const ammo = AMMO[v.ammo];
  const speed = muzzleSpeed(v.ammo);
  const { ship } = v;
  const s = Math.sin(ship.heading);
  const c = Math.cos(ship.heading);
  const [outX, outZ] = sideVector(ship.heading, side);
  // The ship's own motion carries into the shot.
  const shipVx = s * ship.surge + c * ship.sway;
  const shipVz = c * ship.surge - s * ship.sway;

  for (const [lx, ly, lz] of guns) {
    const x = ship.x + lx * c + lz * s;
    const z = ship.z - lx * s + lz * c;
    const y = WATER_LEVEL + ly;
    for (let p = 0; p < ammo.pellets; p++) {
      const yaw = (sea.random() - 0.5) * 2 * ammo.spread;
      const pitch = ELEVATION + (sea.random() - 0.5) * ammo.spread;
      const v0 = speed * (1 + (sea.random() - 0.5) * 0.06);
      const dirX = outX * Math.cos(yaw) - outZ * Math.sin(yaw);
      const dirZ = outX * Math.sin(yaw) + outZ * Math.cos(yaw);
      sea.shots.push({
        ammo: v.ammo,
        owner: v.id,
        x,
        y,
        z,
        vx: dirX * Math.cos(pitch) * v0 + shipVx,
        vy: Math.sin(pitch) * v0,
        vz: dirZ * Math.cos(pitch) * v0 + shipVz,
      });
    }
    sea.emit({ kind: 'fire', x, y, z, dirX: outX, dirZ: outZ, vessel: v.id });
  }
  v.reload[side] = reloadTime(v);
  return true;
}

/** Flies every shot one step and resolves whatever it hits: a ship, a barrel, the land or the sea. */
export function stepShots(sea: Sea, dt: number): void {
  for (let i = sea.shots.length - 1; i >= 0; i--) {
    const shot = sea.shots[i];
    const x0 = shot.x;
    const y0 = shot.y;
    const z0 = shot.z;
    shot.vy -= GRAVITY * dt;
    shot.x += shot.vx * dt;
    shot.y += shot.vy * dt;
    shot.z += shot.vz * dt;
    if (resolve(sea, shot, x0, y0, z0)) sea.shots.splice(i, 1);
  }
}

function resolve(sea: Sea, shot: Shot, x0: number, y0: number, z0: number): boolean {
  const height = shot.y - WATER_LEVEL;
  for (const v of sea.vessels) {
    if (v.id === shot.owner || v.status === 'sinking' || v.status === 'captured') continue;
    if (Math.abs(v.ship.x - shot.x) > 40 || Math.abs(v.ship.z - shot.z) > 40) continue;
    if (distanceToBody(v, shot.x, height, shot.z) > 0) continue;
    const ammo = AMMO[shot.ammo];
    const roll = () => 0.75 + sea.random() * 0.5;
    const before = v.status;
    applyDamage(v, ammo.hull * roll(), ammo.sails * roll(), ammo.crew * roll());
    sea.emit({ kind: 'hit', x: shot.x, y: shot.y, z: shot.z, ammo: shot.ammo, vessel: v.id });
    sea.provoke(v, shot.owner);
    sea.reportStatusChange(v, before);
    return true;
  }

  for (let b = 0; b < sea.barrels.length; b++) {
    const barrel = sea.barrels[b];
    if (Math.hypot(barrel.x - shot.x, barrel.z - shot.z) < BARREL_HIT_RADIUS && height < 1.5) {
      explodeBarrel(sea, b);
      return true;
    }
  }

  const dx = shot.x - x0;
  const dy = shot.y - y0;
  const dz = shot.z - z0;
  const length = Math.hypot(dx, dy, dz);
  const hit = raycastVoxels(sea.world, x0, y0, z0, dx / length, dy / length, dz / length, length);
  if (hit) {
    sea.emit({ kind: 'thud', x: hit.x + 0.5, y: hit.y + 1, z: hit.z + 0.5 });
    return true;
  }

  if (shot.y < waterSurfaceY(shot.x, shot.z, sea.time)) {
    sea.emit({ kind: 'splash', x: shot.x, z: shot.z, ammo: shot.ammo });
    return true;
  }
  return false;
}
