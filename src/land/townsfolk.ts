import { isNight } from '../core/clock';
import { alike, type Dress, type DressKind, townDress } from '../duel/dress';
import type { KeeperPost, Port, PortPlace, SpotKind, TownSpot } from '../economy/ports';
import { hash2 } from '../util/hash';
import type { VoxelReader } from '../voxel/raycast';
import type { Land } from './Land';
import { findPath, type PathPoint } from './paths';
import { collides, createWalker, groundBelow, stepWalker, WALK_SPEED, type Walker } from './walker';

export type { SpotKind, TownSpot } from '../economy/ports';

/** A point on the ground. */
interface Point {
  x: number;
  y: number;
  z: number;
}

/**
 * Someone about town: out of a door, off to the square, the stalls, the well, the
 * shipyard or the tavern, lingering a while, then off again; home at night. Or one of
 * the Crown's soldiers, standing guard at the Governor's door, or a shop's keeper behind
 * the counter. Just for life: nobody talks to them, and they aren't saved.
 */
export interface Townsman {
  id: number;
  /** Picks their face (as a settler's look does), and with their port, their clothes. */
  look: number;
  /** What they wear: their port's dress, or a soldier's (see `townDress`). */
  dress: Dress;
  walker: Walker;
  /** Walking to a spot, or lingering at one, they stand at `at`: their own place round it. */
  task:
    | { kind: 'walk'; path: PathPoint[]; next: number; stuck: number; to: TownSpot; at: Point }
    | { kind: 'linger'; left: number; spot: TownSpot; at: Point }
    | { kind: 'wait'; left: number }
    | { kind: 'guard' }
    | { kind: 'keep'; post: KeeperPost };
  /** Heading home, to go in at a door. */
  home: boolean;
  /** Gone in: taken off the streets next step. */
  gone?: boolean;
}

/** How many are about by day (fewer in the Brethren's haven), and by night. Guards and keepers aren't counted. */
const DAY_FOLK = 8;
const NIGHT_FOLK = 3;
/** One comes out of a door every so often, till the town's as busy as it gets. */
const SPAWN_EVERY = 1.2;
/** They stroll: this share of the captain's pace. */
const PACE = 0.45;
const ARRIVED = 0.35;
/** Closer than that to the place they're making for, so those sharing a spot keep their distance. */
const SETTLED = 0.15;
const STUCK_SECONDS = 2;
const PATH_NODES = 4000;
/** The captain this far from the berth has left the town behind. */
const TOWN_RANGE = 140;
/** How long they linger at each kind of spot (least, most). */
const LINGER: Record<SpotKind, readonly [number, number]> = {
  square: [4, 10],
  stall: [6, 14],
  yard: [8, 16],
  tavern: [6, 14],
  street: [2, 5],
  well: [4, 9],
  door: [1, 2],
};
/** Where they like to go, by weight. */
const LIKES: Record<SpotKind, number> = { square: 3, stall: 4, yard: 2, tavern: 2, street: 2, well: 2, door: 1 };
/** A spot two are at already is this much less liked. */
const CROWDED = 0.2;
/** Those at a spot stand round it: this many places in a ring this far out. */
const RING_PLACES = 6;
const RING = 1.25;
/** Tries at a look unlike everyone about, before settling for one unlike the last out. */
const FRESH_TRIES = 12;
/** How quickly someone lingering turns to face the spot. */
const TURN = 3;

/** A keeper this close to a spot stands in the way of those round it. */
const KEEPER_NEAR = 3;
/** Nobody ever stands this close to a keeper's post: hard-clear of it, present or not, day or night. */
const KEEPER_CLEAR = 0.8;
/**
 * Nobody lingers, nor a guard stands, this close to a doorway: where the captain stands to go
 * in at a shop, or a house's step. A crowd there merged with the captain as they went in.
 */
export const DOOR_CLEAR = 1.2;
/** Nobody lingers this close to the captain: one he walks onto steps aside. */
export const CAPTAIN_CLEAR = 1;

/** Somewhere nobody lingers, and how far from it they keep. */
export interface Clear {
  x: number;
  z: number;
  by: number;
}

/**
 * Where nobody in this port lingers: a step from every doorway (the places you go in at, and
 * the houses' doors), off every keeper's post, present or not, and clear of the captain.
 */
