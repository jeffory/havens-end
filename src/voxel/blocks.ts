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
  // Phase 7: buried treasure, and the landmarks that point to it
  Chest: 33,
  Bone: 34,
  Deadwood: 35,
  Cairn: 36,
  // Phase 10: outcrops of stone and ore
  Boulder: 37,
  CopperOre: 38,
  SilverOre: 39,
  GoldOre: 40,
  // Towns: the Brethren's tarred roofs, flags, and the well
  TarredRoof: 41,
  FlagBlack: 42,
  FlagCrimson: 43,
  FlagBlue: 44,
  WellWater: 45,
  // Towns dressed: stalls and their goods, the quay's cargo, guns, rooms, and banners
  Canvas: 46,
  AwningRed: 47,
  AwningBlue: 48,
  Crate: 49,
  Sack: 50,
  Fruit: 51,
  Greens: 52,
  Cloth: 53,
  Iron: 54,
  Rope: 55,
  Net: 56,
  Books: 57,
  FlagWhite: 58,
  FlagGold: 59,
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
  [Block.Chest]: { name: 'treasure chest', color: 0x6b3f1d },
  [Block.Bone]: { name: 'bone-white rock', color: 0xe6dfcb },
  [Block.Deadwood]: { name: 'dead wood', color: 0x7d766b },
  [Block.Cairn]: { name: 'cairn stone', color: 0x6f777d },
  [Block.Boulder]: { name: 'boulder', color: 0xa8a49a },
  [Block.CopperOre]: { name: 'copper ore', color: 0x3f9a7d },
  [Block.SilverOre]: { name: 'silver ore', color: 0xc9d1d8 },
  [Block.GoldOre]: { name: 'gold ore', color: 0xe0b83a },
  [Block.TarredRoof]: { name: 'tarred roof', color: 0x6a4e3a },
  [Block.FlagBlack]: { name: 'black flag', color: 0x1c1c22 },
  [Block.FlagCrimson]: { name: 'crimson flag', color: 0xa51d24 },
  [Block.FlagBlue]: { name: 'Guild flag', color: 0x2b5da8 },
  [Block.WellWater]: { name: 'well water', color: 0x2a4d6e },
  [Block.Canvas]: { name: 'canvas', color: 0xece2c8 },
  [Block.AwningRed]: { name: 'red awning', color: 0xb8422e },
  [Block.AwningBlue]: { name: 'blue awning', color: 0x356aa3 },
  [Block.Crate]: { name: 'crate', color: 0x8e6a3e },
  [Block.Sack]: { name: 'sacking', color: 0xc9b283 },
  [Block.Fruit]: { name: 'fruit', color: 0xe8892a },
  [Block.Greens]: { name: 'greens', color: 0x78b33c },
  [Block.Cloth]: { name: 'bolts of cloth', color: 0x7d4a93 },
  [Block.Iron]: { name: 'iron', color: 0x4a4f57 },
  [Block.Rope]: { name: 'rope', color: 0xb49d6b },
  [Block.Net]: { name: 'net', color: 0x5f8a80 },
  [Block.Books]: { name: 'books', color: 0x8c3a2c },
  [Block.FlagWhite]: { name: 'white on a flag', color: 0xf2eee2 },
  [Block.FlagGold]: { name: 'gold on a flag', color: 0xe3b53a },
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
// (Awnings and the goods on the ground stay: they're low, and they're what a market is.)
for (const id of [
  Block.Wood,
  Block.Leaves,
  Block.PalmLeaves,
  Block.Planks,
  Block.Plaster,
  Block.RoofTile,
  Block.RoofSlate,
  Block.Thatch,
  Block.TarredRoof,
  Block.Fence,
  Block.Window,
  Block.Copper,
  Block.Barrel,
  Block.Deadwood,
  Block.FlagBlack,
  Block.FlagCrimson,
  Block.FlagBlue,
  Block.FlagWhite,
  Block.FlagGold,
  Block.Rope,
  Block.Net,
  Block.Books,
  // Lanterns go with the wall or post they hang from.
  Block.Lantern,
]) {
  FLAGS[id] |= FLAG_CUTAWAY;
}
// What glows after dark.
for (const id of [Block.Embers, Block.Window, Block.Lantern]) FLAGS[id] |= FLAG_GLOW;

/** Terrain colours, solidity and flags, in the form the mesher takes. */
export const BLOCK_PALETTE: VoxelPalette = { colors: BLOCK_COLORS, solid: SOLID, flags: FLAGS };
