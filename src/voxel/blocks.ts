import { FLAG_CUTAWAY, FLAG_GLOW, srgbToLinear, type VoxelPalette } from './palette';

/** Block ids stored in chunk voxel arrays (one byte each, so up to 256 kinds). */
export const Block = {
  Air: 0,
  Sand: 1,
  Seabed: 2,
  Grass: 3,
  Dirt: 4,
  Stone: 5,
  Wood: 6,
  PalmLeaves: 7,
  Leaves: 8,
  // Harbours and towns
  Planks: 9,
  Plaster: 10,
  RoofTile: 11,
  RoofSlate: 12,
  Thatch: 13,
  // Camps and farms
  Soil: 14,
  Gravel: 15,
  Embers: 16,
  Fence: 17,
  // Crops: drawn but walkable (see PASSABLE)
  Sprout: 18,
  Cane: 19,
  CaneTop: 20,
  TobaccoLeaf: 21,
  TobaccoFlower: 22,
  PepperBush: 23,
  PepperRipe: 24,
  // Phase 6: night lights, workshops, maize and saplings, ore in the hills
  Window: 25,
  Lantern: 26,
  IronOre: 27,
  Copper: 28,
  Barrel: 29,
  MaizeStalk: 30,
  MaizeCob: 31,
  Sapling: 32,
} as const;

export type BlockId = number;

interface BlockDef {
  name: string;
  /** sRGB hex, as you would pick it in a paint program. */
  color: number;
}

const DEFS: Record<BlockId, BlockDef> = {
  [Block.Sand]: { name: 'sand', color: 0xe9d6a0 },
  [Block.Seabed]: { name: 'seabed', color: 0xc8b27c },
  [Block.Grass]: { name: 'grass', color: 0x6cae4c },
  [Block.Dirt]: { name: 'dirt', color: 0x8b6542 },
  [Block.Stone]: { name: 'stone', color: 0x8f9193 },
  [Block.Wood]: { name: 'wood', color: 0x86643f },
  [Block.PalmLeaves]: { name: 'palm leaves', color: 0x5aa83e },
  [Block.Leaves]: { name: 'leaves', color: 0x3d8636 },
  [Block.Planks]: { name: 'planks', color: 0xa57b4c },
  [Block.Plaster]: { name: 'plaster', color: 0xeee4cf },
  [Block.RoofTile]: { name: 'roof tile', color: 0xb4513a },
  [Block.RoofSlate]: { name: 'slate', color: 0x50698a },
  [Block.Thatch]: { name: 'thatch', color: 0xc4a35e },
  [Block.Soil]: { name: 'tilled soil', color: 0x5e4029 },
  [Block.Gravel]: { name: 'gravel path', color: 0xb9ad96 },
  [Block.Embers]: { name: 'embers', color: 0xf07a22 },
  [Block.Fence]: { name: 'fence', color: 0x9a7247 },
  [Block.Sprout]: { name: 'sprout', color: 0x8fd35a },
  [Block.Cane]: { name: 'sugar cane', color: 0x6fae3e },
  [Block.CaneTop]: { name: 'cane tops', color: 0xc5d65a },
  [Block.TobaccoLeaf]: { name: 'tobacco leaves', color: 0x4f8f3a },
  [Block.TobaccoFlower]: { name: 'tobacco flowers', color: 0xe59bb5 },
  [Block.PepperBush]: { name: 'pepper bush', color: 0x356b2c },
  [Block.PepperRipe]: { name: 'ripe peppers', color: 0xd23a26 },
  [Block.Window]: { name: 'window', color: 0xd8c48e },
  [Block.Lantern]: { name: 'lantern', color: 0xffd27a },
  [Block.IronOre]: { name: 'iron ore', color: 0x9b6a50 },
  [Block.Copper]: { name: 'copper still', color: 0xc07a42 },
  [Block.Barrel]: { name: 'barrel', color: 0x7a5530 },
  [Block.MaizeStalk]: { name: 'maize', color: 0x86b847 },
  [Block.MaizeCob]: { name: 'maize cobs', color: 0xe9c85a },
  [Block.Sapling]: { name: 'sapling', color: 0x5f9e3a },
};

const SOLID = new Uint8Array(256);
const BLOCK_COLORS = new Float32Array(256 * 3);

for (const [key, def] of Object.entries(DEFS)) {
  const id = Number(key);
  SOLID[id] = 1;
  BLOCK_COLORS[id * 3] = srgbToLinear(((def.color >> 16) & 0xff) / 255);
  BLOCK_COLORS[id * 3 + 1] = srgbToLinear(((def.color >> 8) & 0xff) / 255);
  BLOCK_COLORS[id * 3 + 2] = srgbToLinear((def.color & 0xff) / 255);
}

/** Solid blocks are drawn, occlude neighbouring faces and stop rays (tools hit them). */
export const isSolid = (id: BlockId): boolean => SOLID[id] === 1;

/** Drawn and hit by tools, but you walk through them: crops. */
const PASSABLE = new Uint8Array(256);
for (const id of [
  Block.Sprout,
  Block.Cane,
  Block.CaneTop,
  Block.TobaccoLeaf,
  Block.TobaccoFlower,
  Block.PepperBush,
  Block.PepperRipe,
  Block.MaizeStalk,
  Block.MaizeCob,
  Block.Sapling,
]) {
  PASSABLE[id] = 1;
}

/** Does this block stop someone on foot? */
export const blocksWalker = (id: BlockId): boolean => SOLID[id] === 1 && PASSABLE[id] === 0;

const FLAGS = new Uint8Array(256);
// Trees and buildings: what the on-foot cutaway may open up. Never the ground itself.
for (const id of [Block.Wood, Block.Leaves, Block.PalmLeaves, Block.Planks, Block.Plaster, Block.RoofTile, Block.RoofSlate, Block.Thatch, Block.Fence, Block.Window, Block.Copper, Block.Barrel]) {
  FLAGS[id] |= FLAG_CUTAWAY;
}
// What glows after dark.
for (const id of [Block.Embers, Block.Window, Block.Lantern]) FLAGS[id] |= FLAG_GLOW;

/** Terrain colours, solidity and flags, in the form the mesher takes. */
export const BLOCK_PALETTE: VoxelPalette = { colors: BLOCK_COLORS, solid: SOLID, flags: FLAGS };
