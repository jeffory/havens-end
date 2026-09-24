/** Test helpers for recipes: a stub ComfyUI client driven by the roles a graph saves. */
import type { Graph } from '../comfy/graph';
import { decodeImage, encodePng } from '../image/io';
import type { Raster } from '../image/raster';
import type { Client } from './types';

export interface StubCall {
  graph: Graph;
  types: string[];
}

/**
 * `answers` maps a save role to the image (or raw bytes) returned for it. Every call is
 * recorded with the node types of its graph so tests can assert what was run.
 */
export function stubClient(answers: Record<string, (g: Graph) => Raster | Uint8Array>) {
  const calls: StubCall[] = [];
  const uploads: Raster[] = [];
  const client: Client = {
    async run(graph) {
      calls.push({ graph, types: Object.values(graph.toJSON()).map((n) => n.class_type) });
      const files: Record<string, Buffer[]> = {};
      for (const role of Object.keys(graph.roles)) {
        const answer = answers[role];
        if (!answer) throw new Error(`stub has no answer for role "${role}"`);
        const value = answer(graph);
        files[role] = [value instanceof Uint8Array ? Buffer.from(value) : await encodePng(value)];
      }
      return { promptId: `p${calls.length}`, files };
    },
    async uploadImage(bytes) {
      uploads.push(await decodeImage(bytes));
      return `upload-${uploads.length}.png`;
    },
  };
  return { client, calls, uploads };
}
