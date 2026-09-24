import { isNight } from '../core/clock';
import { FOOD, GOOD_INFO, type Good } from '../economy/goods';
import { hash2 } from '../util/hash';
import { campHuts, campStores, fireAt, fireCentre, put, stock, storeRoom, take } from './camps';
import { CROPS, type CropKind, stageOf } from './crops';
import type { Land } from './Land';
import { findPath, type PathPoint, pathLength } from './paths';
import { type Building, doorOf, isWorkshop, STRUCTURES } from './structures';
import { createWalker, stepWalker, WALK_SPEED, type Walker } from './walker';

export type Job = 'idle' | 'farmer' | 'woodcutter' | 'fisher' | 'worker';
export const JOB_LABELS: Record<Job, string> = { idle: 'Idle', farmer: 'Farmer', woodcutter: 'Woodcutter', fisher: 'Fisher', worker: 'Workshop hand' };

/** What a settler is doing right now. Plain data, so it saves as it is. */
export type Task =
  | { kind: 'idle'; left: number }
  | { kind: 'walk'; path: PathPoint[]; next: number; stuck: number; then: Task; left?: number }
  | { kind: 'work'; building: number }
  | { kind: 'harvest'; x: number; z: number; left: number }
  | { kind: 'plant'; x: number; z: number; left: number }
  | { kind: 'fell'; x: number; y: number; z: number; left: number }
  | { kind: 'fish'; toward: number; left: number }
  | { kind: 'sleep'; hut: number | null };

export interface Settler {
  id: number;
  name: string;
  /** Picks their face, clothes and hat. */
  look: number;
  /** The campfire of the camp they live at. */
  camp: number;
  job: Job;
  /** A workshop hand's workshop. */
  post: number | null;
  walker: Walker;
  task: Task;
  /** Mornings in a row they've found nothing to eat. */
  hungry: number;
  /** What they're about, in a few words, for the camp screen. */
  doing: string;
}

/** A tilled plot a farmer harvested and had no seed to replant: they'll sow it when there's seed in store. */
export interface Fallow {
  x: number;
  y: number;
  z: number;
  kind: CropKind;
}

/** Settlers walk at this share of the captain's pace. */
const PACE = 0.6;
const SPEED = WALK_SPEED * PACE;
/** Mornings without food before a settler gives up and leaves. */
export const LEAVE_HUNGRY = 2;
const SECONDS = { harvest: 2, plant: 1.5, fell: 14, fish: 24, idle: 4 } as const;
/** Paths searched for a settler's errands are kept short: the camp and a little beyond. */
const PATH_NODES = 3000;
const ARRIVED = 0.3;
const STUCK_SECONDS = 1.5;

const FIRST = ['Ann', 'Tom', 'Maria', 'Jonas', 'Ines', 'Kofi', 'Rosa', 'Will', 'Esme', 'Diego', 'Nell', 'Abel', 'Hana', 'Pip', 'Luz', 'Bram', 'Odile', 'Sam', 'Yara', 'Ned'];
const LAST = ['Tully', 'Marsh', 'Okafor', 'Reyes', 'Fenn', 'Holt', 'Barros', 'Crane', 'Mbeki', 'Doyle', 'Vance', 'Quill', 'Soto', 'Ashby', 'Lark', 'Pruitt'];

export function createSettler(id: number, seed: number, fire: Building, spot: PathPoint): Settler {
  const pick = <T>(list: readonly T[], salt: number) => list[Math.floor(hash2(id, salt, seed) * list.length)];
  return {
    id,
    name: `${pick(FIRST, 1)} ${pick(LAST, 2)}`,
    look: Math.floor(hash2(id, 3, seed) * 2 ** 30),
    camp: fire.id,
    job: 'idle',
    post: null,
    walker: createWalker(spot.x, spot.y, spot.z, hash2(id, 4, seed) * Math.PI * 2),
    task: { kind: 'idle', left: 0.5 + hash2(id, 5, seed) },
    hungry: 0,
    doing: 'Settling in',
  };
}

/** Is the settler out of sight in their hut? */
export const indoors = (s: Settler): boolean => s.task.kind === 'sleep' && s.task.hut !== null;

/** Is this settler at their bench, working? (Workshops only make things then.) */
export const atWork = (s: Settler, b: Building): boolean => s.task.kind === 'work' && s.task.building === b.id;

/**
 * One fixed step of a settler's day. `live` is whether anyone's near enough to see:
 * if not, walks are timed rather than walked, which is all a camp nobody's watching needs.
 */
