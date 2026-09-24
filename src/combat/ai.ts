import { huntsPlayer, merchantsWary } from '../economy/reputation';
import { WATER_LEVEL } from '../ocean/waves';
import { angleOffWind } from '../sailing/pointOfSail';
import type { Wind } from '../sailing/weather';
import { wrapAngle } from '../util/math';
import { isSolid } from '../voxel/blocks';
import type { VoxelReader } from '../voxel/raycast';
import { AMMO, type Ammo, landingDistance } from './ammo';
import { dropBarrel } from './barrels';
import { fireBroadside } from './gunnery';
import type { Sea } from './sea';
import { type Side, sideVector, type Vessel } from './vessel';

export type AiMode = 'cruise' | 'escort' | 'flee' | 'engage' | 'struck';

export interface AiState {
  mode: AiMode;
  /** Heading the captain is trying to hold. */
  course: number;
  /** Where a cruising ship is bound. */
  destX: number;
  destZ: number;
  /** Escorts keep station on this vessel, at this offset in its frame (x port, z forward). */
  leader: number | null;
  stationX: number;
  stationZ: number;
  /** Set once the player has attacked this ship or her group: no more peaceful cruising. */
  alerted: boolean;
  thinkIn: number;
}

const THINK_INTERVAL = 0.25;
const MERCHANT_SIGHT = 110;
const WARSHIP_SIGHT = 140;
/** Closest a captain will point to the wind. */
const NO_GO = (50 * Math.PI) / 180;
const FIRING_ARC = (14 * Math.PI) / 180;

export function createAi(destX: number, destZ: number, course: number): AiState {
  return { mode: 'cruise', course, destX, destZ, leader: null, stationX: 0, stationZ: 0, alerted: false, thinkIn: 0 };
}

/** One tick of an AI captain: decide (a few times a second), then steer every tick. */
export function thinkCaptain(sea: Sea, v: Vessel, dt: number): void {
  const ai = v.ai;
  if (!ai) return;
  if (v.status === 'struck') {
    ai.mode = 'struck';
    v.helm.sails = 0;
    v.helm.rudder = 0;
    return;
  }
  ai.thinkIn -= dt;
  if (ai.thinkIn <= 0) {
    ai.thinkIn = THINK_INTERVAL;
    decide(sea, v, ai);
  }
  v.helm.rudder = rudderFor(v, ai.course);
}

function decide(sea: Sea, v: Vessel, ai: AiState): void {
  const player = sea.player;
  const { ship } = v;
  const dx = player.ship.x - ship.x;
  const dz = player.ship.z - ship.z;
  const distance = Math.hypot(dx, dz);
  // Nobody picks a fight with an empty ship at anchor.
  const playerFightable = player.status === 'afloat' && !sea.ashore;
  const leader = ai.leader !== null ? sea.vessel(ai.leader) : undefined;
  const wind = sea.weather.windAt(ship.x, ship.z, sea.time);
  const isMerchant = v.faction === 'merchant';

  // Who comes for the player unprovoked depends on the captain's name among each flag.
  const standing = sea.captain.standing;
  let course = ai.course;
  if (playerFightable && isMerchant && (ai.alerted || (distance < MERCHANT_SIGHT && merchantsWary(standing)))) {
    ai.mode = 'flee';
    course = Math.atan2(-dx, -dz);
    v.helm.sails = 1;
    // A pursuer close astern gets a keg of powder in her path.
    const [bx, bz] = [-Math.sin(ship.heading), -Math.cos(ship.heading)];
    if (distance < 45 && (dx * bx + dz * bz) / distance > Math.cos((50 * Math.PI) / 180)) dropBarrel(sea, v);
  } else if (
    playerFightable &&
    !isMerchant &&
    (ai.alerted || (distance < WARSHIP_SIGHT && huntsPlayer(standing, v.faction)) || (leader?.ai?.alerted ?? false))
  ) {
    ai.mode = 'engage';
    course = engage(sea, v, dx, dz, distance);
    v.helm.sails = 1;
  } else if (leader && leader.status === 'afloat') {
    ai.mode = 'escort';
    const ls = Math.sin(leader.ship.heading);
    const lc = Math.cos(leader.ship.heading);
    const tx = leader.ship.x + ai.stationX * lc + ai.stationZ * ls;
    const tz = leader.ship.z - ai.stationX * ls + ai.stationZ * lc;
    const gap = Math.hypot(tx - ship.x, tz - ship.z);
    course = gap > 4 ? Math.atan2(tx - ship.x, tz - ship.z) : leader.ship.heading;
    v.helm.sails = gap > 12 ? 1 : leader.helm.sails;
  } else {
    ai.mode = 'cruise';
    if (Math.hypot(ai.destX - ship.x, ai.destZ - ship.z) < 30) {
      // Arrived: carry on in the same general direction.
      ai.destX = ship.x + Math.sin(ship.heading) * 600;
      ai.destZ = ship.z + Math.cos(ship.heading) * 600;
    }
    course = Math.atan2(ai.destX - ship.x, ai.destZ - ship.z);
    v.helm.sails = 0.5;
  }

  ai.course = clearCourse(sea.world, v, avoidShips(sea, v, sailable(course, wind)));
}

/**
 * Bears away from any other ship ahead, harder the closer she is. Nearly head-on, both
 * give way to starboard (the rule of the road), so they pass port to port instead of
 * mirroring each other's dodge.
 */
