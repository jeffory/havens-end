import { describe, expect, it } from 'vitest';
import { decodeImage } from '../image/io';
import { distinctColours } from '../image/palette';
import { createRaster, getPixel, type Raster, setPixel } from '../image/raster';
import { icons, sprite } from './sprites';
import { stubClient } from './testing';
import type { Recipe } from './types';

const opts = (recipe: Recipe, flags: Record<string, string | number> = {}) => ({
  model: 'nano-banana-pro' as const,
  seed: 3,
  variants: 1,
  flags: { ...Object.fromEntries(Object.entries(recipe.flags).map(([k, f]) => [k, f.default])), ...flags },
});

/** A 1024² white image with a coloured 200 × 400 figure, and its matching mask. */
function figure(): { raw: Raster; mask: Raster } {
  const raw = createRaster(1024, 1024, [255, 255, 255, 255]);
  const mask = createRaster(1024, 1024, [0, 0, 0, 255]);
  for (let y = 300; y < 700; y++) {
    for (let x = 400; x < 600; x++) {
      setPixel(raw, x, y, y < 450 ? [200, 30, 30, 255] : [40, 40, 90, 255]);
      setPixel(mask, x, y, [255, 255, 255, 255]);
    }
  }
  return { raw, mask };
}

describe('sprite recipe', () => {
  it('cuts the figure out and scales it to the target height as true pixel art', async () => {
    const { raw, mask } = figure();
    const { client, calls } = stubClient({ raw: () => raw, mask: () => mask });

    const [c] = await sprite.generate(client, [{ name: 'captain', prompt: 'a pirate captain' }], opts(sprite, { height: 32, colors: 4 }), () => {});
    const png = await decodeImage(c.files['captain.png']);

    expect(calls[0].types).toContain('BiRefNetRMBG');
    expect([png.width, png.height]).toEqual([16, 32]); // 200 × 400 figure at 32 px tall
    expect(getPixel(png, 8, 4)).toEqual([200, 30, 30, 255]);
    expect(distinctColours(png)).toBeLessThanOrEqual(4);
  });
});

describe('sprite recipe with a failing variant', () => {
  it('keeps the variant that worked', async () => {
    const { raw, mask } = figure();
    let calls = 0;
    const { client } = stubClient({
      raw: () => {
        if (++calls === 2) throw new Error('safety filter');
        return raw;
      },
      mask: () => mask,
    });
    const lines: string[] = [];

    const candidates = await sprite.generate(client, [{ name: 'captain', prompt: 'p' }], { ...opts(sprite), variants: 2 }, (l) => lines.push(l));

    expect(candidates).toHaveLength(1);
    expect(lines.join('\n')).toMatch(/1 of 2 jobs failed: safety filter/);
  });
});

describe('icons recipe', () => {
  it('draws all icons in one sheet and slices them into square icons', async () => {
    // 2×2 sheet: a 200 px square icon centred in each 512 px cell.
    const raw = createRaster(1024, 1024, [208, 208, 208, 255]);
    const mask = createRaster(1024, 1024, [0, 0, 0, 255]);
    for (let i = 0; i < 4; i++) {
      const ox = (i % 2) * 512 + 156;
      const oy = Math.floor(i / 2) * 512 + 156;
      for (let y = oy; y < oy + 200; y++) {
        for (let x = ox; x < ox + 200; x++) {
          setPixel(raw, x, y, [60 * i, 200 - 40 * i, 90, 255]);
          setPixel(mask, x, y, [255, 255, 255, 255]);
        }
      }
    }
    const { client, calls } = stubClient({ raw: () => raw, mask: () => mask });
    const items = ['coin', 'rum', 'map'].map((name) => ({ name, prompt: name }));

    const candidates = await icons.generate(client, items, opts(icons, { size: 16 }), () => {});

    expect(calls).toHaveLength(1);
    // Square image, square grid: the spare fourth cell becomes a second coin.
    expect(calls[0].graph.toJSON()['1'].inputs.prompt).toMatch(/2x2 grid.*4\. another take on coin/);
    expect(candidates.map((c) => `${c.name}#${c.variant}`)).toEqual(['coin#1', 'coin#2', 'rum#1', 'map#1']);
    const rum = await decodeImage(candidates[2].files['rum.png']);
    expect([rum.width, rum.height]).toEqual([16, 16]);
    expect(getPixel(rum, 8, 8)).toEqual([60, 160, 90, 255]);
    expect(getPixel(rum, 0, 0)[3]).toBe(0); // margin stays transparent
  });
});
