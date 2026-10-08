import { darkness } from '../core/clock';
import { SEA_LEVEL } from '../config';
import type { Cargo } from '../economy/goods';
import { Block } from '../voxel/blocks';
import type { VoxelReader } from '../voxel/raycast';
import type { VoxelWorld } from '../voxel/VoxelWorld';
import { groundHeight } from '../worldgen/buildings';
import { type Crop, stageOf } from './crops';
import type { Land, Tool } from './Land';
import { createWalker, standable, stepWalker, type Walker } from './walker';

export type CreatureKind = 'crab' | 'boar' | 'goat';

interface CreatureSpec {
  label: string;
  speed: number;
  hp: number;
  /** How far off it smells a ripe crop (0: it doesn't raid fields). */
  smell: number;
  /** At most this many about at once. */
  most: number;
  /** What it gives when it's brought down. */
  loot: Cargo;
  ground: number[];
  /** When it's about: the night's raiders, or the day's game. */
  when: 'night' | 'day';
  /** It comes out in herds of this many, least and most. */
  herd?: readonly [number, number];
  /** It bolts when the captain comes this close. */
  shy?: number;
  /** It keeps to ground at least this high above the sea. */
  upland?: number;
}

/**
 * Night creatures (crabs up from the beach, boar out of the woods, both after your crops)
 * and the day's game (wild goats on the uplands, shy of people).
 */
export const CREATURES: Record<CreatureKind, CreatureSpec> = {
  crab: { label: 'land crab', speed: 1.5, hp: 1, smell: 12, most: 4, loot: { fish: 1 }, ground: [Block.Sand], when: 'night' },
  boar: { label: 'wild boar', speed: 3.4, hp: 3, smell: 18, most: 2, loot: { meat: 3 }, ground: [Block.Grass, Block.Dirt], when: 'night' },
  goat: { label: 'wild goat', speed: 4.2, hp: 2, smell: 0, most: 4, loot: { meat: 2, hides: 1 }, ground: [Block.Grass], when: 'day', herd: [2, 4], shy: 8, upland: 4 },
};

export interface Creature {
  id: number;
  kind: CreatureKind;
  walker: Walker;
  hp: number;
  /** Where it's heading: a crop, or somewhere to nose about. */
  target: { x: number; z: number } | null;
  /** Seconds spent at a crop; it's spoilt when this runs out. */
  eating: number;
  /** Seconds left running away (from the captain, or from firelight). */
  fleeing: number;
  flee: { x: number; z: number };
  /** Seconds until it next decides what to do. */
  think: number;
  /** Whether the captain has been told what it's up to (once is enough). */
  told?: boolean;
}

/** Creatures come out within this ring around the captain, and slink off beyond the outer edge. */
const SPAWN_NEAR = 14;
const SPAWN_FAR = 34;
/** Places tried each time something might come out (small islets are mostly sea). */
const SPAWN_TRIES = 8;
const GONE_BEYOND = 70;
const SPAWN_EVERY = 3;
/** They won't go within this of a lit torch or fire. */
export const LIGHT_RADIUS = 6;
/** Seconds of feeding to spoil a crop. */
const EAT_SECONDS = 2.5;
const THINK_SECONDS = 0.5;
/** Animals climb only a single voxel. */
const CLIMB = 1;
const TOOL_DAMAGE: Record<Tool, number> = { axe: 2, pickaxe: 2, hoe: 1 };

/** The world as a beast sees it: a fence is too high to get over. */
export function fenced(world: VoxelWorld): VoxelReader {
  return {
    getVoxel: (x, y, z) => {
      const id = world.getVoxel(x, y, z);
      return id === Block.Air && world.getVoxel(x, y - 1, z) === Block.Fence ? Block.Fence : id;
    },
  };
}

/**
 * One step of the wildlife around the captain. By night crabs and boar come out of the
 * dark for crops that aren't fenced in or lit, and slink off at dawn. By day wild goats
 * graze the uplands in herds, and are gone by nightfall.
 */
export function stepCreatures(land: Land, dt: number, random: () => number): void {
  const w = land.walker;
  const night = darkness(land.sea.clock.phase) > 0.6;
  const list = land.creatures;
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i];
    const far = !w || Math.hypot(c.walker.x - w.x, c.walker.z - w.z) > GONE_BEYOND;
    const itsTime = (CREATURES[c.kind].when === 'night') === night;
    if (far || (!itsTime && c.fleeing <= 0)) list.splice(i, 1);
  }
  if (!w) return;

  land.spawnIn -= dt;
  if (land.spawnIn <= 0) {
    land.spawnIn = SPAWN_EVERY;
    if (night) spawn(land, w, random);
    else spawnHerd(land, w, random);
  }
  const reader = fenced(land.world);
  const lights = land.lights();
  for (const c of list) stepCreature(land, c, dt, reader, lights, random);
}

function newCreature(land: Land, kind: CreatureKind, x: number, y: number, z: number, random: () => number): Creature {
  return { id: land.nextCreature++, kind, walker: createWalker(x, y, z, random() * Math.PI * 2), hp: CREATURES[kind].hp, target: null, eating: 0, fleeing: 0, flee: { x: 0, z: 0 }, think: 0 };
}

