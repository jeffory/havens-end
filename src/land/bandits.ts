import { SEA_LEVEL } from '../config';
import { isNight } from '../core/clock';
import { type Dress, townDress } from '../duel/dress';
import type { Cargo } from '../economy/goods';
import { hash2 } from '../util/hash';
import { Block } from '../voxel/blocks';
import type { VoxelReader } from '../voxel/raycast';
import type { BanditCamp } from '../worldgen/bandits';
import { CLAIM_RADIUS, fireCentre } from './camps';
import { clearLine, hitChance, MUSKET, type Point3, resolveShot } from './firearms';
import type { Land } from './Land';
import { findPath, type PathPoint } from './paths';
import { createWalker, groundBelow, STEP_UP, standable, stepWalker, WALK_SPEED, type Walker } from './walker';

/** No campfire within this of a manned camp; a claim within this keeps a cleared camp empty for good. */
export const HOLD_RADIUS = 60;
/** A cleared camp is manned again after this many days (sea clock). */
export const CAMP_BACK_DAYS = 5;
/** The captain is on a camp's islet within this of its shore. */
const ISLET_MARGIN = 25;
/** The chest opens from this close. */
const CHEST_REACH = 2.2;
/** What a chest holds, by how far out the camp is. */
const CHEST_GOLD: Record<0 | 1 | 2, readonly [number, number]> = { 0: [40, 100], 1: [90, 180], 2: [160, 300] };
const CHEST_GOODS: Record<0 | 1 | 2, Cargo> = {
  0: { rum: 3, cartridges: 6 },
  1: { rum: 3, tobacco: 2, cartridges: 8 },
  2: { spice: 2, muskets: 1, cartridges: 10 },
};

export const BANDIT_HP = 4;
/** They see the captain this far off by day (half that at night), and hear a shot this far. */
export const SIGHT = 18;
export const HEARING = 30;
/** In a fight they keep between these two distances from the captain. */
export const KEEP_NEAR = 8;
export const KEEP_FAR = 16;
/** Wounded to this, a bandit breaks and runs. */
export const FLEE_AT = 2;
/** A runaway is gone once this far off, or this far and out of sight. */
const FLEE_GONE = 40;
const FLEE_HIDDEN = 20;
/** Out of sight of the captain this long, a bandit goes back to their camp. */
const LOSE_SECONDS = 20;
const PATH_NODES = 1500;
/** At ease they amble; in a fight they move smartly. */
const EASE_PACE = 0.35;
const FIGHT_PACE = 0.8;
/** Wounded and running, they limp: slower than the captain walks, so they can be run down. */
const LIMP_PACE = 0.8;
const ARRIVED = 0.4;
/** Too near, too far or out of sight in a fight, a bandit picks somewhere better within this. */
const REPLAN = 0.5;
/** Held up this long on the way, a bandit gives up the path. */
const STUCK_SECONDS = 1.5;
/** A musket ball that misses goes this far wide of the captain. */
const MISS_WIDE = 0.8;
/** Bandits plan their way at least this far clear of the captain's claimed ground… */
const CLAIM_BERTH = 1.5;
/** …and running, look this far ahead for it, and for the water. */
const LOOK_AHEAD = 1.5;

/** How a camp stands. */
export interface CampState {
  /** Bandits holding it (fallen and fled ones are gone). */
  left: number;
  /** The day (with its fraction) the last of them went, or null while it's manned. */
  cleared: number | null;
  looted: boolean;
  /** Never manned again: someone's camp claims its ground, or an old save's edits wiped it out. */
  gone: boolean;
}

export interface BanditsSnapshot {
  camps: Array<{ id: number } & CampState>;
}

/**
 * The bandits' camps and how each stands: manned, cleared and when, looted, back again
 * five days on, or gone for good. The bandits themselves are stepped only for the camp on
 * the islet the captain walks (`stepBandits`); they aren't saved.
 */
export class Bandits {
  /** The bandits of the camp the captain's islet holds, while they're there to be met. */
  live: Bandit[] = [];
  liveCamp: number | null = null;
  nextBandit = 1;
  private readonly states = new Map<number, CampState>();

  constructor(readonly camps: readonly BanditCamp[] = []) {
    for (const c of camps) this.states.set(c.id, { left: c.size, cleared: null, looted: false, gone: false });
  }

  state(id: number): CampState {
    return this.states.get(id)!;
  }

  manned(camp: BanditCamp): boolean {
    const s = this.state(camp.id);
    return !s.gone && s.left > 0;
  }

