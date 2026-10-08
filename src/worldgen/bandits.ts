import { SEA_LEVEL } from '../config';
import { hash2 } from '../util/hash';
import { Block } from '../voxel/blocks';
import type { VoxelWorld } from '../voxel/VoxelWorld';
import type { IslandPlan } from './archipelago';
import { groundHeight, TREE_BLOCKS } from './buildings';
import { mulberry32 } from './noise';

/** A bandit camp as the world was made with it (its state as the game goes on is `land/bandits.ts`). */
export interface BanditCamp {
  /** The islet's index in the archipelago plan. */
  id: number;
  /** The middle of its fire, and the height of the ground there (the embers' cell). */
  x: number;
  y: number;
  z: number;
  /** The islet it holds. */
  islandX: number;
  islandZ: number;
  islandRadius: number;
  /** How far out it is: 0 home waters, 1 contested, 2 Imperial. More bandits, and better loot, further out. */
  tier: 0 | 1 | 2;
  /** How many bandits hold it. */
  size: number;
  chest: { x: number; y: number; z: number };
}

/** About a third of the wild islets are held. */
const SHARE = 1 / 3;
/**
 * A camp's footprint reaches this far each way from its fire: far enough to clear `avoid`
 * (town land, outcrops) all round the lean-to and the chest and keg beside it.
 */
const HALF = 4;
/**
 * Level, dry ground is only demanded this close to the fire, not over the whole footprint:
 * a wild islet is rarely bare for a stretch wide enough to hold a whole camp under its
 * canopy, so the lean-to's corners settle for whatever the ground there gives them, and
 * any tree in the way is felled as the camp goes up rather than ruled out beforehand.
 */
const CORE = 2;
/** The ground within the core may rise or fall this many voxels, not more. */
const TOLERANCE = 2;
const TRIES = 80;

/**
 * Places bandit camps on about a third of the wild islets (never a port's island, never a
 * cursed isle), and builds them: a fire ringed with stones, a plank lean-to on two posts
 * with a bedroll under it, a chest and a keg. Each on level dry ground clear of whatever
 * `avoid` says (town land, outcrops); trees are cleared away as a camp goes up, not
 * demanded of the ground beforehand. Deterministic in `seed`, and drawing nothing from
 * any other stream.
 */
export function placeBanditCamps(world: VoxelWorld, islands: readonly IslandPlan[], seed: number, tierOf: (x: number, z: number) => 0 | 1 | 2, avoid: (x: number, z: number) => boolean): BanditCamp[] {
  const wild = islands.map((plan, index) => ({ plan, index })).filter(({ plan }) => !plan.port && !plan.cursed);
  const held = [...wild].sort((a, b) => hash2(a.plan.seed, 23, seed) - hash2(b.plan.seed, 23, seed)).slice(0, Math.round(wild.length * SHARE));
  held.sort((a, b) => a.index - b.index);
  const camps: BanditCamp[] = [];
  for (const { plan, index } of held) {
    const random = mulberry32((seed ^ 0xba4d ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);
    for (let attempt = 0; attempt < TRIES; attempt++) {
      const angle = random() * Math.PI * 2;
      const r = Math.sqrt(random()) * plan.radius * 0.65;
      const x = Math.round(plan.centerX + Math.sin(angle) * r);
      const z = Math.round(plan.centerZ + Math.cos(angle) * r);
      const y = clearing(world, x, z, avoid);
      if (y === null) continue;
      const tier = tierOf(plan.centerX, plan.centerZ);
      const chest = raiseCamp(world, x, z);
      camps.push({ id: index, x, y, z, islandX: plan.centerX, islandZ: plan.centerZ, islandRadius: plan.radius, tier, size: 2 + tier, chest });
      break;
    }
  }
  return camps;
}

/** The ground height at (x, z) if its footprint clears `avoid` and its core is level and dry; else null. */
function clearing(world: VoxelWorld, x: number, z: number, avoid: (x: number, z: number) => boolean): number | null {
  for (let dx = -HALF; dx <= HALF; dx++) for (let dz = -HALF; dz <= HALF; dz++) if (avoid(x + dx, z + dz)) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (let dx = -CORE; dx <= CORE; dx++) {
    for (let dz = -CORE; dz <= CORE; dz++) {
      const top = groundHeight(world, x + dx, z + dz); // already ignores a tree standing on it
      if (top < SEA_LEVEL + 2) return null;
      lo = Math.min(lo, top);
      hi = Math.max(hi, top);
    }
  }
  return hi - lo <= TOLERANCE ? groundHeight(world, x, z) : null;
}

/** Builds a camp round its fire at (x, z) (each block's height is read off the ground as it's placed); returns where its chest stands. */
function raiseCamp(world: VoxelWorld, x: number, z: number): { x: number; y: number; z: number } {
  const at = (cx: number, cz: number) => groundHeight(world, cx, cz);
  clearTrees(world, x, z);
  // The fire: embers in a ring of stones.
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) world.setVoxel(x + dx, at(x + dx, z + dz), z + dz, dx === 0 && dz === 0 ? Block.Embers : (dx + dz) % 2 === 0 ? Block.Stone : Block.Air);
  }
  // The lean-to: two posts at its open front, its roof sloping down to the ground behind.
  const base = at(x - 2, z + 3);
  for (const px of [x - 3, x - 1]) for (let py = base; py < base + 2; py++) world.setVoxel(px, py, z + 2, Block.Wood);
  for (let px = x - 3; px <= x - 1; px++) {
    world.setVoxel(px, base + 2, z + 2, Block.Planks);
    world.setVoxel(px, base + 1, z + 3, Block.Planks);
    world.setVoxel(px, base, z + 4, Block.Planks);
  }
  world.setVoxel(x - 2, base, z + 3, Block.Canvas); // a bedroll
  const chest = { x: x + 2, y: at(x + 2, z + 2), z: z + 2 };
  world.setVoxel(chest.x, chest.y, chest.z, Block.Chest);
  world.setVoxel(x + 2, at(x + 2, z + 3), z + 3, Block.Barrel);
  return chest;
}

/** Fells whatever stands over the camp's plot (and a little round it), so none of it rises through the new roof. */
function clearTrees(world: VoxelWorld, x: number, z: number): void {
  for (let dx = -4; dx <= 3; dx++) {
    for (let dz = -2; dz <= 6; dz++) {
      const cx = x + dx;
      const cz = z + dz;
      const top = groundHeight(world, cx, cz);
      for (let y = top; y < top + 14; y++) if (TREE_BLOCKS.has(world.getVoxel(cx, y, cz))) world.setVoxel(cx, y, cz, Block.Air);
    }
  }
}
