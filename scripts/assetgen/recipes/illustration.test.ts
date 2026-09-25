import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { createRaster } from '../image/raster';
import { illustration } from './illustration';
import { stubClient } from './testing';

const opts = (flags: Record<string, string | number> = {}) => ({
  model: 'nano-banana-pro' as const,
  seed: 5,
  variants: 1,
  flags: { ...Object.fromEntries(Object.entries(illustration.flags).map(([k, f]) => [k, f.default])), ...flags },
});

describe('illustration recipe', () => {
  it('paints a wide picture and installs it as a WebP of the asked-for size', async () => {
    const { client, calls } = stubClient({ raw: () => createRaster(1376, 768, [180, 120, 60, 255]) });
    const [c] = await illustration.generate(client, [{ name: 'storm', prompt: 'a ship in a storm' }], opts({ width: 800, height: 450 }), () => {});
    const meta = await sharp(c.files['storm.webp']).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 800, 450]);
    expect(calls[0].types).toContain('GeminiImage2Node');
    expect(c.prompt).toMatch(/a ship in a storm/);
    expect(c.preview.width).toBe(480);
  });

  it('counts one paid generation per picture and variant', () => {
    expect(illustration.paidCalls([{ name: 'a', prompt: 'p' }, { name: 'b', prompt: 'p' }], { ...opts(), variants: 2 })).toBe(4);
  });
});
