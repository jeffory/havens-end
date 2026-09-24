import { Graph } from '../comfy/graph';
import { MODELS, type ModelId, textToImage } from '../comfy/models';
import { loadImage, loadMask, seamRepair } from '../comfy/pipelines';
import { decodeImage, encodePng, resize } from '../image/io';
import { kmeansPalette, quantize, type Rgb } from '../image/palette';
import { type DownscaleMode, kCentroidDownscale } from '../image/pixelate';
import type { Raster } from '../image/raster';
import { compositeMasked, maskToRaster, roll, seamCrossMask, type TileAxes } from '../image/seam';
import { seamEditPrompt } from '../style';
import type { Client, GenOptions } from './types';

/** Seam repair runs at this size: FLUX.2 Klein's native resolution. */
const REPAIR_SIZE = 1024;
/** Width of the repainted seam band and of its feathered edge, in pixels at REPAIR_SIZE. */
const SEAM_BAND = 160;
const SEAM_FEATHER = 48;

export interface PixelizeOptions {
  width: number;
  height: number;
  /** Palette size to derive, unless `palette` is given. */
  colors?: number;
  palette?: Rgb[];
  mode?: DownscaleMode;
}

/** True pixel art: k-centroid down to width × height, then a palette of `colors` (or the given palette). */
export function pixelize(image: Raster, { width, height, colors = 16, palette, mode = 'dominant' }: PixelizeOptions): Raster {
  const small = kCentroidDownscale(image, width, height, 3, mode);
  return quantize(small, palette ?? kmeansPalette(small, colors));
}

/** 1 when `opts.model` is a paid partner model, else 0: multiply by the generations a run makes. */
export const paidPerImage = (opts: GenOptions): number => (MODELS[opts.model].partner ? 1 : 0);

/** The --downscale flag shared by the pixel-art recipes. */
export const downscaleFlag = (defaultMode: DownscaleMode) => ({
  default: defaultMode,
  choices: ['detail', 'dominant'],
  help: "'detail' keeps thin lines and specks (textures); 'dominant' is cleaner and flatter (sprites)",
});

export const downscaleMode = (flag: unknown): DownscaleMode => (flag === 'detail' ? 'detail' : 'dominant');

/**
 * Waits for every job and keeps what succeeded: one failed item or variant must not
 * throw away its siblings' (paid) results. Failures are reported; only a run where
 * everything failed is an error.
 */
export async function collect<T>(jobs: Array<Promise<T[]>>, log: (line: string) => void): Promise<T[]> {
  const settled = await Promise.allSettled(jobs);
  const errors = settled.flatMap((s) => (s.status === 'rejected' ? [(s.reason as Error).message] : []));
  if (errors.length === settled.length && errors.length > 0) throw new Error(`All ${errors.length} jobs failed: ${errors.join('; ')}`);
  if (errors.length) log(`${errors.length} of ${settled.length} jobs failed: ${errors.join('; ')}`);
  return settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
}

/** Runs an optional improvement step; if it fails, keeps the input and notes why. */
export async function optional<T>(input: T, step: () => Promise<T>, what: string, notes: string[], log: (line: string) => void): Promise<T> {
  try {
    return await step();
  } catch (error) {
    log(`${what} failed, keeping the unrepaired result: ${(error as Error).message}`);
    notes.push(`${what} failed`);
    return input;
  }
}

/** The first file saved under `role`, decoded. */
export async function outputImage(result: { files: Record<string, Buffer[]> }, role: string): Promise<Raster> {
  const file = result.files[role]?.[0];
  if (!file) throw new Error(`ComfyUI returned no "${role}" image`);
  return decodeImage(file);
}

/**
 * Makes a texture tile: rolls it by half so the wrap seams meet in a cross at the centre,
 * repaints a feathered band over the cross, then composites so every pixel outside the
 * band is kept. The repaint is done by `editor` when given (an image-editing model such
 * as Nano Banana Pro, which redraws in the texture's own pixel style), else by FLUX.2
 * Klein inpainting on the local GPU. Only the model's copy is scaled to its working size
 * (nearest-neighbour for pixel art, smooth for HD); rolling, masking and compositing
 * happen at the texture's own size, so pixels outside the band are kept exactly.
 * The result is the rolled texture: it tiles the same, offset by half.
 */
export async function repairSeam(
  client: Client,
  texture: Raster,
  prompt: string,
  axes: TileAxes,
  seed: number,
  scaling: 'nearest' | 'smooth' = 'nearest',
  editor?: ModelId,
): Promise<Raster> {
  if (editor && !MODELS[editor].refs) throw new Error(`${editor} cannot edit images, so it cannot repair seams`);
  const { width: w, height: h } = texture;
  const fitsModel = w === REPAIR_SIZE && h === REPAIR_SIZE;
  // Roll, mask and composite at the texture's own size; only the model's copy is scaled.
  const rolled = roll(texture, Math.floor(w / 2), axes === 'xy' ? Math.floor(h / 2) : 0);
  const scale = w / REPAIR_SIZE;
  const mask = seamCrossMask(w, h, SEAM_BAND * scale, SEAM_FEATHER * scale, axes);

  const g = new Graph();
  const work = fitsModel ? rolled : await resize(rolled, REPAIR_SIZE, REPAIR_SIZE, scaling);
  const image = loadImage(g, await client.uploadImage(await encodePng(work)));
  if (editor) {
    g.save('repaired', textToImage(g, editor, { prompt: seamEditPrompt(prompt, axes), width: REPAIR_SIZE, height: REPAIR_SIZE, seed, refs: [image] }));
  } else {
    const workMask = maskToRaster(seamCrossMask(REPAIR_SIZE, REPAIR_SIZE, SEAM_BAND, SEAM_FEATHER, axes), REPAIR_SIZE, REPAIR_SIZE);
    const maskRef = loadMask(g, await client.uploadImage(await encodePng(workMask)));
    g.save('repaired', seamRepair(g, { image, mask: maskRef, prompt, width: REPAIR_SIZE, height: REPAIR_SIZE, seed }));
  }
  const repaired = await outputImage(await client.run(g), 'repaired');
  const native = repaired.width === w && repaired.height === h ? repaired : await resize(repaired, w, h, scaling);
  return compositeMasked(rolled, native, mask);
}
