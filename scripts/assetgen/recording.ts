import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RunError } from './comfy/client';
import type { Graph } from './comfy/graph';
import type { Client } from './recipes/types';

/**
 * Wraps a client so nothing paid for is ever lost: every submitted graph is saved to
 * <dir>/graphs/ (open one in ComfyUI to tweak that run), and every downloaded output,
 * including the partial outputs of a failed run, to <dir>/raw/ the moment it arrives,
 * before any local processing that could fail. The API key is never in either: it
 * travels only in the request body's extra_data.
 */
export function recordingClient(client: Client, dir: string, log: (line: string) => void): Client {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  let n = 0;

  const keep = async (run: number, files: Record<string, Buffer[]>): Promise<number> => {
    await mkdir(join(dir, 'raw'), { recursive: true });
    let count = 0;
    for (const [role, list] of Object.entries(files)) {
      for (const [i, bytes] of list.entries()) {
        await writeFile(join(dir, 'raw', `${stamp}-${run}-${role}${list.length > 1 ? `-${i}` : ''}.${extension(bytes)}`), bytes);
        count++;
      }
    }
    return count;
  };

  return {
    uploadImage: (bytes) => client.uploadImage(bytes),
    async run(graph: Graph) {
      const run = ++n;
      await mkdir(join(dir, 'graphs'), { recursive: true });
      await writeFile(join(dir, 'graphs', `${stamp}-${run}.json`), JSON.stringify(graph.toJSON(), null, 2));
      try {
        const result = await client.run(graph);
        await keep(run, result.files);
        return result;
      } catch (error) {
        if (error instanceof RunError && Object.keys(error.files).length) {
          const kept = await keep(run, error.files);
          log(`kept ${kept} output(s) of the failed run in ${join(dir, 'raw')}/`);
        }
        throw error;
      }
    },
  };
}

function extension(bytes: Buffer): string {
  if (bytes.subarray(0, 4).toString('latin1') === 'glTF') return 'glb';
  if (bytes[0] === 0x89 && bytes.subarray(1, 4).toString('latin1') === 'PNG') return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  return 'bin';
}
