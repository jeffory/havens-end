import { SEA_LEVEL } from '../config';
import { Block, type BlockId } from '../voxel/blocks';
import type { VoxelWorld } from '../voxel/VoxelWorld';

/** A building's plot: `w` along x and `d` along z from the corner (x0, z0). */
export interface Footprint {
  x0: number;
  z0: number;
  w: number;
  d: number;
}

export interface HouseStyle {
  walls: BlockId;
  roof: BlockId;
}

export const TREE_BLOCKS: ReadonlySet<BlockId> = new Set([Block.Wood, Block.Leaves, Block.PalmLeaves]);

export const overlaps = (a: Footprint, b: Footprint, margin = 0): boolean =>
  a.x0 < b.x0 + b.w + margin && b.x0 < a.x0 + a.w + margin && a.z0 < b.z0 + b.d + margin && b.z0 < a.z0 + a.d + margin;

/** Surface height ignoring trees. */
export function groundHeight(world: VoxelWorld, x: number, z: number): number {
  let h = world.surfaceHeight(x, z);
  while (h > 0 && TREE_BLOCKS.has(world.getVoxel(x, h - 1, z))) h--;
  return h;
}

/**
 * Floor height for a building here (the highest ground under it), or null if the
 * ground is wet, on a pier, or rises and falls more than `range` voxels.
 */
export function levelGround(world: VoxelWorld, fp: Footprint, range: number): number | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let x = fp.x0; x < fp.x0 + fp.w; x++) {
    for (let z = fp.z0; z < fp.z0 + fp.d; z++) {
      const h = groundHeight(world, x, z);
      if (h < SEA_LEVEL || world.getVoxel(x, h - 1, z) === Block.Planks) return null;
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
  }
  return hi - lo <= range ? hi : null;
}

/**
 * Fills the footprint up to the floor with stone, and clears what's above it. Trees
 * within `border` of it are cleared too, so no canopy hangs through the roof.
 */
export function clearSite(world: VoxelWorld, fp: Footprint, base: number, border: number): void {
  for (let x = fp.x0 - border; x < fp.x0 + fp.w + border; x++) {
    for (let z = fp.z0 - border; z < fp.z0 + fp.d + border; z++) {
      const inside = x >= fp.x0 - 1 && x <= fp.x0 + fp.w && z >= fp.z0 - 1 && z <= fp.z0 + fp.d;
      for (let y = base - 2; y < base + 14; y++) {
        const id = world.getVoxel(x, y, z);
        if (TREE_BLOCKS.has(id) || (inside && y >= base && id !== Block.Air)) world.setVoxel(x, y, z, Block.Air);
      }
      if (x >= fp.x0 && x < fp.x0 + fp.w && z >= fp.z0 && z < fp.z0 + fp.d) {
        for (let y = groundHeight(world, x, z); y < base; y++) world.setVoxel(x, y, z, Block.Stone);
      }
    }
  }
}

/** Where a door is: the cell in the wall, and the cell just outside it (where you stand to go in). */
export interface Door {
  x: number;
  z: number;
  outX: number;
  outZ: number;
  y: number;
}

/**
 * A house: walls three high a storey with a door in the middle of the wall facing
 * (towardX, towardZ), a row of windows each storey, and a stepped gable roof over the
 * long axis.
 */