export function stepSettler(land: Land, s: Settler, dt: number, live: boolean): void {
  const night = isNight(land.sea.clock.phase);
  const task = s.task;
  if (live && task.kind !== 'walk' && !indoors(s)) stepWalker(s.walker, 0, 0, land.world, dt); // stay on the ground as it changes
  switch (task.kind) {
    case 'walk':
      if (night && task.then.kind !== 'sleep') return think(land, s);
      if (live ? follow(land, s, task, dt) : timed(s, task, dt)) begin(s, task.then);
      return;
    case 'sleep':
      if (!night) wake(land, s);
      return;
    case 'work':
      if (night || s.post !== task.building || !land.building(task.building)) think(land, s);
      else face(s, land.building(task.building)!);
      return;
    case 'idle':
      task.left -= dt;
      if (task.left <= 0) think(land, s);
      return;
    default:
      task.left -= dt;
      if (task.left <= 0) finish(land, s);
  }
}

/** Starts a task that was waiting at the end of a walk. */
function begin(s: Settler, task: Task): void {
  s.task = task;
  if (task.kind === 'sleep') s.doing = task.hut === null ? 'Asleep by the fire' : 'Asleep in their hut';
  if (task.kind === 'work') s.doing = 'At work';
  if (task.kind === 'fish') {
    s.walker.facing = task.toward;
    s.doing = 'Fishing';
  }
}

/** Walks the path; true on arrival. Anyone held up too long is helped on to the next cell. */
function follow(land: Land, s: Settler, task: Extract<Task, { kind: 'walk' }>, dt: number): boolean {
  const w = s.walker;
  const p = task.path[task.next];
  if (!p) return true;
  const dx = p.x - w.x;
  const dz = p.z - w.z;
  const d = Math.hypot(dx, dz);
  if (d < ARRIVED) {
    task.next++;
    task.stuck = 0;
    return task.next >= task.path.length;
  }
  const before = { x: w.x, z: w.z };
  stepWalker(w, (dx / d) * PACE, (dz / d) * PACE, land.world, dt);
  if (Math.hypot(w.x - before.x, w.z - before.z) < SPEED * dt * 0.2) {
    task.stuck += dt;
    if (task.stuck > STUCK_SECONDS) {
      place(w, p);
      task.stuck = 0;
    }
  }
  return false;
}

/** A walk nobody's watching: it takes as long as it would, then they're there. */
function timed(s: Settler, task: Extract<Task, { kind: 'walk' }>, dt: number): boolean {
  task.left ??= pathLength(s.walker, task.path.slice(task.next)) / SPEED;
  task.left -= dt;
  if (task.left > 0) return false;
  const end = task.path.at(-1);
  if (end) place(s.walker, end);
  return true;
}

function place(w: Walker, p: PathPoint): void {
  w.x = w.prev.x = p.x;
  w.y = w.prev.y = p.y;
  w.z = w.prev.z = p.z;
  w.vx = w.vz = w.vy = 0;
}

function face(s: Settler, b: Building): void {
  s.walker.facing = Math.atan2(b.x0 + b.w / 2 - s.walker.x, b.z0 + b.d / 2 - s.walker.z);
}

/** Heads somewhere to do something there. False (and a short rest) if there's no way to get there. */
function go(land: Land, s: Settler, to: { x: number; z: number }, then: Task, doing: string, near = 0): boolean {
  s.doing = doing;
  const path = findPath(land.world, s.walker, to, near, PATH_NODES);
  if (!path) {
    s.task = { kind: 'idle', left: SECONDS.idle };
    s.doing = `Can’t find a way there`;
    return false;
  }
  if (path.length === 0) begin(s, then);
  else s.task = { kind: 'walk', path, next: 0, stuck: 0, then };
  return true;
}

function rest(s: Settler, doing: string, seconds: number = SECONDS.idle): void {
  s.task = { kind: 'idle', left: seconds };
  s.doing = doing;
}

/** Decides what to do next: bed at night, then whatever their job is. */
export function think(land: Land, s: Settler): void {
  const fire = land.building(s.camp);
  if (!fire) return rest(s, 'Their camp is gone', 10);
  if (isNight(land.sea.clock.phase)) {
    const hut = homeOf(land, s);
    if (hut) go(land, s, doorOf(hut), { kind: 'sleep', hut: hut.id }, 'Off home to bed');
    else go(land, s, fireCentre(fire), { kind: 'sleep', hut: null }, 'Bedding down by the fire', 2.5);
    return;
  }
  if (s.hungry > 0) return wander(land, s, fire, 'Hungry: there’s no food in the stores');
  const stores = campStores(land.buildings, fire);
  if (s.job !== 'idle' && stores.length === 0) return wander(land, s, fire, 'Waiting for a storehouse to work for');
  switch (s.job) {
    case 'farmer':
      return farm(land, s, fire);
    case 'woodcutter':
      return cutWood(land, s, fire);
    case 'fisher':
      return fish(land, s, fire);
    case 'worker': {
      const post = s.post === null ? undefined : land.building(s.post);
      if (!post || !isWorkshop(post.kind)) return wander(land, s, fire, 'No workshop to work in');
      go(land, s, doorOf(post), { kind: 'work', building: post.id }, `Off to the ${STRUCTURES[post.kind].label.toLowerCase()}`, 0.8);
      return;
    }
    default:
      return wander(land, s, fire, 'Idle: give them a job at the campfire');
  }
}

