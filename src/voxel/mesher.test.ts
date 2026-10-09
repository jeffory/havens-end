import { describe, expect, it } from 'vitest';
import { Block, BLOCK_PALETTE } from './blocks';
import { buildPaddedVolume, meshPaddedVolume } from './mesher';
import { FLAG_GLASS, FLAG_GLOW, paletteFromRgba } from './palette';
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

  it('marks each vertex’s corner of its block, so a point a quarter in from it lies inside the block, edges and all', () => {
    const world = new VoxelWorld();
    const blocks: Array<[number, number, number, number]> = [
      [5, 5, 5, Block.Plaster],
      [9, 5, 5, Block.StoneSlab],
      [13, 5, 5, Block.StoneStairE],
      [17, 5, 5, Block.Thatch],
      [17, 4, 5, Block.Plaster], // its top kept under the thatch
    ];
    for (const [x, y, z, id] of blocks) world.setVoxel(x, y, z, id);
    const mesh = meshChunk(world, 0, 0, 0)!;
    expect(mesh.corners).toBeDefined();
    expect(mesh.corners!.length).toBe(mesh.positions.length / 3);
    const cells = new Set(blocks.map(([x, y, z]) => `${x},${y},${z}`));
    const faces = mesh.positions.length / 12;
    for (let f = 0; f < faces; f++) {
      const inside = new Set<string>();
      for (let v = f * 4; v < f * 4 + 4; v++) {
        const bits = mesh.corners![v];
        const at = [0, 1, 2].map((a) => Math.floor(mesh.positions[v * 3 + a] + 0.25 - 0.5 * ((bits >> a) & 1)));
        inside.add(at.join(','));
      }
      expect(inside.size, `face ${f}: its corners, moved in, in one block`).toBe(1);
      expect(cells.has([...inside][0]), `face ${f}: in its own block, not ${[...inside][0]}`).toBe(true);
    }
  });

  it('marks the top of a building block kept under one that may be lifted away, and no other face, for the cut’s cap', () => {
    const world = new VoxelWorld();
    world.setVoxel(5, 5, 5, Block.Plaster);
    world.setVoxel(5, 6, 5, Block.Thatch); // the plaster's top kept under it
    world.setVoxel(9, 5, 5, Block.Window);
    world.setVoxel(9, 6, 5, Block.Plaster); // the window's top kept under it
    world.setVoxel(13, 5, 5, Block.Plaster); // open to the sky: a top, not a cut
    world.setVoxel(17, 5, 5, Block.Stone);
    world.setVoxel(17, 6, 5, Block.Plaster); // the ground's face against a building: kept, but not a building's top
    world.setVoxel(21, 5, 5, Block.StoneStairE);
    world.setVoxel(25, 5, 5, Block.Leaves);
    world.setVoxel(25, 6, 5, Block.Leaves); // a canopy cut through: foliage, not a plate
    const mesh = meshChunk(world, 0, 0, 0)!;
    const capped = new Set<string>();
    for (let v = 0; v < mesh.positions.length / 3; v++) {
      if (!(mesh.corners![v] & 8)) continue;
      expect(mesh.normals[v * 3 + 1], 'a capped face looks up').toBe(1);
      capped.add([0, 1, 2].map((a) => Math.floor(mesh.positions[v * 3 + a] + 0.25 - 0.5 * ((mesh.corners![v] >> a) & 1))).join(','));
    }
    expect([...capped].sort()).toEqual(['5,5,5', '9,5,5']);
  });

  it('marks a window’s faces as glass, to be drawn as panes lit from within, and nothing else', () => {
    const world = new VoxelWorld();
    world.setVoxel(5, 5, 5, Block.Window);
    world.setVoxel(9, 5, 5, Block.Lantern); // glows, but isn't glass
    world.setVoxel(13, 5, 5, Block.Embers);
    world.setVoxel(17, 5, 5, Block.Plaster);
    const mesh = meshChunk(world, 0, 0, 0)!;
    const glass = new Set<number>();
    for (let v = 0; v < mesh.positions.length / 3; v++) {
      const flags = mesh.flags![v];
      expect((flags & FLAG_GLOW) !== 0 || (flags & FLAG_GLASS) === 0, 'glass glows').toBe(true);
      if (flags & FLAG_GLASS) glass.add(Math.floor(mesh.positions[v * 3] + 0.25 - 0.5 * (mesh.corners![v] & 1))); // its block, by its corner
    }
    expect([...glass]).toEqual([5]);
    expect(BLOCK_PALETTE.flags!.filter((f) => f & FLAG_GLASS)).toHaveLength(1);
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

describe('mesher: stairs, slabs and the blocker', () => {
  it('draws a slab as a half-height box', () => {
    const world = new VoxelWorld();
    world.setVoxel(5, 5, 5, Block.StoneSlab);
    const mesh = meshChunk(world, 0, 0, 0)!;
    expect(faceCount(mesh)).toBe(6);
    const ys = [...mesh.positions].filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys)).toBe(5.5);
    expect(Math.min(...ys)).toBe(5);
  });

  it('draws a stair as its two boxes, the top over the half it climbs to', () => {
    const world = new VoxelWorld();
    world.setVoxel(5, 5, 5, Block.StoneStairE);
    const mesh = meshChunk(world, 0, 0, 0)!;
    expect(faceCount(mesh)).toBe(12);
    const topXs: number[] = [];
    for (let v = 0; v < mesh.positions.length / 3; v++) if (mesh.positions[v * 3 + 1] === 6) topXs.push(mesh.positions[v * 3]);
    expect(Math.min(...topXs)).toBe(5.5);
    expect(Math.max(...topXs)).toBe(6);
  });

  it('hides a slab’s faces against whole cubes, but keeps the cubes’ faces against the slab', () => {
    const world = new VoxelWorld();
    world.setVoxel(5, 4, 5, Block.Stone); // under the slab
    world.setVoxel(5, 5, 5, Block.StoneSlab);
    world.setVoxel(6, 5, 5, Block.Stone); // beside it
    // Both stones keep all six faces (the slab hides none); the slab loses its bottom and its +x side.
    expect(faceCount(meshChunk(world, 0, 0, 0))).toBe(16);
  });

  it('culls a slab’s face against a cube in the next chunk, and keeps the cube’s', () => {
    const world = new VoxelWorld();
    world.setVoxel(31, 5, 5, Block.StoneSlab);
    world.setVoxel(32, 5, 5, Block.Stone);
    expect(faceCount(meshChunk(world, 0, 0, 0))).toBe(5);
    expect(faceCount(meshChunk(world, 1, 0, 0))).toBe(6);
  });

  it('never draws the blocker, and hides nothing behind it', () => {
    const world = new VoxelWorld();
    world.setVoxel(5, 5, 5, Block.Stone);
    world.setVoxel(6, 5, 5, Block.Blocker);
    expect(faceCount(meshChunk(world, 0, 0, 0))).toBe(6);
  });

  it('meshes a model’s colour indices as cubes, whatever terrain block shares the number', () => {
    const world = new VoxelWorld();
    world.setVoxel(5, 5, 5, Block.StoneStairE);
    const rgba = new Uint8Array(256 * 4).fill(255);
    const mesh = meshPaddedVolume(buildPaddedVolume(world, 0, 0, 0, undefined, false), 0, 0, 0, paletteFromRgba(rgba))!;
    expect(mesh.indices.length / 6).toBe(6);
  });

  it('keeps the old diagonal split for a whole cube when its corners tie on raw occlusion counts', () => {
    const world = new VoxelWorld();
    world.setVoxel(5, 5, 5, Block.Stone);
    // At y = 6, around the top face: S and W each block a corner outright (occlusion count 0);
    // the other two corners (reached via the clear N and E sides) both come out at a raw count of
    // 2, a tie, even though those two corners' occlusion counts differ (1 and 2) and so map to
    // different AO_CURVE brightnesses (0.68 vs 0.85) that would break the tie the other way.
    world.setVoxel(5, 6, 6, Block.Stone); // S
    world.setVoxel(4, 6, 5, Block.Stone); // W
    world.setVoxel(4, 6, 4, Block.Stone); // NW
    world.setVoxel(6, 6, 4, Block.Stone); // NE
    world.setVoxel(6, 6, 6, Block.Stone); // SE
    const { positions, normals, indices } = meshChunk(world, 0, 0, 0)!;
    let seen = 0;
    for (let q = 0; q < indices.length; q += 6) {
      const six = indices.slice(q, q + 6);
      const base = Math.min(...six);
      if (normals[base * 3 + 1] !== 1 || positions[base * 3 + 1] !== 6) continue;
      seen++;
      // The old code's split repeats the corner-0 vertex once, not twice: the tie goes the way
      // the raw occlusion counts (not the AO_CURVE-mapped brightness) would have broken it.
      expect([...six].filter((idx) => idx === base).length).toBe(1);
    }
    expect(seen).toBe(1);
  });
});
