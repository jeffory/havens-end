import { describe, expect, it } from 'vitest';
import { Block } from '../../voxel/blocks';
import { groundOf } from './ground';

describe('groundOf', () => {
  it.each([
    ['Sand', 'sand'],
    ['Seabed', 'sand'],
    ['Grass', 'grass'],
    ['Soil', 'grass'],
    ['Planks', 'wood'],
    ['PlanksStairN', 'wood'],
    ['Wood', 'wood'],
    ['Stone', 'stone'],
    ['GravelSlab', 'stone'],
    ['StoneStairE', 'stone'],
    ['GoldOre', 'stone'],
    ['Boulder', 'stone'],
  ] as const)('%s is %s underfoot', (block, ground) => {
    expect(groundOf(Block[block])).toBe(ground);
  });
});
