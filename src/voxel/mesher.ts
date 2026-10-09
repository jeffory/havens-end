import { hash3 } from '../util/hash';
import { Block, BLOCK_PALETTE } from './blocks';
import { Chunk, CHUNK_SIZE } from './Chunk';
import { type Box, FLAG_CUTAWAY, type VoxelPalette } from './palette';
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
  /** Per vertex, the block's palette flags (cutaway, glow), when the palette has them. */
  flags?: Float32Array;
  /**
   * Per vertex, with the flags: which corner of its block's box it is, bits 1, 2 and 4 set on
   * the high side in x, y and z. A quarter block in from there is inside its own block, so the
   * terrain shader finds the block every fragment of a face belongs to, edges and all. Bit 8
   * marks a building's or a trunk's top kept under more of it (never foliage's): seen only when
   * what's over it is lifted away, so it's the cut's top, and drawn as its cap.
   */
  corners?: Uint8Array;
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
  /** The axis the face is square to (0 x, 1 y, 2 z), and the two it lies along. */
  axis: number;
  plane: [number, number];
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
    FACES.push({ normal, axis, plane: [u, v], neighbor, corners });
  }
}

/** Cut through, it stays foliage: no timber cap on a canopy. */
const FOLIAGE: ReadonlySet<number> = new Set([Block.Leaves, Block.PalmLeaves]);

/** Brightness for 0-3 unoccluded neighbours around a vertex. */
const AO_CURVE = [0.5, 0.68, 0.85, 1];
/** Per-voxel brightness variation, for a hand-painted rather than flat-shaded look. */
const COLOR_JITTER = 0.07;

/** A whole cube as a box: how every block but a stair or slab is drawn. */
const WHOLE: readonly Box[] = [{ x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 }];
const low = (b: Box, axis: number) => (axis === 0 ? b.x0 : axis === 1 ? b.y0 : b.z0);
const high = (b: Box, axis: number) => (axis === 0 ? b.x1 : axis === 1 ? b.y1 : b.z1);

/** The cube face's corner shading, blended to a point on it (a stair's or slab's corner, in cell units). */
function blend(face: Face, shading: readonly number[], at: readonly number[]): number {
  let lit = 0;
  for (let k = 0; k < 4; k++) {
    const corner = face.corners[k];
    const offset = [corner.x, corner.y, corner.z];
    let weight = 1;
    for (const a of face.plane) weight *= offset[a] ? at[a] : 1 - at[a];
    lit += weight * shading[k];
  }
  return lit;
}

/**
 * Builds a face-culled mesh with per-vertex ambient occlusion from a padded volume.
 * Pure function: no world access, no Three.js. Terrain uses block colours; models
 * (ships) pass the palette from their .vox file.
 *
 * Plain culled faces rather than greedy meshing: with AO and colour jitter on every
 * voxel, few faces could be merged anyway. Revisit if triangle counts ever matter.
 *
 * Stairs and slabs are drawn as their boxes; the blocker a prop stands in isn't drawn at all.
 */
export function meshPaddedVolume(
  vol: Uint8Array,
  originX: number,
  originY: number,
  originZ: number,
  palette: VoxelPalette = BLOCK_PALETTE,
): MeshData | null {
  const { colors: rgb, solid, flags, shapes, hidden } = palette;
  /** Drawn and whole: it hides the face of whatever is against it. */
  const whole = (v: number) => solid[v] === 1 && !shapes?.[v] && !hidden?.[v];
  const marks: number[] = [];
  const corners: number[] = [];
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  /** The cube face's occlusion count and brightness at its four corners, and each drawn corner's brightness. */
  const ao = [0, 0, 0, 0];
  const shading = [0, 0, 0, 0];
  const lit = [0, 0, 0, 0];
  const at = [0, 0, 0];

  for (let py = 1; py <= CHUNK_SIZE; py++) {
    for (let pz = 1; pz <= CHUNK_SIZE; pz++) {
      for (let px = 1; px <= CHUNK_SIZE; px++) {
        const i = px + pz * P + py * P2;
        const id = vol[i];
        if (!solid[id] || hidden?.[id]) continue;

        const x = px - 1;
        const y = py - 1;
        const z = pz - 1;
        const shade = 1 + (hash3(originX + x, originY + y, originZ + z) * 2 - 1) * COLOR_JITTER;
        const r = rgb[id * 3] * shade;
        const g = rgb[id * 3 + 1] * shade;
        const b = rgb[id * 3 + 2] * shade;
        const boxes = shapes?.[id] ?? WHOLE;

        for (const face of FACES) {
          const next = vol[i + face.neighbor];
          // Faces against what may be lifted away on foot are kept, hidden till it goes:
          // inside a tree or a building, a top face under more of it; and the ground's
          // face against a tree or a building (a roof's eave against a terrace wall).
          const inner = whole(next);
          const liftable = !!flags && (flags[next] & FLAG_CUTAWAY) !== 0;
          const mine = !!flags && (flags[id] & FLAG_CUTAWAY) !== 0;
          const covered = inner && !(liftable && (!mine || face.normal[1] === 1));
          const cap = inner && liftable && mine && face.normal[1] === 1 && !FOLIAGE.has(id) ? 8 : 0;
          // An inner face is lit as though what's against it had gone. The blocker casts no shade.
          const blocks = (v: number) => solid[v] === 1 && !hidden?.[v] && !(inner && flags && flags[v] & FLAG_CUTAWAY);
          for (let c = 0; c < 4; c++) {
            const corner = face.corners[c];
            const s1 = +blocks(vol[i + corner.side1]);
            const s2 = +blocks(vol[i + corner.side2]);
            const d = +blocks(vol[i + corner.diagonal]);
            ao[c] = s1 && s2 ? 0 : 3 - (s1 + s2 + d);
            shading[c] = AO_CURVE[ao[c]];
          }
          // A cube is one box, a stair or slab two or one. A box's face on the cell's side is
          // covered as a cube's would be; one inside the cell (a stair's riser) always shows.
          for (const box of boxes) {
            const onSide = face.normal[face.axis] > 0 ? high(box, face.axis) === 1 : low(box, face.axis) === 0;
            if (onSide && covered) continue;
            const base = positions.length / 3;
            for (let c = 0; c < 4; c++) {
              const corner = face.corners[c];
              at[0] = corner.x ? box.x1 : box.x0;
              at[1] = corner.y ? box.y1 : box.y0;
              at[2] = corner.z ? box.z1 : box.z0;
              lit[c] = box === WHOLE[0] ? shading[c] : blend(face, shading, at);
              positions.push(x + at[0], y + at[1], z + at[2]);
              normals.push(face.normal[0], face.normal[1], face.normal[2]);
              colors.push(r * lit[c], g * lit[c], b * lit[c]);
              if (flags) {
                marks.push(flags[id]);
                corners.push(corner.x | (corner.y << 1) | (corner.z << 2) | (onSide ? cap : 0));
              }
            }
            // Split the quad along the diagonal with the brighter ends, so occlusion shades one
            // corner instead of smearing across the whole face. A cube ties this on the raw
            // occlusion counts (AO_CURVE isn't affine, so the mapped brightness can tie the other
            // way); a stair's or slab's corners don't sit on the cube's, so blended brightness is
            // all there is to go on.
            const split = box === WHOLE[0] ? ao[0] + ao[2] > ao[1] + ao[3] : lit[0] + lit[2] > lit[1] + lit[3];
            if (split) {
              indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
            } else {
              indices.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
            }
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
    ...(flags ? { flags: new Float32Array(marks), corners: new Uint8Array(corners) } : {}),
  };
}