  /** The camp holding the islet at (x, z), if any. */
  campFor(x: number, z: number): BanditCamp | undefined {
    return this.camps.find((c) => !this.state(c.id).gone && Math.hypot(c.islandX - x, c.islandZ - z) < c.islandRadius + ISLET_MARGIN);
  }

  /** Is a camp (manned or not, bar the gone) within `r` of (x, z)? Treasure is buried clear of them. */
  near(x: number, z: number, r: number): boolean {
    return this.camps.some((c) => !this.state(c.id).gone && Math.hypot(c.x - x, c.z - z) < r);
  }

  /** Does a manned camp hold the ground at (x, z)? No campfire goes there. */
  holds(x: number, z: number): boolean {
    return this.camps.some((c) => this.manned(c) && Math.hypot(c.x - x, c.z - z) < HOLD_RADIUS);
  }

  /** A bandit is gone (fallen, or fled): true when that was the last of them, and the camp is cleared. */
  lose(camp: BanditCamp, day: number): boolean {
    const s = this.state(camp.id);
    if (s.left <= 0) return false;
    s.left -= 1;
    if (s.left > 0) return false;
    s.cleared = day;
    return true;
  }

  /** Cleared camps are manned again `CAMP_BACK_DAYS` on, unless a camp of the captain's now claims ground near. */
  reman(day: number, claimNear: (x: number, z: number, r: number) => boolean): void {
    for (const c of this.camps) {
      const s = this.state(c.id);
      if (s.gone || s.left > 0 || s.cleared === null) continue;
      if (claimNear(c.x, c.z, HOLD_RADIUS)) s.gone = true;
      else if (day >= s.cleared + CAMP_BACK_DAYS) Object.assign(s, { left: c.size, cleared: null, looted: false });
    }
  }

  /** A camp whose unlooted chest is at hand from (x, z). */
  chestAt(x: number, z: number): BanditCamp | undefined {
    return this.camps.find((c) => {
      const s = this.state(c.id);
      return !s.gone && !s.looted && Math.hypot(c.chest.x + 0.5 - x, c.chest.z + 0.5 - z) < CHEST_REACH;
    });
  }

  /** Opens a camp's chest: gold and goods by how far out it is. */
  loot(camp: BanditCamp, random: () => number): { gold: number; goods: Cargo } {
    this.state(camp.id).looted = true;
    const [lo, hi] = CHEST_GOLD[camp.tier];
    return { gold: Math.round(lo + random() * (hi - lo)), goods: { ...CHEST_GOODS[camp.tier] } };
  }

  /**
   * After a load, squares the camps with the world: one whose fire an old save's own edits
   * wiped out, or whose ground a camp of the captain's already claims, is never manned.
   */
  reconcile(world: VoxelReader, claimNear: (x: number, z: number, r: number) => boolean): void {
    for (const c of this.camps) {
      if (world.getVoxel(c.x, c.y, c.z) !== Block.Embers || claimNear(c.x, c.z, HOLD_RADIUS)) this.state(c.id).gone = true;
    }
  }

  /**
   * Every bandit at ease takes up the fight, their muskets coming to bear one after another,
   * the first of them two seconds on. True when that starts a fight (none of them was in one).
   */
  alertAll(): boolean {
    const starts = !this.fighting() && this.live.some((b) => b.mode === 'ease');
    for (const b of this.live) if (b.mode === 'ease') Object.assign(b, { mode: 'fight', path: null, think: 0, unseen: 0, loading: 2 + (b.id % 3) * 0.9 });
    return starts;
  }

  /** Would a shot fired at (x, z) be heard? Only if a bandit is within earshot. */
  hears(x: number, z: number): boolean {
    return this.live.some((b) => Math.hypot(b.walker.x - x, b.walker.z - z) < HEARING);
  }

  /** Is a fight on? */
  fighting(): boolean {
    return this.live.some((b) => b.mode === 'fight');
  }

  snapshot(): BanditsSnapshot {
    return { camps: [...this.states].map(([id, s]) => ({ id, ...s })) };
  }

  restore(s: BanditsSnapshot): void {
    for (const c of s.camps) {
      const state = this.states.get(c.id);
      if (state) Object.assign(state, { left: c.left, cleared: c.cleared, looted: c.looted, gone: c.gone });
    }
    this.live = [];
    this.liveCamp = null;
  }
}

