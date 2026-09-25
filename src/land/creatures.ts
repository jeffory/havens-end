import { darkness } from '../core/clock';
import type { Good } from '../economy/goods';
import { Block } from '../voxel/blocks';
import type { VoxelReader } from '../voxel/raycast';
import type { VoxelWorld } from '../voxel/VoxelWorld';
import { groundHeight } from '../worldgen/buildings';
import { type Crop, stageOf } from './crops';
import type { Land, Tool } from './Land';
import { createWalker, standable, stepWalker, type Walker } from './walker';

export type CreatureKind = 'crab' | 'boar';

/** Night creatures: crabs up from the beach, boar out of the woods. Both are after your crops. */
export const CREATURES: Record<CreatureKind, { label: string; speed: number; hp: number; smell: number; most: number; loot: Good; amount: number; ground: number[] }> = {
  crab: { label: 'land crab', speed: 1.5, hp: 1, smell: 12, most: 4, loot: 'fish', amount: 1, ground: [Block.Sand] },
  boar: { label: 'wild boar', speed: 3.4, hp: 3, smell: 18, most: 2, loot: 'meat', amount: 3, ground: [Block.Grass, Block.Dirt] },
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
 * One step of the night's wildlife around the captain: new creatures come out of the
 * dark, go for crops that aren't fenced in or lit, and slink off at dawn.
 */
export function stepCreatures(land: Land, dt: number, random: () => number): void {
  const w = land.walker;
  const night = darkness(land.sea.clock.phase) > 0.6;
  const list = land.creatures;
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i];
    const far = !w || Math.hypot(c.walker.x - w.x, c.walker.z - w.z) > GONE_BEYOND;
    if (far || (!night && c.fleeing <= 0)) list.splice(i, 1);
  }
  if (!w || !night) return;

  land.spawnIn -= dt;
  if (land.spawnIn <= 0) {
    land.spawnIn = SPAWN_EVERY;
    spawn(land, w, random);
  }
  const reader = fenced(land.world);
  const lights = land.lights();
  for (const c of list) stepCreature(land, c, dt, reader, lights, random);
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
    return void land.creatures.push({
      id: land.nextCreature++,
      kind,
      walker: createWalker(x, y, z, random() * Math.PI * 2),
      hp: spec.hp,
      target: null,
      eating: 0,
      fleeing: 0,
      flee: { x: 0, z: 0 },
      think: 0,
    });
  }
}

function stepCreature(land: Land, c: Creature, dt: number, reader: VoxelReader, lights: ReadonlyArray<{ x: number; z: number }>, random: () => number): void {
  const spec = CREATURES[c.kind];
  const w = c.walker;
  c.think -= dt;
  if (c.fleeing > 0) {
    c.fleeing -= dt;
    const dx = w.x - c.flee.x;
    const dz = w.z - c.flee.z;
    const d = Math.hypot(dx, dz) || 1;
    stepWalker(w, dx / d, dz / d, reader, dt, spec.speed * 1.4, CLIMB);
    return;
  }
  if (c.think <= 0) {
    c.think = THINK_SECONDS;
    const light = lights.find((l) => Math.hypot(l.x - w.x, l.z - w.z) < LIGHT_RADIUS);
    if (light) return scare(c, light.x, light.z, 2.5);
    const crop = nearestCrop(land, c, spec.smell, lights);
    c.target = crop ? { x: crop.x + 0.5, z: crop.z + 0.5 } : c.target && random() < 0.8 ? c.target : wanderFrom(w, random);
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
  stepWalker(w, dx / d, dz / d, reader, dt, spec.speed, CLIMB);
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

export function scare(c: Creature, fromX: number, fromZ: number, seconds: number): void {
  c.fleeing = seconds;
  c.flee = { x: fromX, z: fromZ };
  c.target = null;
  c.eating = 0;
}

/**
 * The captain takes a swing at a creature: it bolts, and enough blows bring it down
 * (for its meat, or crab for the pot). Returns what was caught, if anything.
 */
export function strike(c: Creature, tool: Tool, fromX: number, fromZ: number): { good: Good; amount: number } | null {
  c.hp -= TOOL_DAMAGE[tool];
  scare(c, fromX, fromZ, 4);
  if (c.hp > 0) return null;
  const spec = CREATURES[c.kind];
  return { good: spec.loot, amount: spec.amount };
}
