import { SEA_LEVEL } from '../config';
import { hash2, hash3 } from '../util/hash';
import { Block, type BlockId } from '../voxel/blocks';
import type { VoxelWorld } from '../voxel/VoxelWorld';
import { smoothstep } from '../util/math';
import { fbm2, mulberry32, seededNoise2D } from './noise';

export interface IslandParams {
  seed: number;
  centerX: number;
  centerZ: number;
  /** Rough coastline radius in voxels. */
  radius: number;
  /** Height of the summit above sea level. */
  peak: number;
}

/** Columns deeper than this get no voxels: the water above them is opaque, so the floor would never be seen. */
const SHELF_FLOOR = SEA_LEVEL - 8;
const TREE_CELL = 6;
/** Ore veins: noise frequency, and how much of the bare rock carries them. */
const ORE_SCALE = 0.11;
const ORE_THRESHOLD = 0.35;

/**
 * Writes one procedural tropical island into the world. Deterministic in `seed`: a
 * save file only needs the seed plus the player's edits, not the voxels themselves.
 */
export function generateIsland(world: VoxelWorld, p: IslandParams): void {
  const random = mulberry32(p.seed);
  const coastNoise = seededNoise2D(random);
  const hillNoise = seededNoise2D(random);
  const oreNoise = seededNoise2D(random);

  const extent = Math.ceil(p.radius * 1.6);
  const size = extent * 2;
  const x0 = Math.floor(p.centerX) - extent;
  const z0 = Math.floor(p.centerZ) - extent;
  const heights = new Int16Array(size * size);
  const heightAt = (col: number, row: number) =>
    heights[Math.min(Math.max(row, 0), size - 1) * size + Math.min(Math.max(col, 0), size - 1)];

  // 1. Height field: radial falloff warped by noise (ragged coastline), hills inland, a sandy shelf offshore.
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const x = x0 + col;
      const z = z0 + row;
      const d =
        Math.hypot(x + 0.5 - p.centerX, z + 0.5 - p.centerZ) / p.radius +
        fbm2(coastNoise, x * 0.018, z * 0.018, 3) * 0.32;
      let h: number;
      if (d < 1) {
        const inland = 1 - d; // 0 at the coast, 1 at the centre
        const hills = (fbm2(hillNoise, x * 0.045, z * 0.045) * 0.5 + 0.5) * 7 * smoothstep(0.12, 0.45, inland);
        h = SEA_LEVEL + 0.6 + smoothstep(0.06, 0.95, inland) ** 1.4 * p.peak + hills;
      } else {
        h = SEA_LEVEL + 0.6 - (d - 1) * 28;
      }
      heights[row * size + col] = Math.floor(h);
    }
  }

  // 2. Columns: stone core under a surface layer picked by height and steepness.
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const height = heights[row * size + col];
      if (height < SHELF_FLOOR) continue;
      const slope = Math.max(
        Math.abs(height - heightAt(col - 1, row)),
        Math.abs(height - heightAt(col + 1, row)),
        Math.abs(height - heightAt(col, row - 1)),
        Math.abs(height - heightAt(col, row + 1)),
      );
      const [top, under, underDepth] = surfaceLayers(height, slope, p.peak);
      const x = x0 + col;
      const z = z0 + row;
      // Iron shows in veins where the rock breaks the surface.
      const vein = top === Block.Stone && height > SEA_LEVEL + 2 && oreNoise(x * ORE_SCALE, z * ORE_SCALE) > ORE_THRESHOLD;
      for (let y = 0; y < height; y++) {
        let id = y === height - 1 ? top : y >= height - 1 - underDepth ? under : Block.Stone;
        if (vein && y >= height - 3 && hash3(x, y, z) < 0.55) id = Block.IronOre;
        world.setVoxel(x, y, z, id);
      }
    }
  }

  // 3. Vegetation on a jittered grid: palms along the shore, broadleaf trees inland.
  for (let gz = z0; gz < z0 + size; gz += TREE_CELL) {
    for (let gx = x0; gx < x0 + size; gx += TREE_CELL) {
      const roll = hash2(gx, gz, p.seed);
      const x = gx + 1 + Math.floor(hash2(gx, gz, p.seed + 1) * (TREE_CELL - 2));
      const z = gz + 1 + Math.floor(hash2(gx, gz, p.seed + 2) * (TREE_CELL - 2));
      const ground = world.surfaceHeight(x, z);
      const surface = world.getVoxel(x, ground - 1, z);
      const variant = hash2(x, z, p.seed + 3);
      const nearShore = ground <= SEA_LEVEL + 4;
      if (roll < 0.5 && nearShore && (surface === Block.Sand || surface === Block.Grass)) {
        palmTree(world, x, ground, z, variant);
      } else if (roll < 0.6 && !nearShore && surface === Block.Grass) {
        broadleafTree(world, x, ground, z, variant);
      }
    }
  }
}

function surfaceLayers(height: number, slope: number, peak: number): [top: BlockId, under: BlockId, underDepth: number] {
  if (height < SEA_LEVEL) return [Block.Seabed, Block.Seabed, 2];
  if (height <= SEA_LEVEL + 1) return [Block.Sand, Block.Sand, 3];
  if (slope >= 3 || height > SEA_LEVEL + peak * 0.8) return [Block.Stone, Block.Stone, 0];
  return [Block.Grass, Block.Dirt, 3];
}

const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;
const DIAGONALS = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

export function palmTree(world: VoxelWorld, x: number, y: number, z: number, variant: number): void {
  const height = 5 + Math.floor(variant * 3);
  const [leanX, leanZ] = DIRECTIONS[Math.floor(variant * 97) % 4];
  let tx = x;
  let tz = z;
  for (let i = 0; i < height; i++) {
    if (i === Math.ceil(height * 0.6)) {
      tx += leanX;
      tz += leanZ;
    }
    world.setVoxel(tx, y + i, tz, Block.Wood);
  }
  const top = y + height;
  world.setVoxel(tx, top, tz, Block.PalmLeaves);
  for (const [dx, dz] of DIRECTIONS) {
    world.setVoxel(tx + dx, top, tz + dz, Block.PalmLeaves);
    world.setVoxel(tx + 2 * dx, top, tz + 2 * dz, Block.PalmLeaves);
    world.setVoxel(tx + 3 * dx, top - 1, tz + 3 * dz, Block.PalmLeaves);
  }
  for (const [dx, dz] of DIAGONALS) {
    world.setVoxel(tx + dx, top, tz + dz, Block.PalmLeaves);
    world.setVoxel(tx + 2 * dx, top - 1, tz + 2 * dz, Block.PalmLeaves);
  }
}

export function broadleafTree(world: VoxelWorld, x: number, y: number, z: number, variant: number): void {
  const trunk = 3 + Math.floor(variant * 2);
  for (let i = 0; i < trunk; i++) world.setVoxel(x, y + i, z, Block.Wood);
  const cy = y + trunk + 1;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const d = dx * dx + dz * dz + dy * dy * 2;
        if (d > 5 || (d >= 4 && hash3(x + dx, cy + dy, z + dz) < 0.4)) continue; // ragged canopy edge
        if (world.getVoxel(x + dx, cy + dy, z + dz) === Block.Air) world.setVoxel(x + dx, cy + dy, z + dz, Block.Leaves);
      }
    }
  }
}
