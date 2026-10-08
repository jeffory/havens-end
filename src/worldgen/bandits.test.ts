import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../config';
import { Block } from '../voxel/blocks';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { buildArchipelago, planArchipelago, type IslandPlan } from './archipelago';
import { placeBanditCamps } from './bandits';

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

  it('on the real archipelago, hold some wild islets and leave outcrops alone', () => {
    const world = new VoxelWorld();
    const islands = planArchipelago(1717);
    buildArchipelago(world, islands);
    const camps = placeBanditCamps(world, islands, 1717, (x, z) => { const d = Math.hypot(x, z); return d < 700 ? 0 : d < 1500 ? 1 : 2; }, () => false);
    expect(camps.length).toBeGreaterThanOrEqual(3);
    for (const c of camps) expect(islands[c.id].port === null && !islands[c.id].cursed).toBe(true);
  }, 20_000);
});
