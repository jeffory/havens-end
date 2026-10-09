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
  bed: { w: 1, d: 2, h: 0.875, blocks: true },
  table: { w: 1, d: 1, h: 1, blocks: true },
  stool: { w: 1, d: 1, h: 0.5, blocks: false },
  chair: { w: 1, d: 1, h: 1, blocks: false },
  shelfCrockery: { w: 1, d: 1, h: 1.75, blocks: true },
  shelfBottles: { w: 1, d: 1, h: 1.75, blocks: true },
  shelfBooks: { w: 1, d: 1, h: 1.75, blocks: true },
  chest: { w: 1, d: 1, h: 0.625, blocks: true },
  hearth: { w: 1, d: 1, h: 2, blocks: true },
  rug: { w: 2, d: 2, h: 0.125, blocks: false },
  runner: { w: 1, d: 2, h: 0.125, blocks: false },
  bar: { w: 1, d: 1, h: 1.25, blocks: true },
  barCask: { w: 1, d: 1, h: 1.375, blocks: true },
  desk: { w: 1, d: 1, h: 1.25, blocks: true },
  counterProduce: { w: 1, d: 1, h: 1.125, blocks: true },
  counterCloth: { w: 1, d: 1, h: 1.125, blocks: true },
  rugGuild: { w: 2, d: 2, h: 0.125, blocks: false },
  rugSea: { w: 2, d: 2, h: 0.125, blocks: false },
  rugBrethren: { w: 2, d: 2, h: 0.125, blocks: false },
  runnerGuild: { w: 1, d: 2, h: 0.125, blocks: false },
  runnerSea: { w: 1, d: 2, h: 0.125, blocks: false },
  runnerBrethren: { w: 1, d: 2, h: 0.125, blocks: false },
  deskGrand: { w: 1, d: 1, h: 1.25, blocks: true },
  strongbox: { w: 1, d: 1, h: 0.75, blocks: true },
  ledgerChest: { w: 1, d: 1, h: 1.125, blocks: true },
  treasureChest: { w: 1, d: 1, h: 1.125, blocks: true },
  mapTable: { w: 1, d: 1, h: 1, blocks: true },
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
