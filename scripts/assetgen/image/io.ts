import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import type { Raster } from './raster';

/** Decodes PNG / JPEG / WebP bytes to RGBA. */
export async function decodeImage(bytes: Uint8Array): Promise<Raster> {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

export async function readImage(path: string): Promise<Raster> {
  return decodeImage(await readFile(path));
}

export async function encodePng(r: Raster): Promise<Buffer> {
  return sharp(Buffer.from(r.data.buffer, r.data.byteOffset, r.data.length), {
    raw: { width: r.width, height: r.height, channels: 4 },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export async function writePng(r: Raster, path: string): Promise<void> {
  await writeFile(path, await encodePng(r));
}

/** 'nearest' keeps hard pixel edges (pixel art previews); 'smooth' is Lanczos. */
export async function resize(r: Raster, width: number, height: number, mode: 'nearest' | 'smooth'): Promise<Raster> {
  const { data, info } = await sharp(Buffer.from(r.data.buffer, r.data.byteOffset, r.data.length), {
    raw: { width: r.width, height: r.height, channels: 4 },
  })
    .resize(width, height, { kernel: mode === 'nearest' ? 'nearest' : 'lanczos3', fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}
