import type { Good } from '../economy/goods';
import { Block, type BlockId } from '../voxel/blocks';
import type { VoxelWorld } from '../voxel/VoxelWorld';
import { hash3 } from '../util/hash';
import { broadleafTree, palmTree } from '../worldgen/island';

export type CropKind = 'cane' | 'tobacco' | 'pepper' | 'maize';

/**
 * Each crop: the seed it grows from, what it yields, and how long it takes (sea
 * seconds). Cane and tobacco leaf are worth more once a mill or a curing shed has been
 * at them; maize feeds settlers, and is its own seed.
 */
export const CROPS: Record<CropKind, { label: string; seed: Good; harvest: Good; amount: number; seconds: number }> = {
  cane: { label: 'Sugar cane', seed: 'caneCuttings', harvest: 'cane', amount: 3, seconds: 180 },
  tobacco: { label: 'Tobacco', seed: 'tobaccoSeed', harvest: 'leaf', amount: 3, seconds: 240 },
  pepper: { label: 'Pepper', seed: 'pepperSeed', harvest: 'spice', amount: 1, seconds: 300 },
  maize: { label: 'Maize', seed: 'maize', harvest: 'maize', amount: 3, seconds: 150 },
};

export const CROP_FOR_SEED: Partial<Record<Good, CropKind>> = { caneCuttings: 'cane', tobaccoSeed: 'tobacco', pepperSeed: 'pepper', maize: 'maize' };
/** What can be planted, in hotbar order. */
export const PLANTABLE: readonly Good[] = ['caneCuttings', 'tobaccoSeed', 'pepperSeed', 'maize'];

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
  maize: [[Block.Sprout], [Block.MaizeStalk, Block.MaizeStalk], [Block.MaizeStalk, Block.MaizeCob, Block.MaizeStalk]],
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

/** A young tree a woodcutter planted where they felled one. (x, y, z): the cell above the ground. */
export interface Sapling {
  x: number;
  y: number;
  z: number;
  planted: number;
}

/** Sea seconds for a sapling to grow into a tree worth felling. */
export const SAPLING_SECONDS = 420;

/** 0 a shoot, 1 a sapling, 2 grown (it becomes a real tree then). */
export function saplingStage(s: Sapling, time: number): Stage {
  const f = (time - s.planted) / SAPLING_SECONDS;
  return f >= 1 ? 2 : f >= 0.35 ? 1 : 0;
}

/** Draws a sapling; at stage 2 it grows into a full tree: a palm on sand, broadleaf elsewhere. */
export function showSapling(world: VoxelWorld, s: Sapling, stage: Stage): void {
  if (stage < 2) {
    world.setVoxel(s.x, s.y, s.z, stage === 0 ? Block.Sprout : Block.Sapling);
    world.setVoxel(s.x, s.y + 1, s.z, stage === 0 ? Block.Air : Block.Sapling);
    return;
  }
  world.setVoxel(s.x, s.y, s.z, Block.Air);
  world.setVoxel(s.x, s.y + 1, s.z, Block.Air);
  const variant = hash3(s.x, s.y, s.z, 77);
  if (world.getVoxel(s.x, s.y - 1, s.z) === Block.Sand) palmTree(world, s.x, s.y, s.z, variant);
  else broadleafTree(world, s.x, s.y, s.z, variant);
}
