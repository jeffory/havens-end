import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseVox } from '../../../src/vox/parseVox';
import { decodeImage, encodePng } from '../image/io';
import { distinctColours } from '../image/palette';
import { createRaster, type Raster, setPixel } from '../image/raster';
import { makeGlb } from '../voxel/glbFixture';
import { blockColour, material, pattern } from './surfaces';
import { stubClient } from './testing';
import type { Recipe } from './types';
import { vox } from './vox';

const opts = (recipe: Recipe, flags: Record<string, string | number | boolean> = {}) => ({
  model: 'nano-banana-pro' as const,
  seed: 5,
  variants: 1,
  flags: { ...Object.fromEntries(Object.entries(recipe.flags).map(([k, f]) => [k, f.default])), ...flags },
});

function checker(size: number, cell: number, a: number[], b: number[]): Raster {
  const r = createRaster(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) setPixel(r, x, y, [...((Math.floor(x / cell) + Math.floor(y / cell)) % 2 ? a : b), 255] as [number, number, number, number]);
  return r;
}

describe('pattern recipe', () => {
  it('makes a one-pixel-per-voxel tile tinted to a game block colour', async () => {
    const { client } = stubClient({ raw: () => checker(1024, 64, [120, 120, 120], [90, 90, 90]) });

    const [c] = await pattern.generate(client, [{ name: 'sand_ripples', prompt: 'ripples' }], opts(pattern, { size: 32, colors: 4, block: 'sand' }), () => {});
    const png = await decodeImage(c.files['sand_ripples.png']);

    expect([png.width, png.height]).toEqual([32, 32]);
    expect(distinctColours(png)).toBeLessThanOrEqual(4);
    const mean = [0, 1, 2].map((ch) => {
      let s = 0;
      for (let i = 0; i < png.data.length; i += 4) s += png.data[i + ch];
      return s / (png.data.length / 4);
    });
    const sand = blockColour('sand');
    mean.forEach((m, ch) => expect(Math.abs(m - sand[ch])).toBeLessThan(15));
  });

  it('knows the game block colours by name', () => {
    expect(blockColour('Sand')).toEqual([0xe9, 0xd6, 0xa0]);
    expect(() => blockColour('lava')).toThrow(/sand, seabed, grass/);
  });
});

describe('material recipe', () => {
  it('repairs the seam and derives normal and height maps', async () => {
    const gradient = createRaster(1024, 1024);
    for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) setPixel(gradient, x, y, [x / 4, 90, 60, 255]);
    const { client, calls } = stubClient({
      raw: () => gradient,
      repaired: () => createRaster(1024, 1024, [128, 90, 60, 255]),
      normal: () => createRaster(1024, 1024, [128, 128, 255, 255]),
      height: () => createRaster(1024, 1024, [128, 128, 128, 255]),
    });

    const [c] = await material.generate(client, [{ name: 'deck', prompt: 'oak deck' }], opts(material), () => {});

    expect(Object.keys(c.files).sort()).toEqual(['color.png', 'height.png', 'normal.png']);
    expect(calls.some((call) => call.types.includes('SetLatentNoiseMask'))).toBe(true);
    expect(calls.some((call) => call.types.includes('Deep Bump (mtb)'))).toBe(true);
  });
});

describe('material recipe when the seam repair fails', () => {
  it('keeps the unrepaired colour texture', async () => {
    const { client } = stubClient({
      raw: () => createRaster(1024, 1024, [120, 90, 60, 255]),
      repaired: () => {
        throw new Error('out of memory');
      },
      normal: () => createRaster(8, 8),
      height: () => createRaster(8, 8),
    });

    const [c] = await material.generate(client, [{ name: 'deck', prompt: 'oak deck' }], opts(material), () => {});

    expect(c.files['color.png']).toBeDefined();
    expect(c.notes).toContain('seam repair failed');
  });
});

