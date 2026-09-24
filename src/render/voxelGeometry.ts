import { BufferAttribute, BufferGeometry } from 'three';
import { CHUNK_SIZE } from '../voxel/Chunk';
import { buildPaddedVolume, type MeshData, meshPaddedVolume, PADDED } from '../voxel/mesher';
import type { VoxelPalette } from '../voxel/palette';
import { VoxelWorld } from '../voxel/VoxelWorld';

export function toGeometry(data: MeshData): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(data.normals, 3));
  geometry.setAttribute('color', new BufferAttribute(data.colors, 3));
  if (data.flags) geometry.setAttribute('flags', new BufferAttribute(data.flags, 1));
  geometry.setIndex(new BufferAttribute(data.indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Meshes a free-standing voxel model (x, y, z, colourIndex quads) with the terrain
 * mesher, so ships get the same ambient occlusion and hand-painted look as the islands.
 * Positions come out in the cells' own coordinates.
 */
export function meshCells(cells: Int32Array, palette: VoxelPalette): BufferGeometry {
  const world = new VoxelWorld();
  for (let i = 0; i < cells.length; i += 4) world.setVoxel(cells[i], cells[i + 1], cells[i + 2], cells[i + 3]);

  const parts: MeshData[] = [];
  const scratch = new Uint8Array(PADDED ** 3);
  for (const chunk of world.allChunks()) {
    const ox = chunk.cx * CHUNK_SIZE;
    const oy = chunk.cy * CHUNK_SIZE;
    const oz = chunk.cz * CHUNK_SIZE;
    const data = meshPaddedVolume(buildPaddedVolume(world, chunk.cx, chunk.cy, chunk.cz, scratch, false), ox, oy, oz, palette);
    if (!data) continue;
    for (let i = 0; i < data.positions.length; i += 3) {
      data.positions[i] += ox;
      data.positions[i + 1] += oy;
      data.positions[i + 2] += oz;
    }
    parts.push(data);
  }
  return toGeometry(merge(parts));
}

function merge(parts: MeshData[]): MeshData {
  const count = (key: 'positions' | 'indices') => parts.reduce((n, p) => n + p[key].length, 0);
  const out: MeshData = {
    positions: new Float32Array(count('positions')),
    normals: new Float32Array(count('positions')),
    colors: new Float32Array(count('positions')),
    indices: new Uint32Array(count('indices')),
  };
  let vertexOffset = 0;
  let indexOffset = 0;
  for (const part of parts) {
    out.positions.set(part.positions, vertexOffset * 3);
    out.normals.set(part.normals, vertexOffset * 3);
    out.colors.set(part.colors, vertexOffset * 3);
    for (let i = 0; i < part.indices.length; i++) out.indices[indexOffset + i] = part.indices[i] + vertexOffset;
    vertexOffset += part.positions.length / 3;
    indexOffset += part.indices.length;
  }
  return out;
}
