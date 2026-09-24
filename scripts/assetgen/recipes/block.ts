import { Graph } from '../comfy/graph';
import { MODELS, type ModelId, textToImage } from '../comfy/models';
import { tile } from '../image/compose';
import { detailResolution } from '../image/detail';
import { sliceGrid } from '../image/grid';
import { encodePng } from '../image/io';
import type { Raster } from '../image/raster';
import { seamScore, type TileAxes } from '../image/seam';
import { atlasPrompt, gridFor, PIXEL_RULES } from '../style';
import { collect, downscaleFlag, downscaleMode, optional, outputImage, paidPerImage, pixelize, repairSeam } from './common';
import type { Candidate, Client, GenOptions, Item, Recipe } from './types';

/** Seam scores above this (wrap jump vs. neighbouring jumps) count as a visible seam. */
export const SEAM_LIMIT = 3;

export const needsRepair = (score: { x: number; y: number }, axes: TileAxes) => score.x > SEAM_LIMIT || (axes === 'xy' && score.y > SEAM_LIMIT);

export const formatSeam = (score: { x: number; y: number }, axes: TileAxes) =>
  axes === 'xy' ? `seam ${score.x.toFixed(1)}/${score.y.toFixed(1)}` : `seam ${score.x.toFixed(1)}`;

/** A caption note when the drawing has more detail than `size` pixels can hold. */
export function detailNote(image: Raster, size: number): string[] {
  const detail = detailResolution(image);
  return detail > size * 1.25 ? [`busy (detail ≈${Math.round(detail)} px)`] : [];
}

export function chunk<T>(list: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
}

/** The model that redraws seams: the generation model if it can edit images, else Klein (undefined). */
export const seamEditor = (model: ModelId): ModelId | undefined => (MODELS[model].refs ? model : undefined);

/** Blocks per generated atlas. Always a full 3×3: smaller cells come out chunkier, closer to 16 px art. */
const CELLS = 9;

/**
 * Block face textures. Up to nine blocks share one generated atlas, so a set drawn
 * together matches in style; spare cells hold extra variations of the same blocks.
 * Each cell is then reduced to true pixel art.
 */
export const block: Recipe = {
  id: 'block',
  summary: 'Tileable pixel-art block face textures (16/32 px), 9 cells per generation',
  defaultModel: 'nano-banana-pro',
  flags: {
    size: { default: 16, min: 4, max: 128, help: 'texture size in pixels' },
    colors: { default: 12, min: 2, max: 256, help: 'palette size per texture' },
    tile: { default: 'xy', choices: ['xy', 'x'], help: "'xy' tiles both ways (tops); 'x' left-right only (sides)" },
    repair: { default: 'auto', choices: ['auto', 'always', 'never'], help: 'seam repair: when a seam shows, always, or never' },
    downscale: downscaleFlag('detail'),
  },
  installDir: () => 'public/textures/blocks',
  paidCalls: (items, opts) => Math.ceil(items.length / CELLS) * opts.variants * paidPerImage(opts),

  async generate(client, items, opts, log) {
    const size = Number(opts.flags.size);
    const axes = opts.flags.tile === 'x' ? 'x' : 'xy';
    const jobs = [];
    for (let run = 1; run <= opts.variants; run++) {
      for (const group of chunk(items, CELLS)) jobs.push(atlasJob(client, group, opts, run, size, axes, log));
    }
    const results = await collect(jobs, log);
    // Number each item's candidates 1, 2, 3… across atlas cells and runs.
    return items.flatMap((item) =>
      results
        .filter((c) => c.name === item.name)
        .sort((a, b) => a.variant - b.variant)
        .map((c, i) => ({ ...c, variant: i + 1 })),
    );
  },
};

async function atlasJob(client: Client, group: Item[], opts: GenOptions, run: number, size: number, axes: TileAxes, log: (s: string) => void) {
  const seed = opts.seed + run - 1;
  const cells = Array.from({ length: CELLS }, (_, i) => group[i % group.length]);
  const prompt = atlasPrompt(
    cells.map((item, i) => (i < group.length ? item.prompt : `another take on ${item.prompt}`)),
    size,
    axes,
  );
  const g = new Graph();
  g.save('raw', textToImage(g, opts.model, { prompt, width: 1024, height: 1024, seed }));
  log(`block: generating ${group.map((i) => i.name).join(', ')} (run ${run}, ${opts.model})`);
  const atlas = await outputImage(await client.run(g), 'raw');
  const [cols, rows] = gridFor(CELLS);
  const images = sliceGrid(atlas, cols, rows, 'black');
  const atlasPng = await encodePng(atlas);
  const colors = Number(opts.flags.colors);
  const pixelOptions = { width: size, height: size, colors, mode: downscaleMode(opts.flags.downscale) };

  return Promise.all(
    cells.map(async (item, i): Promise<Candidate> => {
      let hi: Raster = images[i];
      let px = pixelize(hi, pixelOptions);
      const before = seamScore(px);
      const notes = [formatSeam(before, axes), ...detailNote(hi, size)];
      const mode = opts.flags.repair;
      if (mode === 'always' || (mode === 'auto' && needsRepair(before, axes))) {
        const editor = seamEditor(opts.model);
        log(`block: repairing the seam of ${item.name} (${formatSeam(before, axes)}) with ${editor ?? 'klein'}`);
        const repaired = await optional(
          null,
          () => repairSeam(client, hi, `${item.prompt}, chunky pixel art texture. ${PIXEL_RULES}`, axes, seed, 'nearest', editor),
          'seam repair',
          notes,
          log,
        );
        if (repaired) {
          hi = repaired;
          px = pixelize(hi, pixelOptions);
          notes.push(`repaired → ${formatSeam(seamScore(px), axes)}`);
        }
      }
      return {
        name: item.name,
        variant: run * CELLS + i, // sort key; renumbered per item in generate()
        files: { [`${item.name}.png`]: await encodePng(px) },
        extras: { 'atlas.png': atlasPng, 'cell.png': await encodePng(hi) },
        preview: tile(px, 3, axes === 'xy' ? 3 : 1),
        notes,
        prompt,
        seed,
      };
    }),
  );
}