export interface Bandit {
  id: number;
  camp: number;
  look: number;
  dress: Dress;
  walker: Walker;
  hp: number;
  mode: 'ease' | 'fight' | 'flee';
  /** Seconds until the musket's loaded. */
  loading: number;
  /** Seconds left levelling the musket (for drawing). */
  aiming: number;
  path: PathPoint[] | null;
  next: number;
  /** Seconds until they next choose where to go. */
  think: number;
  /** Seconds they've had no sight of the captain, in a fight. */
  unseen: number;
  /** Seconds they've been held up on the way to the next point of their path. */
  stuck: number;
  /** Seconds they've been held up getting off the captain's claimed ground; past `STUCK_SECONDS` they stop trying. */
  pinned: number;
}

/**
 * One step of the camp on the islet the captain walks: its bandits muster at ease the
 * first time, loiter, see or hear the captain and fight, keeping their distance and
 * firing when loaded and in sight, and run when badly hurt. Other camps wait. None of
 * them ever sets foot on ground a camp of the captain's claims.
 */
export function stepBandits(land: Land, dt: number, random: () => number): void {
  const bandits = land.bandits;
  const ashore = land.walker;
  const camp = ashore ? bandits.campFor(ashore.x, ashore.z) : undefined;
  if (!ashore || !camp || !bandits.manned(camp)) {
    bandits.live = [];
    bandits.liveCamp = null;
    return;
  }
  if (bandits.liveCamp !== camp.id) {
    // Mustering takes the step: they come out at ease, and look about them from the next.
    bandits.live = muster(land, camp, random);
    bandits.liveCamp = camp.id;
    return;
  }
  const r: Round = { land, camp, captain: { x: ashore.x, y: ashore.y + 1.2, z: ashore.z }, night: isNight(land.sea.clock.phase), claims: claimsOf(land), dt, random };
  for (const b of [...bandits.live]) {
    if (!land.walker) return; // the last shot brought the captain down
    b.aiming = Math.max(0, b.aiming - dt);
    const w = b.walker;
    // A camp of the captain's made round them: off its ground first (and, unless they're
    // running, out of the berth they plan their ways clear of it by), away from the nearest
    // fire. Held up at it, they give up and go about their business where they stand.
    const fire = b.mode === 'flee' ? r.claims.at(w.x, w.z) : r.claims.at(Math.floor(w.x) + 0.5, Math.floor(w.z) + 0.5, CLAIM_BERTH);
    if (!fire) b.pinned = 0;
    else if (b.pinned <= STUCK_SECONDS) {
      getOff(r, b, fire);
      continue;
    }
    if (b.mode === 'ease') ease(r, b);
    else if (b.mode === 'fight') fight(r, b);
    else flee(r, b);
  }
}

/** A step away from a fire whose claim (or its berth) they stand on: `pinned` counts the time it gets them nowhere. */
function getOff(r: Round, b: Bandit, fire: { x: number; z: number }): void {
  const w = b.walker;
  b.path = null;
  const before = { x: w.x, z: w.z };
  stride(r, b, w.x - fire.x, w.z - fire.z);
  b.pinned = Math.hypot(w.x - before.x, w.z - before.z) < WALK_SPEED * r.dt * 0.2 ? b.pinned + r.dt : 0;
}

/** What a bandit's step goes on. */
interface Round {
  land: Land;
  camp: BanditCamp;
  /** The captain's chest: what bandits look for and shoot at. */
  captain: Point3;
  night: boolean;
  claims: Claims;
  dt: number;
  random: () => number;
}

/**
 * The ground the captain's camps claim, which no bandit sets foot on. `at`: the nearest fire
 * whose claim (or `berth` round it) takes in (x, z), if one does. `ways`: the world as a
 * bandit plans a way across it, with claimed ground and a berth round it walled off.
 */
interface Claims {
  at(x: number, z: number, berth?: number): { x: number; z: number } | undefined;
  holds(x: number, z: number, berth?: number): boolean;
  ways: VoxelReader;
}

function claimsOf(land: Land): Claims {
  const fires = land.buildings.filter((b) => b.kind === 'campfire').map(fireCentre);
  const at = (x: number, z: number, berth = 0) => {
    let nearest: { x: number; z: number } | undefined;
    let best = CLAIM_RADIUS + berth;
    for (const f of fires) {
      const d = Math.hypot(f.x - x, f.z - z);
      if (d <= best) [nearest, best] = [f, d];
    }
    return nearest;
  };
  const holds = (x: number, z: number, berth = 0) => at(x, z, berth) !== undefined;
  const world = land.world;
  const ways = fires.length === 0 ? world : { getVoxel: (x: number, y: number, z: number) => (holds(x + 0.5, z + 0.5, CLAIM_BERTH) ? Block.Stone : world.getVoxel(x, y, z)) };
  return { at, holds, ways };
}

