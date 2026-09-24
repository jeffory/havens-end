import type { Good } from '../economy/goods';
import { Block, type BlockId } from '../voxel/blocks';
import type { VoxelWorld } from '../voxel/VoxelWorld';

export type CropKind = 'cane' | 'tobacco' | 'pepper';

/** Each crop: the seed it grows from, what it yields, and how long it takes (sea seconds). */
export const CROPS: Record<CropKind, { label: string; seed: Good; harvest: Good; amount: number; seconds: number }> = {
  cane: { label: 'Sugar cane', seed: 'caneCuttings', harvest: 'sugar', amount: 2, seconds: 180 },
  tobacco: { label: 'Tobacco', seed: 'tobaccoSeed', harvest: 'tobacco', amount: 2, seconds: 240 },
  pepper: { label: 'Pepper', seed: 'pepperSeed', harvest: 'spice', amount: 1, seconds: 300 },
};

export const CROP_FOR_SEED: Partial<Record<Good, CropKind>> = { caneCuttings: 'cane', tobaccoSeed: 'tobacco', pepperSeed: 'pepper' };

/** A plant in a field. (x, z) is its column; y is the first cell above the tilled soil. */
export interface Crop {
  x: number;
  y: number;
  z: number;
  kind: CropKind;
  /** Sea time it went in. */
  planted: number;
}

export type Stage = 0 | 1 | 2;

/** 0 sprouting, 1 growing, 2 ripe for harvest. */
export function stageOf(crop: Crop, time: number): Stage {
  const f = (time - crop.planted) / CROPS[crop.kind].seconds;
  return f >= 1 ? 2 : f >= 0.4 ? 1 : 0;
}

/** The plant as a stack of voxels, bottom first. */
const LOOKS: Record<CropKind, readonly (readonly BlockId[])[]> = {
  cane: [[Block.Sprout], [Block.Cane, Block.Cane], [Block.Cane, Block.Cane, Block.CaneTop]],
  tobacco: [[Block.Sprout], [Block.TobaccoLeaf], [Block.TobaccoLeaf, Block.TobaccoFlower]],
  pepper: [[Block.Sprout], [Block.PepperBush], [Block.PepperBush, Block.PepperRipe]],
};

const TALLEST = 3;

/** Draws a crop at a stage, replacing whatever stage was there. */
export function showCrop(world: VoxelWorld, crop: Crop, stage: Stage): void {
  const look = LOOKS[crop.kind][stage];
  for (let i = 0; i < TALLEST; i++) world.setVoxel(crop.x, crop.y + i, crop.z, look[i] ?? Block.Air);
}

export function clearCrop(world: VoxelWorld, crop: Crop): void {
  for (let i = 0; i < TALLEST; i++) world.setVoxel(crop.x, crop.y + i, crop.z, Block.Air);
}
