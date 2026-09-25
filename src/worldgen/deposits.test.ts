import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../config';
import { Block } from '../voxel/blocks';
import { VoxelWorld } from '../voxel/VoxelWorld';
import type { IslandPlan } from './archipelago';
import { placeDeposits } from './deposits';

const TOP = SEA_LEVEL + 4;

/** A flat grassy disc of an island, a ring of beach round it, and whatever else the test adds. */
function island(radius = 40): { world: VoxelWorld; plan: IslandPlan } {
  const world = new VoxelWorld();
  for (let x = -radius - 4; x <= radius + 4; x++) {
    for (let z = -radius - 4; z <= radius + 4; z++) {
      const r = Math.hypot(x, z);
      if (r > radius + 4) continue;
      const beach = r > radius;
      const top = beach ? SEA_LEVEL + 1 : TOP;
      for (let y = 0; y < top; y++) world.setVoxel(x, y, z, y === top - 1 ? (beach ? Block.Sand : Block.Grass) : Block.Dirt);
    }
  }
  return { world, plan: { seed: 3, centerX: 0, centerZ: 0, radius, peak: 6, port: null } };
}

const home = () => 0 as const;
const far = () => 2 as const;
const nowhere = () => false;

describe('placing outcrops', () => {
  it('puts a few on an island, on open grass, apart, standing on the ground', () => {
    const { world, plan } = island();
    const deposits = placeDeposits(world, [plan], 1, home, nowhere);
    expect(deposits.length).toBeGreaterThanOrEqual(5);
    expect(deposits.map((d) => d.id)).toEqual(deposits.map((_, i) => i + 1)); // island 0: ids 1, 2, 3…
    for (const d of deposits) {
      expect(d.cells.length).toBeGreaterThanOrEqual(3);
      expect(d.cells.length).toBeLessThanOrEqual(5);
      for (const [x, y, z, block] of d.cells) {
        expect(world.getVoxel(x, y, z)).toBe(block);
        expect(Math.hypot(x, z)).toBeLessThan(plan.radius);
        const under = world.getVoxel(x, y - 1, z);
        expect([Block.Grass, block, ...d.cells.map((c) => c[3])]).toContain(under);
      }
      for (const o of deposits) if (o !== d) expect(Math.max(Math.abs(o.x - d.x), Math.abs(o.z - d.z))).toBeGreaterThanOrEqual(7);
    }
  });

  it('is the same every time for the same seed', () => {
    const a = placeDeposits(island().world, [island().plan], 5, home, nowhere);
    const b = placeDeposits(island().world, [island().plan], 5, home, nowhere);
    expect(a).toEqual(b);
  });

  it('keeps off the beach, out of where it’s told to avoid, and away from trees', () => {
    const { world, plan } = island();
    for (let y = TOP; y < TOP + 5; y++) world.setVoxel(10, y, 10, Block.Wood);
    world.setVoxel(10, TOP + 5, 10, Block.Leaves);
    const deposits = placeDeposits(world, [plan], 2, home, (x) => x < 0);
    for (const d of deposits) {
      expect(d.x).toBeGreaterThanOrEqual(0);
      for (const [x, y, z] of d.cells) {
        expect(world.getVoxel(x, y - 1, z)).not.toBe(Block.Sand);
        expect(Math.max(Math.abs(x - 10), Math.abs(z - 10))).toBeGreaterThan(1);
      }
    }
  });

  it('has no silver or gold in home waters, and some of both far out', () => {
    const kinds = (tierOf: () => 0 | 1 | 2) => {
      const found = new Set<string>();
      for (let seed = 1; seed <= 12; seed++) {
        const { world, plan } = island(60);
        for (const d of placeDeposits(world, [plan], seed, tierOf, nowhere)) found.add(d.kind);
      }
      return found;
    };
    const near = kinds(home);
    expect(near.has('silver') || near.has('gold')).toBe(false);
    expect(near.has('stone') && near.has('iron') && near.has('copper')).toBe(true);
    const out = kinds(far);
    expect(out.has('silver') && out.has('gold')).toBe(true);
  });

  it('stands out of the ground, never sunk in a hollow', () => {
    // Ground in 2 × 2 squares, every other one a block lower: plenty of hollows to sink into.
    const { world, plan } = island();
    for (let x = -40; x <= 40; x++) {
      for (let z = -40; z <= 40; z++) {
        if (Math.hypot(x, z) > 40 || (Math.floor(x / 2) + Math.floor(z / 2)) % 2 !== 0) continue;
        world.setVoxel(x, TOP - 1, z, Block.Air);
        world.setVoxel(x, TOP - 2, z, Block.Grass);
      }
    }
    const deposits = placeDeposits(world, [plan], 4, home, nowhere);
    expect(deposits.length).toBeGreaterThan(0);
    for (const d of deposits) {
      // The ground each column of it stands on (a block stacked on top doesn't count).
      const feet = new Map<string, number>();
      for (const [x, y, z] of d.cells) feet.set(`${x},${z}`, Math.min(y, feet.get(`${x},${z}`) ?? Infinity));
      const base = Math.max(...feet.values());
      for (let dx = -1; dx <= 2; dx++) {
        for (let dz = -1; dz <= 2; dz++) {
          if (dx >= 0 && dx <= 1 && dz >= 0 && dz <= 1) continue;
          expect(world.surfaceHeight(d.x + dx, d.z + dz)).toBeLessThanOrEqual(base);
        }
      }
    }
  });

  it('deals the kinds out so a region’s outcrops follow its mix, however few each island has', () => {
    // Twenty small islets, a couple of outcrops each: rolled one by one, the shares wander.
    const world = new VoxelWorld();
    const plans: IslandPlan[] = [];
    for (let i = 0; i < 20; i++) {
      const cx = i * 100;
      for (let x = cx - 16; x <= cx + 16; x++) {
        for (let z = -16; z <= 16; z++) {
          if (Math.hypot(x - cx, z) > 16) continue;
          for (let y = 0; y < TOP; y++) world.setVoxel(x, y, z, y === TOP - 1 ? Block.Grass : Block.Dirt);
        }
      }
      plans.push({ seed: i, centerX: cx, centerZ: 0, radius: 16, peak: 6, port: null });
    }
    const deposits = placeDeposits(world, plans, 3, far, nowhere);
    const n = deposits.length;
    expect(n).toBeGreaterThanOrEqual(20);
    const share = { stone: 0.4, iron: 0.15, copper: 0.15, silver: 0.18, gold: 0.12 };
    for (const [kind, w] of Object.entries(share)) {
      expect(Math.abs(deposits.filter((d) => d.kind === kind).length - n * w)).toBeLessThanOrEqual(1);
    }
  });

  it('numbers each island’s outcrops for itself, so changing one island leaves the others where they were', () => {
    const one = island();
    const two = island();
    const before = { ...one.plan, centerX: 300, radius: 20 };
    const changed = { ...before, radius: 30 };
    // A different island placed first must not move the outcrops of the island after it.
    const here = (list: ReturnType<typeof placeDeposits>) => list.filter((d) => Math.hypot(d.x, d.z) < 60).map((d) => [d.id, d.x, d.z, d.cells.map((c) => c.slice(0, 3))]);
    const a = placeDeposits(one.world, [before, one.plan], 6, home, nowhere);
    const b = placeDeposits(two.world, [changed, two.plan], 6, home, nowhere);
    expect(here(a).length).toBeGreaterThan(0);
    expect(here(a)).toEqual(here(b));
    expect(here(a).every(([id]) => (id as number) > 1000 && (id as number) < 2000)).toBe(true); // island 1's own numbers
  });

  it('shows ore in every ore outcrop, and a stone outcrop is all boulder', () => {
    const { world, plan } = island(60);
    for (const d of placeDeposits(world, [plan], 9, far, nowhere)) {
      const blocks = d.cells.map((c) => c[3]);
      if (d.kind === 'stone') expect(blocks.every((b) => b === Block.Boulder)).toBe(true);
      else expect(blocks.some((b) => b !== Block.Boulder)).toBe(true);
    }
  });
});