function avoidShips(sea: Sea, v: Vessel, course: number): number {
  const lookahead = v.cls.body.bow + 30;
  let turn = 0;
  for (const other of sea.vessels) {
    if (other === v || other.status === 'captured') continue;
    const dx = other.ship.x - v.ship.x;
    const dz = other.ship.z - v.ship.z;
    const d = Math.hypot(dx, dz);
    const limit = lookahead + (other.cls.body.bow - other.cls.body.stern) * 0.5;
    if (d > limit) continue;
    const bearing = wrapAngle(Math.atan2(dx, dz) - course); // positive: she's to port
    if (Math.abs(bearing) > 1.3) continue;
    const away = Math.abs(bearing) < 0.35 ? -1 : -Math.sign(bearing); // negative turns to starboard
    turn += away * 1.4 * (1 - d / limit);
  }
  return course + Math.max(-1.3, Math.min(1.3, turn));
}

/** Warship tactics: close to range, then turn to bring a loaded broadside to bear, and fire. */
function engage(sea: Sea, v: Vessel, dx: number, dz: number, distance: number): number {
  const { ship } = v;
  const player = sea.player;
  v.ammo = chooseAmmo(v, player, distance);
  const reach = landingDistance(v.ammo, v.cls.body.deck);

  // Fire whatever bears.
  for (const side of ['port', 'starboard'] as Side[]) {
    const [sx, sz] = sideVector(ship.heading, side);
    const offAbeam = Math.acos(Math.min(1, (sx * dx + sz * dz) / distance));
    if (offAbeam < FIRING_ARC && distance < reach * 0.97) fireBroadside(sea, v, side);
  }

  if (distance > reach * 0.9 || v.cls.type.gunsPerSide === 0) {
    // Close in, aiming a little ahead of where the target is going.
    const lead = Math.min(3, distance / 30);
    const px = player.ship.x + Math.sin(player.ship.heading) * player.ship.surge * lead;
    const pz = player.ship.z + Math.cos(player.ship.heading) * player.ship.surge * lead;
    return Math.atan2(px - ship.x, pz - ship.z);
  }

  // Turn beam-on: the course that puts the target abeam to port or starboard,
  // preferring a loaded side, then the one needing the smaller turn.
  const portCourse = Math.atan2(-dz, dx);
  const starboardCourse = Math.atan2(dz, -dx);
  const turn = (course: number) => Math.abs(wrapAngle(course - ship.heading));
  const ready = (side: Side) => (v.reload[side] <= 0 ? 0 : 1);
  const usePort = ready('port') - ready('starboard') || turn(portCourse) - turn(starboardCourse);
  let course = usePort <= 0 ? portCourse : starboardCourse;
  // Hold the fight at about 60% of reach: edge in if too far, open out if too close.
  const preferred = reach * 0.6;
  const toward = Math.atan2(dx, dz);
  const adjust = distance > preferred * 1.2 ? 0.45 : distance < preferred * 0.7 ? -0.45 : 0;
  course += Math.sign(wrapAngle(toward - course)) * adjust;
  return course;
}

function chooseAmmo(v: Vessel, target: Vessel, distance: number): Ammo {
  if (distance < AMMO.grape.range * 0.9 && target.crew > 6) return 'grape';
  if (distance > AMMO.chain.range * 0.6 && distance < AMMO.chain.range && target.ship.surge > v.ship.surge * 0.9) return 'chain';
  return 'round';
}

/** Nudges a course out of the no-go zone: nobody sails straight into the wind. */
export function sailable(course: number, wind: Wind): number {
  if (angleOffWind(Math.sin(course), Math.cos(course), wind) >= NO_GO) return course;
  const from = Math.atan2(-wind.dirX, -wind.dirZ);
  const side = Math.sign(wrapAngle(course - from)) || 1;
  return from + side * NO_GO;
}

const PROBE_TURNS = [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2.1, -2.1, Math.PI];
const PROBE_DISTANCES = [10, 22, 36];

/** The nearest course to `course` whose water ahead is deep enough and free of land. */
export function clearCourse(world: VoxelReader, v: Vessel, course: number): number {
  for (const turn of PROBE_TURNS) {
    const c = course + turn;
    if (PROBE_DISTANCES.every((d) => deepAt(world, v, v.ship.x + Math.sin(c) * d, v.ship.z + Math.cos(c) * d))) return c;
  }
  return course + Math.PI;
}

function deepAt(world: VoxelReader, v: Vessel, x: number, z: number): boolean {
  const yMin = Math.floor(WATER_LEVEL - v.cls.body.draft - 0.5);
  const yMax = Math.floor(WATER_LEVEL + 1);
  const r = v.cls.body.halfBeam + 1;
  for (const [ox, oz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
    for (let y = yMin; y <= yMax; y++) if (isSolid(world.getVoxel(Math.floor(x + ox), y, Math.floor(z + oz)))) return false;
  }
  return true;
}

/** Proportional helm with a little damping; positive rudder turns to starboard (heading decreases). */
function rudderFor(v: Vessel, course: number): number {
  const error = wrapAngle(course - v.ship.heading);
  return Math.max(-1, Math.min(1, -(2.5 * error - 1.5 * v.ship.yawRate)));
}

