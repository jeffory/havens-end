import sharp, { type OverlayOptions } from 'sharp';
import { encodePng, resize } from './io';
import type { Raster } from './raster';

const CAPTION = 38;

/** Whole-number upscale for small images (square pixels), plain downscale for large ones. */
export function previewScale(width: number, height: number, cell: number): number {
  const longest = Math.max(width, height);
  return longest <= cell ? Math.floor(cell / longest) : cell / longest;
}

/** A PNG grid of previews with a caption under each, for choosing between candidates. */
export async function contactSheet(entries: Array<{ label: string; image: Raster }>, opts: { cell: number; columns: number }): Promise<Buffer> {
  const { cell, columns } = opts;
  const rows = Math.ceil(entries.length / columns);
  const layers: OverlayOptions[] = [];
  for (const [i, entry] of entries.entries()) {
    const x = (i % columns) * cell;
    const y = Math.floor(i / columns) * (cell + CAPTION);
    const scale = previewScale(entry.image.width, entry.image.height, cell);
    const w = Math.max(1, Math.round(entry.image.width * scale));
    const h = Math.max(1, Math.round(entry.image.height * scale));
    const preview = await resize(entry.image, w, h, scale >= 1 ? 'nearest' : 'smooth');
    layers.push({ input: await encodePng(preview), left: x + Math.floor((cell - w) / 2), top: y + Math.floor((cell - h) / 2) });
    layers.push({ input: caption(entry.label, cell), left: x, top: y + cell });
  }
  return sharp({ create: { width: columns * cell, height: rows * (cell + CAPTION), channels: 4, background: '#3a3a3a' } })
    .composite(layers)
    .png()
    .toBuffer();
}

/** Title on the first line, the rest (after the first " · ") smaller on the second. */
function caption(label: string, width: number): Buffer {
  const escape = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
  const [title, ...rest] = label.split(' · ');
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${CAPTION}">` +
      `<rect width="100%" height="100%" fill="#1e1e1e"/>` +
      `<text x="6" y="15" font-family="sans-serif" font-size="13" fill="#f0f0f0">${escape(title)}</text>` +
      `<text x="6" y="31" font-family="sans-serif" font-size="11" fill="#a8a8a8">${escape(rest.join(' · '))}</text></svg>`,
  );
}