export function offLimits(port: Port, captain: { x: number; z: number } | null): Clear[] {
  const doorways = [...port.places, ...(port.spots ?? []).filter((s) => s.kind === 'door')];
  return [
    ...doorways.map(({ x, z }) => ({ x, z, by: DOOR_CLEAR })),
    ...(port.keepers ?? []).map(({ x, z }) => ({ x, z, by: KEEPER_CLEAR })),
    ...(captain ? [{ x: captain.x, z: captain.z, by: CAPTAIN_CLEAR }] : []),
  ];
}

const within = (clear: readonly Clear[], x: number, z: number): boolean => clear.some((c) => Math.hypot(c.x - x, c.z - z) < c.by);

/** Who stands fixed at a post: the Crown's guards and the shops' keepers. They don't count toward the town's numbers. */
const fixed = (f: Townsman): boolean => f.task.kind === 'guard' || f.task.kind === 'keep';

/** Those at posts who are in the way of anyone standing round a spot: the guards, and a keeper close by. */
function postedBy(folk: readonly Townsman[], spot: TownSpot): Walker[] {
  return folk.filter((f) => f.task.kind === 'guard' || (f.task.kind === 'keep' && Math.hypot(f.walker.x - spot.x, f.walker.z - spot.z) < KEEPER_NEAR)).map((f) => f.walker);
}

/** Is a keeper in their shop? By day, all of them; at night, only the tavern's. */
export const keeping = (post: KeeperPost, night: boolean): boolean => !night || post.kind === 'tavern';

/**
 * A keeper's looks: from where they stand, not a draw from the town's dice, so they look the
 * same each visit and the town's dice roll as they would without them. Dressed for the port,
 * and never as a soldier.
 */
export function keeperLook(port: Port, post: KeeperPost): { look: number; dress: Dress } {
  let tried = { look: 0, dress: townDress(dressKind(port), 0) };
  for (let salt = 0; salt < 32; salt++) {
    const look = Math.floor(hash2(Math.floor(post.x) * 7 + salt, Math.floor(post.z), 0x6b) * 1e6);
    tried = { look, dress: townDress(dressKind(port), look) };
    if (!tried.dress.soldier) return tried;
  }
  return tried;
}

/** One step of the town's comings and goings, while the captain walks a town. */
export function stepTownsfolk(land: Land, dt: number, random: () => number): void {
  const port = land.sea.docked;
  const w = land.walker;
  const spots = port?.spots ?? [];
  if (!port || !w || spots.length === 0 || Math.hypot(w.x - port.x, w.z - port.z) > TOWN_RANGE) {
    land.townsfolk.length = 0;
    land.lastOut = null;
    return;
  }
  const doors = spots.filter((s) => s.kind === 'door');
  const night = isNight(land.sea.clock.phase);
  const want = night ? NIGHT_FOLK : port.faction === 'pirate' ? DAY_FOLK - 1 : DAY_FOLK;

  // The Crown's soldiers take their posts at the Governor's door as soon as the captain's in town.
  if (!land.townsfolk.some((f) => f.task.kind === 'guard')) {
    for (const post of guardPosts(port, land.world)) {
      const look = Math.floor(random() * 1e6);
      land.townsfolk.push({ id: land.nextTownsman++, look, dress: townDress('soldier', look), walker: createWalker(post.x, post.y, post.z, post.facing), task: { kind: 'guard' }, home: false });
    }
  }
  // The shops' keepers, behind their counters: all of them by day, only the tavern's at night.
  for (const post of port.keepers ?? []) {
    const here = land.townsfolk.find((f) => f.task.kind === 'keep' && f.task.post === post);
    if (here && !keeping(post, night)) here.gone = true;
    if (here || !keeping(post, night)) continue;
    const { look, dress } = keeperLook(port, post);
    land.townsfolk.push({ id: land.nextTownsman++, look, dress, walker: createWalker(post.x, post.y, post.z, post.facing), task: { kind: 'keep', post }, home: false });
  }
  const clear = offLimits(port, w);
  // Arriving, the town's already about its business: its folk are out at its places, not
  // all still to come out of their doors.
  if (land.lastOut === null && !land.townsfolk.some((f) => !fixed(f))) {
    const places = spots.filter((s) => s.kind !== 'door');
    for (let i = 0; i < want && places.length > 0; i++) {
      const spot = pickSpot(places, (s) => standingAt(land.townsfolk, s).length, random)!;
      const at = standAt(land.world, spot, [...standingAt(land.townsfolk, spot), ...postedBy(land.townsfolk, spot)], random, clear);
      if (!at) continue; // no room there: they'll come out of a door instead
      const { look, dress } = freshLook(dressKind(port), land.townsfolk.filter((f) => f.task.kind !== 'keep').map((f) => f.dress), random, land.lastOut ?? undefined);
      land.lastOut = dress;
      const walker = createWalker(at.x, at.y, at.z, random() * Math.PI * 2);
      land.townsfolk.push({ id: land.nextTownsman++, look, dress, walker, task: { kind: 'linger', left: between(LINGER[spot.kind], random), spot, at }, home: false });
    }
    land.townSpawnIn = SPAWN_EVERY;
  }
  const folk = land.townsfolk.filter((f) => !fixed(f));
  const about = folk.filter((f) => !f.home);
  // Out of a door, till there are enough about; the rest head home.
  land.townSpawnIn -= dt;
  if (about.length < want && land.townSpawnIn <= 0 && doors.length > 0) {
    land.townSpawnIn = SPAWN_EVERY;
    const door = doors[Math.floor(random() * doors.length)];
    const { look, dress } = freshLook(dressKind(port), folk.map((f) => f.dress), random, land.lastOut ?? undefined);
    land.lastOut = dress;
    land.townsfolk.push({ id: land.nextTownsman++, look, dress, walker: createWalker(door.x, door.y, door.z, 0), task: { kind: 'wait', left: 0 }, home: false });
  }
  for (const f of about.slice(want)) {
    f.home = true;
    f.task = { kind: 'wait', left: 0 };
  }

  for (const f of land.townsfolk) step(land, f, spots, doors, clear, dt, random);
  for (let i = land.townsfolk.length - 1; i >= 0; i--) if (land.townsfolk[i].gone) land.townsfolk.splice(i, 1);
}

