import { describe, expect, it } from 'vitest';
import { Block } from './blocks';
import { buildPaddedVolume, meshPaddedVolume } from './mesher';
import { paletteFromRgba } from './palette';
import { VoxelWorld } from './VoxelWorld';

function meshChunk(world: VoxelWorld, cx: number, cy: number, cz: number) {
  return meshPaddedVolume(buildPaddedVolume(world, cx, cy, cz), cx * 32, cy * 32, cz * 32);
}

const faceCount = (mesh: ReturnType<typeof meshChunk>) => (mesh ? mesh.indices.length / 6 : 0);

describe('mesher', () => {
  it('emits six faces for a lone voxel', () => {
    const world = new VoxelWorld();
    world.setVoxel(5, 5, 5, Block.Stone);
    const mesh = meshChunk(world, 0, 0, 0);
    expect(faceCount(mesh)).toBe(6);
    expect(mesh!.positions.length).toBe(6 * 4 * 3);
  });

  it('culls the shared faces of adjacent voxels', () => {
    const world = new VoxelWorld();
    world.setVoxel(5, 5, 5, Block.Stone);
    world.setVoxel(6, 5, 5, Block.Stone);
    expect(faceCount(meshChunk(world, 0, 0, 0))).toBe(10);
  });

  it('culls faces against voxels in neighbouring chunks', () => {
    const world = new VoxelWorld();
    world.setVoxel(31, 5, 5, Block.Stone);
    world.setVoxel(32, 5, 5, Block.Stone);
    expect(faceCount(meshChunk(world, 0, 0, 0))).toBe(5);
    expect(faceCount(meshChunk(world, 1, 0, 0))).toBe(5);
  });

  it('treats the space below y = 0 as bedrock, so the world has no underside', () => {
    const world = new VoxelWorld();
    world.setVoxel(5, 0, 5, Block.Stone);
    expect(faceCount(meshChunk(world, 0, 0, 0))).toBe(5);
  });

  it('returns null for a chunk with nothing to draw', () => {
    const world = new VoxelWorld();
    world.getOrCreateChunk(0, 0, 0);
    expect(meshChunk(world, 0, 0, 0)).toBeNull();
  });

  it('winds faces counter-clockwise when seen from outside', () => {
    const world = new VoxelWorld();
    world.setVoxel(5, 5, 5, Block.Stone);
    const { positions, normals, indices } = meshChunk(world, 0, 0, 0)!;
    for (let t = 0; t < indices.length; t += 3) {
      const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]].map((i) => [
        positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2],
      ]);
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cross = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const n = indices[t] * 3;
      expect(cross[0] * normals[n] + cross[1] * normals[n + 1] + cross[2] * normals[n + 2]).toBeGreaterThan(0);
    }
  });

  it('darkens vertices in corners (ambient occlusion)', () => {
    const world = new VoxelWorld();
    world.setVoxel(5, 5, 5, Block.Stone);
    const lone = meshChunk(world, 0, 0, 0)!;
    world.setVoxel(6, 6, 5, Block.Stone); // overhangs the +x edge of the top face
    const occluded = meshChunk(world, 0, 0, 0)!;
    const darkest = (colors: Float32Array) => Math.min(...colors);
    expect(darkest(occluded.colors)).toBeLessThan(darkest(lone.colors));
  });
});

describe('mesher options for models', () => {
  it('keeps underside faces when bedrock is off', () => {
    const world = new VoxelWorld();
    world.setVoxel(5, 0, 5, Block.Stone);
    const mesh = meshPaddedVolume(buildPaddedVolume(world, 0, 0, 0, undefined, false), 0, 0, 0);
    expect(mesh!.indices.length / 6).toBe(6);
  });

  it('colours voxels from the palette it is given', () => {
    const world = new VoxelWorld();
    world.setVoxel(5, 5, 5, 200);
    const rgba = new Uint8Array(256 * 4);
    rgba.set([255, 0, 0, 255], 200 * 4);
    const mesh = meshPaddedVolume(buildPaddedVolume(world, 0, 0, 0), 0, 0, 0, paletteFromRgba(rgba))!;
    expect(mesh.colors[0]).toBeGreaterThan(0.5); // red
    expect(mesh.colors[1]).toBe(0);
  });

  it('keeps the top of a building block under another, for when the one above is lifted away', () => {
    const world = new VoxelWorld();
    world.setVoxel(5, 5, 5, Block.Plaster);
    world.setVoxel(5, 6, 5, Block.Thatch);
    // Both blocks' outsides (5 each), and the plaster's top, hidden inside the thatch.
    expect(faceCount(meshChunk(world, 0, 0, 0))).toBe(11);
  });

  it('keeps the ground’s face against a tree or building, so lifting it leaves no hole', () => {
    const world = new VoxelWorld();
    world.setVoxel(5, 5, 5, Block.Stone);
    world.setVoxel(6, 5, 5, Block.Thatch);
    // The stone's six (one hidden in the thatch till it lifts); the thatch's five: its face
    // against the stone is never seen, so it isn't drawn over the stone's.
    expect(faceCount(meshChunk(world, 0, 0, 0))).toBe(11);
  });
});
