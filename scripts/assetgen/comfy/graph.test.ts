import { describe, expect, it } from 'vitest';
import { Graph } from './graph';

describe('Graph', () => {
  it('builds ComfyUI API-format JSON with numbered nodes and [id, output] links', () => {
    const g = new Graph();
    const loader = g.add('CheckpointLoaderSimple', { ckpt_name: 'x.safetensors' });
    const encode = g.add('CLIPTextEncode', { clip: loader.out(1), text: 'hello' });

    expect(g.toJSON()).toEqual({
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
      '2': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: 'hello' } },
    });
    expect(encode.id).toBe('2');
  });

  it('records which save node holds which named output', () => {
    const g = new Graph();
    const img = g.add('EmptyImage', { width: 8, height: 8 });
    g.save('color', img.out(0));

    const [id, save] = Object.entries(g.toJSON()).find(([, n]) => n.class_type === 'SaveImage')!;
    expect(save.inputs.images).toEqual(['1', 0]);
    expect(g.roles).toEqual({ color: id });
  });

  it('drops inputs left undefined so optional inputs can be passed conditionally', () => {
    const g = new Graph();
    g.add('Node', { a: 1, b: undefined });
    expect(g.toJSON()['1'].inputs).toEqual({ a: 1 });
  });
});