/** How a port's townsfolk dress: Haven's (the home port, the first) as fisherfolk, the rest as their masters' ports do. */
export function dressKind(port: Port): DressKind {
  return port.id === 0 ? 'haven' : port.faction;
}

/**
 * A look for someone coming out of a door, dressed as `kind`: unlike anyone already
 * `about` if one turns up soon, and never like the `last` one out (by default, the last
 * of those about).
 */
export function freshLook(kind: DressKind, about: readonly Dress[], random: () => number, last: Dress | undefined = about[about.length - 1]): { look: number; dress: Dress } {
  let fallback: { look: number; dress: Dress } | undefined;
  let fresh = { look: 0, dress: townDress(kind, 0) };
  for (let i = 0; i < 100; i++) {
    const look = Math.floor(random() * 1e6);
    fresh = { look, dress: townDress(kind, look) };
    if (last && alike(last, fresh.dress)) continue;
    if (about.every((d) => !alike(d, fresh.dress))) return fresh;
    fallback ??= fresh;
    if (i >= FRESH_TRIES) break;
  }
  return fallback ?? fresh;
}

/** One step of someone about town. `clear` is where nobody lingers (see `offLimits`). */
function step(land: Land, f: Townsman, spots: readonly TownSpot[], doors: readonly TownSpot[], clear: readonly Clear[], dt: number, random: () => number): void {
  const t = f.task;
  if (t.kind === 'guard' || t.kind === 'keep') {
    stepWalker(f.walker, 0, 0, land.world, dt); // stands at their post
    return;
  }
  if (t.kind === 'walk') {
    if (!follow(land, f.walker, t, dt)) return;
    if (f.home && t.to.kind === 'door') f.gone = true;
    else f.task = { kind: 'linger', left: between(LINGER[t.to.kind], random), spot: t.to, at: t.at };
    return;
  }
  stepWalker(f.walker, 0, 0, land.world, dt); // stay on the ground
  const others = land.townsfolk.filter((o) => o !== f);
  const captain = land.walker;
  if (t.kind === 'linger') {
    turnToward(f.walker, t.spot, dt);
    // The captain's walked onto them: a step aside, to another place round the same spot (or off elsewhere if there's none).
    if (captain && Math.hypot(captain.x - f.walker.x, captain.z - f.walker.z) < CAPTAIN_CLEAR) {
      const at = standAt(land.world, t.spot, [...standingAt(others, t.spot), ...postedBy(others, t.spot)], random, clear);
      const path = at && findPath(land.world, f.walker, at, 0.6, PATH_NODES);
      if (at && path) {
        path.push({ x: at.x, y: path[path.length - 1]?.y ?? f.walker.y, z: at.z });
        f.task = { kind: 'walk', path, next: 0, stuck: 0, to: t.spot, at };
        return;
      }
      t.left = 0;
    }
  }
  t.left -= dt;
  if (t.left > 0) return;
  // Off somewhere else: home to the nearest door, or a spot they like (not the one they're at, and not a crowded one, mostly).
  const here = t.kind === 'linger' ? t.spot : null;
  const to = f.home ? nearest(f.walker, doors) : pickSpot(spots.filter((s) => s !== here), (s) => standingAt(others, s).length, random);
  if (!to) {
    f.gone = f.home;
    return;
  }
  const at = f.home ? to : standAt(land.world, to, [...standingAt(others, to), ...postedBy(others, to)], random, clear);
  const path = at && findPath(land.world, f.walker, at, 0.6, PATH_NODES);
  if (at && path && !f.home) path.push({ x: at.x, y: path[path.length - 1]?.y ?? f.walker.y, z: at.z });
  f.task = at && path ? { kind: 'walk', path, next: 0, stuck: 0, to, at } : { kind: 'wait', left: 2 };
}

