import sharp from 'sharp';
import { Graph } from '../comfy/graph';
import { textToImage } from '../comfy/models';
import { encodePng, resize } from '../image/io';
import { illustrationPrompt } from '../style';
import { collect, outputImage, paidPerImage } from './common';
import { referenceImages } from './sprites';
import type { Candidate, Recipe } from './types';

/** Contact sheet previews are this wide. */
const PREVIEW_WIDTH = 480;

/**
 * Painted story pictures (the intro's panels, an epilogue): a wide painting, installed
 * as a compressed WebP. `--ref` passes earlier pictures so a series keeps one style
 * and the same faces.
 */
export const illustration: Recipe = {
  id: 'illustration',
  summary: 'Painted story pictures (intro panels): wide, painterly, saved as WebP',
  defaultModel: 'nano-banana-pro',
  flags: {
    width: { default: 1600, min: 256, max: 4096, help: 'width of the installed picture in pixels' },
    height: { default: 900, min: 256, max: 4096, help: 'height of the installed picture in pixels' },
    quality: { default: 82, min: 30, max: 100, help: 'WebP quality' },
    ref: { default: '', help: 'comma-separated reference images for a consistent style and characters' },
  },
  installDir: () => 'public/story',
  paidCalls: (items, opts) => items.length * opts.variants * paidPerImage(opts),

  async generate(client, items, opts, log) {
    const width = Number(opts.flags.width);
    const height = Number(opts.flags.height);
    const jobs = items.flatMap((item) =>
      Array.from({ length: opts.variants }, async (_, i): Promise<Candidate[]> => {
        const variant = i + 1;
        const seed = opts.seed + i;
        const prompt = illustrationPrompt(item.prompt);
        log(`illustration: painting ${item.name} (variant ${variant}, ${opts.model})`);
        const g = new Graph();
        const refs = await referenceImages(client, g, String(opts.flags.ref ?? ''));
        g.save('raw', textToImage(g, opts.model, { prompt, width, height, seed, refs }));
        const raw = await outputImage(await client.run(g), 'raw');
        // Cover the target frame (the model's aspect is only the nearest it supports), then compress.
        const picture = await sharp(Buffer.from(raw.data.buffer, raw.data.byteOffset, raw.data.length), { raw: { width: raw.width, height: raw.height, channels: 4 } })
          .resize(width, height, { fit: 'cover' })
          .webp({ quality: Number(opts.flags.quality) })
          .toBuffer();
        const preview = await resize(raw, PREVIEW_WIDTH, Math.round((PREVIEW_WIDTH * raw.height) / raw.width), 'smooth');
        return [
          {
            name: item.name,
            variant,
            files: { [`${item.name}.webp`]: picture },
            extras: { 'raw.png': await encodePng(raw) },
            preview,
            notes: [`${width}×${height}`, `${Math.round(picture.length / 1024)} KB`],
            prompt,
            seed,
          },
        ];
      }),
    );
    return collect(jobs, log);
  },
};
