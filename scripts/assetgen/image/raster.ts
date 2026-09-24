/** An RGBA image in memory: 4 bytes per pixel, rows top to bottom. */
export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export type Rgba = readonly [number, number, number, number];

export function createRaster(width: number, height: number, fill: Rgba = [0, 0, 0, 0]): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  return { width, height, data };
}

export function getPixel(r: Raster, x: number, y: number): [number, number, number, number] {
  const i = (y * r.width + x) * 4;
  return [r.data[i], r.data[i + 1], r.data[i + 2], r.data[i + 3]];
}

export function setPixel(r: Raster, x: number, y: number, c: Rgba): void {
  r.data.set(c, (y * r.width + x) * 4);
}

export function cloneRaster(r: Raster): Raster {
  return { width: r.width, height: r.height, data: new Uint8ClampedArray(r.data) };
}

/** Copies the w×h region at (x, y). */
export function crop(r: Raster, x: number, y: number, w: number, h: number): Raster {
  const out = createRaster(w, h);
  for (let row = 0; row < h; row++) {
    const from = ((y + row) * r.width + x) * 4;
    out.data.set(r.data.subarray(from, from + w * 4), row * w * 4);
  }
  return out;
}