/** A camp's bandits, gathered round the fire. */
function muster(land: Land, camp: BanditCamp, random: () => number): Bandit[] {
  const out: Bandit[] = [];
  const n = land.bandits.state(camp.id).left;
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2 + random();
    const x = camp.x + 0.5 + Math.sin(angle) * 3;
    const z = camp.z + 0.5 + Math.cos(angle) * 3;
    const look = Math.floor(hash2(camp.id, i, 0xba4d) * 1e6);
    out.push({
      id: land.bandits.nextBandit++,
      camp: camp.id,
      look,
      dress: { ...townDress('pirate', look), ragged: true },
      walker: createWalker(x, standable(land.world, x, z, camp.y + 4) ?? camp.y, z, angle + Math.PI),
      hp: BANDIT_HP,
      mode: 'ease',
      loading: 0,
      aiming: 0,
      path: null,
      next: 0,
      think: random() * 2,
      unseen: 0,
      stuck: 0,
      pinned: 0,
    });
  }
  return out;
}

const eyeOf = (b: Bandit): Point3 => ({ x: b.walker.x, y: b.walker.y + 1.5, z: b.walker.z });

/** A way there, if it isn't on the captain's claimed ground and there is one. */
function wayTo(r: Round, b: Bandit, to: { x: number; z: number }, near: number): PathPoint[] | null {
  return r.claims.holds(to.x, to.z, CLAIM_BERTH) ? null : findPath(r.claims.ways, b.walker, to, near, PATH_NODES);
}

function ease(r: Round, b: Bandit): void {
  const { land, camp, captain, night, random } = r;
  const w = b.walker;
  const sight = night ? SIGHT / 2 : SIGHT;
  if (Math.hypot(captain.x - w.x, captain.z - w.z) < sight && clearLine(land.world, eyeOf(b), captain)) return land.alertBandits();
  b.think -= r.dt;
  if (b.think <= 0 && !b.path) {
    b.think = 3 + random() * 5;
    // By day some wander the islet; at night they keep to the fire.
    const roam = !night && random() < 0.35;
    const [cx, cz] = roam ? [camp.islandX, camp.islandZ] : [camp.x + 0.5, camp.z + 0.5];
    const reach = roam ? camp.islandRadius * 0.7 : night ? 3 : 6;
    const angle = random() * Math.PI * 2;
    const far = (roam ? Math.sqrt(random()) : 0.5 + random() * 0.5) * reach;
    b.path = wayTo(r, b, { x: cx + Math.sin(angle) * far, z: cz + Math.cos(angle) * far }, 0.8);
    b.next = 0;
  }
  walk(r, b, EASE_PACE);
}

function fight(r: Round, b: Bandit): void {
  const { land, captain, dt, random } = r;
  const w = b.walker;
  const eye = eyeOf(b);
  const d = Math.hypot(captain.x - w.x, captain.z - w.z);
  const sees = clearLine(land.world, eye, captain);
  b.unseen = sees ? 0 : b.unseen + dt;
  if (b.unseen > LOSE_SECONDS) {
    Object.assign(b, { mode: 'ease', path: null, think: 1, unseen: 0 });
    return;
  }
  b.loading = Math.max(0, b.loading - dt);
  if (b.loading <= 0 && sees && d <= MUSKET.range) {
    w.facing = Math.atan2(captain.x - w.x, captain.z - w.z);
    b.loading = MUSKET.reload;
    b.aiming = 0.6;
    land.underFire();
    const chance = hitChance('musket', d);
    const roll = random();
    // A miss goes wide, past one side of the captain or the other.
    const side = (roll < (1 + chance) / 2 ? -1 : 1) * MISS_WIDE;
    const wide = { x: captain.x + Math.cos(w.facing) * side, y: captain.y + 0.2, z: captain.z - Math.sin(w.facing) * side };
    const hit = roll < chance;
    const end = hit ? { ...captain } : resolveShot(land.world, eye, wide, MUSKET.range, null, 0, 1).end;
    land.emit({ kind: 'shot', gun: 'musket', from: eye, to: end, hit: hit ? 'captain' : null });
    if (hit) land.hurt(MUSKET.damage);
    // And off somewhere else before the next.
    b.path = null;
    b.think = 0;
    return;
  }
  // Too near, too far, or out of sight: somewhere better, and soon.
  if (d < KEEP_NEAR || d > KEEP_FAR || !sees) b.think = Math.min(b.think, REPLAN);
  b.think -= dt;
  if (!b.path && b.think <= 0) {
    b.think = 1.5 + random() * 2;
    const angle = Math.atan2(w.x - captain.x, w.z - captain.z) + (random() - 0.5) * 1.2;
    const off = KEEP_NEAR + random() * (KEEP_FAR - KEEP_NEAR);
    b.path = wayTo(r, b, { x: captain.x + Math.sin(angle) * off, z: captain.z + Math.cos(angle) * off }, 1);
    b.next = 0;
  }
  walk(r, b, FIGHT_PACE);
  if (!b.path) w.facing = Math.atan2(captain.x - w.x, captain.z - w.z);
}

