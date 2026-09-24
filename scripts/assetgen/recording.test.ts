import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RunError } from './comfy/client';
import { Graph } from './comfy/graph';
import { recordingClient } from './recording';
import type { Client } from './recipes/types';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const GLB = Buffer.from('glTF....');

function graph() {
  const g = new Graph();
  const img = g.add('EmptyImage', {});
  g.save('concept', img.out(0));
  g.saveModel('model', img.out(0));
  return g;
}

describe('recordingClient', () => {
  it('saves each submitted graph and every downloaded output as soon as it arrives', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'assetgen-rec-'));
    const inner: Client = { run: async () => ({ promptId: 'p', files: { concept: [PNG], model: [GLB] } }), uploadImage: async () => 'x' };

    await recordingClient(inner, dir, () => {}).run(graph());

    const raw = (await readdir(join(dir, 'raw'))).sort();
    expect(raw).toHaveLength(2);
    expect(raw.find((f) => f.includes('concept'))).toMatch(/\.png$/);
    expect(raw.find((f) => f.includes('model'))).toMatch(/\.glb$/);
    const graphs = await readdir(join(dir, 'graphs'));
    expect(JSON.parse(await readFile(join(dir, 'graphs', graphs[0]), 'utf8'))['1'].class_type).toBe('EmptyImage');
  });

  it('keeps the outputs of a failed run, says where, and still fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'assetgen-rec-'));
    const lines: string[] = [];
    const inner: Client = {
      run: async () => {
        throw new RunError('BiRefNetRMBG failed', 'p9', { concept: [PNG] });
      },
      uploadImage: async () => 'x',
    };

    await expect(recordingClient(inner, dir, (l) => lines.push(l)).run(graph())).rejects.toThrow(/BiRefNetRMBG/);
    expect(await readdir(join(dir, 'raw'))).toHaveLength(1);
    expect(lines.join('\n')).toMatch(/kept 1 output.*raw/);
  });
});
