import type { Cargo } from '../economy/goods';
import { Block } from '../voxel/blocks';
import type { VoxelWorld } from '../voxel/VoxelWorld';
import { buildHouse, clearHouse, type Footprint } from '../worldgen/buildings';

export type Structure = 'campfire' | 'hut' | 'storehouse' | 'fence' | 'path' | 'torch';
export const STRUCTURE_LIST: readonly Structure[] = ['campfire', 'hut', 'storehouse', 'fence', 'path', 'torch'];

export interface StructureSpec {
  label: string;
  detail: string;
  cost: Cargo;
  /** Size along x and z before turning. */
  w: number;
  d: number;
  /** Laid one cell at a time, anywhere in a claim (fences, paths), rather than placed on the grid as a building. */
  freeform: boolean;
}

export const STRUCTURES: Record<Structure, StructureSpec> = {
  campfire: { label: 'Campfire', detail: 'Claims the land around it for your camp. Rest here to save.', cost: { timber: 5 }, w: 3, d: 3, freeform: false },
  hut: { label: 'Hut', detail: 'A roof of your own. Rest here to save.', cost: { timber: 30, stone: 10 }, w: 5, d: 5, freeform: false },
  storehouse: { label: 'Storehouse', detail: `Keeps ${150} goods at the camp; building draws on it.`, cost: { timber: 40, stone: 15 }, w: 7, d: 5, freeform: false },
  fence: { label: 'Fence', detail: 'Keeps the goats out of the cane.', cost: { timber: 1 }, w: 1, d: 1, freeform: true },
  path: { label: 'Path', detail: 'Gravel underfoot.', cost: { stone: 1 }, w: 1, d: 1, freeform: true },
  torch: { label: 'Torch', detail: 'A post with a flame on top.', cost: { timber: 1 }, w: 1, d: 1, freeform: true },
};

export const STORE_SIZE = 150;

/** Something the captain built. (x0, z0, w, d) is its plot; y its floor. `rot` 0-3 turns it (the door faces +z, +x, −z, −x). */
export interface Building extends Footprint {
  id: number;
  kind: Structure;
  y: number;
  rot: number;
  /** A storehouse's contents. */
  store?: Cargo;
}

const DOOR_DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

/** The plot for a structure centred on a cell, turned `rot` quarter turns. */
export function plotFor(kind: Structure, cx: number, cz: number, rot: number): Footprint {
  const spec = STRUCTURES[kind];
  const [w, d] = rot % 2 === 0 ? [spec.w, spec.d] : [spec.d, spec.w];
  return { x0: cx - Math.floor(w / 2), z0: cz - Math.floor(d / 2), w, d };
}

/** Writes a structure into the world on its (already levelled) plot. */
export function raise(world: VoxelWorld, b: Building): void {
  const { x0, z0, y } = b;
  switch (b.kind) {
    case 'campfire': {
      for (let x = x0; x < x0 + 3; x++) for (let z = z0; z < z0 + 3; z++) world.setVoxel(x, y, z, x === x0 + 1 && z === z0 + 1 ? Block.Embers : (x + z) % 2 === 0 ? Block.Stone : Block.Air);
      break;
    }
    case 'hut':
    case 'storehouse': {
      const [dx, dz] = DOOR_DIRS[b.rot % 4];
      const cx = x0 + b.w / 2;
      const cz = z0 + b.d / 2;
      const style = b.kind === 'hut' ? { walls: Block.Planks, roof: Block.Thatch } : { walls: Block.Planks, roof: Block.RoofSlate };
      buildHouse(world, b, y, style, cx + dx * 20, cz + dz * 20);
      break;
    }
    case 'fence':
      world.setVoxel(x0, y, z0, Block.Fence);
      break;
    case 'path':
      world.setVoxel(x0, y - 1, z0, Block.Gravel);
      break;
    case 'torch':
      world.setVoxel(x0, y, z0, Block.Wood);
      world.setVoxel(x0, y + 1, z0, Block.Embers);
      break;
  }
}

/** Takes a structure down again, leaving the ground as it was levelled. */
export function raze(world: VoxelWorld, b: Building): void {
  switch (b.kind) {
    case 'hut':
    case 'storehouse':
      clearHouse(world, b, b.y);
      break;
    case 'path':
      world.setVoxel(b.x0, b.y - 1, b.z0, Block.Dirt);
      break;
    default:
      for (let x = b.x0; x < b.x0 + b.w; x++) for (let z = b.z0; z < b.z0 + b.d; z++) for (let y = b.y; y < b.y + 2; y++) world.setVoxel(x, y, z, Block.Air);
  }
}

/** Where to stand to use a building (its door, or beside it). */
export function doorOf(b: Building): { x: number; z: number } {
  if (b.kind !== 'hut' && b.kind !== 'storehouse') return { x: b.x0 + b.w / 2, z: b.z0 + b.d / 2 };
  const [dx, dz] = DOOR_DIRS[b.rot % 4];
  return { x: b.x0 + b.w / 2 + dx * (b.w / 2 + 0.6), z: b.z0 + b.d / 2 + dz * (b.d / 2 + 0.6) };
}
