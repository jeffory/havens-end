import { describe, expect, it } from 'vitest';
import { distinctColours } from '../image/palette';
import { createRaster, getPixel, setPixel } from '../image/raster';
import { collect, optional, pixelize, repairSeam } from './common';
import { stubClient } from './testing';

const grey = () => createRaster(1024, 1024, [99, 99, 99, 255]);

describe('collect', () => {
  it('keeps the results of jobs that succeeded when others fail, and reports the failures', async () => {
    const lines: string[] = [];
    const out = await collect([Promise.resolve([1, 2]), Promise.reject(new Error('Tripo refused')), Promise.resolve([3])], (l) => lines.push(l));

    expect(out).toEqual([1, 2, 3]);
    expect(lines.join('\n')).toMatch(/1 of 3 jobs failed: Tripo refused/);
  });

  it('fails when every job failed', async () => {
    await expect(collect([Promise.reject(new Error('a')), Promise.reject(new Error('b'))], () => {})).rejects.toThrow(/All 2 jobs failed: a; b/);
  });
});

describe('optional', () => {
  it('returns the step result, or the input with a note when the step fails', async () => {
    const notes: string[] = [];
    expect(await optional(1, async () => 2, 'seam repair', notes, () => {})).toBe(2);
    expect(await optional(1, async () => Promise.reject(new Error('refused')), 'seam repair', notes, () => {})).toBe(1);
    expect(notes).toEqual(['seam repair failed']);
  });
});

describe('pixelize', () => {
  it('reduces a large image to the target size and colour budget', () => {
    const big = createRaster(64, 64);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) setPixel(big, x, y, [x * 4, y * 4, 128, 255]);

    const px = pixelize(big, { width: 16, height: 16, colors: 6 });

    expect([px.width, px.height]).toEqual([16, 16]);
    expect(distinctColours(px)).toBeLessThanOrEqual(6);
  });
});

describe('repairSeam with an editing model', () => {
  it('asks the model to redraw the rolled image and still keeps unmasked pixels exact', async () => {
    const tex = createRaster(64, 64, [10, 10, 10, 255]);
    setPixel(tex, 20, 10, [0, 250, 0, 255]);
    const { client, calls, uploads } = stubClient({ repaired: grey });

    const out = await repairSeam(client, tex, 'sand', 'xy', 7, 'nearest', 'nano-banana-pro');

    const types = calls[0].types;
    expect(types).toContain('GeminiImage2Node');
    expect(types).not.toContain('SetLatentNoiseMask');
    expect(uploads).toHaveLength(1); // only the rolled image: the mask is applied locally
    expect(getPixel(out, 52, 42)).toEqual([0, 250, 0, 255]);
    expect(getPixel(out, 32, 32)).toEqual([99, 99, 99, 255]);
  });
});

describe('repairSeam at sizes other than 1024', () => {
  it('keeps every pixel outside the band exactly, even at 2048 px with fine detail', async () => {
    const tex = createRaster(2048, 2048);
    for (let y = 0; y < 2048; y++) for (let x = 0; x < 2048; x++) setPixel(tex, x, y, (x + y) % 2 ? [250, 250, 250, 255] : [5, 5, 5, 255]);
    const { client } = stubClient({ repaired: grey });

    const out = await repairSeam(client, tex, 'fine', 'xy', 1, 'smooth');

    // (100, 100) of the output is (1124, 1124) of the input, far from the seam cross.
    expect([out.width, out.height]).toEqual([2048, 2048]);
    expect(getPixel(out, 100, 100)).toEqual(getPixel(tex, 1124, 1124));
    expect(getPixel(out, 101, 100)).toEqual(getPixel(tex, 1125, 1124));
    expect(getPixel(out, 1024, 1024)).toEqual([99, 99, 99, 255]); // centre of the cross: repainted
  }, 20_000); // a 2048 px image: slow under a full parallel run
});

describe('repairSeam', () => {
  it('uploads the texture rolled by half plus a mask, and keeps unmasked pixels exact', async () => {
    const tex = createRaster(64, 64, [10, 10, 10, 255]);
    setPixel(tex, 0, 0, [250, 0, 0, 255]); // after rolling by 32, this sits at (32, 32), inside the cross
    setPixel(tex, 20, 10, [0, 250, 0, 255]); // rolls to (52, 42), outside the cross
    const { client, calls, uploads } = stubClient({ repaired: grey });

    const out = await repairSeam(client, tex, 'sand', 'xy', 7);

    expect(uploads).toHaveLength(2); // the rolled image and the mask
    expect(calls[0].types).toContain('SetLatentNoiseMask');
    expect([out.width, out.height]).toEqual([64, 64]);
    expect(getPixel(out, 52, 42)).toEqual([0, 250, 0, 255]); // untouched
    expect(getPixel(out, 32, 32)).toEqual([99, 99, 99, 255]); // repainted
  });
});
