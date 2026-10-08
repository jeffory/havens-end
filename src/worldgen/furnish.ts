import { PROP_SHAPES, shapeCells } from '../props/shapes';
import type { PropKind, PropPlacement } from '../props/types';
import { Block } from '../voxel/blocks';
import type { VoxelWorld } from '../voxel/VoxelWorld';

/** A block of grid cells, from (x0, z0) to (x1, z1), both included. */
export interface Cells {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** How high a prop that keeps people out takes its cells: the walker scrambles up two, never three. */
export const KEEP_OUT = 3;

/**
 * Stands a prop drawn finer than a block on the floor at `y`, over these cells, its front
 * (+z) looking along `facing` (as FACING_DIRS). Its anchor is the cell its top is in, so it
 * goes when that's lifted away on foot (a stall in the way, say). One that keeps people out
 * takes its cells KEEP_OUT high with the blocker, where there's air. Throws if the cells
 * aren't its shape, turned that way.
 */
export function standProp(world: VoxelWorld, decor: PropPlacement[], kind: PropKind, cells: Cells, y: number, facing: number): PropPlacement {
  const shape = PROP_SHAPES[kind];
  if (!shape) throw new Error(`standProp: ${kind} has no shape`);
  const p: PropPlacement = { kind, x: (cells.x0 + cells.x1 + 1) / 2, y, z: (cells.z0 + cells.z1 + 1) / 2, facing, anchor: null };
  const covered = shapeCells(p, shape);
  const wanted = (cells.x1 - cells.x0 + 1) * (cells.z1 - cells.z0 + 1);
  if (covered.length !== wanted || covered.some(({ x, z }) => x < cells.x0 || x > cells.x1 || z < cells.z0 || z > cells.z1)) {
    throw new Error(`standProp: ${kind} facing ${facing} doesn't fit ${cells.x0},${cells.z0} to ${cells.x1},${cells.z1}`);
  }
  p.anchor = { x: Math.floor((cells.x0 + cells.x1) / 2), y: y + Math.max(0, Math.ceil(shape.h) - 1), z: Math.floor((cells.z0 + cells.z1) / 2) };
  decor.push(p);
  if (shape.blocks) {
    for (const { x, z } of covered) for (let dy = 0; dy < KEEP_OUT; dy++) if (world.getVoxel(x, y + dy, z) === Block.Air) world.setVoxel(x, y + dy, z, Block.Blocker);
  }
  return p;
}
