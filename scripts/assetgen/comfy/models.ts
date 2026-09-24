import type { Graph, Ref } from './graph';

export type ModelId = 'nano-banana-pro' | 'nano-banana-2' | 'gpt-image-2' | 'seedream-4.5' | 'flux-2-max' | 'flux-2-pro' | 'klein' | 'sdxl-seamless';

export interface ModelInfo {
  /** Runs through a paid partner API (needs COMFY_API_KEY and spends credits). */
  partner: boolean;
  /** Accepts reference images for style or content. */
  refs: boolean;
  note: string;
}

export const MODELS: Record<ModelId, ModelInfo> = {
  'nano-banana-pro': { partner: true, refs: true, note: 'Gemini 3 Pro Image: best pixel art, sprites and block atlases' },
  'nano-banana-2': { partner: true, refs: true, note: 'Gemini 3.1 Flash Image: cheaper Nano Banana for drafts' },
  'gpt-image-2': { partner: true, refs: true, note: 'OpenAI GPT Image 2 (high quality): strong sprites, slower' },
  'seedream-4.5': { partner: true, refs: true, note: 'ByteDance Seedream 4.5: painterly, high resolution' },
  'flux-2-max': { partner: true, refs: true, note: 'BFL FLUX.2 [max]: most realistic HD materials' },
  'flux-2-pro': { partner: true, refs: true, note: 'BFL FLUX.2 [pro]: cheaper FLUX.2' },
  klein: { partner: false, refs: false, note: 'FLUX.2 Klein 4B on the local GPU: free, ~15 s, good drafts' },
  'sdxl-seamless': { partner: false, refs: false, note: 'Juggernaut XL with circular padding: free and truly seamless, plainer' },
};

export const isModelId = (s: string): s is ModelId => s in MODELS;

export interface TextToImageRequest {
  prompt: string;
  width: number;
  height: number;
  seed: number;
  /** IMAGE outputs to use as style/content references (models with `refs` only). */
  refs?: Ref[];
  /** Only the SDXL model uses a negative prompt. */
  negative?: string;
}

const ASPECTS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] as const;

/** The supported aspect-ratio label closest to width:height. */
export function nearestAspect(width: number, height: number): string {
  const target = Math.log(width / height);
  const error = (aspect: string) => {
    const [w, h] = aspect.split(':').map(Number);
    return Math.abs(Math.log(w / h) - target);
  };
  return ASPECTS.reduce<string>((best, aspect) => (error(aspect) < error(best) ? aspect : best), ASPECTS[0]);
}

/** Adds the nodes that generate one image with `model`; returns the IMAGE output. */
export function textToImage(g: Graph, model: ModelId, req: TextToImageRequest): Ref {
  if (req.refs?.length && !MODELS[model].refs) throw new Error(`${model} does not take reference images`);
  const refs = req.refs?.length ? batch(g, req.refs) : undefined;
  const long = Math.max(req.width, req.height);

  switch (model) {
    case 'nano-banana-pro':
    case 'nano-banana-2':
      return g
        .add('GeminiImage2Node', {
          prompt: req.prompt,
          model: model === 'nano-banana-pro' ? 'gemini-3-pro-image-preview' : 'Nano Banana 2 (Gemini 3.1 Flash Image)',
          seed: req.seed,
          aspect_ratio: nearestAspect(req.width, req.height),
          resolution: long <= 1024 ? '1K' : long <= 2048 ? '2K' : '4K',
          response_modalities: 'IMAGE',
          images: refs,
        })
        .out(0);
    case 'gpt-image-2': {
      const size = req.width === req.height ? (long > 1024 ? '2048x2048' : '1024x1024') : req.width > req.height ? '1536x1024' : '1024x1536';
      return g
        .add('OpenAIGPTImage1', { prompt: req.prompt, model: 'gpt-image-2', quality: 'high', background: 'opaque', size, n: 1, seed: req.seed % 2147483647, image: refs })
        .out(0);
    }
    case 'seedream-4.5': {
      const scale = Math.max(1, 2048 / long);
      return g
        .add('ByteDanceSeedreamNode', {
          model: 'seedream-4-5-251128',
          prompt: req.prompt,
          size_preset: 'Custom',
          width: Math.round(req.width * scale),
          height: Math.round(req.height * scale),
          seed: req.seed % 2147483647,
          watermark: false,
          image: refs,
        })
        .out(0);
    }
    case 'flux-2-max':
    case 'flux-2-pro':
      return g
        .add(model === 'flux-2-max' ? 'Flux2MaxImageNode' : 'Flux2ProImageNode', {
          prompt: req.prompt,
          width: clamp(req.width, 256, 2048),
          height: clamp(req.height, 256, 2048),
          seed: req.seed,
          prompt_upsampling: false,
          images: refs,
        })
        .out(0);
    case 'klein':
      return klein(g, req);
    case 'sdxl-seamless':
      return sdxlSeamless(g, req);
  }
}