function wander(land: Land, s: Settler, fire: Building, doing: string): void {
  const c = fireCentre(fire);
  const t = land.sea.time;
  const angle = hash2(s.id, Math.floor(t), 11) * Math.PI * 2;
  const r = 3 + hash2(s.id, Math.floor(t), 12) * 5;
  if (!go(land, s, { x: c.x + Math.sin(angle) * r, z: c.z + Math.cos(angle) * r }, { kind: 'idle', left: SECONDS.idle + hash2(s.id, t, 13) * 4 }, doing, 1.5)) rest(s, doing);
}

/** Is another settler already on their way to (or working) this cell? */
function spoken(land: Land, s: Settler, x: number, z: number): boolean {
  return land.settlers.some((o) => {
    if (o === s) return false;
    const t = o.task.kind === 'walk' ? o.task.then : o.task;
    return (t.kind === 'harvest' || t.kind === 'plant' || t.kind === 'fell') && t.x === x && t.z === z;
  });
}

const nearest = <T extends { x: number; z: number }>(s: Settler, list: readonly T[]): T | undefined =>
  list.reduce<T | undefined>((a, b) => (!a || Math.hypot(b.x - s.walker.x, b.z - s.walker.z) < Math.hypot(a.x - s.walker.x, a.z - s.walker.z) ? b : a), undefined);

function farm(land: Land, s: Settler, fire: Building): void {
  const inCamp = (x: number, z: number) => fireAt(land.buildings, x + 0.5, z + 0.5) === fire;
  const time = land.sea.time;
  const ripe = land.crops.filter((c) => stageOf(c, time) === 2 && inCamp(c.x, c.z) && !spoken(land, s, c.x, c.z));
  const crop = nearest(s, ripe);
  if (crop) {
    go(land, s, { x: crop.x + 0.5, z: crop.z + 0.5 }, { kind: 'harvest', x: crop.x, z: crop.z, left: SECONDS.harvest }, `Harvesting ${CROPS[crop.kind].label.toLowerCase()}`, 1.1);
    return;
  }
  const have = stock(campStores(land.buildings, fire));
  const sowable = land.fallow.filter((f) => inCamp(f.x, f.z) && (have[CROPS[f.kind].seed] ?? 0) > 0 && !spoken(land, s, f.x, f.z));
  const plot = nearest(s, sowable);
  if (plot) {
    go(land, s, { x: plot.x + 0.5, z: plot.z + 0.5 }, { kind: 'plant', x: plot.x, z: plot.z, left: SECONDS.plant }, `Sowing ${CROPS[plot.kind].label.toLowerCase()}`, 1.1);
    return;
  }
  const waiting = land.fallow.some((f) => inCamp(f.x, f.z));
  wander(land, s, fire, waiting ? 'Needs seed in the storehouse to sow' : land.crops.some((c) => inCamp(c.x, c.z)) ? 'Waiting for the crops to ripen' : 'No fields to tend: plant some');
}

function cutWood(land: Land, s: Settler, fire: Building): void {
  if (storeRoom(campStores(land.buildings, fire)) < 3) return wander(land, s, fire, 'The storehouse is full');
  const tree = nearest(
    s,
    land.trees(fire).filter((t) => !spoken(land, s, t.x, t.z)),
  );
  if (!tree) return wander(land, s, fire, 'No trees left near the camp: saplings are growing');
  go(land, s, { x: tree.x + 0.5, z: tree.z + 0.5 }, { kind: 'fell', x: tree.x, y: tree.y, z: tree.z, left: SECONDS.fell }, 'Felling a tree', 1.5);
}

function fish(land: Land, s: Settler, fire: Building): void {
  if (storeRoom(campStores(land.buildings, fire)) < 3) return wander(land, s, fire, 'The storehouse is full');
  const spots = land.shore(fire);
  if (spots.length === 0) return wander(land, s, fire, 'No shore near enough to fish from');
  // Fishers spread out along the shore.
  const spot = spots[Math.floor(hash2(s.id, land.sea.clock.day, 21) * spots.length)];
  go(land, s, spot, { kind: 'fish', toward: spot.toward, left: SECONDS.fish }, 'Off to fish', 0.5);
}

