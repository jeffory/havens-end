import { readFile } from 'node:fs/promises';
import { Graph, type Ref } from '../comfy/graph';
import { textToImage } from '../comfy/models';
import { loadImage, maskAsImage, removeBackground } from '../comfy/pipelines';
import { userPath } from '../env';
import { applyMask, cropToContent, padToSquare } from '../image/compose';
import { sliceGrid } from '../image/grid';
import { encodePng } from '../image/io';
import { kmeansPalette, quantize } from '../image/palette';
import { kCentroidDownscale } from '../image/pixelate';
import { createRaster, type Raster } from '../image/raster';
import { iconSheetPrompt, spritePrompt } from '../style';
import { chunk } from './block';
import { collect, downscaleFlag, downscaleMode, outputImage, paidPerImage, pixelize } from './common';
import type { Candidate, Client, GenOptions, Item, Recipe } from './types';

/** Share of an icon's cell left empty around it. */
const ICON_MARGIN = 0.12;

/** Uploads comma-separated reference image paths and returns their LoadImage outputs. */
async function referenceImages(client: Client, g: Graph, paths: string): Promise<Ref[] | undefined> {
  const list = paths.split(',').map((p) => p.trim()).filter(Boolean);
  if (list.length === 0) return undefined;
  const refs: Ref[] = [];
  for (const path of list) refs.push(loadImage(g, await client.uploadImage(await readFile(userPath(path)))));
  return refs;
}

/** Generates `prompt` and a BiRefNet foreground mask in one run. */
async function generateWithMask(client: Client, opts: GenOptions, prompt: string, seed: number) {
  const g = new Graph();
  const refs = await referenceImages(client, g, String(opts.flags.ref ?? ''));
  const raw = textToImage(g, opts.model, { prompt, width: 1024, height: 1024, seed, refs });
  g.save('raw', raw);
  g.save('mask', maskAsImage(g, removeBackground(g, raw)));
  const result = await client.run(g);
  return { raw: await outputImage(result, 'raw'), mask: await outputImage(result, 'mask') };
}

export const sprite: Recipe = {
  id: 'sprite',
  summary: 'Pixel-art sprites with transparent backgrounds (characters, props, portraits)',
  defaultModel: 'nano-banana-pro',
  flags: {
    height: { default: 64, min: 8, max: 512, help: 'sprite height in pixels (width follows the figure)' },
    colors: { default: 24, min: 2, max: 256, help: 'palette size' },
    ref: { default: '', help: 'comma-separated reference images for style or character consistency' },
    downscale: downscaleFlag('dominant'),
  },
  installDir: () => 'public/sprites',
  paidCalls: (items, opts) => items.length * opts.variants * paidPerImage(opts),

  async generate(client, items, opts, log) {
    const height = Number(opts.flags.height);
    const jobs = items.flatMap((item) =>
      Array.from({ length: opts.variants }, async (_, i): Promise<Candidate> => {
        const variant = i + 1;
        const seed = opts.seed + i;
        const prompt = spritePrompt(item.prompt);
        log(`sprite: generating ${item.name} (variant ${variant}, ${opts.model})`);
        const { raw, mask } = await generateWithMask(client, opts, prompt, seed);
        const figure = cropToContent(applyMask(raw, mask));
        const width = Math.max(1, Math.round((figure.width * height) / figure.height));
        const px = pixelize(figure, { width, height, colors: Number(opts.flags.colors), mode: downscaleMode(opts.flags.downscale) });
        return {
          name: item.name,
          variant,
          files: { [`${item.name}.png`]: await encodePng(px) },
          extras: { 'raw.png': await encodePng(raw) },
          preview: px,
          notes: [`${width}×${height}`],
          prompt,
          seed,
        };
      }),
    );
    return collect(
      jobs.map((job) => job.then((c) => [c])),
      log,
    );
  },
};

export const icons: Recipe = {
  id: 'icons',
  summary: 'Pixel-art inventory/UI icons, up to 16 drawn together in one sheet',
  defaultModel: 'nano-banana-pro',
  flags: {
    size: { default: 32, min: 8, max: 256, help: 'icon size in pixels (square)' },
    colors: { default: 32, min: 2, max: 256, help: 'palette size, shared by all icons of a sheet' },
    ref: { default: '', help: 'comma-separated reference images for style consistency' },
    downscale: downscaleFlag('dominant'),
  },
  installDir: () => 'public/sprites/icons',
  paidCalls: (items, opts) => Math.ceil(items.length / 16) * opts.variants * paidPerImage(opts),

  async generate(client, items, opts, log) {
    const jobs = [];
    for (let v = 1; v <= opts.variants; v++) {
      for (const group of chunk(items, 16)) jobs.push(sheetJob(client, group, opts, v, log));
    }
    const results = await collect(jobs, log);
    // Number each item's candidates 1, 2, 3… across sheet cells and runs.
    return items.flatMap((item) =>
      results
        .filter((c) => c.name === item.name)
        .sort((a, b) => a.variant - b.variant)
        .map((c, i) => ({ ...c, variant: i + 1 })),
    );
  },
};

/**
 * One icon sheet: generate, mask, slice, then pixelize every icon with one shared palette.
 * The grid is always square (2×2, 3×3, 4×4): on a square image models draw square grids
 * whatever they are asked, so spare cells are filled with extra takes on the same icons.
 */
async function sheetJob(client: Client, group: Item[], opts: GenOptions, run: number, log: (s: string) => void): Promise<Candidate[]> {
  const size = Number(opts.flags.size);
  const seed = opts.seed + run - 1;
  const side = Math.ceil(Math.sqrt(group.length));
  const cells = Array.from({ length: side * side }, (_, i) => group[i % group.length]);
  const prompt = iconSheetPrompt(
    cells.map((item, i) => (i < group.length ? item.prompt : `another take on ${item.prompt}`)),
    size,
  );
  log(`icons: generating ${group.map((i) => i.name).join(', ')} (run ${run}, ${opts.model})`);
  const { raw, mask } = await generateWithMask(client, opts, prompt, seed);
  const images = sliceGrid(applyMask(raw, mask), side, side, 'none');
  const mode = downscaleMode(opts.flags.downscale);
  const small = images.map((cell) => kCentroidDownscale(withMargin(padToSquare(cropToContent(cell))), size, size, 3, mode));
  const palette = kmeansPalette(stack(small), Number(opts.flags.colors));
  const sheet = await encodePng(raw);
  return Promise.all(
    cells.map(async (item, i): Promise<Candidate> => {
      const px = quantize(small[i], palette);
      const variant = run * cells.length + i; // sort key; renumbered per item in generate()
      return { name: item.name, variant, files: { [`${item.name}.png`]: await encodePng(px) }, extras: { 'sheet.png': sheet }, preview: px, notes: [], prompt, seed };
    }),
  );
}

/** Transparent border so an icon does not touch its edges. */
function withMargin(r: Raster): Raster {
  const pad = Math.round(r.width * ICON_MARGIN);
  const out = createRaster(r.width + 2 * pad, r.height + 2 * pad);
  for (let y = 0; y < r.height; y++) out.data.set(r.data.subarray(y * r.width * 4, (y + 1) * r.width * 4), ((y + pad) * out.width + pad) * 4);
  return out;
}

/** Stacks same-width images vertically (to take one palette over all of them). */
function stack(images: Raster[]): Raster {
  const out = createRaster(images[0].width, images.reduce((h, r) => h + r.height, 0));
  let y = 0;
  for (const r of images) {
    out.data.set(r.data, y * out.width * 4);
    y += r.height;
  }
  return out;
}
