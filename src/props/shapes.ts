import { FACING_DIRS } from '../voxel/blocks';
import type { PropKind, PropPlacement } from './types';

/**
 * How much room a prop drawn finer than a block takes, in blocks: `w` across its own x, `d`
 * along its own z (the way it faces), centred on its origin at its foot, and `h` high. One
 * that `blocks` keeps people out of its cells: the town builder puts the blocker in them,
 * three high, so nobody walks through it or scrambles up on top.
 */
export interface PropShape {
  w: number;
  d: number;
  h: number;
  blocks: boolean;
}

/** Every prop drawn finer than a block that the town builder stands on a floor, by kind. */
export const PROP_SHAPES: Partial<Record<PropKind, PropShape>> = {
  barrel: { w: 1, d: 1, h: 1, blocks: true },
  crate: { w: 1, d: 1, h: 0.75, blocks: true },
  stallProduceRed: { w: 3, d: 2, h: 2.875, blocks: true },
  stallClothRed: { w: 3, d: 2, h: 2.875, blocks: true },
  stallProduceBlue: { w: 3, d: 2, h: 2.875, blocks: true },
  stallClothBlue: { w: 3, d: 2, h: 2.875, blocks: true },
  handCart: { w: 2, d: 3, h: 1.625, blocks: true },
};

/** The grid cells a placed prop of this shape stands in: round its origin, turned with it. */
export function shapeCells(p: PropPlacement, shape: { w: number; d: number }): Array<{ x: number; z: number }> {
  // Facing along x, its own x runs along z.
  const along = FACING_DIRS[p.facing][0] !== 0;
  const [wx, wz] = along ? [shape.d, shape.w] : [shape.w, shape.d];
  const x0 = Math.round(p.x - wx / 2);
  const z0 = Math.round(p.z - wz / 2);
  const out: Array<{ x: number; z: number }> = [];
  for (let x = x0; x < x0 + wx; x++) for (let z = z0; z < z0 + wz; z++) out.push({ x, z });
  return out;
}
