import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../config';
import { Block } from '../voxel/blocks';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { buildArchipelago, planArchipelago, type IslandPlan } from './archipelago';
import { placeBanditCamps } from './bandits';
import { placeDeposits } from './deposits';

/** The game's own `TOWN_RADIUS` (`land/Land.ts`), kept local so this test doesn't pull in the whole Land module. */
const TOWN_RADIUS = 80;
/** How far out an island lies, the way `combat/encounters.ts`'s `regionTier` reckons it. */
const regionTier = (x: number, z: number): 0 | 1 | 2 => {
  const d = Math.hypot(x, z);
  return d < 700 ? 0 : d < 1500 ? 1 : 2;
};

const TOP = SEA_LEVEL + 4;
/** A flat grassy disc of an island with a sandy rim. */
function disc(world: VoxelWorld, cx: number, cz: number, radius: number): void {
  for (let x = cx - radius; x <= cx + radius; x++) {
    for (let z = cz - radius; z <= cz + radius; z++) {
      const d = Math.hypot(x - cx, z - cz);
      if (d > radius) continue;
      const top = d > radius - 3 ? SEA_LEVEL + 1 : TOP;
      for (let y = 0; y <= top; y++) world.setVoxel(x, y, z, y === top ? (d > radius - 3 ? Block.Sand : Block.Grass) : Block.Dirt);
    }
  }
}

const plan = (i: number, x: number, extra: Partial<IslandPlan> = {}): IslandPlan => ({ seed: 100 + i, centerX: x, centerZ: 0, radius: 20, peak: 4, port: null, ...extra });

/** A port island, a cursed isle, and six wild islets in a row. */
function archipelago() {
  const world = new VoxelWorld();
  const islands = [
    plan(0, 0, { port: { name: 'Haven', faction: 'merchant' } }),
    plan(1, 100, { cursed: true }),
    ...[2, 3, 4, 5, 6, 7].map((i) => plan(i, i * 100)),
  ];
  for (const island of islands) disc(world, island.centerX, 0, island.radius);
  return { world, islands };
}
const tierOf = (x: number): 0 | 1 | 2 => (x < 400 ? 0 : x < 600 ? 1 : 2);

