import type { Graph, Ref } from './graph';
import { kleinBase, kleinSample } from './models';

/** An image previously uploaded with ComfyClient.uploadImage. */
export function loadImage(g: Graph, name: string): Ref {
  return g.add('LoadImage', { image: name }).out(0);
}

/** An uploaded greyscale image used as a MASK (white = 1). */
export function loadMask(g: Graph, name: string): Ref {
  return g.add('ImageToMask', { image: loadImage(g, name), channel: 'red' }).out(0);
}

export interface SeamRepairRequest {
  /** The texture rolled by half, so its old edges meet in a cross at the centre. */
  image: Ref;
  /** Feathered cross mask over those edges. */
  mask: Ref;
  prompt: string;
  width: number;
  height: number;
  seed: number;
}

/**
 * Repaints the masked seam cross with FLUX.2 Klein so the texture tiles. Differential
 * diffusion reads the feathered mask as per-pixel strength, so the repaint fades into
 * the untouched pixels instead of leaving a hard boundary.
 */
export function seamRepair(g: Graph, req: SeamRepairRequest): Ref {
  const { model, vae, cond } = kleinBase(g, req.prompt);
  const diffModel = g.add('DifferentialDiffusion', { model, strength: 1 }).out(0);
  const latent = g.add('VAEEncode', { pixels: req.image, vae }).out(0);
  const masked = g.add('SetLatentNoiseMask', { samples: latent, mask: req.mask }).out(0);
  const samples = kleinSample(g, diffModel, cond, masked, req.width, req.height, req.seed);
  return g.add('VAEDecode', { samples, vae }).out(0);
}

/**
 * Foreground MASK from BiRefNet (runs on the local GPU). Any alpha channel is dropped
 * first: BiRefNet fails on RGBA input, and Nano Banana returns RGBA images.
 */
export function removeBackground(g: Graph, image: Ref): Ref {
  const rgb = g.add('SplitImageWithAlpha', { image }).out(0);
  return g.add('BiRefNetRMBG', { image: rgb, model: 'BiRefNet-general', background: 'Alpha' }).out(1);
}

/** A MASK as a saveable greyscale IMAGE. */
export function maskAsImage(g: Graph, mask: Ref): Ref {
  return g.add('MaskToImage', { mask }).out(0);
}

/** Normal and height maps estimated from a colour texture (Deep Bump, local). */
export function normalAndHeight(g: Graph, color: Ref): { normal: Ref; height: Ref } {
  const bump = (image: Ref, mode: string) =>
    g
      .add('Deep Bump (mtb)', {
        image,
        mode,
        color_to_normals_overlap: 'SMALL',
        normals_to_curvature_blur_radius: 'SMALL',
        normals_to_height_seamless: true,
        auto_download: true, // fetches deepbump256.onnx on first use; omitted, it arrives as None
      })
      .out(0);
  const normal = bump(color, 'Color to Normals');
  return { normal, height: bump(normal, 'Normals to Height') };
}

/** Image → textured 3D model (GLB) with Tripo v3.1; colours are baked into the texture. */
export function imageTo3d(g: Graph, image: Ref, seed = 42): Ref {
  const tripoSeed = seed % 2_147_483_647;
  return g
    .add('TripoImageToModelNode', {
      image,
      model_version: 'v3.1-20260211',
      style: 'None',
      texture: true,
      pbr: false,
      model_seed: tripoSeed,
      orientation: 'default',
      texture_seed: tripoSeed,
      texture_quality: 'standard',
      texture_alignment: 'original_image',
      face_limit: 20000,
      quad: false,
      geometry_quality: 'standard',
    })
    .out(2);
}
