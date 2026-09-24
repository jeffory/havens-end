import { describe, expect, it } from 'vitest';
import { Graph } from './graph';
import { MODELS, nearestAspect, textToImage } from './models';
import { imageTo3d, loadImage, loadMask, normalAndHeight, removeBackground, seamRepair } from './pipelines';

const nodesOf = (g: Graph) => Object.values(g.toJSON());
const find = (g: Graph, type: string) => nodesOf(g).find((n) => n.class_type === type);

describe('textToImage', () => {
  it('asks Nano Banana Pro for the right model, aspect and resolution', () => {
    const g = new Graph();
    textToImage(g, 'nano-banana-pro', { prompt: 'a chest', width: 2048, height: 2048, seed: 5 });

    expect(find(g, 'GeminiImage2Node')?.inputs).toMatchObject({
      prompt: 'a chest',
      model: 'gemini-3-pro-image-preview',
      aspect_ratio: '1:1',
      resolution: '2K',
      seed: 5,
      response_modalities: 'IMAGE',
    });
  });

  it('batches reference images into the model input', () => {
    const g = new Graph();
    const a = loadImage(g, 'a.png');
    const b = loadImage(g, 'b.png');
    textToImage(g, 'nano-banana-pro', { prompt: 'p', width: 1024, height: 1024, seed: 1, refs: [a, b] });

    const batch = nodesOf(g).find((n) => n.class_type === 'ImageBatch');
    expect(batch?.inputs).toMatchObject({ image1: a, image2: b });
    expect(find(g, 'GeminiImage2Node')?.inputs.images).toBeDefined();
  });

  it('runs FLUX.2 Klein locally with its distilled 4-step, cfg 1 settings', () => {
    const g = new Graph();
    textToImage(g, 'klein', { prompt: 'p', width: 1024, height: 1024, seed: 1 });

    expect(find(g, 'UNETLoader')?.inputs.unet_name).toBe('flux-2-klein-4b.safetensors');
    expect(find(g, 'CLIPLoader')?.inputs).toMatchObject({ clip_name: 'qwen_3_4b.safetensors', type: 'flux2' });
    expect(find(g, 'Flux2Scheduler')?.inputs.steps).toBe(4);
    expect(find(g, 'CFGGuider')?.inputs.cfg).toBe(1);
  });

  it('marks which models spend partner credits', () => {
    expect(MODELS['nano-banana-pro'].partner).toBe(true);
    expect(MODELS.klein.partner).toBe(false);
    expect(MODELS['sdxl-seamless'].partner).toBe(false);
  });
});

describe('nearestAspect', () => {
  it('picks the closest supported ratio', () => {
    expect(nearestAspect(1024, 1536)).toBe('2:3');
    expect(nearestAspect(1920, 1080)).toBe('16:9');
  });
});

describe('seamRepair', () => {
  it('inpaints only the masked cross with differential diffusion', () => {
    const g = new Graph();
    seamRepair(g, { image: loadImage(g, 'rolled.png'), mask: loadMask(g, 'mask.png'), prompt: 'sand', width: 1024, height: 1024, seed: 3 });

    expect(find(g, 'SetLatentNoiseMask')).toBeDefined();
    expect(find(g, 'DifferentialDiffusion')).toBeDefined();
    expect(find(g, 'ImageToMask')?.inputs.channel).toBe('red');
  });
});

describe('normalAndHeight', () => {
  it('lets Deep Bump download its model on first use (omitted optional inputs arrive empty)', () => {
    const g = new Graph();
    normalAndHeight(g, loadImage(g, 'c.png'));
    const bumps = nodesOf(g).filter((n) => n.class_type === 'Deep Bump (mtb)');
    expect(bumps.map((b) => b.inputs.mode)).toEqual(['Color to Normals', 'Normals to Height']);
    bumps.forEach((b) => expect(b.inputs.auto_download).toBe(true));
  });
});

describe('removeBackground', () => {
  it('drops any alpha channel before BiRefNet, which fails on RGBA (Nano Banana returns RGBA)', () => {
    const g = new Graph();
    const img = loadImage(g, 'x.png');
    removeBackground(g, img);

    const nodes = g.toJSON();
    const split = Object.entries(nodes).find(([, n]) => n.class_type === 'SplitImageWithAlpha')!;
    expect(split[1].inputs.image).toEqual(img);
    expect(find(g, 'BiRefNetRMBG')?.inputs.image).toEqual([split[0], 0]);
  });
});

describe('removeBackground and imageTo3d', () => {
  it('uses BiRefNet for masks and Tripo v3.1 with baked colour for 3D', () => {
    const g = new Graph();
    const img = loadImage(g, 'x.png');
    removeBackground(g, img);
    imageTo3d(g, img);

    expect(find(g, 'BiRefNetRMBG')?.inputs.model).toBe('BiRefNet-general');
    expect(find(g, 'TripoImageToModelNode')?.inputs).toMatchObject({ model_version: 'v3.1-20260211', texture: true, pbr: false });
  });
});
