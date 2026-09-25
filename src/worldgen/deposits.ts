import { SEA_LEVEL } from '../config';
import { hash3 } from '../util/hash';
import { type Deposit, type DepositKind, DEPOSITS } from '../land/deposits';
import { Block, type BlockId } from '../voxel/blocks';
import type { VoxelWorld } from '../voxel/VoxelWorld';
import type { IslandPlan } from './archipelago';
import { groundHeight, TREE_BLOCKS } from './buildings';
import { mulberry32 } from './noise';

/** An island gets an outcrop for about every this many square voxels of it. */
const AREA_PER_DEPOSIT = 700;
/** Outcrops keep at least this far apart (either way). */
const SPACING = 7;
/** Spots tried per outcrop wanted. */
const TRIES = 60;
/** How many blocks of an ore outcrop show ore (the rest are boulder). */
const ORE_SHARE = 0.4;
/** The mix of kinds by region: home waters, contested waters, Imperial waters. */
const MIX: Record<0 | 1 | 2, Record<DepositKind, number>> = {
  0: { stone: 0.55, iron: 0.25, copper: 0.2, silver: 0, gold: 0 },
  1: { stone: 0.45, iron: 0.2, copper: 0.2, silver: 0.12, gold: 0.03 },
  2: { stone: 0.4, iron: 0.15, copper: 0.15, silver: 0.18, gold: 0.12 },
};

/** Outcrops are numbered by island: island i's are i × this + 1, + 2, … */
const PER_ISLAND = 1000;

/**
 * Raises the islands' outcrops of stone and ore, and returns them. Deterministic in
 * `seed` and the world as generated: run it after the archipelago is built and before
 * the world starts tracking edits. `tierOf` says how far out an island lies (it picks
 * the mix); `avoid` rules spots out (town land).
 *
 * Each island draws its spots from numbers of its own and numbers its outcrops for
 * itself, so a change to one island leaves every other island's outcrops (and a save's
 * record of them) where they were. Kinds are dealt out per region, so its outcrops
 * follow its mix however few each island has.
 */
export function placeDeposits(
  world: VoxelWorld,
  islands: readonly IslandPlan[],
  seed: number,
  tierOf: (x: number, z: number) => 0 | 1 | 2,
  avoid: (x: number, z: number) => boolean,
): Deposit[] {
  const dealers = new Map<0 | 1 | 2, Dealer>();
  const out: Deposit[] = [];
  islands.forEach((plan, index) => {
    const random = mulberry32((seed ^ 0xde90 ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);
    const tier = tierOf(plan.centerX, plan.centerZ);
    const dealer = dealers.get(tier) ?? dealers.set(tier, new Dealer(MIX[tier])).get(tier)!;
    const wanted = Math.max(1, Math.round((Math.PI * plan.radius ** 2) / AREA_PER_DEPOSIT));
    let placed = 0;
    for (let attempt = 0; attempt < wanted * TRIES && placed < wanted; attempt++) {
      const angle = random() * Math.PI * 2;
      const r = Math.sqrt(random()) * plan.radius * 0.85;
      const x = Math.round(plan.centerX + Math.sin(angle) * r);
      const z = Math.round(plan.centerZ + Math.cos(angle) * r);
      if (avoid(x, z) || out.some((d) => Math.max(Math.abs(d.x - x), Math.abs(d.z - z)) < SPACING) || !footing(world, x, z)) continue;
      placed++;
      out.push(raise(world, index * PER_ISLAND + placed, dealer.next(), x, z, random));
    }
  });
  return out;
}

/**
 * Deals kinds in proportion to a mix: each next one is whichever kind is furthest
 * behind its share of those dealt so far. The shares never stray a whole outcrop from
 * the mix, which rolling each at random can't promise over a handful.
 */
class Dealer {
  private readonly dealt = new Map<DepositKind, number>();
  private count = 0;

  constructor(private readonly mix: Record<DepositKind, number>) {}

  next(): DepositKind {
    const kinds = Object.keys(this.mix) as DepositKind[];
    const total = kinds.reduce((n, k) => n + this.mix[k], 0);
    let best = kinds[0];
    let behind = -Infinity;
    for (const k of kinds) {
      const owed = ((this.count + 1) * this.mix[k]) / total - (this.dealt.get(k) ?? 0);
      if (owed > behind) {
        best = k;
        behind = owed;
      }
    }
    this.dealt.set(best, (this.dealt.get(best) ?? 0) + 1);
    this.count++;
    return best;
  }
}

/**
 * Can an outcrop stand at (x, z) (its 2 × 2 footprint)? Dry grass, earth or rock, near
 * level, no tree on or beside it, and not in a hollow (sunk level with the ground about
 * it, it would look like paving).
 */
function footing(world: VoxelWorld, x: number, z: number): boolean {
  let lo = Infinity;
  let hi = -Infinity;
  let around = -Infinity;
  for (let dx = -1; dx <= 2; dx++) {
    for (let dz = -1; dz <= 2; dz++) {
      const top = groundHeight(world, x + dx, z + dz);
      for (let y = top; y < top + 8; y++) if (TREE_BLOCKS.has(world.getVoxel(x + dx, y, z + dz))) return false;
      if (dx < 0 || dx > 1 || dz < 0 || dz > 1) {
        around = Math.max(around, top);
        continue;
      }
      const ground = world.getVoxel(x + dx, top - 1, z + dz);
      if (top < SEA_LEVEL + 3 || world.getVoxel(x + dx, top, z + dz) !== Block.Air) return false;
      if (ground !== Block.Grass && ground !== Block.Dirt && ground !== Block.Stone) return false;
      lo = Math.min(lo, top);
      hi = Math.max(hi, top);
    }
  }
  return hi - lo <= 1 && around <= hi;
}

/** Builds an outcrop into the world: three or four blocks on the ground, sometimes one on top. */
function raise(world: VoxelWorld, id: number, kind: DepositKind, x: number, z: number, random: () => number): Deposit {
  const ore = DEPOSITS[kind].ore;
  const columns: Array<[number, number]> = [[0, 0], [1, 0], [0, 1], [1, 1]];
  const dropped = random() < 0.3 ? Math.floor(random() * 4) : -1;
  const cells: Array<[number, number, number, BlockId]> = [];
  columns.forEach(([dx, dz], i) => {
    if (i !== dropped) cells.push([x + dx, groundHeight(world, x + dx, z + dz), z + dz, ore]);
  });
  if (random() < 0.7) {
    const [cx, cy, cz] = cells[Math.floor(random() * cells.length)];
    cells.push([cx, cy + 1, cz, ore]);
  }
  // Ore shows in some of an ore outcrop's blocks, always its last (the top, when it has
  // one). Chosen by place, not by drawing a number, so the kind never shifts later draws.
  cells.forEach((c, i) => {
    if (kind !== 'stone' && i < cells.length - 1 && hash3(c[0], c[1], c[2]) >= ORE_SHARE) c[3] = Block.Boulder;
  });
  for (const [cx, cy, cz, block] of cells) world.setVoxel(cx, cy, cz, block);
  return { id, kind, x, z, cells };
}