function flee(r: Round, b: Bandit): void {
  const { land, captain } = r;
  const w = b.walker;
  const dx = w.x - captain.x;
  const dz = w.z - captain.z;
  const d = Math.hypot(dx, dz) || 1;
  const [fx, fz] = veer(r.claims, w, dx / d, dz / d);
  // At the shore they're gone, off along it or into the sea, rather than wading in.
  if ((fx !== 0 || fz !== 0) && wet(land.world, w.x + fx * LOOK_AHEAD, w.z + fz * LOOK_AHEAD, w.y)) return land.banditGone(b, 'fled');
  stride(r, b, fx * LIMP_PACE, fz * LIMP_PACE);
  if (d > FLEE_GONE || (d > FLEE_HIDDEN && !clearLine(land.world, eyeOf(b), captain))) land.banditGone(b, 'fled');
}

/** The sea at (x, z), for someone on foot at height `y`: ground at or below sea level there, or none at all. */
function wet(world: VoxelReader, x: number, z: number, y: number): boolean {
  return groundBelow(world, x, z, y + STEP_UP) <= SEA_LEVEL;
}

/** Turns tried, smallest first, to run clear of the captain's claimed ground. */
const VEERS = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, (3 * Math.PI) / 4, (-3 * Math.PI) / 4];

/** A way to run that doesn't carry them onto claimed ground: straight on, or veering as little as will do; standing, if nothing will. */
function veer(claims: Claims, w: Walker, dx: number, dz: number): readonly [number, number] {
  for (const turn of VEERS) {
    const fx = dx * Math.cos(turn) + dz * Math.sin(turn);
    const fz = dz * Math.cos(turn) - dx * Math.sin(turn);
    if (!claims.holds(w.x + fx * LOOK_AHEAD, w.z + fz * LOOK_AHEAD)) return [fx, fz];
  }
  return [0, 0];
}

/** Along their path, if they have one; standing their ground if not. Held up too long, they give the path up. */
function walk(r: Round, b: Bandit, pace: number): void {
  const w = b.walker;
  const p = b.path?.[b.next];
  if (!p) {
    b.path = null;
    stepWalker(w, 0, 0, r.land.world, r.dt);
    return;
  }
  const dx = p.x - w.x;
  const dz = p.z - w.z;
  const d = Math.hypot(dx, dz);
  if (d < ARRIVED) {
    b.next++;
    b.stuck = 0;
    return;
  }
  const before = { x: w.x, z: w.z };
  const kept = stride(r, b, (dx / d) * pace, (dz / d) * pace);
  const moved = Math.hypot(w.x - before.x, w.z - before.z);
  b.stuck = moved < WALK_SPEED * pace * r.dt * 0.2 ? b.stuck + r.dt : 0;
  if (!kept || b.stuck > STUCK_SECONDS) Object.assign(b, { path: null, stuck: 0 });
}

/**
 * A step on foot that never takes a bandit onto the captain's claimed ground from off it:
 * false if it would have, and they stopped at its edge. (On it already, they're getting off.)
 */
function stride(r: Round, b: Bandit, moveX: number, moveZ: number): boolean {
  const w = b.walker;
  stepWalker(w, moveX, moveZ, r.land.world, r.dt);
  if (!r.claims.holds(w.x, w.z) || r.claims.holds(w.prev.x, w.prev.z)) return true;
  Object.assign(w, { x: w.prev.x, y: w.prev.y, z: w.prev.z, vx: 0, vz: 0, vy: 0 });
  return false;
}
