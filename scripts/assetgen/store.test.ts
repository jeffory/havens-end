import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { decodeImage, encodePng } from './image/io';
import { createRaster } from './image/raster';
import type { Candidate } from './recipes/types';
import { Store } from './store';

async function candidate(name: string, variant: number, colour: number): Promise<Candidate> {
  const img = createRaster(16, 16, [colour, 0, 0, 255]);
  return { name, variant, files: { [`${name}.png`]: await encodePng(img) }, extras: { 'raw.png': await encodePng(img) }, preview: img, notes: ['seam 1.0/1.0'], prompt: `full prompt for ${name}`, seed: 40 + variant };
}

const run = { model: 'nano-banana-pro' as const, flags: { size: 16 } };

describe('Store', () => {
  let root: string;
  let store: Store;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'assetgen-store-'));
    store = new Store(root);
  });

  it('saves candidates with metadata and continues variant numbers on later runs', async () => {
    await store.saveRun('block', run, [{ name: 'sand', prompt: 'pale sand' }], [await candidate('sand', 1, 10), await candidate('sand', 2, 20)]);
    const second = await store.saveRun('block', run, [{ name: 'sand', prompt: 'pale sand' }], [await candidate('sand', 1, 30)]);

    expect((await readdir(join(root, '.assetgen/candidates/block/sand'))).sort()).toEqual(['1', '2', '3']);
    const meta = JSON.parse(await readFile(join(root, '.assetgen/candidates/block/sand/3/meta.json'), 'utf8'));
    expect(meta).toMatchObject({ recipe: 'block', name: 'sand', variant: 3, itemPrompt: 'pale sand', model: 'nano-banana-pro', seed: 41, flags: { size: 16 } });
    expect(second.sheet).toMatch(/\.assetgen\/sheets\/.+-block\.png$/);
  });

  it('installs a picked candidate and records it in the manifest', async () => {
    await store.saveRun('sprite', run, [{ name: 'captain', prompt: 'a captain' }], [await candidate('captain', 1, 10), await candidate('captain', 2, 99)]);

    const { installed } = await store.pick('captain', 2);

    expect(installed).toEqual(['public/sprites/captain.png']);
    const png = await decodeImage(await readFile(join(root, 'public/sprites/captain.png')));
    expect(png.data[0]).toBe(99);
    const manifest = JSON.parse(await readFile(join(root, 'scripts/assetgen/assets.json'), 'utf8'));
    expect(manifest['sprite/captain']).toMatchObject({ recipe: 'sprite', prompt: 'a captain', seed: 42, files: ['public/sprites/captain.png'] });
  });

  it('repacks the block atlas whenever a block is picked', async () => {
    await store.saveRun('block', run, [{ name: 'sand', prompt: 's' }, { name: 'dirt', prompt: 'd' }], [await candidate('sand', 1, 10), await candidate('dirt', 1, 20)]);
    await store.pick('sand', 1);
    await store.pick('dirt', 1);

    const layout = JSON.parse(await readFile(join(root, 'public/textures/blocks/atlas.json'), 'utf8'));
    expect(Object.keys(layout.tiles).sort()).toEqual(['dirt', 'sand']);
    const atlas = await decodeImage(await readFile(join(root, 'public/textures/blocks/atlas.png')));
    expect([atlas.width, atlas.height]).toEqual([32, 16]);
  });

  it('keeps same-named assets of different recipes apart and asks which one is meant', async () => {
    await store.saveRun('block', run, [{ name: 'deck', prompt: 'planks' }], [await candidate('deck', 1, 10)]);
    await store.saveRun('material', run, [{ name: 'deck', prompt: 'planks' }], [await candidate('deck', 1, 20)]);

    await expect(store.pick('deck', 1)).rejects.toThrow(/block\/deck.*material\/deck/);
    const { installed } = await store.pick('material/deck', 1);
    expect(installed).toEqual(['public/textures/materials/deck/deck.png']);
    expect(Object.keys(await store.candidates()).sort()).toEqual(['block/deck', 'material/deck']);
  });

  it('removes files of the previous pick that the new pick does not have', async () => {
    const withMaps = { ...(await candidate('deck', 1, 10)), files: { 'color.png': await encodePng(createRaster(4, 4)), 'normal.png': await encodePng(createRaster(4, 4)) } };
    const colourOnly = { ...(await candidate('deck', 2, 20)), files: { 'color.png': await encodePng(createRaster(4, 4)) } };
    await store.saveRun('material', run, [{ name: 'deck', prompt: 'p' }], [withMaps, colourOnly]);

    await store.pick('deck', 1);
    await store.pick('deck', 2);

    expect(await readdir(join(root, 'public/textures/materials/deck'))).toEqual(['color.png']);
  });

  it('warns when the block atlas has to leave out a texture of another size', async () => {
    const big = { ...(await candidate('dirt', 1, 20)), files: { 'dirt.png': await encodePng(createRaster(32, 32, [9, 9, 9, 255])) } };
    await store.saveRun('block', run, [{ name: 'sand', prompt: 's' }, { name: 'dirt', prompt: 'd' }], [await candidate('sand', 1, 10), big]);
    await store.pick('sand', 1);

    const { warnings } = await store.pick('dirt', 1);

    expect(warnings.join(' ')).toMatch(/atlas.*left out.*(sand|dirt)/);
  });

  it('explains when a candidate does not exist', async () => {
    await expect(store.pick('nothing', 1)).rejects.toThrow(/No candidates named "nothing"/);
    await store.saveRun('sprite', run, [{ name: 'cat', prompt: 'c' }], [await candidate('cat', 1, 10)]);
    await expect(store.pick('cat', 5)).rejects.toThrow(/sprite\/cat has no #5/);
  });
});
