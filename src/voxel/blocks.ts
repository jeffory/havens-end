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
};

const SOLID = new Uint8Array(256);
/** Linear-space RGB per block id, ready to be written into vertex colours. */
export const BLOCK_COLORS = new Float32Array(256 * 3);

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

for (const [key, def] of Object.entries(DEFS)) {
  const id = Number(key);
  SOLID[id] = 1;
  BLOCK_COLORS[id * 3] = srgbToLinear(((def.color >> 16) & 0xff) / 255);
  BLOCK_COLORS[id * 3 + 1] = srgbToLinear(((def.color >> 8) & 0xff) / 255);
  BLOCK_COLORS[id * 3 + 2] = srgbToLinear((def.color & 0xff) / 255);
}

/** Solid blocks occlude neighbouring faces, block movement and stop rays. */
export const isSolid = (id: BlockId): boolean => SOLID[id] === 1;
