import type { Cargo } from '../economy/goods';
import { Block, type BlockId } from '../voxel/blocks';
import type { VoxelWorld } from '../voxel/VoxelWorld';
import { buildHouse, clearHouse, type Footprint } from '../worldgen/buildings';

export type Structure =
  | 'campfire'
  | 'hut'
  | 'storehouse'
  | 'sawpit'
  | 'mill'
  | 'distillery'
  | 'curingShed'
  | 'smokehouse'
  | 'forge'
  | 'fence'
  | 'path'
  | 'torch';
export const STRUCTURE_LIST: readonly Structure[] = ['campfire', 'hut', 'storehouse', 'sawpit', 'mill', 'distillery', 'curingShed', 'smokehouse', 'forge', 'fence', 'path', 'torch'];

/** One thing a workshop makes: what goes in, what comes out, and how long a batch takes a worker (sea seconds). */
export interface Recipe {
  label: string;
  inputs: Cargo;
  outputs: Cargo;
  seconds: number;
}

export interface StructureSpec {
  label: string;
  detail: string;
  cost: Cargo;
  /** Size along x and z before turning. */
  w: number;
  d: number;
  /** Laid one cell at a time, anywhere in a claim (fences, paths), rather than placed on the grid as a building. */
  freeform: boolean;
  /** How far it reaches above its floor, and past its plot (roof overhangs, windmill sails). */
  height: number;
  pad: number;
  /** Settlers who can sleep here. */
  beds?: number;
  /** A workshop: what a settler working here can make, drawing on the camp's storehouses. */
  recipes?: readonly Recipe[];
}

export const STRUCTURES: Record<Structure, StructureSpec> = {
  campfire: { label: 'Campfire', detail: 'Claims the land around it for your camp. Settlers and workshops are run from here.', cost: { timber: 5 }, w: 3, d: 3, freeform: false, height: 1, pad: 0 },
  hut: { label: 'Hut', detail: 'Beds for two settlers. Sleep here to pass the night (and save).', cost: { timber: 30, stone: 10 }, w: 5, d: 5, freeform: false, height: 8, pad: 1, beds: 2 },
  storehouse: { label: 'Storehouse', detail: `Keeps ${150} goods at the camp. Building, workshops and settlers draw on it.`, cost: { timber: 40, stone: 15 }, w: 7, d: 5, freeform: false, height: 8, pad: 1 },
  sawpit: {
    label: 'Sawpit',
    detail: 'Saws timber into planks: good for building, and your carpenter mends the hull with them.',
    cost: { timber: 20, stone: 5 },
    w: 5,
    d: 3,
    freeform: false,
    height: 3,
    pad: 0,
    recipes: [{ label: 'Planks', inputs: { timber: 3 }, outputs: { planks: 2 }, seconds: 12 }],
  },
  mill: {
    label: 'Sugar mill',
    detail: 'Crushes cane into sugar, with molasses left over for the distillery.',
    cost: { timber: 30, stone: 25 },
    w: 5,
    d: 5,
    freeform: false,
    height: 10,
    pad: 1,
    recipes: [{ label: 'Sugar', inputs: { cane: 3 }, outputs: { sugar: 2, molasses: 1 }, seconds: 15 }],
  },
  distillery: {
    label: 'Distillery',
    detail: 'Stills molasses into rum. The copper still needs iron.',
    cost: { timber: 25, stone: 20, iron: 4 },
    w: 5,
    d: 5,
    freeform: false,
    height: 7,
    pad: 1,
    recipes: [{ label: 'Rum', inputs: { molasses: 2, timber: 1 }, outputs: { rum: 2 }, seconds: 20 }],
  },
  curingShed: {
    label: 'Curing shed',
    detail: 'Hangs tobacco leaf to cure into tobacco worth shipping.',
    cost: { timber: 25, stone: 5 },
    w: 6,
    d: 4,
    freeform: false,
    height: 6,
    pad: 1,
    recipes: [{ label: 'Tobacco', inputs: { leaf: 3 }, outputs: { tobacco: 2 }, seconds: 30 }],
  },
  smokehouse: {
    label: 'Smokehouse',
    detail: 'Smokes fish and meat into provisions that keep: settlers eat them, and ports buy them.',
    cost: { timber: 15, stone: 15 },
    w: 4,
    d: 4,
    freeform: false,
    height: 6,
    pad: 1,
    recipes: [
      { label: 'Smoked fish', inputs: { fish: 3, timber: 1 }, outputs: { provisions: 3 }, seconds: 15 },
      { label: 'Smoked meat', inputs: { meat: 2, timber: 1 }, outputs: { provisions: 3 }, seconds: 15 },
    ],
  },
  forge: {
    label: 'Forge',
    detail: 'Smelts ore into iron, and makes cutlasses and muskets to sell.',
    cost: { timber: 30, stone: 30 },
    w: 5,
    d: 5,
    freeform: false,
    height: 7,
    pad: 1,
    recipes: [
      { label: 'Iron', inputs: { ore: 2, timber: 2 }, outputs: { iron: 1 }, seconds: 20 },
      { label: 'Cutlasses', inputs: { iron: 1, timber: 1 }, outputs: { cutlasses: 1 }, seconds: 20 },
      { label: 'Muskets', inputs: { iron: 2, planks: 1 }, outputs: { muskets: 1 }, seconds: 30 },
    ],
  },
  fence: { label: 'Fence', detail: 'Keeps the boar out of the cane.', cost: { timber: 1 }, w: 1, d: 1, freeform: true, height: 1, pad: 0 },
  path: { label: 'Path', detail: 'Gravel underfoot.', cost: { stone: 1 }, w: 1, d: 1, freeform: true, height: 1, pad: 0 },
  torch: { label: 'Torch', detail: 'A post with a flame on top. Night creatures keep away from its light.', cost: { timber: 1 }, w: 1, d: 1, freeform: true, height: 2, pad: 0 },
};

