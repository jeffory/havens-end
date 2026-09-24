import { BLOCK_PALETTE, Block } from '../../../src/voxel/blocks';
import { Graph } from '../comfy/graph';
import { textToImage } from '../comfy/models';
import { loadImage, normalAndHeight } from '../comfy/pipelines';
import { tile, tintToward, toSrgb } from '../image/compose';
import { encodePng, resize } from '../image/io';
import type { Rgb } from '../image/palette';
import { seamScore } from '../image/seam';
import { materialPrompt, PIXEL_RULES, patternPrompt } from '../style';
import { detailNote, formatSeam, needsRepair, seamEditor } from './block';
import { collect, downscaleFlag, downscaleMode, optional, outputImage, paidPerImage, pixelize, repairSeam } from './common';
import type { Candidate, Recipe } from './types';

const blockKey = (name: string) => name.replace(/[^a-z]/gi, '').toLowerCase();
const snake = (key: string) => key.replace(/[a-z][A-Z]/g, (m) => `${m[0]}_${m[1]}`).toLowerCase();

/** A game block's colour today (sRGB), from src/voxel/blocks.ts. */
export function blockColour(name: string): Rgb {
  const entry = Object.entries(Block).find(([key, id]) => id !== Block.Air && blockKey(key) === blockKey(name));
  if (!entry) {
    const known = Object.keys(Block).filter((k) => k !== 'Air').map(snake);
    throw new Error(`Unknown block "${name}"; known blocks: ${known.join(', ')}`);
  }
  const id = entry[1];
  return [0, 1, 2].map((c) => toSrgb(BLOCK_PALETTE.colors[id * 3 + c])) as Rgb;
}

/**
 * Per-voxel colour patterns: a tileable texture at one pixel per voxel (e.g. 32 × 32
 * covers 32 voxels), optionally tinted so its average matches a block's current colour.
 * The game can sample it by world position to paint terrain without real textures.
 */
export const pattern: Recipe = {
  id: 'pattern',
  summary: 'Per-voxel colour patterns (1 px = 1 voxel), tinted to a game block colour',
  defaultModel: 'nano-banana-pro',
  flags: {
    size: { default: 32, min: 4, max: 256, help: 'pattern size in pixels = voxels' },
    colors: { default: 8, min: 2, max: 256, help: 'palette size' },
    block: { default: '', help: 'tint to this block colour (sand, grass, dirt, stone, wood, …)' },
    repair: { default: 'auto', choices: ['auto', 'always', 'never'], help: 'seam repair: when a seam shows, always, or never' },
    downscale: downscaleFlag('detail'),
  },
  installDir: () => 'public/textures/patterns',
  paidCalls: (items, opts) => items.length * opts.variants * paidPerImage(opts),

  async generate(client, items, opts, log) {
    const size = Number(opts.flags.size);
    const target = opts.flags.block ? blockColour(String(opts.flags.block)) : undefined;
    const jobs = items.flatMap((item) =>
      Array.from({ length: opts.variants }, async (_, i): Promise<Candidate[]> => {
        const variant = i + 1;
        const seed = opts.seed + i;
        const prompt = patternPrompt(item.prompt, size);
        const g = new Graph();
        g.save('raw', textToImage(g, opts.model, { prompt, width: 1024, height: 1024, seed }));
        log(`pattern: generating ${item.name} (variant ${variant}, ${opts.model})`);
        let hi = await outputImage(await client.run(g), 'raw');
        const colors = Number(opts.flags.colors);
        const pixelOptions = { width: size, height: size, colors, mode: downscaleMode(opts.flags.downscale) };
        let px = pixelize(hi, pixelOptions);
        const notes = [formatSeam(seamScore(px), 'xy'), ...detailNote(hi, size)];
        if (opts.flags.repair === 'always' || (opts.flags.repair === 'auto' && needsRepair(seamScore(px), 'xy'))) {
          log(`pattern: repairing the seam of ${item.name}`);
          const prompt = `${item.prompt}, chunky pixel art pattern. ${PIXEL_RULES}`;
          const repaired = await optional(null, () => repairSeam(client, hi, prompt, 'xy', seed, 'nearest', seamEditor(opts.model)), 'seam repair', notes, log);
          if (repaired) {
            hi = repaired;
            px = pixelize(hi, pixelOptions);
            notes.push(`repaired → ${formatSeam(seamScore(px), 'xy')}`);
          }
        }
        if (target) {
          px = tintToward(px, target);
          notes.push(`tint ${opts.flags.block}`);
        }
        return [{ name: item.name, variant, files: { [`${item.name}.png`]: await encodePng(px) }, extras: { 'raw.png': await encodePng(hi) }, preview: tile(px, 3, 3), notes, prompt, seed }];
      }),
    );
    return collect(jobs, log);
  },
};