function spawn(land: Land, w: Walker, random: () => number): void {
  const kind: CreatureKind = random() < 0.6 ? 'crab' : 'boar';
  const spec = CREATURES[kind];
  if (land.creatures.filter((c) => c.kind === kind).length >= spec.most) return;
  for (let i = 0; i < SPAWN_TRIES; i++) {
    const angle = random() * Math.PI * 2;
    const distance = SPAWN_NEAR + random() * (SPAWN_FAR - SPAWN_NEAR);
    const x = Math.floor(w.x + Math.sin(angle) * distance) + 0.5;
    const z = Math.floor(w.z + Math.cos(angle) * distance) + 0.5;
    if (land.inTown(x, z)) continue;
    const y = standable(land.world, x, z, groundHeight(land.world, Math.floor(x), Math.floor(z)) + 1);
    if (y === null || !spec.ground.includes(land.world.getVoxel(Math.floor(x), y - 1, Math.floor(z)))) continue;
    if (land.lights().some((l) => Math.hypot(l.x - x, l.z - z) < LIGHT_RADIUS * 1.5)) continue;
    return void land.creatures.push(newCreature(land, kind, x, y, z, random));
  }
}

/** A herd of goats comes over the brow of a hill, somewhere out of sight of the captain. */
function spawnHerd(land: Land, w: Walker, random: () => number): void {
  const spec = CREATURES.goat;
  const [least, most] = spec.herd!;
  const have = land.creatures.filter((c) => c.kind === 'goat').length;
  if (spec.most - have < least) return;
  const lights = land.lights();
  for (let i = 0; i < SPAWN_TRIES; i++) {
    const angle = random() * Math.PI * 2;
    const distance = SPAWN_NEAR + random() * (SPAWN_FAR - SPAWN_NEAR);
    const cx = Math.floor(w.x + Math.sin(angle) * distance) + 0.5;
    const cz = Math.floor(w.z + Math.cos(angle) * distance) + 0.5;
    if (grazing(land, cx, cz, lights) === null) continue;
    const size = Math.min(least + Math.floor(random() * (most - least + 1)), spec.most - have);
    for (let n = 0; n < size; n++) {
      const x = Math.floor(cx + (random() - 0.5) * 4) + 0.5;
      const z = Math.floor(cz + (random() - 0.5) * 4) + 0.5;
      const y = grazing(land, x, z, lights);
      if (y !== null) land.creatures.push(newCreature(land, 'goat', x, y, z, random));
    }
    return;
  }
}

/** Where feet would come to rest at this point, or null off any standable ground. */
function footing(land: Land, x: number, z: number): number | null {
  return standable(land.world, x, z, groundHeight(land.world, Math.floor(x), Math.floor(z)) + 1);
}

/** This point's footing, if it's at least `upland` above the sea; null off that ground, or too low off it. */
function uplandFooting(land: Land, x: number, z: number, upland: number): number | null {
  const y = footing(land, x, z);
  return y !== null && y - 1 >= SEA_LEVEL + upland ? y : null;
}

/** Where a goat can graze: upland grass, off town and camp land, out of firelight. Its footing's height, or null. */
function grazing(land: Land, x: number, z: number, lights: ReadonlyArray<{ x: number; z: number }>): number | null {
  if (land.inTown(x, z) || land.claimed(x, z)) return null;
  if (lights.some((l) => Math.hypot(l.x - x, l.z - z) < LIGHT_RADIUS * 3)) return null;
  const y = uplandFooting(land, x, z, CREATURES.goat.upland!);
  return y !== null && land.world.getVoxel(Math.floor(x), y - 1, Math.floor(z)) === Block.Grass ? y : null;
}

function stepCreature(land: Land, c: Creature, dt: number, reader: VoxelReader, lights: ReadonlyArray<{ x: number; z: number }>, random: () => number): void {
  const spec = CREATURES[c.kind];
  const w = c.walker;
  const pace = spec.when === 'day' ? spec.speed * 0.25 : spec.speed;
  c.think -= dt;
  if (c.fleeing > 0) {
    c.fleeing -= dt;
    const dx = w.x - c.flee.x;
    const dz = w.z - c.flee.z;
    const d = Math.hypot(dx, dz) || 1;
    const [fx, fz] = uplandFlee(land, w, dx / d, dz / d, spec.upland);
    stepWalker(w, fx, fz, reader, dt, spec.speed * 1.4, CLIMB);
    keepUp(land, w, spec.upland);
    return;
  }
  if (c.think <= 0) {
    c.think = THINK_SECONDS;
    const captain = land.walker;
    if (spec.shy && captain && Math.hypot(captain.x - w.x, captain.z - w.z) < spec.shy) {
      // One sees you, and the herd goes with it.
      for (const o of land.creatures) if (o.kind === c.kind && Math.hypot(o.walker.x - w.x, o.walker.z - w.z) < 8) scare(o, captain.x, captain.z, 5);
      return;
    }
    const light = lights.find((l) => Math.hypot(l.x - w.x, l.z - w.z) < LIGHT_RADIUS);
    if (light) return scare(c, light.x, light.z, 2.5);
    const crop = nearestCrop(land, c, spec.smell, lights);
    c.target = crop ? { x: crop.x + 0.5, z: crop.z + 0.5 } : c.target && random() < 0.8 ? c.target : wander(land, w, spec.upland, lights, random);
  }
  const t = c.target;
  if (!t) return stepWalker(w, 0, 0, reader, dt, spec.speed, CLIMB);
  const dx = t.x - w.x;
  const dz = t.z - w.z;
  const d = Math.hypot(dx, dz);
  const crop = land.cropAt(Math.floor(t.x), Math.floor(t.z));
  if (d < 0.8 && crop) {
    stepWalker(w, 0, 0, reader, dt, spec.speed, CLIMB);
    c.eating += dt;
    if (c.eating >= EAT_SECONDS) {
      c.eating = 0;
      land.spoilCrop(crop, c);
      scare(c, t.x, t.z, 3); // off into the dark with it
    }
    return;
  }
  c.eating = 0;
  if (d < 0.5) {
    c.target = null;
    return stepWalker(w, 0, 0, reader, dt, spec.speed, CLIMB);
  }
  stepWalker(w, dx / d, dz / d, reader, dt, pace, CLIMB);
  if (keepUp(land, w, spec.upland)) c.target = null; // held at the drop: it grazes somewhere else
}

