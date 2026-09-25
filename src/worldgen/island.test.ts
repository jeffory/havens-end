import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../config';
import { Block } from '../voxel/blocks';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { generateIsland, type IslandParams } from './island';

const PARAMS: IslandParams = { seed: 1717, centerX: 0, centerZ: 0, radius: 40, peak: 16 };

function fingerprint(world: VoxelWorld): string {
  const parts: string[] = [];
  for (const c of world.allChunks()) {
    let sum = 0;
    for (let i = 0; i < c.data.length; i++) sum = (sum * 31 + c.data[i]) | 0;
    parts.push(`${c.cx},${c.cy},${c.cz}:${sum}`);
  }
  return parts.sort().join('|');
}

describe('generateIsland', () => {
  it('has no iron veins in the rock: iron comes from outcrops now', () => {
    const world = new VoxelWorld();
    generateIsland(world, { seed: 11, centerX: 0, centerZ: 0, radius: 40, peak: 20 });
    let iron = 0;
    for (let x = -64; x <= 64; x++) for (let z = -64; z <= 64; z++) for (let y = 0; y < 60; y++) if (world.getVoxel(x, y, z) === Block.IronOre) iron++;
    expect(iron).toBe(0);
  });

  it('is deterministic for a given seed', () => {
    const a = new VoxelWorld();
    const b = new VoxelWorld();
    generateIsland(a, PARAMS);
    generateIsland(b, PARAMS);
    expect(fingerprint(a)).toBe(fingerprint(b));

    const c = new VoxelWorld();
    generateIsland(c, { ...PARAMS, seed: 99 });
    expect(fingerprint(c)).not.toBe(fingerprint(a));
  });

  it('rises above the sea in the middle and leaves open water far away', () => {
    const world = new VoxelWorld();
    generateIsland(world, PARAMS);
    expect(world.surfaceHeight(0, 0)).toBeGreaterThan(SEA_LEVEL + 5);
    expect(world.surfaceHeight(0, 63)).toBe(0);
  });
});
