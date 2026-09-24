import { readFile } from 'node:fs/promises';
import { Graph } from '../comfy/graph';
import { textToImage } from '../comfy/models';
import { imageTo3d, loadImage } from '../comfy/pipelines';
import { userPath } from '../env';
import { decodeImage, encodePng } from '../image/io';
import { voxConceptPrompt } from '../style';
import { parseGlb } from '../voxel/glb';
import { renderIso } from '../voxel/preview';
import { gridToVox, quantizeGrid } from '../voxel/toVox';
import { voxelize } from '../voxel/voxelize';
import { collect, outputImage, paidPerImage } from './common';
import type { Candidate, GenOptions, Item, Recipe } from './types';

/**
 * Concept art → textured 3D model (Tripo v3.1) → voxels → MagicaVoxel .vox. The concept
 * is generated from the prompt unless `--image` supplies one (your own sketch or render);
 * `--glb` skips ComfyUI entirely and re-voxelizes a model you already have, for free.
 */
export const vox: Recipe = {
  id: 'vox',
  summary: 'Concept art → 3D (Tripo) → voxel model (.vox for MagicaVoxel)',
  defaultModel: 'nano-banana-pro',
  flags: {
    height: { default: 24, min: 2, max: 256, help: 'model height in voxels (MagicaVoxel caps every axis at 256)' },
    colors: { default: 32, min: 2, max: 255, help: 'palette size' },
    turns: { default: 1, min: 0, max: 3, help: 'quarter turns clockwise to face the front to −y (Tripo models face +x)' },
    image: { default: '', help: 'use this concept image instead of generating one' },
    glb: { default: '', help: 're-voxelize this GLB (e.g. a candidate model.glb or one in .assetgen/raw/) without ComfyUI' },
  },
  installDir: () => 'public/models/props',
  // Tripo per model, plus the concept image unless one is supplied; a GLB needs no calls.
  paidCalls: (items, opts) => (opts.flags.glb ? 0 : items.length * opts.variants * (1 + (opts.flags.image ? 0 : paidPerImage(opts)))),

  async generate(client, items, opts, log) {
    if (opts.flags.glb) {
      const glb = new Uint8Array(await readFile(userPath(String(opts.flags.glb))));
      return collect(
        items.map(async (item) => [await toCandidate(item, opts, 1, opts.seed, `(re-voxelized ${opts.flags.glb})`, glb)]),
        log,
      );
    }
    const supplied = opts.flags.image ? await readFile(userPath(String(opts.flags.image))) : undefined;
    const jobs = items.flatMap((item) =>
      Array.from({ length: opts.variants }, async (_, i): Promise<Candidate[]> => {
        const variant = i + 1;
        const seed = opts.seed + i;
        const prompt = supplied ? `(supplied image ${opts.flags.image})` : voxConceptPrompt(item.prompt);
        const g = new Graph();
        const concept = supplied
          ? loadImage(g, await client.uploadImage(supplied))
          : textToImage(g, opts.model, { prompt, width: 1024, height: 1024, seed });
        g.save('concept', concept);
        g.saveModel('model', imageTo3d(g, concept, seed));
        log(`vox: generating ${item.name} (variant ${variant}; concept + 3D takes about 3 minutes)`);
        const result = await client.run(g);
        const glb = result.files.model?.[0];
        if (!glb) throw new Error('ComfyUI returned no 3D model');
        return [await toCandidate(item, opts, variant, seed, prompt, glb, await encodePng(await outputImage(result, 'concept')))];
      }),
    );
    return collect(jobs, log);
  },
};

async function toCandidate(item: Item, opts: GenOptions, variant: number, seed: number, prompt: string, glbBytes: Uint8Array, concept?: Uint8Array): Promise<Candidate> {
  const glb = parseGlb(glbBytes);
  const textures = await Promise.all(glb.images.map((img) => decodeImage(img.bytes)));
  const height = Number(opts.flags.height);
  const grid = voxelize(glb, textures, { height, turns: Number(opts.flags.turns) });
  const colors = Number(opts.flags.colors);
  const notes = [`${grid.size.join('×')} voxels`];
  if (grid.size[2] < height) notes.push(`shrunk to fit 256`);
  return {
    name: item.name,
    variant,
    files: { [`${item.name}.vox`]: gridToVox(grid, { colors, name: item.name }) },
    extras: { ...(concept ? { 'concept.png': concept } : {}), 'model.glb': glbBytes },
    preview: renderIso(quantizeGrid(grid, colors).grid, 6),
    notes,
    prompt,
    seed,
  };
}