/** A timed job done: the goods go into the camp's storehouses. */
function finish(land: Land, s: Settler): void {
  const task = s.task;
  const fire = land.building(s.camp);
  const stores = fire ? campStores(land.buildings, fire) : [];
  switch (task.kind) {
    case 'harvest': {
      const crop = land.cropAt(task.x, task.z);
      if (!crop || stageOf(crop, land.sea.time) < 2) break;
      const spec = CROPS[crop.kind];
      if (storeRoom(stores) < spec.amount) return rest(s, 'The storehouse is full');
      land.removeCrop(crop);
      put(stores, spec.harvest, spec.amount);
      // Straight back in with fresh seed, if there's any in store.
      if (take(stores, { [spec.seed]: 1 })) land.plantCrop(crop.x, crop.y, crop.z, crop.kind);
      else land.fallow.push({ x: crop.x, y: crop.y, z: crop.z, kind: crop.kind });
      land.emit({ kind: 'work', action: 'harvest', x: crop.x, y: crop.y, z: crop.z, good: spec.harvest, amount: spec.amount, settler: s.id });
      break;
    }
    case 'plant': {
      const i = land.fallow.findIndex((f) => f.x === task.x && f.z === task.z);
      if (i < 0) break;
      const plot = land.fallow[i];
      land.fallow.splice(i, 1);
      if (land.cropAt(plot.x, plot.z) || !land.tilled(plot)) break;
      if (!take(stores, { [CROPS[plot.kind].seed]: 1 })) {
        land.fallow.push(plot);
        break;
      }
      land.plantCrop(plot.x, plot.y, plot.z, plot.kind);
      land.emit({ kind: 'work', action: 'plant', x: plot.x, y: plot.y, z: plot.z, settler: s.id });
      break;
    }
    case 'fell': {
      const felled = land.fellTreeAt(task.x, task.y, task.z);
      if (!felled) break;
      put(stores, 'timber', felled.timber);
      land.plantSapling(task.x, task.y, task.z);
      land.emit({ kind: 'work', action: 'fell', x: task.x, y: task.y, z: task.z, good: 'timber', amount: felled.timber, settler: s.id, leaves: felled.leaves });
      break;
    }
    case 'fish': {
      const catch_ = 1 + Math.floor(hash2(s.id, land.sea.time, 31) * 3);
      put(stores, 'fish', catch_);
      land.emit({ kind: 'work', action: 'fish', x: s.walker.x, y: s.walker.y, z: s.walker.z, good: 'fish', amount: catch_, settler: s.id });
      break;
    }
  }
  think(land, s);
}

/** Morning: out of bed (and out of the hut), and off to work. */
function wake(land: Land, s: Settler): void {
  if (s.task.kind === 'sleep' && s.task.hut !== null) {
    const hut = land.building(s.task.hut);
    if (hut) {
      const door = doorOf(hut);
      place(s.walker, { x: door.x, y: hut.y, z: door.z });
    }
  }
  s.task = { kind: 'idle', left: hash2(s.id, land.sea.clock.day, 41) * 3 };
  s.doing = 'Up and about';
}

/** The hut a settler sleeps in: beds are handed out in order of arrival. */
export function homeOf(land: Land, s: Settler): Building | undefined {
  const fire = land.building(s.camp);
  if (!fire) return undefined;
  const mates = land.settlers.filter((o) => o.camp === s.camp).sort((a, b) => a.id - b.id);
  let bed = mates.indexOf(s);
  for (const hut of campHuts(land.buildings, fire)) {
    bed -= STRUCTURES[hut.kind].beds ?? 0;
    if (bed < 0) return hut;
  }
  return undefined;
}

/**
 * Breakfast, at sunrise: each settler eats one of whatever food is in their camp's
 * stores. Nothing to eat, and they won't work; a few hungry mornings and they leave.
 * Returns the settlers who gave up.
 */
export function breakfast(land: Land): Settler[] {
  const gone: Settler[] = [];
  for (const s of land.settlers) {
    const fire = land.building(s.camp);
    const stores = fire ? campStores(land.buildings, fire) : [];
    const have = stock(stores);
    const food = FOOD.find((g) => (have[g] ?? 0) > 0);
    if (food && take(stores, { [food]: 1 })) {
      s.hungry = 0;
    } else if (++s.hungry > LEAVE_HUNGRY) {
      gone.push(s);
    }
  }
  return gone;
}

/** How many days the camp's food will last its settlers. */
export function foodDays(land: Land, fire: Building): number {
  const eaters = land.settlers.filter((s) => s.camp === fire.id).length;
  if (eaters === 0) return Infinity;
  const have = stock(campStores(land.buildings, fire));
  return Math.floor(FOOD.reduce((n, g: Good) => n + (have[g] ?? 0), 0) / eaters);
}

export const foodLabel = (g: Good) => GOOD_INFO[g].label.toLowerCase();
