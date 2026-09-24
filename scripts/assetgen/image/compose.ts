import { ALPHA_CUTOFF, type Rgb } from './palette';
import { createRaster, crop, type Raster } from './raster';

/** Alpha from a greyscale mask image (its red channel; white = opaque). */
export function applyMask(image: Raster, mask: Raster): Raster {
  if (image.width !== mask.width || image.height !== mask.height) {
    throw new Error(`Mask is ${mask.width}×${mask.height} but the image is ${image.width}×${image.height}`);
  }
  const out = createRaster(image.width, image.height);
  out.data.set(image.data);
  for (let i = 0; i < out.data.length; i += 4) out.data[i + 3] = mask.data[i];
  return out;
}

/** Bounding box of the opaque pixels, or null when there are none. */
export function contentBox(r: Raster): { x: number; y: number; width: number; height: number } | null {
  let x0 = r.width;
  let y0 = r.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      if (r.data[(y * r.width + x) * 4 + 3] < ALPHA_CUTOFF) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** Crops to the opaque content; a fully transparent image comes back unchanged. */
export function cropToContent(r: Raster): Raster {
  const box = contentBox(r);
  return box ? crop(r, box.x, box.y, box.width, box.height) : r;
}

/** Centres the image on a transparent square canvas. */
export function padToSquare(r: Raster): Raster {
  const size = Math.max(r.width, r.height);
  const out = createRaster(size, size);
  const ox = Math.floor((size - r.width) / 2);
  const oy = Math.floor((size - r.height) / 2);
  for (let y = 0; y < r.height; y++) out.data.set(r.data.subarray(y * r.width * 4, (y + 1) * r.width * 4), ((oy + y) * size + ox) * 4);
  return out;
}

/** The image repeated nx × ny times: how a texture looks on the ground. */
export function tile(r: Raster, nx: number, ny: number): Raster {
  const out = createRaster(r.width * nx, r.height * ny);
  for (let y = 0; y < out.height; y++) {
    const row = r.data.subarray((y % r.height) * r.width * 4, ((y % r.height) + 1) * r.width * 4);
    for (let t = 0; t < nx; t++) out.data.set(row, (y * out.width + t * r.width) * 4);
  }
  return out;
}

/**
 * Scales colours (in linear light) so the average opaque colour becomes `target`,
 * keeping the light/dark variation: fits a generated pattern to a block's colour.
 */
export function tintToward(r: Raster, target: Rgb): Raster {
  const mean = [0, 0, 0];
  let count = 0;
  for (let i = 0; i < r.data.length; i += 4) {
    if (r.data[i + 3] < ALPHA_CUTOFF) continue;
    for (let c = 0; c < 3; c++) mean[c] += toLinear(r.data[i + c]);
    count++;
  }
  if (count === 0) return r;
  const gain = mean.map((m, c) => toLinear(target[c]) / Math.max(1e-6, m / count));
  const out = createRaster(r.width, r.height);
  out.data.set(r.data);
  for (let i = 0; i < out.data.length; i += 4) {
    if (out.data[i + 3] < ALPHA_CUTOFF) continue;
    for (let c = 0; c < 3; c++) out.data[i + c] = toSrgb(Math.min(1, toLinear(r.data[i + c]) * gain[c]));
  }
  return out;
}

export interface AtlasLayout {
  tileSize: number;
  columns: number;
  tiles: Record<string, { x: number; y: number; width: number; height: number }>;
}

/** Packs equal-sized square tiles row by row into a near-square atlas. */
export function packAtlas(tiles: Array<{ name: string; image: Raster }>): { image: Raster; layout: AtlasLayout } {
  if (tiles.length === 0) throw new Error('No tiles to pack');
  const size = tiles[0].image.width;
  for (const t of tiles) {
    if (t.image.width !== size || t.image.height !== size) throw new Error(`Tile ${t.name} is not ${size}×${size}`);
  }
  const columns = Math.ceil(Math.sqrt(tiles.length));
  const rows = Math.ceil(tiles.length / columns);
  const image = createRaster(columns * size, rows * size);
  const layout: AtlasLayout = { tileSize: size, columns, tiles: {} };
  tiles.forEach((t, i) => {
    const x = (i % columns) * size;
    const y = Math.floor(i / columns) * size;
    for (let row = 0; row < size; row++) image.data.set(t.image.data.subarray(row * size * 4, (row + 1) * size * 4), ((y + row) * image.width + x) * 4);
    layout.tiles[t.name] = { x, y, width: size, height: size };
  });
  return { image, layout };
}

export const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

export const toSrgb = (c: number) => Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
