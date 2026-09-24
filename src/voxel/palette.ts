/** What the mesher needs to know about voxel ids: their colour and whether they are solid. */
export interface VoxelPalette {
  /** Linear-space RGB per id (256 × 3). */
  colors: Float32Array;
  /** 1 where the id is solid (256 entries). */
  solid: Uint8Array;
  /** Per id, which of FLAG_CUTAWAY and FLAG_GLOW apply (terrain only; models have none). */
  flags?: Uint8Array;
}

/** May be cut away to show someone on foot beneath it: trees and buildings, never the ground. */
export const FLAG_CUTAWAY = 1;
/** Gives off its own light at night: embers, lanterns, lit windows. */
export const FLAG_GLOW = 2;

export const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** Palette from MagicaVoxel-style RGBA bytes (4 per index); every index except 0 is solid. */
export function paletteFromRgba(rgba: Uint8Array): VoxelPalette {
  const colors = new Float32Array(256 * 3);
  const solid = new Uint8Array(256);
  for (let i = 1; i < 256; i++) {
    solid[i] = 1;
    for (let c = 0; c < 3; c++) colors[i * 3 + c] = srgbToLinear(rgba[i * 4 + c] / 255);
  }
  return { colors, solid };
}
