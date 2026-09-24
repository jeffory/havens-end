import { WATER_LEVEL } from '../ocean/waves';
import { isSolid } from '../voxel/blocks';
import type { VoxelReader } from '../voxel/raycast';
import { angleOffWind, sailEfficiency } from './pointOfSail';
import type { Wind } from './weather';

/**
 * Ship frame (matches three.js `rotation.y = heading`): local +z is the bow, local +x
 * is PORT. World forward is (sin h, cos h); increasing the heading turns to port.
 */
export interface ShipSpec {
  name: string;
  /** Depth of the hull below the waterline. Water shallower than this runs the ship aground. */
  draft: number;
  /** u/s at full sail on the best point of sail in a strength-1 wind. */
  topSpeed: number;
  /** u/s² of drive under full sail on the best point of sail in a strength-1 wind. */
  acceleration: number;
  /** Turn rate (rad/s) with full rudder and way on. */
  turnRate: number;
  /** Waterline footprint boundary as (x, z) pairs in ship-local space. */
  outline: Float32Array;
}

export interface ShipState {
  x: number;
  z: number;
  heading: number;
  /** Forward speed, u/s. */
  surge: number;
  /** Sideways speed toward port, u/s (leeway). */
  sway: number;
  /** rad/s, positive = turning to port. */
  yawRate: number;
  /** Actual rudder position, -1 (hard to port) .. +1 (hard to starboard). */
  rudder: number;
  /** Canvas actually set, 0 (furled) .. 1 (full). */
  sail: number;
  /** Roll in radians, positive = port side up. Visual only. */
  heel: number;
  /** True while the hull is pressed against the shore or a shoal (and briefly after). */
  grounded: boolean;
  /** Seconds left before `grounded` clears; keeps it steady while the hull bumps the bottom. */
  groundedTimer: number;
  /** Condition of sails and rigging, 0..1. Shot-away canvas gives less drive (chain shot). */
  rig: number;
  /** Fraction of the crew left, 0..1. A short-handed ship works her sails slowly. */
  crewing: number;
}

/** What the helm is asking for; the crew move the rudder and canvas toward it at a finite pace. */
export interface Helm {
  rudder: number;
  sails: number;
}

const RUDDER_RATE = 3; // full travel per second
const SAIL_RATE = 0.4; // furled to full in 2.5 s
const LINEAR_DRAG = 0.1; // lets a drifting ship actually stop
const KEEL = 3; // how hard the keel resists sideways slip
const LEEWAY = 0.4;
const YAW_RESPONSE = 2;
const TURN_SCRUB = 0.25; // turning bleeds speed
const HEEL_WIND = 0.12;
const HEEL_TURN = 0.02;
const HEEL_MAX = 0.3;
/** Fraction of speed kept per tick while grounded: running aground stops you almost at once. */
const GROUNDED_KEEP = 0.5;
const PUSH_OFF_STEPS = [0.05, 0.1, 0.2];
const GROUNDED_MEMORY = 0.5;

export function createShip(x: number, z: number, heading: number): ShipState {
  return { x, z, heading, surge: 0, sway: 0, yawRate: 0, rudder: 0, sail: 0, heel: 0, grounded: false, groundedTimer: 0, rig: 1, crewing: 1 };
}

/** Advances one ship by one fixed step. Deterministic: same inputs, same result. */
export function stepShip(ship: ShipState, spec: ShipSpec, helm: Helm, wind: Wind, world: VoxelReader, dt: number): void {
  ship.rudder = approach(ship.rudder, clamp(helm.rudder, -1, 1), RUDDER_RATE * dt);
  ship.sail = approach(ship.sail, clamp(helm.sails, 0, 1), SAIL_RATE * (0.3 + 0.7 * ship.crewing) * dt);

  const fx = Math.sin(ship.heading);
  const fz = Math.cos(ship.heading);
  const px = fz; // port = (cos h, -sin h)
  const pz = -fx;

  // Drive from the sails, shaped by the point of sail. Quadratic drag is tuned so that
  // full drive settles at exactly topSpeed.
  const push = spec.acceleration * ship.sail * wind.strength * (0.15 + 0.85 * ship.rig);
  const drive = push * sailEfficiency(angleOffWind(fx, fz, wind));
  const quadDrag = (spec.acceleration - LINEAR_DRAG * spec.topSpeed) / spec.topSpeed ** 2;
  const drag = quadDrag * ship.surge * Math.abs(ship.surge) + LINEAR_DRAG * ship.surge + TURN_SCRUB * Math.abs(ship.yawRate) * ship.surge;
  ship.surge += (drive - drag) * dt;

  // The wind also shoves the hull sideways; the keel resists most of it.
  const windToPort = wind.dirX * px + wind.dirZ * pz;
  ship.sway += (LEEWAY * push * windToPort - KEEL * ship.sway) * dt;

  // A rudder needs water flowing past it: full authority from half speed. At rest the
  // crew can still warp her round (boats, sweeps), slowly, so a grounded ship is never stuck.
  const steerage = 0.35 + 0.65 * Math.min(1, Math.abs(ship.surge) / (0.5 * spec.topSpeed));
  const targetYaw = -ship.rudder * spec.turnRate * steerage * (ship.surge < 0 ? -1 : 1);
  ship.yawRate += (targetYaw - ship.yawRate) * (1 - Math.exp(-YAW_RESPONSE * dt));

  // Visual heel: pressed down to leeward by the wind, thrown outward in turns.
  const heelTarget = clamp(-HEEL_WIND * ship.sail * wind.strength * windToPort + HEEL_TURN * ship.yawRate * ship.surge, -HEEL_MAX, HEEL_MAX);
  ship.heel += (heelTarget - ship.heel) * (1 - Math.exp(-2 * dt));

  move(ship, spec, world, dt, fx, fz, px, pz);
}