/** HD seamless materials with normal and height maps. */
export const material: Recipe = {
  id: 'material',
  summary: 'HD seamless material (colour + normal + height maps)',
  defaultModel: 'flux-2-max',
  flags: {
    size: { default: 1024, min: 256, max: 2048, help: 'texture size in pixels (square; rounded to a multiple of 16)' },
    repair: { default: 'always', choices: ['always', 'auto', 'never'], help: 'seam repair: always, when a seam shows, or never' },
    maps: { default: true, help: 'also derive normal and height maps (--no-maps to skip)' },
  },
  installDir: (name) => `public/textures/materials/${name}`,
  paidCalls: (items, opts) => items.length * opts.variants * paidPerImage(opts),

  async generate(client, items, opts, log) {
    const size = Math.round(Number(opts.flags.size) / 16) * 16; // the repair model works in 16 px blocks
    const jobs = items.flatMap((item) =>
      Array.from({ length: opts.variants }, async (_, i): Promise<Candidate[]> => {
        const variant = i + 1;
        const seed = opts.seed + i;
        const prompt = materialPrompt(item.prompt);
        const g = new Graph();
        g.save('raw', textToImage(g, opts.model, { prompt, width: size, height: size, seed }));
        log(`material: generating ${item.name} (variant ${variant}, ${opts.model})`);
        const raw = await outputImage(await client.run(g), 'raw');
        let color = raw.width === size && raw.height === size ? raw : await resize(raw, size, size, 'smooth');
        const notes = [formatSeam(seamScore(color), 'xy')];
        if (opts.flags.repair === 'always' || (opts.flags.repair === 'auto' && needsRepair(seamScore(color), 'xy'))) {
          log(`material: repairing the seam of ${item.name}`);
          const unrepaired = color;
          const repaired = await optional(null, () => repairSeam(client, unrepaired, `${item.prompt}, seamless texture`, 'xy', seed, 'smooth'), 'seam repair', notes, log);
          if (repaired) {
            color = repaired;
            notes.push(`repaired → ${formatSeam(seamScore(color), 'xy')}`);
          }
        }
        const files: Record<string, Uint8Array> = { 'color.png': await encodePng(color) };
        if (opts.flags.maps) {
          // Optional extras: a failure here must not throw away the (paid) colour texture.
          try {
            const mg = new Graph();
            const maps = normalAndHeight(mg, loadImage(mg, await client.uploadImage(files['color.png'])));
            mg.save('normal', maps.normal);
            mg.save('height', maps.height);
            const result = await client.run(mg);
            const normal = await encodePng(await outputImage(result, 'normal'));
            const height = await encodePng(await outputImage(result, 'height'));
            Object.assign(files, { 'normal.png': normal, 'height.png': height });
          } catch (error) {
            log(`material: normal/height maps for ${item.name} failed: ${(error as Error).message}`);
            notes.push(`no maps: ${(error as Error).message}`);
          }
        }
        const small = await resize(color, 256, 256, 'smooth');
        return [{ name: item.name, variant, files, extras: { 'raw.png': await encodePng(raw) }, preview: tile(small, 2, 2), notes, prompt, seed }];
      }),
    );
    return collect(jobs, log);
  },
};