/**
 * Upland game never steps off its upland: a step from upland ground to a spot below it is
 * undone, so it stands at the drop instead (a look ahead alone misses a gully in between,
 * or a brow that runs aslant). True if the step was undone.
 */
function keepUp(land: Land, w: Walker, upland: number | undefined): boolean {
  if (upland === undefined || uplandFooting(land, w.x, w.z, upland) !== null || uplandFooting(land, w.prev.x, w.prev.z, upland) === null) return false;
  Object.assign(w, { x: w.prev.x, y: w.prev.y, z: w.prev.z, vx: 0, vy: 0, vz: 0 });
  return true;
}

/** The nearest crop worth eating that isn't lit up by a torch. */
function nearestCrop(land: Land, c: Creature, smell: number, lights: ReadonlyArray<{ x: number; z: number }>): Crop | undefined {
  const w = c.walker;
  let best: Crop | undefined;
  let bestDistance = smell;
  for (const crop of land.crops) {
    const d = Math.hypot(crop.x + 0.5 - w.x, crop.z + 0.5 - w.z);
    if (d >= bestDistance || stageOf(crop, land.sea.time) === 0) continue;
    if (lights.some((l) => Math.hypot(l.x - crop.x - 0.5, l.z - crop.z - 0.5) < LIGHT_RADIUS)) continue;
    best = crop;
    bestDistance = d;
  }
  return best;
}

function wanderFrom(w: Walker, random: () => number): { x: number; z: number } {
  const angle = random() * Math.PI * 2;
  return { x: w.x + Math.sin(angle) * 6, z: w.z + Math.cos(angle) * 6 };
}

/** Somewhere to wander to: anywhere, or — for upland game — somewhere grazeable it can actually climb to. */
function wander(land: Land, w: Walker, upland: number | undefined, lights: ReadonlyArray<{ x: number; z: number }>, random: () => number): { x: number; z: number } {
  if (upland === undefined) return wanderFrom(w, random);
  const here = footing(land, w.x, w.z) ?? w.y;
  for (let i = 0; i < SPAWN_TRIES; i++) {
    const p = wanderFrom(w, random);
    const there = grazing(land, p.x, p.z, lights);
    if (there !== null && there - here <= CLIMB) return p;
  }
  return { x: w.x, z: w.z };
}

/**
 * A fleeing direction that doesn't carry upland game off the edge: it veers along the
 * brow if the way ahead drops away, or stands its ground at the drop if neither side does.
 */
function uplandFlee(land: Land, w: Walker, dx: number, dz: number, upland: number | undefined): readonly [number, number] {
  if (upland === undefined) return [dx, dz];
  const ahead = 1.5;
  for (const [fx, fz] of [[dx, dz], [-dz, dx], [dz, -dx]] as const) {
    if (uplandFooting(land, w.x + fx * ahead, w.z + fz * ahead, upland) !== null) return [fx, fz];
  }
  return [0, 0];
}

export function scare(c: Creature, fromX: number, fromZ: number, seconds: number): void {
  c.fleeing = seconds;
  c.flee = { x: fromX, z: fromZ };
  c.target = null;
  c.eating = 0;
}

/**
 * Something hurts a creature (a blow, a shot): it bolts, and enough brings it down.
 * Returns what it gives, if it's down.
 */
export function harm(c: Creature, damage: number, fromX: number, fromZ: number): Cargo | null {
  c.hp -= damage;
  scare(c, fromX, fromZ, 4);
  return c.hp > 0 ? null : { ...CREATURES[c.kind].loot };
}

/** The captain takes a swing at a creature with a tool. */
export function strike(c: Creature, tool: Tool, fromX: number, fromZ: number): Cargo | null {
  return harm(c, TOOL_DAMAGE[tool], fromX, fromZ);
}