export function buildHouse(world: VoxelWorld, fp: Footprint, base: number, style: HouseStyle, towardX: number, towardZ: number, storeys = 1): Door {
  const { x0, z0, w, d } = fp;
  const top = base + 2 + (storeys - 1) * 3;
  const ridgeAlongX = w >= d;
  const span = ridgeAlongX ? d : w;
  const eave = (span + 1) / 2;
  const roofY = (x: number, z: number) => {
    const across = ridgeAlongX ? Math.abs(z - (z0 + (d - 1) / 2)) : Math.abs(x - (x0 + (w - 1) / 2));
    return Math.round(top + (eave - across));
  };

  const cx = x0 + (w - 1) / 2;
  const cz = z0 + (d - 1) / 2;
  const toX = towardX - cx;
  const toZ = towardZ - cz;
  const door: Door =
    Math.abs(toX) > Math.abs(toZ)
      ? { x: toX > 0 ? x0 + w - 1 : x0, z: Math.floor(cz), outX: toX > 0 ? x0 + w : x0 - 1, outZ: Math.floor(cz), y: base }
      : { x: Math.floor(cx), z: toZ > 0 ? z0 + d - 1 : z0, outX: Math.floor(cx), outZ: toZ > 0 ? z0 + d : z0 - 1, y: base };

  for (let x = x0; x < x0 + w; x++) {
    for (let z = z0; z < z0 + d; z++) {
      const edge = x === x0 || x === x0 + w - 1 || z === z0 || z === z0 + d - 1;
      if (!edge) continue;
      // Gable ends run up to meet the roof.
      const gable = ridgeAlongX ? x === x0 || x === x0 + w - 1 : z === z0 || z === z0 + d - 1;
      const height = gable ? roofY(x, z) - 1 : top;
      for (let y = base; y <= height; y++) {
        const isDoor = x === door.x && z === door.z && y < base + 2;
        const corner = (x === x0 || x === x0 + w - 1) && (z === z0 || z === z0 + d - 1);
        const windowRow = (y - base) % 3 === 1 && y < top;
        const isWindow = !corner && !gable && windowRow && (ridgeAlongX ? x - x0 === 1 || x0 + w - 1 - x === 1 : z - z0 === 1 || z0 + d - 1 - z === 1);
        if (isDoor) continue;
        if (isWindow) {
          world.setVoxel(x, y, z, Block.Window);
          continue;
        }
        world.setVoxel(x, y, z, corner && style.walls === Block.Plaster ? Block.Wood : style.walls);
      }
    }
  }
  // Roof, with a one-voxel overhang all round.
  for (let x = x0 - 1; x <= x0 + w; x++) {
    for (let z = z0 - 1; z <= z0 + d; z++) world.setVoxel(x, roofY(x, z), z, style.roof);
  }
  // A clear step outside the door, so it can always be walked through.
  world.setVoxel(door.outX, base, door.outZ, Block.Air);
  world.setVoxel(door.outX, base + 1, door.outZ, Block.Air);
  return door;
}

/** Everything `buildHouse` puts above the floor, for demolishing: the footprint plus the roof overhang. */
export function clearHouse(world: VoxelWorld, fp: Footprint, base: number): void {
  for (let x = fp.x0 - 1; x <= fp.x0 + fp.w; x++) {
    for (let z = fp.z0 - 1; z <= fp.z0 + fp.d; z++) {
      for (let y = base; y < base + 8; y++) world.setVoxel(x, y, z, Block.Air);
    }
  }
}

/** A stone watchtower with crenellations and a beacon fire: the Crown's mark on a harbour. Returns where the fire is. */
export function buildTower(world: VoxelWorld, fp: Footprint, base: number): { x: number; y: number; z: number } {
  const height = 9;
  for (let x = fp.x0; x < fp.x0 + fp.w; x++) {
    for (let z = fp.z0; z < fp.z0 + fp.d; z++) {
      for (let y = base; y < base + height; y++) world.setVoxel(x, y, z, Block.Stone);
    }
  }
  for (let x = fp.x0 - 1; x <= fp.x0 + fp.w; x++) {
    for (let z = fp.z0 - 1; z <= fp.z0 + fp.d; z++) {
      world.setVoxel(x, base + height, z, Block.Stone);
      if ((x + z) % 2 === 0 && (x < fp.x0 || x >= fp.x0 + fp.w || z < fp.z0 || z >= fp.z0 + fp.d)) world.setVoxel(x, base + height + 1, z, Block.Stone);
    }
  }
  const cx = fp.x0 + Math.floor(fp.w / 2);
  const cz = fp.z0 + Math.floor(fp.d / 2);
  world.setVoxel(cx, base + height + 1, cz, Block.Embers);
  return { x: cx + 0.5, y: base + height + 2, z: cz + 0.5 };
}
