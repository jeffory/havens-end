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
/** A felled tree's connected blocks (trunk and canopy) won't grow past this many, however it's tangled with its neighbours. */
const FELL_LIMIT = 300;

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
  const rank = [...wild].sort((a, b) => hash2(a.plan.seed, 23, seed) - hash2(b.plan.seed, 23, seed));
  const wanted = Math.round(wild.length * SHARE);
  const camps: BanditCamp[] = [];
  // Still hash2-ranked and deterministic: an islet with no clearing (town, outcrops, or
  // just no level ground to be had) is skipped for the next in rank, not left short.
  for (const { plan, index } of rank) {
    if (camps.length >= wanted) break;
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
  camps.sort((a, b) => a.id - b.id);
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
  // Its whole footprint is levelled to one height first, so a post never hangs over a dip
  // nor a back plank sits buried in a rise: the ground it's checked against is only the
  // core round the fire, not this far out.
  const base = at(x - 2, z + 3);
  levelFootprint(world, x, z, base);
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

/** Forces the lean-to's footprint level with `base`: fills what's low with stone, clears what's high. */
function levelFootprint(world: VoxelWorld, x: number, z: number, base: number): void {
  for (let dx = -3; dx <= -1; dx++) {
    for (let dz = 2; dz <= 4; dz++) {
      const cx = x + dx;
      const cz = z + dz;
      const ground = groundHeight(world, cx, cz);
      if (ground < base) for (let y = ground; y < base; y++) world.setVoxel(cx, y, cz, Block.Stone);
      else for (let y = base; y < ground; y++) world.setVoxel(cx, y, cz, Block.Air);
    }
  }
}

/**
 * Fells whatever stands over the camp's plot (and a little round it), so none of it rises
 * through the new roof: the whole of each tree found there, trunk and canopy together
 * (touching at a face, an edge or a corner, as a leaning palm's fronds droop), not just
 * the part that happened to stand in the window — so no canopy is left hanging where its
 * trunk was cut. Run before anything is built, so it never fells the camp's own posts.
 */
function clearTrees(world: VoxelWorld, x: number, z: number): void {
  for (let dx = -4; dx <= 3; dx++) {
    for (let dz = -2; dz <= 6; dz++) {
      const cx = x + dx;
      const cz = z + dz;
      const top = groundHeight(world, cx, cz);
      for (let y = top; y < top + 14; y++) if (TREE_BLOCKS.has(world.getVoxel(cx, y, cz))) fellWholeTree(world, cx, y, cz);
    }
  }
}

/** Clears every tree block connected to (x, y, z), flooding out through face, edge and corner neighbours. */
function fellWholeTree(world: VoxelWorld, x: number, y: number, z: number): void {
  const stack: Array<[number, number, number]> = [[x, y, z]];
  world.setVoxel(x, y, z, Block.Air);
  let cleared = 1;
  while (stack.length > 0 && cleared < FELL_LIMIT) {
    const [cx, cy, cz] = stack.pop()!;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          const nz = cz + dz;
          if (!TREE_BLOCKS.has(world.getVoxel(nx, ny, nz))) continue;
          world.setVoxel(nx, ny, nz, Block.Air);
          cleared++;
          stack.push([nx, ny, nz]);
        }
      }
    }
  }
}
