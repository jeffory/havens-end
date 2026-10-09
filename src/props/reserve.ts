import { Block } from '../voxel/blocks';
import type { VoxelWorld } from '../voxel/VoxelWorld';
import { toWorld } from './place';
import type { PropKind, PropModel, PropPlacement } from './types';

/**
 * Keeps people out of the props that ask for it (the ship on the stocks): every air cell
 * the middle of one of such a prop's voxels lies in becomes Block.Blocker, so a prop drawn
 * finer than a block takes every cell any of it reaches into. Run it once, straight after
 * the world is generated and before edits are tracked, so the blockers are part of the
 * world, not of a save. Returns how many cells it took.
 */
export function reserveProps(world: VoxelWorld, placements: readonly PropPlacement[], catalog: Readonly<Record<PropKind, PropModel>>): number {
  let taken = 0;
  for (const p of placements) {
    const model = catalog[p.kind];
    if (!model.reserve) continue;
    for (let i = 0; i < model.cells.length; i += 4) {
      const w = toWorld(p, model, model.cells[i] + 0.5, model.cells[i + 1] + 0.5, model.cells[i + 2] + 0.5);
      const [x, y, z] = [Math.floor(w.x), Math.floor(w.y), Math.floor(w.z)];
      if (world.getVoxel(x, y, z) !== Block.Air) continue;
      world.setVoxel(x, y, z, Block.Blocker);
      taken++;
    }
  }
  return taken;
}
