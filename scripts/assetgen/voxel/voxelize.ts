import type { Raster } from '../image/raster';
import type { Glb, GlbMesh } from './glb';

export type Rgb = [number, number, number];

export interface VoxelGrid {
  /** Cells along MagicaVoxel x (right), y (depth) and z (up). */
  size: [number, number, number];
  get(x: number, y: number, z: number): Rgb | undefined;
  entries(): Array<[number, number, number, Rgb]>;
}

/** MagicaVoxel's limit per axis. */
export const MAX_VOXELS = 256;

export interface VoxelizeOptions {
  /** Voxels from the model's lowest to highest point (less if another axis would pass MAX_VOXELS). */
  height: number;
  /** Quarter turns clockwise (seen from above) about the up axis, to face the model's front to −y. */
  turns?: number;
}

/**
 * Surface-voxelizes a textured mesh: every triangle is sampled at half-voxel spacing
 * and each voxel it touches takes the average colour of its samples. glTF is +y up;
 * the grid uses MagicaVoxel axes (z up), so x stays, glTF -z becomes depth and y height,
 * before the optional quarter turns.
 * `textures` holds the decoded GLB images by index.
 */
export function voxelize(glb: Glb, textures: Array<Raster | undefined>, opts: VoxelizeOptions): VoxelGrid {
  const turns = (((opts.turns ?? 0) % 4) + 4) % 4;
  const toMv = (p: Float32Array, i: number): Rgb => {
    let [x, y] = [p[i], -p[i + 2]];
    for (let t = 0; t < turns; t++) [x, y] = [y, -x];
    return [x, y, p[i + 1]];
  };

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of glb.meshes) {
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const v = toMv(mesh.positions, i);
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], v[a]);
        max[a] = Math.max(max[a], v[a]);
      }
    }
  }
  if (!Number.isFinite(min[0])) throw new Error('The model has no geometry to voxelize');
  const extent = max.map((m, a) => m - min[a]);
  // The requested height, unless that would make some axis longer than MagicaVoxel allows.
  const scale = Math.min(opts.height / (extent[2] || Math.max(extent[0], extent[1]) || 1), MAX_VOXELS / Math.max(...extent));
  const size = extent.map((e) => Math.max(1, Math.ceil(e * scale - 1e-6))) as [number, number, number];

  const sums = new Map<number, [number, number, number, number]>();
  const key = (x: number, y: number, z: number) => (z * size[1] + y) * size[0] + x;
  const cell = (v: number, a: number) => Math.min(size[a] - 1, Math.max(0, Math.floor((v - min[a]) * scale)));

  for (const mesh of glb.meshes) {
    const texture = mesh.image !== undefined ? textures[mesh.image] : undefined;
    const { positions: p, indices } = mesh;
    for (let t = 0; t < indices.length; t += 3) {
      const [i0, i1, i2] = [indices[t], indices[t + 1], indices[t + 2]];
      const a = toMv(p, i0 * 3);
      const b = toMv(p, i1 * 3);
      const c = toMv(p, i2 * 3);
      const longest = Math.max(dist(a, b), dist(b, c), dist(c, a)) * scale;
      const n = Math.max(1, Math.ceil(longest * 2));
      for (let i = 0; i <= n; i++) {
        for (let j = 0; j <= n - i; j++) {
          const wa = i / n;
          const wb = j / n;
          const wc = 1 - wa - wb;
          const point = [0, 1, 2].map((ax) => a[ax] * wa + b[ax] * wb + c[ax] * wc);
          const colour = sampleColour(mesh, texture, i0, i1, i2, wa, wb, wc);
          const k = key(cell(point[0], 0), cell(point[1], 1), cell(point[2], 2));
          const s = sums.get(k) ?? [0, 0, 0, 0];
          s[0] += colour[0];
          s[1] += colour[1];
          s[2] += colour[2];
          s[3]++;
          sums.set(k, s);
        }
      }
    }
  }

  const colours = new Map<number, Rgb>();
  for (const [k, [r, g, b, count]] of sums) colours.set(k, [Math.round(r / count), Math.round(g / count), Math.round(b / count)]);
  return {
    size,
    get: (x, y, z) => colours.get(key(x, y, z)),
    entries: () =>
      [...colours].map(([k, rgb]) => {
        const x = k % size[0];
        const y = Math.floor(k / size[0]) % size[1];
        const z = Math.floor(k / (size[0] * size[1]));
        return [x, y, z, rgb];
      }),
  };
}

/** Colour at barycentric (wa, wb, wc): texture (or vertex colour, or white) × material factor, 0..255. */
function sampleColour(mesh: GlbMesh, texture: Raster | undefined, i0: number, i1: number, i2: number, wa: number, wb: number, wc: number): Rgb {
  let rgb: Rgb = [1, 1, 1];
  if (texture && mesh.uvs) {
    const u = mesh.uvs[i0 * 2] * wa + mesh.uvs[i1 * 2] * wb + mesh.uvs[i2 * 2] * wc;
    const v = mesh.uvs[i0 * 2 + 1] * wa + mesh.uvs[i1 * 2 + 1] * wb + mesh.uvs[i2 * 2 + 1] * wc;
    const x = Math.min(texture.width - 1, Math.floor(fract(u) * texture.width));
    const y = Math.min(texture.height - 1, Math.floor(fract(v) * texture.height));
    const o = (y * texture.width + x) * 4;
    rgb = [texture.data[o] / 255, texture.data[o + 1] / 255, texture.data[o + 2] / 255];
  } else if (mesh.colors) {
    const c = mesh.colors;
    rgb = [0, 1, 2].map((ch) => c[i0 * 4 + ch] * wa + c[i1 * 4 + ch] * wb + c[i2 * 4 + ch] * wc) as Rgb;
  }
  return [rgb[0] * mesh.baseColor[0] * 255, rgb[1] * mesh.baseColor[1] * 255, rgb[2] * mesh.baseColor[2] * 255];
}

const fract = (v: number) => v - Math.floor(v);
const dist = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