export const STORE_SIZE = 150;

/** A workshop's work in hand: the recipe it's set to and how far through a batch it is. */
export interface Workshop {
  recipe: number;
  /** 0..1 through the batch in hand; 0 when none is started (its inputs aren't taken yet). */
  progress: number;
}

/** Something the captain built. (x0, z0, w, d) is its plot; y its floor. `rot` 0-3 turns it (the door faces +z, +x, −z, −x). */
export interface Building extends Footprint {
  id: number;
  kind: Structure;
  y: number;
  rot: number;
  /** A storehouse's contents. */
  store?: Cargo;
  /** A workshop's batch in hand. */
  work?: Workshop;
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

export const isWorkshop = (kind: Structure): boolean => STRUCTURES[kind].recipes !== undefined;

/**
 * Where a cell of a building's own layout lands in the world. Layouts are drawn facing
 * +z (the front, where the door is, is the far z edge), `w` wide along x and `d` deep;
 * turning the building turns the layout with it.
 */
function placeLocal(b: Building, lx: number, lz: number): [number, number] {
  const { w, d } = STRUCTURES[b.kind];
  switch (b.rot % 4) {
    case 1:
      return [b.x0 + lz, b.z0 + (w - 1 - lx)];
    case 2:
      return [b.x0 + (w - 1 - lx), b.z0 + (d - 1 - lz)];
    case 3:
      return [b.x0 + (d - 1 - lz), b.z0 + lx];
    default:
      return [b.x0 + lx, b.z0 + lz];
  }
}

/** Writes a structure into the world on its (already levelled) plot. */
export function raise(world: VoxelWorld, b: Building): void {
  const { x0, z0, y } = b;
  const put = (lx: number, ly: number, lz: number, id: BlockId) => {
    const [x, z] = placeLocal(b, lx, lz);
    world.setVoxel(x, y + ly, z, id);
  };
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, id: BlockId) => {
    for (let lx = x0; lx <= x1; lx++) for (let ly = y0; ly <= y1; ly++) for (let lz = z0; lz <= z1; lz++) put(lx, ly, lz, id);
  };
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
    case 'sawpit':
      // Two trestles with a log across them, and a stack of sawn planks.
      for (const lx of [1, 3]) for (const lz of [0, 2]) box(lx, lx, 0, 1, lz, lz, Block.Wood);
      box(0, 4, 2, 2, 1, 1, Block.Wood);
      box(4, 4, 0, 1, 0, 0, Block.Planks);
      put(0, 0, 2, Block.Planks);
      break;
    case 'mill': {
      // A stone windmill: a round-ish tower with a thatched cap and sails on its side.
      box(1, 3, 0, 6, 1, 3, Block.Stone);
      box(2, 2, 0, 1, 3, 3, Block.Air); // the door
      box(1, 3, 7, 7, 1, 3, Block.Thatch);
      put(2, 8, 2, Block.Thatch);
      for (let i = -3; i <= 3; i++) {
        put(4, 5 + i, 2, Block.Planks);
        if (i !== 0) put(4, 5, 2 + i, Block.Planks);
      }
      break;
    }
    case 'distillery': {
      const front = placeLocal(b, 2, 4);
      buildHouse(world, localFootprint(b, 0, 0, 4, 2), y, { walls: Block.Stone, roof: Block.RoofSlate }, front[0], front[1]);
      // The copper still in the yard, a chimney and the barrels.
      box(0, 1, 0, 1, 3, 4, Block.Copper);
      put(0, 2, 3, Block.Copper);
      put(4, 0, 4, Block.Barrel);
      put(4, 0, 3, Block.Barrel);
      put(3, 0, 4, Block.Barrel);
      break;
    }
    case 'curingShed':
      // An open barn, leaves hung up under the thatch to cure.
      for (const lx of [0, 5]) for (const lz of [0, 3]) box(lx, lx, 0, 2, lz, lz, Block.Wood);
      box(-1, 6, 3, 3, -1, 4, Block.Thatch);
      box(-1, 6, 4, 4, 1, 2, Block.Thatch);
      box(1, 4, 2, 2, 1, 2, Block.TobaccoLeaf);
      break;
    case 'smokehouse':
      // A little stone smokehouse with a fire inside and a chimney.
      box(0, 2, 0, 2, 0, 2, Block.Stone);
      box(1, 1, 0, 1, 1, 1, Block.Air);
      put(1, 0, 1, Block.Embers);
      box(1, 1, 0, 1, 2, 2, Block.Air); // the door
      box(-1, 3, 3, 3, -1, 3, Block.RoofSlate);
      box(0, 0, 3, 4, 0, 0, Block.Stone);
      put(3, 0, 3, Block.Barrel);
      break;
    case 'forge':
      // An open smithy: a slate roof on posts over the hearth, chimney and anvil.
      for (const lx of [0, 4]) for (const lz of [0, 4]) box(lx, lx, 0, 2, lz, lz, Block.Wood);
      box(-1, 5, 3, 3, -1, 5, Block.RoofSlate);
      box(0, 1, 0, 0, 0, 1, Block.Stone);
      put(1, 1, 1, Block.Embers);
      put(0, 1, 1, Block.Embers);
      box(0, 0, 1, 5, 0, 0, Block.Stone);
      put(3, 0, 2, Block.Stone);
      put(4, 0, 2, Block.Barrel);
      break;
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

/** The world footprint of a rectangle in a building's layout (inclusive local corners). */
function localFootprint(b: Building, lx0: number, lz0: number, lx1: number, lz1: number): Footprint {
  const [ax, az] = placeLocal(b, lx0, lz0);
  const [bx, bz] = placeLocal(b, lx1, lz1);
  return { x0: Math.min(ax, bx), z0: Math.min(az, bz), w: Math.abs(ax - bx) + 1, d: Math.abs(az - bz) + 1 };
}

/** Takes a structure down again, leaving the ground as it was levelled. */
export function raze(world: VoxelWorld, b: Building): void {
  const spec = STRUCTURES[b.kind];
  switch (b.kind) {
    case 'hut':
    case 'storehouse':
      clearHouse(world, b, b.y);
      break;
    case 'path':
      world.setVoxel(b.x0, b.y - 1, b.z0, Block.Dirt);
      break;
    default:
      for (let x = b.x0 - spec.pad; x < b.x0 + b.w + spec.pad; x++) {
        for (let z = b.z0 - spec.pad; z < b.z0 + b.d + spec.pad; z++) for (let y = b.y; y < b.y + Math.max(2, spec.height); y++) world.setVoxel(x, y, z, Block.Air);
      }
  }
}

/** Where to stand to use a building: outside its door (or front), or beside a fire, fence or torch. */
export function doorOf(b: Building): { x: number; z: number } {
  if (STRUCTURES[b.kind].freeform || b.kind === 'campfire') return { x: b.x0 + b.w / 2, z: b.z0 + b.d / 2 };
  const [dx, dz] = DOOR_DIRS[b.rot % 4];
  return { x: b.x0 + b.w / 2 + dx * (b.w / 2 + 0.6), z: b.z0 + b.d / 2 + dz * (b.d / 2 + 0.6) };
}
