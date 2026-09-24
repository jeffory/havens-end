import type { Sea } from './sea';
import { applyDamage, distanceToBody, type Vessel } from './vessel';

/** A powder keg bobbing where it was dropped, waiting for a hull to touch it. */
export interface Barrel {
  id: number;
  x: number;
  z: number;
  /** Seconds until it can go off: long enough for the ship that dropped it to get clear. */
  arm: number;
  age: number;
}

const ARM_TIME = 2;
const LIFETIME = 90;
const COOLDOWN = 6;
const TRIGGER_DISTANCE = 1.6;
const BLAST_RADIUS = 7;
const CHAIN_RADIUS = 5;
const BLAST = { hull: 32, sails: 14, crew: 4 };

/** Drops a barrel off the stern. Returns false if none are left or the last one only just went over. */
export function dropBarrel(sea: Sea, v: Vessel): boolean {
  if (v.barrels <= 0 || v.barrelCooldown > 0 || v.status !== 'afloat') return false;
  const back = v.cls.body.stern - 1.5;
  const x = v.ship.x + Math.sin(v.ship.heading) * back;
  const z = v.ship.z + Math.cos(v.ship.heading) * back;
  sea.barrels.push({ id: sea.nextId++, x, z, arm: ARM_TIME, age: 0 });
  v.barrels--;
  v.barrelCooldown = COOLDOWN;
  sea.emit({ kind: 'barrel', x, z });
  return true;
}

export function stepBarrels(sea: Sea, dt: number): void {
  for (let i = sea.barrels.length - 1; i >= 0; i--) {
    const barrel = sea.barrels[i];
    barrel.age += dt;
    barrel.arm -= dt;
    if (barrel.age > LIFETIME) {
      sea.barrels.splice(i, 1);
      continue;
    }
    if (barrel.arm > 0) continue;
    const touched = sea.vessels.some(
      (v) => v.status !== 'sinking' && v.status !== 'captured' && distanceToBody(v, barrel.x, 0, barrel.z) < TRIGGER_DISTANCE,
    );
    if (touched) {
      explodeBarrel(sea, i);
      i = Math.min(i, sea.barrels.length); // a chain reaction may have removed others
    }
  }
}

/** Blows up the barrel at `index`, hurting every ship in the blast and setting off nearby barrels. */
export function explodeBarrel(sea: Sea, index: number): void {
  const [barrel] = sea.barrels.splice(index, 1);
  if (!barrel) return;
  sea.emit({ kind: 'explosion', x: barrel.x, z: barrel.z });
  for (const v of sea.vessels) {
    const d = distanceToBody(v, barrel.x, 1, barrel.z);
    if (d >= BLAST_RADIUS) continue;
    const f = 1 - d / BLAST_RADIUS;
    const before = v.status;
    applyDamage(v, BLAST.hull * f, BLAST.sails * f, BLAST.crew * f);
    sea.reportStatusChange(v, before);
  }
  for (let j = sea.barrels.length - 1; j >= 0; j--) {
    const other = sea.barrels[j];
    if (j < sea.barrels.length && Math.hypot(other.x - barrel.x, other.z - barrel.z) < CHAIN_RADIUS) explodeBarrel(sea, j);
  }
}
