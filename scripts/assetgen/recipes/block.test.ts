import { describe, expect, it } from 'vitest';
import { decodeImage } from '../image/io';
import { distinctColours } from '../image/palette';
import { createRaster, type Raster, setPixel } from '../image/raster';
import { block } from './block';
import { stubClient } from './testing';

/** 3×3 atlas, 4 px black gutters; seamless checker cells, or a gradient where `seamed` lists the cell. */
function atlas(seamed: number[] = []): Raster {
  const cell = 64;
  const g = 4;
  const size = 3 * cell + 4 * g;
  const r = createRaster(size, size, [0, 0, 0, 255]);
  for (let i = 0; i < 9; i++) {
    const ox = g + (i % 3) * (cell + g);
    const oy = g + Math.floor(i / 3) * (cell + g);
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const v = seamed.includes(i) ? 40 + x * 3 : (Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? 200 : 120;
        setPixel(r, ox + x, oy + y, [v, 100 + (i % 3) * 40, 80, 255]);
      }
    }
  }
  return r;
}

const opts = (flags: Record<string, string | number> = {}) => ({
  model: 'nano-banana-pro' as const,
  seed: 11,
  variants: 1,
  flags: { ...Object.fromEntries(Object.entries(block.flags).map(([k, f]) => [k, f.default])), ...flags },
});

const items = [
  { name: 'grass', prompt: 'lush grass' },
  { name: 'sand', prompt: 'pale sand' },
  { name: 'stone', prompt: 'grey stone' },
];

describe('block recipe', () => {
  it('fills a 3×3 atlas, spending spare cells on extra variations, as true 16×16 textures', async () => {
    const { client, calls } = stubClient({ raw: () => atlas() });

    const candidates = await block.generate(client, items, opts({ size: 16, colors: 6 }), () => {});

    expect(calls).toHaveLength(1);
    expect(calls[0].graph.toJSON()['1'].inputs.prompt).toMatch(/3x3 grid/);
    expect(candidates.map((c) => c.name)).toEqual(['grass', 'grass', 'grass', 'sand', 'sand', 'sand', 'stone', 'stone', 'stone']);
    expect(candidates.filter((c) => c.name === 'sand').map((c) => c.variant)).toEqual([1, 2, 3]);
    for (const c of candidates) {
      const png = await decodeImage(c.files[`${c.name}.png`]);
      expect([png.width, png.height]).toEqual([16, 16]);
      expect(distinctColours(png)).toBeLessThanOrEqual(6);
    }
  });

  it('keeps the unrepaired texture when the seam repair fails', async () => {
    const { client } = stubClient({
      raw: () => atlas([1]),
      repaired: () => {
        throw new Error('model refused');
      },
    });

    const candidates = await block.generate(client, items, opts(), () => {});

    expect(candidates).toHaveLength(9);
    expect(candidates.filter((c) => c.notes.includes('seam repair failed'))).toHaveLength(1);
  });

  it('repairs only textures whose seam shows, redrawing with the generation model when it can edit', async () => {
    const { client, calls } = stubClient({ raw: () => atlas([1]), repaired: () => createRaster(1024, 1024, [90, 140, 80, 255]) });

    const candidates = await block.generate(client, items, opts(), () => {});

    const repairs = calls.filter((c) => c.graph.roles.repaired);
    expect(repairs).toHaveLength(1);
    expect(repairs[0].types).toContain('GeminiImage2Node');
    expect(candidates.filter((c) => c.notes.join(' ').includes('repaired'))).toHaveLength(1);
  });
});