/** Where the others at a spot (or on their way to it) stand. */
function standingAt(others: readonly Townsman[], spot: TownSpot): Point[] {
  const out: Point[] = [];
  for (const o of others) {
    const t = o.task;
    if ((t.kind === 'walk' && t.to === spot) || (t.kind === 'linger' && t.spot === spot)) out.push(t.at);
  }
  return out;
}

/**
 * Where to stand at a spot: one of a ring of places round it, as far as can be from
 * those already there or thereabouts (`taken`: the others at the spot, and any guards or
 * a keeper close by), on the spot's own level and clear of walls, stalls and the well. A
 * ring place within reach of anything `clear` keeps them off (see `offLimits`: a doorway,
 * a keeper's post whether that keeper's there or not, the captain) is never used. The spot
 * itself if there's no room round it and it's clear; null if it isn't.
 */
export function standAt(world: VoxelReader, spot: TownSpot, taken: readonly { x: number; z: number }[], random: () => number, clear: readonly Clear[] = []): Point | null {
  const turn = hash2(Math.floor(spot.x), Math.floor(spot.z), 7) * Math.PI * 2;
  const first = Math.floor(random() * RING_PLACES);
  let best: Point | null = null;
  let room = -1;
  for (let i = 0; i < RING_PLACES; i++) {
    const a = turn + ((first + i) % RING_PLACES) * ((Math.PI * 2) / RING_PLACES);
    const p = { x: spot.x + Math.sin(a) * RING, y: spot.y, z: spot.z + Math.cos(a) * RING };
    if (collides(world, p.x, p.y, p.z) || groundBelow(world, p.x, p.z, p.y + 0.5) !== p.y || within(clear, p.x, p.z)) continue;
    const apart = taken.reduce((m, o) => Math.min(m, Math.hypot(o.x - p.x, o.z - p.z)), Infinity);
    if (apart > room) {
      best = p;
      room = apart;
    }
  }
  return best ?? (within(clear, spot.x, spot.z) ? null : { x: spot.x, y: spot.y, z: spot.z });
}

/** Walks the path a step; true on arrival. Anyone held up too long is helped on to the next point. */
function follow(land: Land, w: Walker, task: Extract<Townsman['task'], { kind: 'walk' }>, dt: number): boolean {
  const p = task.path[task.next];
  if (!p) return true;
  const dx = p.x - w.x;
  const dz = p.z - w.z;
  const d = Math.hypot(dx, dz);
  if (d < (task.next === task.path.length - 1 ? SETTLED : ARRIVED)) {
    task.next++;
    task.stuck = 0;
    return task.next >= task.path.length;
  }
  const before = { x: w.x, z: w.z };
  stepWalker(w, (dx / d) * PACE, (dz / d) * PACE, land.world, dt);
  if (Math.hypot(w.x - before.x, w.z - before.z) < WALK_SPEED * PACE * dt * 0.2) {
    task.stuck += dt;
    if (task.stuck > STUCK_SECONDS) {
      Object.assign(w, { x: p.x, y: p.y, z: p.z, vx: 0, vz: 0, vy: 0 });
      Object.assign(w.prev, { x: p.x, y: p.y, z: p.z });
      task.stuck = 0;
    }
  }
  return false;
}