const centroid = { x: 0, z: 0 };

function move(ship: ShipState, spec: ShipSpec, world: VoxelReader, dt: number, fx: number, fz: number, px: number, pz: number): void {
  const x = ship.x + (fx * ship.surge + px * ship.sway) * dt;
  const z = ship.z + (fz * ship.surge + pz * ship.sway) * dt;
  const heading = ship.heading + ship.yawRate * dt;

  // A hull already stuck (terrain changed under it) may make any move that doesn't dig it in deeper.
  const before = hullContacts(world, spec, ship.x, ship.z, ship.heading);
  const allowed = (contacts: number) => contacts === 0 || (before > 0 && contacts <= before);

  const contacts = hullContacts(world, spec, x, z, heading, centroid);
  if (allowed(contacts)) {
    ship.x = x;
    ship.z = z;
    ship.heading = heading;
    ship.groundedTimer = Math.max(0, ship.groundedTimer - dt);
    ship.grounded = ship.groundedTimer > 0;
    return;
  }

  ship.grounded = true;
  ship.groundedTimer = GROUNDED_MEMORY;
  ship.surge *= GROUNDED_KEEP;
  ship.sway = 0;

  // Glancing blow: slide along the shore on one axis.
  if (allowed(hullContacts(world, spec, x, ship.z, heading))) {
    ship.x = x;
    ship.heading = heading;
    return;
  }
  if (allowed(hullContacts(world, spec, ship.x, z, heading))) {
    ship.z = z;
    ship.heading = heading;
    return;
  }
  // Turning into the shore: push the hull away from where it touches, so the ship can always turn off.
  const awayX = x - centroid.x;
  const awayZ = z - centroid.z;
  const length = Math.hypot(awayX, awayZ) || 1;
  for (const step of PUSH_OFF_STEPS) {
    const ox = ship.x + (awayX / length) * step;
    const oz = ship.z + (awayZ / length) * step;
    if (allowed(hullContacts(world, spec, ox, oz, heading))) {
      ship.x = ox;
      ship.z = oz;
      ship.heading = heading;
      return;
    }
  }
  ship.yawRate = 0;
}

/**
 * How many outline samples of a hull at this pose touch solid voxels between the keel
 * and just above the waterline. Optionally reports where they touch (their centroid).
 */
export function hullContacts(
  world: VoxelReader,
  spec: ShipSpec,
  x: number,
  z: number,
  heading: number,
  centroidOut?: { x: number; z: number },
): number {
  const s = Math.sin(heading);
  const c = Math.cos(heading);
  const yMin = Math.floor(WATER_LEVEL - spec.draft);
  const yMax = Math.floor(WATER_LEVEL + 1);
  const outline = spec.outline;
  let contacts = 0;
  let sumX = 0;
  let sumZ = 0;
  for (let i = 0; i < outline.length; i += 2) {
    const lx = outline[i];
    const lz = outline[i + 1];
    const wx = x + lx * c + lz * s;
    const wz = z - lx * s + lz * c;
    const cx = Math.floor(wx);
    const cz = Math.floor(wz);
    for (let y = yMin; y <= yMax; y++) {
      if (isSolid(world.getVoxel(cx, y, cz))) {
        contacts++;
        sumX += wx;
        sumZ += wz;
        break;
      }
    }
  }
  if (centroidOut && contacts > 0) {
    centroidOut.x = sumX / contacts;
    centroidOut.z = sumZ / contacts;
  }
  return contacts;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const approach = (value: number, target: number, maxDelta: number) =>
  value + clamp(target - value, -maxDelta, maxDelta);