describe('bandit camps', () => {
  it('hold about a third of the wild islets, never a port’s island or a cursed isle', () => {
    const { world, islands } = archipelago();
    const camps = placeBanditCamps(world, islands, 1717, tierOf, () => false);
    expect(camps).toHaveLength(2);
    for (const c of camps) {
      expect(islands[c.id].port).toBeNull();
      expect(islands[c.id].cursed).toBeFalsy();
      expect(Math.hypot(c.x - c.islandX, c.z - c.islandZ)).toBeLessThan(c.islandRadius);
    }
  });

  it('are built from blocks: a fire, a lean-to, a chest', () => {
    const { world, islands } = archipelago();
    for (const c of placeBanditCamps(world, islands, 1717, tierOf, () => false)) {
      expect(world.getVoxel(c.x, c.y, c.z)).toBe(Block.Embers);
      expect(world.getVoxel(c.chest.x, c.chest.y, c.chest.z)).toBe(Block.Chest);
      let planks = 0;
      for (let x = c.x - 4; x <= c.x + 4; x++) for (let z = c.z - 4; z <= c.z + 4; z++) for (let y = c.y - 1; y <= c.y + 4; y++) if (world.getVoxel(x, y, z) === Block.Planks) planks++;
      expect(planks).toBeGreaterThanOrEqual(6);
    }
  });

  it('are more, and hold more bandits, further from Haven', () => {
    const { world, islands } = archipelago();
    for (const c of placeBanditCamps(world, islands, 1717, tierOf, () => false)) {
      expect(c.tier).toBe(tierOf(c.islandX));
      expect(c.size).toBe(2 + c.tier);
    }
  });

  it('come out the same from the same seed', () => {
    const a = placeBanditCamps(archipelago().world, archipelago().islands, 1717, tierOf, () => false);
    const b = placeBanditCamps(archipelago().world, archipelago().islands, 1717, tierOf, () => false);
    expect(a).toEqual(b);
  });

  it('keep clear of what they’re told to avoid', () => {
    const { world, islands } = archipelago();
    expect(placeBanditCamps(world, islands, 1717, tierOf, () => true)).toEqual([]);
  });

  it('on the real archipelago, with the game’s own avoid, hold some wild islets and leave outcrops alone', () => {
    const world = new VoxelWorld();
    const islands = planArchipelago(1717);
    const ports = buildArchipelago(world, islands);
    // The same avoid the game builds in Game.ts: clear of town land, and of the outcrops
    // placeDeposits puts down first. An islet with no clearing left under that is skipped
    // for the next in hash2 order (see placeBanditCamps), so the ≥3 bar still has to hold.
    const inTown = (x: number, z: number) => ports.some((p) => Math.hypot(p.x - x, p.z - z) < TOWN_RADIUS + 8);
    const deposits = placeDeposits(world, islands, 1717, regionTier, inTown);
    const nearOutcrop = (x: number, z: number) => deposits.some((d) => Math.abs(d.x + 1 - x) <= 3 && Math.abs(d.z + 1 - z) <= 3);
    const camps = placeBanditCamps(world, islands, 1717, regionTier, (x, z) => inTown(x, z) || nearOutcrop(x, z));
    expect(camps.length).toBeGreaterThanOrEqual(3);
    for (const c of camps) expect(islands[c.id].port === null && !islands[c.id].cursed).toBe(true);
  }, 20_000);

  it('sits every post, back plank, bedroll, chest and keg on solid ground, none of it buried', () => {
    for (const seed of [1717, 2, 3, 5, 16, 21, 28, 30]) {
      const world = new VoxelWorld();
      const islands = planArchipelago(seed);
      buildArchipelago(world, islands);
      for (const c of placeBanditCamps(world, islands, seed, regionTier, () => false)) {
        // The lean-to's shared floor: read back off the post that's always placed on it.
        let base = -1;
        for (let y = SEA_LEVEL - 8; y < SEA_LEVEL + 80; y++) {
          if (world.getVoxel(c.x - 3, y, c.z + 2) === Block.Wood) {
            base = y;
            break;
          }
        }
        expect(base).toBeGreaterThan(-1);
        const pieces: ReadonlyArray<readonly [number, number, number, number]> = [
          [c.x - 3, base, c.z + 2, Block.Wood], // post, open side
          [c.x - 1, base, c.z + 2, Block.Wood], // post, open side
          [c.x - 3, base, c.z + 4, Block.Planks], // back plank
          [c.x - 2, base, c.z + 4, Block.Planks], // back plank
          [c.x - 1, base, c.z + 4, Block.Planks], // back plank
          [c.x - 2, base, c.z + 3, Block.Canvas], // bedroll
          [c.chest.x, c.chest.y, c.chest.z, Block.Chest],
        ];
        for (const [px, py, pz, expected] of pieces) {
          expect(world.getVoxel(px, py, pz)).toBe(expected); // the piece itself, not buried under terrain
          expect(world.getVoxel(px, py - 1, pz)).not.toBe(Block.Air); // solid ground directly under it
        }
        let kegY = -1;
        for (let y = SEA_LEVEL - 8; y < SEA_LEVEL + 80; y++) {
          if (world.getVoxel(c.x + 2, y, c.z + 3) === Block.Barrel) {
            kegY = y;
            break;
          }
        }
        expect(kegY).toBeGreaterThan(-1);
        expect(world.getVoxel(c.x + 2, kegY - 1, c.z + 3)).not.toBe(Block.Air);
      }
    }
  }, 20_000);

  it('fells a whole tree, not just the part of it standing in the window cleared for the camp', () => {
    const bigIslets = (): { world: VoxelWorld; islands: IslandPlan[] } => {
      const world = new VoxelWorld();
      const islands = [0, 1, 2].map((i) => plan(i, i * 200, { radius: 60 }));
      for (const island of islands) disc(world, island.centerX, 0, island.radius);
      return { world, islands };
    };
    const tierOf60 = (): 0 | 1 | 2 => 0;
    // Learn where the one camp (wanted = round(3 / 3) = 1) lands: planting nothing here
    // yet, since the ground under it is all that picks the spot, not what stands on it.
    const dry = bigIslets();
    const [first] = placeBanditCamps(dry.world, dry.islands, 1717, tierOf60, () => false);
    expect(first).toBeTruthy();

    const { world, islands } = bigIslets();
    // A tree's trunk and canopy, as a straight chain of blocks straddling the edge of the
    // window a camp clears (checked dx ∈ [-4, 3], dz ∈ [-2, 6]): one cell inside it, two
    // more face-connected cells outside, as a real canopy can reach past a felled trunk.
    const tx = first.x - 4;
    const tz = first.z - 2;
    world.setVoxel(tx, TOP, tz, Block.Wood);
    world.setVoxel(tx - 1, TOP, tz, Block.Wood);
    world.setVoxel(tx - 2, TOP, tz, Block.Leaves);

    const camps = placeBanditCamps(world, islands, 1717, tierOf60, () => false);
    expect(camps).toHaveLength(1);
    expect(camps[0].x).toBe(first.x);
    expect(camps[0].z).toBe(first.z);
    expect(world.getVoxel(tx, TOP, tz)).toBe(Block.Air);
    expect(world.getVoxel(tx - 1, TOP, tz)).toBe(Block.Air); // outside the window: left floating by a felled-trunk-only clearing
    expect(world.getVoxel(tx - 2, TOP, tz)).toBe(Block.Air); // further outside still, same whole tree
  });
});
