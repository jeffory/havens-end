import { writeVox } from '../../../src/vox/writeVox';
import { kmeansPalette, nearest, type Rgb } from '../image/palette';
import { createRaster } from '../image/raster';
import type { VoxelGrid } from './voxelize';

export interface ToVoxOptions {
  /** Palette budget (MagicaVoxel allows 255). Voxel art usually reads best with 16–48. */
  colors: number;
  /** Object name shown in MagicaVoxel's outliner. */
  name: string;
}

/** The grid with every colour snapped to a k-means palette of at most `colors` entries. */
export function quantizeGrid(grid: VoxelGrid, colors: number): { grid: VoxelGrid; palette: Rgb[] } {
  const cells = grid.entries();
  const swatch = createRaster(Math.max(1, cells.length), 1);
  cells.forEach(([, , , rgb], i) => swatch.data.set([...rgb, 255], i * 4));
  const palette = kmeansPalette(swatch, Math.min(255, colors));
  const snapped = cells.map(([x, y, z, [r, g, b]]) => [x, y, z, palette[nearest(palette, r, g, b)]] as [number, number, number, Rgb]);
  const byKey = new Map(snapped.map((c) => [`${c[0]},${c[1]},${c[2]}`, c[3]]));
  return { palette, grid: { size: grid.size, get: (x, y, z) => byKey.get(`${x},${y},${z}`), entries: () => snapped } };
}

/**
 * Packs a voxel grid into a MagicaVoxel file: colours reduced to a k-means palette, the
 * model centred on x/y and standing on z = 0, so it opens ready to touch up.
 */
export function gridToVox(grid: VoxelGrid, opts: ToVoxOptions): Uint8Array {
  if (grid.size.some((s) => s > 256)) throw new Error(`Model is ${grid.size.join('×')} voxels; MagicaVoxel allows at most 256 per axis`);
  const { grid: snapped, palette } = quantizeGrid(grid, opts.colors);

  const rgba = new Uint8Array(256 * 4);
  palette.forEach((c, i) => rgba.set([...c, 255], (i + 1) * 4));
  const index = new Map(palette.map((c, i) => [c.join(','), i + 1]));

  const voxels = snapped.entries().map(([x, y, z, rgb]) => [x, y, z, index.get(rgb.join(','))!] as const);
  const [sx, sy, sz] = grid.size;
  return writeVox([{ name: opts.name, size: [sx, sy, sz], min: [-Math.floor(sx / 2), -Math.floor(sy / 2), 0], voxels }], rgba);
}
