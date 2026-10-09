/** What the captain is walking on, for the footsteps. */
import { Block, type BlockId } from '../../voxel/blocks';

export type Ground = 'sand' | 'grass' | 'wood' | 'stone';

const GROUNDS: ReadonlyMap<BlockId, Ground> = new Map<BlockId, Ground>([
  [Block.Sand, 'sand'],
  [Block.Seabed, 'sand'],
  [Block.Wood, 'wood'],
  [Block.Planks, 'wood'],
  [Block.PlanksSlab, 'wood'],
  [Block.PlanksStairS, 'wood'],
  [Block.PlanksStairE, 'wood'],
  [Block.PlanksStairN, 'wood'],
  [Block.PlanksStairW, 'wood'],
  [Block.Stone, 'stone'],
  [Block.Gravel, 'stone'],
  [Block.GravelSlab, 'stone'],
  [Block.GravelStairS, 'stone'],
  [Block.GravelStairE, 'stone'],
  [Block.GravelStairN, 'stone'],
  [Block.GravelStairW, 'stone'],
  [Block.StoneSlab, 'stone'],
  [Block.StoneStairS, 'stone'],
  [Block.StoneStairE, 'stone'],
  [Block.StoneStairN, 'stone'],
  [Block.StoneStairW, 'stone'],
  [Block.Boulder, 'stone'],
  [Block.IronOre, 'stone'],
  [Block.Copper, 'stone'],
  [Block.CopperOre, 'stone'],
  [Block.SilverOre, 'stone'],
  [Block.GoldOre, 'stone'],
]);

/** The ground a block makes underfoot: grass for anything that isn't sand, wood or stone. */
export function groundOf(block: BlockId): Ground {
  return GROUNDS.get(block) ?? 'grass';
}
