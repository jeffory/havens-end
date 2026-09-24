import { describe, expect, it } from 'vitest';
import { createRaster, setPixel } from '../image/raster';
import type { Glb, GlbMesh } from './glb';
import { voxelize } from './voxelize';

/** A vertical 1 × 1 square in the glTF XY plane (facing +z), as two triangles. */
function wall(extra: Partial<GlbMesh> = {}): GlbMesh {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
    uvs: new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    baseColor: [1, 1, 1, 1],
    ...extra,
  };
}

describe('voxelize', () => {
  it('scales the model to the requested height with z up, MagicaVoxel style', () => {
    const glb: Glb = { meshes: [wall({ colors: new Float32Array(16).fill(1) })], images: [] };

    const grid = voxelize(glb, [], { height: 8 });

    expect(grid.size).toEqual([8, 1, 8]); // x = width, y = depth (glTF z), z = height (glTF y)
    for (let x = 0; x < 8; x++) for (let z = 0; z < 8; z++) expect(grid.get(x, 0, z)).toBeDefined();
  });

  it('colours voxels from the base-colour texture', () => {
    const tex = createRaster(2, 1);
    setPixel(tex, 0, 0, [255, 0, 0, 255]);
    setPixel(tex, 1, 0, [0, 0, 255, 255]);
    const glb: Glb = { meshes: [wall({ image: 0 })], images: [{ mime: 'image/png', bytes: new Uint8Array() }] };

    const grid = voxelize(glb, [tex], { height: 8 });

    expect(grid.get(1, 0, 4)).toEqual([255, 0, 0]); // left half of the texture
    expect(grid.get(6, 0, 4)).toEqual([0, 0, 255]); // right half
  });

  it('multiplies by the material colour factor and uses vertex colours when untextured', () => {
    const colors = new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const glb: Glb = { meshes: [wall({ colors, baseColor: [1, 0.5, 0, 1] })], images: [] };

    expect(voxelize(glb, [], { height: 4 }).get(2, 0, 2)).toEqual([255, 128, 0]);
  });

  it('turns the model clockwise about the up axis, a quarter turn at a time', () => {
    // A 2 × 1 slab along glTF +x (MV +x); one turn points it along MV −y.
    const slab = wall({ positions: new Float32Array([0, 0, 0, 2, 0, 0, 2, 1, 0, 0, 1, 0]), colors: new Float32Array(16).fill(1) });

    expect(voxelize({ meshes: [slab], images: [] }, [], { height: 2 }).size).toEqual([4, 1, 2]);
    expect(voxelize({ meshes: [slab], images: [] }, [], { height: 2, turns: 1 }).size).toEqual([1, 4, 2]);
  });

  it('shrinks the model rather than exceed the 256-voxel MagicaVoxel limit on any axis', () => {
    // A long, low plank: 100 wide, 1 tall. At 24 voxels tall it would be 2400 wide.
    const plank = wall({ positions: new Float32Array([0, 0, 0, 100, 0, 0, 100, 1, 0, 0, 1, 0]), colors: new Float32Array(16).fill(1) });

    const grid = voxelize({ meshes: [plank], images: [] }, [], { height: 24 });

    expect(Math.max(...grid.size)).toBeLessThanOrEqual(256);
    expect(grid.size[0]).toBe(256);
  });

  it('puts what is high in the model at the top of the grid', () => {
    const top = wall({ positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0.1, 0, 0, 0.1, 0]), colors: new Float32Array(16).fill(1) });
    const post = wall({ positions: new Float32Array([0.45, 0, 0, 0.55, 0, 0, 0.55, 2, 0, 0.45, 2, 0]), colors: new Float32Array(16).fill(1) });

    const grid = voxelize({ meshes: [top, post], images: [] }, [], { height: 20 });

    expect(grid.size[2]).toBe(20);
    expect(grid.get(5, 0, 19)).toBeDefined(); // the post reaches the top
    expect(grid.get(0, 0, 19)).toBeUndefined(); // the low slab does not
  });
});