/** Turns someone standing about, bit by bit, to face the middle of the spot they're at. */
function turnToward(w: Walker, spot: TownSpot, dt: number): void {
  const dx = spot.x - w.x;
  const dz = spot.z - w.z;
  if (Math.hypot(dx, dz) < 0.3) return;
  const turn = Math.atan2(Math.sin(Math.atan2(dx, dz) - w.facing), Math.cos(Math.atan2(dx, dz) - w.facing));
  w.facing += turn * Math.min(1, TURN * dt);
}

const between = ([lo, hi]: readonly [number, number], random: () => number) => lo + random() * (hi - lo);

function nearest(w: Walker, list: readonly TownSpot[]): TownSpot | undefined {
  return list.reduce<TownSpot | undefined>((a, b) => (!a || Math.hypot(b.x - w.x, b.z - w.z) < Math.hypot(a.x - w.x, a.z - w.z) ? b : a), undefined);
}

/** A spot, by how much they like its kind, and much less where two or more are already (`crowd` says how many). */
export function pickSpot(list: readonly TownSpot[], crowd: (s: TownSpot) => number, random: () => number): TownSpot | undefined {
  const weight = (s: TownSpot) => LIKES[s.kind] * (crowd(s) >= 2 ? CROWDED : 1);
  const weights = list.map(weight);
  let left = random() * weights.reduce((n, x) => n + x, 0);
  for (let i = 0; i < list.length; i++) {
    left -= weights[i];
    if (left < 0) return list[i];
  }
  return list[list.length - 1];
}

/** A soldier's post: where he stands, and which way he faces. */
export interface GuardPost extends Point {
  facing: number;
}

/**
 * Where the Crown's soldiers stand guard: either side of the Governor's door in an
 * Imperial port, just outside the wall, facing out, a step clear of where the captain
 * stands to go in, or of any other doorway (a step further along if something's in the
 * way). None anywhere else, nor where the office has no door of its own.
 */
export function guardPosts(port: Port, world: VoxelReader): GuardPost[] {
  if (port.faction !== 'imperial') return [];
  const office = port.places.find((p) => p.kind === 'office');
  const yard = port.places.find((p) => p.kind === 'shipyard');
  if (!office || (yard && yard.x === office.x && yard.z === office.z)) return [];
  const out = doorOut(office, world);
  if (!out) return [];
  const clear = offLimits(port, null);
  const posts: GuardPost[] = [];
  for (const side of [-1, 1]) {
    for (const reach of [2, 3]) {
      const x = office.x + out.dz * side * reach;
      const z = office.z + out.dx * side * reach;
      if (collides(world, x, office.y, z) || within(clear, x, z)) continue;
      posts.push({ x, y: office.y, z, facing: Math.atan2(out.dx, out.dz) });
      break;
    }
  }
  return posts;
}

/**
 * Which way a door looks out, from where you stand to go in: back from the step is the
 * doorway, open two high with wall either side of it. If more than one way would do,
 * the one away from the building's sign.
 */
function doorOut(place: PortPlace, world: VoxelReader): { dx: number; dz: number } | null {
  const x = Math.floor(place.x) + 0.5;
  const z = Math.floor(place.z) + 0.5;
  const ways = [
    { dx: 1, dz: 0 },
    { dx: -1, dz: 0 },
    { dx: 0, dz: 1 },
    { dx: 0, dz: -1 },
  ].filter(({ dx, dz }) => {
    const [ix, iz] = [x - dx, z - dz]; // the doorway, a step back in
    return !collides(world, ix, place.y, iz) && collides(world, ix + dz, place.y, iz + dx) && collides(world, ix - dz, place.y, iz - dx);
  });
  const sign = place.sign;
  if (sign) {
    const away = (w: { dx: number; dz: number }) => (place.x - sign.x) * w.dx + (place.z - sign.z) * w.dz;
    ways.sort((a, b) => away(b) - away(a));
  }
  return ways[0] ?? null;
}
