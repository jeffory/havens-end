import { describe, expect, it } from 'vitest';
import { makeGlb } from './glbFixture';
import { parseGlb } from './glb';

describe('parseGlb', () => {
  it('reads a textured triangle and applies the node transform', () => {
    const glb = makeGlb({ node: { translation: [10, 0, 0], scale: [2, 2, 2] } });

    const { meshes, images } = parseGlb(glb);

    expect(Array.from(meshes[0].positions)).toEqual([10, 0, 0, 12, 0, 0, 10, 2, 0]);
    expect(Array.from(meshes[0].uvs!)).toEqual([0, 0, 1, 0, 0, 1]);
    expect(Array.from(meshes[0].indices)).toEqual([0, 1, 2]);
    expect(meshes[0].baseColor).toEqual([1, 0.5, 0.5, 1]);
    expect(images[meshes[0].image!]).toEqual({ mime: 'image/png', bytes: new Uint8Array([7, 7, 7]) });
  });

  it('composes matrix transforms down the node tree', () => {
    const half = [0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 1];
    const glb = makeGlb({ node: { matrix: half }, parent: { translation: [0, 0, 4] } });

    const { meshes } = parseGlb(glb);

    expect(Array.from(meshes[0].positions)).toEqual([0, 0, 4, 0.5, 0, 4, 0, 0.5, 4]);
  });

  it('refuses Draco-compressed files with a clear message', () => {
    expect(() => parseGlb(makeGlb({ extensionsRequired: ['KHR_draco_mesh_compression'] }))).toThrow(/Draco/);
  });
});
