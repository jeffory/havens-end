import { hash3 } from '../util/hash';
import { Block, BLOCK_PALETTE } from './blocks';
import { Chunk, CHUNK_SIZE } from './Chunk';
import type { VoxelPalette } from './palette';
import type { VoxelWorld } from './VoxelWorld';

/** A chunk plus a one-voxel border borrowed from its neighbours. */
export const PADDED = CHUNK_SIZE + 2;
const P = PADDED;
const P2 = P * P;
/** Index deltas in the padded volume for +1 along x, y, z. Layout: x + z * P + y * P². */
const STRIDE = [1, P2, P];

export interface MeshData {
  /** Chunk-local positions (0..32 on each axis). */
  positions: Float32Array;
  normals: Float32Array;
  /** Linear RGB, ambient occlusion and colour jitter already applied. */
  colors: Float32Array;
  indices: Uint32Array;
}

/**
 * Copies a chunk and its one-voxel border into a flat array, so meshing needs no world
 * lookups. This is the seam for moving meshing into a Web Worker later: the padded
 * volume (39 KB) is all a worker needs.
 */
export function buildPaddedVolume(
  world: VoxelWorld,
  cx: number,
  cy: number,
  cz: number,
  out: Uint8Array = new Uint8Array(P * P * P),
  /** Terrain is never seen from below, so treat y < 0 as bedrock and skip the underside faces. Off for models. */
  bedrock = true,
): Uint8Array {
  out.fill(Block.Air);
  if (bedrock && cy === 0) out.fill(Block.Stone, 0, P2);

  for (let ny = -1; ny <= 1; ny++) {
    for (let nz = -1; nz <= 1; nz++) {
      for (let nx = -1; nx <= 1; nx++) {
        const chunk = world.getChunk(cx + nx, cy + ny, cz + nz);
        if (!chunk || chunk.filled === 0) continue;
        const [x0, x1] = paddedSpan(nx);
        const [y0, y1] = paddedSpan(ny);
        const [z0, z1] = paddedSpan(nz);
        // Padded coord p maps to the neighbour's local coord p - 1 - n * CHUNK_SIZE.
        for (let py = y0; py < y1; py++) {
          const ly = py - 1 - ny * CHUNK_SIZE;
          for (let pz = z0; pz < z1; pz++) {
            const lz = pz - 1 - nz * CHUNK_SIZE;
            for (let px = x0; px < x1; px++) {
              out[px + pz * P + py * P2] = chunk.data[Chunk.index(px - 1 - nx * CHUNK_SIZE, ly, lz)];
            }
          }
        }
      }
    }
  }
  return out;
}

/** Which padded coordinates [start, end) a neighbour at offset -1, 0 or +1 fills. */
function paddedSpan(n: number): [number, number] {
  return n < 0 ? [0, 1] : n > 0 ? [P - 1, P] : [1, P - 1];
}

interface Corner {
  /** Vertex offset from the voxel's minimum corner. */
  x: number;
  y: number;
  z: number;
  /** Padded-index deltas (from the voxel) to the two edge neighbours and the diagonal neighbour that shade this corner. */
  side1: number;
  side2: number;
  diagonal: number;
}

interface Face {
  normal: [number, number, number];
  /** Padded-index delta to the voxel this face looks into. */
  neighbor: number;
  corners: Corner[];
}

/** The six cube faces. Corner order is counter-clockwise seen from outside, so front faces point out. */
const FACES: Face[] = [];
for (let axis = 0; axis < 3; axis++) {
  const u = (axis + 1) % 3;
  const v = (axis + 2) % 3;
  for (const dir of [1, -1]) {
    const normal: [number, number, number] = [0, 0, 0];
    normal[axis] = dir;
    const neighbor = dir * STRIDE[axis];
    const uvs = dir > 0 ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[0, 0], [0, 1], [1, 1], [1, 0]];
    const corners = uvs.map(([du, dv]) => {
      const offset = [0, 0, 0];
      offset[axis] = dir > 0 ? 1 : 0;
      offset[u] = du;
      offset[v] = dv;
      const su = (du ? 1 : -1) * STRIDE[u];
      const sv = (dv ? 1 : -1) * STRIDE[v];
      return { x: offset[0], y: offset[1], z: offset[2], side1: neighbor + su, side2: neighbor + sv, diagonal: neighbor + su + sv };
    });
    FACES.push({ normal, neighbor, corners });
  }
}

/** Brightness for 0-3 unoccluded neighbours around a vertex. */
const AO_CURVE = [0.5, 0.68, 0.85, 1];
/** Per-voxel brightness variation, for a hand-painted rather than flat-shaded look. */
const COLOR_JITTER = 0.07;

/**
 * Builds a face-culled mesh with per-vertex ambient occlusion from a padded volume.
 * Pure function: no world access, no Three.js. Terrain uses block colours; models
 * (ships) pass the palette from their .vox file.
 *
 * Plain culled faces rather than greedy meshing: with AO and colour jitter on every
 * voxel, few faces could be merged anyway. Revisit if triangle counts ever matter.
 */
export function meshPaddedVolume(
  vol: Uint8Array,
  originX: number,
  originY: number,
  originZ: number,
  palette: VoxelPalette = BLOCK_PALETTE,
): MeshData | null {
  const { colors: rgb, solid } = palette;
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const ao = [0, 0, 0, 0];

  for (let py = 1; py <= CHUNK_SIZE; py++) {
    for (let pz = 1; pz <= CHUNK_SIZE; pz++) {
      for (let px = 1; px <= CHUNK_SIZE; px++) {
        const i = px + pz * P + py * P2;
        const id = vol[i];
        if (!solid[id]) continue;

        const x = px - 1;
        const y = py - 1;
        const z = pz - 1;
        const shade = 1 + (hash3(originX + x, originY + y, originZ + z) * 2 - 1) * COLOR_JITTER;
        const r = rgb[id * 3] * shade;
        const g = rgb[id * 3 + 1] * shade;
        const b = rgb[id * 3 + 2] * shade;

        for (const face of FACES) {
          if (solid[vol[i + face.neighbor]]) continue;

          const base = positions.length / 3;
          for (let c = 0; c < 4; c++) {
            const corner = face.corners[c];
            const s1 = solid[vol[i + corner.side1]];
            const s2 = solid[vol[i + corner.side2]];
            const d = solid[vol[i + corner.diagonal]];
            ao[c] = s1 && s2 ? 0 : 3 - (s1 + s2 + d);
            const light = AO_CURVE[ao[c]];
            positions.push(x + corner.x, y + corner.y, z + corner.z);
            normals.push(face.normal[0], face.normal[1], face.normal[2]);
            colors.push(r * light, g * light, b * light);
          }
          // Split the quad along the diagonal with the brighter ends, so occlusion
          // shades one corner instead of smearing across the whole face.
          if (ao[0] + ao[2] > ao[1] + ao[3]) {
            indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
          } else {
            indices.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
          }
        }
      }
    }
  }

  if (indices.length === 0) return null;
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
  };
}