/** FLUX.2 Klein 4B loaders and conditioning, shared with the seam-repair pass. */
export function kleinBase(g: Graph, prompt: string) {
  const model = g.add('UNETLoader', { unet_name: 'flux-2-klein-4b.safetensors', weight_dtype: 'default' }).out(0);
  const clip = g.add('CLIPLoader', { clip_name: 'qwen_3_4b.safetensors', type: 'flux2' }).out(0);
  const vae = g.add('VAELoader', { vae_name: 'flux2-vae.safetensors' }).out(0);
  const cond = g.add('CLIPTextEncode', { clip, text: prompt }).out(0);
  return { model, vae, cond };
}

/** Distilled Klein: 4 steps, cfg 1 (the negative is ignored at cfg 1, so it reuses the positive). */
export function kleinSample(g: Graph, model: Ref, cond: Ref, latent: Ref, width: number, height: number, seed: number): Ref {
  const guider = g.add('CFGGuider', { model, positive: cond, negative: cond, cfg: 1 }).out(0);
  return g
    .add('SamplerCustomAdvanced', {
      noise: g.add('RandomNoise', { noise_seed: seed }).out(0),
      guider,
      sampler: g.add('KSamplerSelect', { sampler_name: 'euler' }).out(0),
      sigmas: g.add('Flux2Scheduler', { steps: 4, width, height }).out(0),
      latent_image: latent,
    })
    .out(0);
}

function klein(g: Graph, req: TextToImageRequest): Ref {
  const { model, vae, cond } = kleinBase(g, req.prompt);
  const latent = g.add('EmptyFlux2LatentImage', { width: req.width, height: req.height, batch_size: 1 }).out(0);
  const samples = kleinSample(g, model, cond, latent, req.width, req.height, req.seed);
  return g.add('VAEDecode', { samples, vae }).out(0);
}

function sdxlSeamless(g: Graph, req: TextToImageRequest): Ref {
  const ckpt = g.add('CheckpointLoaderSimple', { ckpt_name: 'juggernautXL_ragnarokBy.safetensors' });
  const model = g.add('Model Patch Seamless (mtb)', { model: ckpt.out(0), startStep: 0, stopStep: 999, tilingX: true, tilingY: true }).out(0);
  const encode = (text: string) => g.add('CLIPTextEncode', { clip: ckpt.out(1), text }).out(0);
  const samples = g
    .add('KSampler', {
      model,
      positive: encode(req.prompt),
      negative: encode(req.negative ?? 'perspective, shadows, vignette, border, frame, text, watermark, blurry, lowres'),
      latent_image: g.add('EmptyLatentImage', { width: req.width, height: req.height, batch_size: 1 }).out(0),
      seed: req.seed,
      steps: 30,
      cfg: 5,
      sampler_name: 'dpmpp_2m',
      scheduler: 'karras',
      denoise: 1,
    })
    .out(0);
  return g.add('Vae Decode (mtb)', { samples, vae: ckpt.out(2), seamless_model: true, use_tiling_decoder: false, tile_size: 512 }).out(0);
}

function batch(g: Graph, images: Ref[]): Ref {
  return images.slice(1).reduce((acc, img) => g.add('ImageBatch', { image1: acc, image2: img }).out(0), images[0]);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
