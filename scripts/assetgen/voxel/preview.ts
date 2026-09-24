import { createRaster, type Raster } from '../image/raster';
import type { VoxelGrid } from './voxelize';

const TOP = 1;
const LEFT = 0.8; // the front (−y) face
const RIGHT = 0.62; // the +x face

/**
 * Isometric preview of a voxel grid, seen from the front-right and above (−y, +x, +z;
 * the model's front after voxelize()). Each voxel is a 2s × 2s hexagon of three shaded
 * faces, drawn back to front. Used on contact sheets; MagicaVoxel is the real viewer.
 */
export function renderIso(grid: VoxelGrid, s = 6): Raster {
  const [nx, ny, nz] = grid.size;
  const width = (nx + ny) * s;
  const height = ((nx + ny - 2) * s) / 2 + (nz - 1) * s + 2 * s;
  const out = createRaster(width, height);
  const sprite = cubeSprite(s);

  // Y counts from the front so larger x + Y + z is always nearer the viewer.
  const cells = grid.entries().map(([x, y, z, rgb]) => ({ x, Y: ny - 1 - y, z, rgb }));
  cells.sort((a, b) => a.x + a.Y + a.z - (b.x + b.Y + b.z));
  for (const { x, Y, z, rgb } of cells) {
    const ox = (x - Y) * s + (ny - 1) * s;
    const oy = ((x + Y) * s) / 2 - z * s + (nz - 1) * s;
    for (let py = 0; py < 2 * s; py++) {
      for (let px = 0; px < 2 * s; px++) {
        const shade = sprite[py * 2 * s + px];
        if (!shade) continue;
        out.data.set([rgb[0] * shade, rgb[1] * shade, rgb[2] * shade, 255], ((oy + py) * width + ox + px) * 4);
      }
    }
  }
  return out;
}

/** Shade per pixel of one cube's hexagon (0 = outside). */
function cubeSprite(s: number): Float32Array {
  const out = new Float32Array(4 * s * s);
  for (let py = 0; py < 2 * s; py++) {
    for (let px = 0; px < 2 * s; px++) {
      const X = px + 0.5;
      const Y = py + 0.5;
      const dx = Math.abs(X - s);
      if (dx / s + Math.abs(Y - s / 2) / (s / 2) <= 1) out[py * 2 * s + px] = TOP;
      else if (Y >= dx / 2 && Y <= 2 * s - dx / 2) out[py * 2 * s + px] = X < s ? LEFT : RIGHT;
    }
  }
  return out;
}