describe('material recipe when the maps step fails', () => {
  it('keeps the finished colour texture and notes the failure', async () => {
    const { client } = stubClient({
      raw: () => createRaster(1024, 1024, [120, 90, 60, 255]),
      repaired: () => createRaster(1024, 1024, [120, 90, 60, 255]),
      normal: () => {
        throw new Error('ComfyUI run failed: Deep Bump (mtb): model not found');
      },
      height: () => createRaster(8, 8),
    });

    const [c] = await material.generate(client, [{ name: 'deck', prompt: 'oak deck' }], opts(material), () => {});

    expect(Object.keys(c.files)).toEqual(['color.png']);
    expect(c.notes.join(' ')).toMatch(/no maps: .*Deep Bump/);
  });
});

describe('vox recipe', () => {
  const texture = createRaster(4, 4, [180, 120, 60, 255]);

  it('turns concept art into a 3D model and then a MagicaVoxel file', async () => {
    const glb = makeGlb({
      positions: [0, 0, 0, 1, 0, 0, 1, 2, 0, 0, 2, 0],
      uvs: [0, 1, 1, 1, 1, 0, 0, 0],
      indices: [0, 1, 2, 0, 2, 3],
      image: { mime: 'image/png', bytes: await encodePng(texture) },
    });
    const { client, calls } = stubClient({ concept: () => createRaster(64, 64, [255, 255, 255, 255]), model: () => glb });

    const [c] = await vox.generate(client, [{ name: 'post', prompt: 'a post' }], opts(vox, { height: 8, colors: 4, turns: 0 }), () => {});
    const file = parseVox(c.files['post.vox'].slice().buffer);

    expect(calls[0].types).toContain('TripoImageToModelNode');
    expect(file.models[0].sizeZ).toBe(8);
    expect(file.models[0].voxels.length / 4).toBeGreaterThan(0);
    expect(Object.keys(c.extras).sort()).toEqual(['concept.png', 'model.glb']);
  });

  it('gives each variant its own Tripo seeds, so variants of one image differ', async () => {
    const glb = makeGlb({ image: { mime: 'image/png', bytes: await encodePng(texture) } });
    const { client, calls } = stubClient({ concept: () => createRaster(8, 8), model: () => glb });

    await vox.generate(client, [{ name: 'x', prompt: 'x' }], { ...opts(vox, { height: 4 }), variants: 2 }, () => {});

    const seeds = calls.map((c) => Object.values(c.graph.toJSON()).find((n) => n.class_type === 'TripoImageToModelNode')!.inputs.model_seed);
    expect(new Set(seeds).size).toBe(2);
  });

  it('re-voxelizes an existing GLB without calling ComfyUI (free)', async () => {
    const path = join(tmpdir(), `assetgen-model-${process.pid}.glb`);
    await writeFile(path, makeGlb({ image: { mime: 'image/png', bytes: await encodePng(texture) } }));
    const { client, calls } = stubClient({});

    const [c] = await vox.generate(client, [{ name: 'x', prompt: 'x' }], opts(vox, { glb: path, height: 6, turns: 0 }), () => {});

    expect(calls).toHaveLength(0);
    expect(parseVox(c.files['x.vox'].slice().buffer).models[0].sizeZ).toBe(6);
  });

  it('starts from a supplied image instead of generating concept art', async () => {
    const path = join(tmpdir(), `assetgen-concept-${process.pid}.png`);
    await writeFile(path, await encodePng(createRaster(8, 8, [1, 2, 3, 255])));
    const glb = makeGlb({ image: { mime: 'image/png', bytes: await encodePng(texture) } });
    const { client, calls, uploads } = stubClient({ concept: () => createRaster(8, 8), model: () => glb });

    await vox.generate(client, [{ name: 'x', prompt: 'x' }], opts(vox, { image: path, height: 4 }), () => {});

    expect(uploads).toHaveLength(1);
    expect(calls[0].types).not.toContain('GeminiImage2Node');
  });
});
