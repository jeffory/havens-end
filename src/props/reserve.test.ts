import { describe, expect, it } from 'vitest';
import { Block } from '../voxel/blocks';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { reserveProps } from './reserve';
import { Sketch } from './sketch';
import type { PropKind, PropModel } from './types';

/** A 2 × 1 × 3 block, a block a voxel, standing on the middle of its left edge's end. */
const brick = (): PropModel => ({ ...new Sketch().paint('a', 0).box(0, 0, 0, 1, 0, 2, 'a').model({ x: 1, y: 0, z: 0 }, 1), reserve: true });
const catalog = (model: PropModel) => ({ hullOnStocks: model }) as unknown as Record<PropKind, PropModel>;

describe('reserving props', () => {
  it('fills the air in the cells a block-a-voxel prop fills with the blocker, and leaves what’s there', () => {
    const world = new VoxelWorld();
    world.setVoxel(10, 5, 21, Block.Stone);
    const taken = reserveProps(world, [{ kind: 'hullOnStocks', x: 11, y: 5, z: 20, facing: 0, anchor: null }], catalog(brick()));
    expect(taken).toBe(5);
    expect(world.getVoxel(10, 5, 21)).toBe(Block.Stone);
    for (const [x, z] of [[10, 20], [11, 20], [11, 21], [10, 22], [11, 22]]) expect(world.getVoxel(x, 5, z)).toBe(Block.Blocker);
  });

  it('turns with the prop', () => {
    const world = new VoxelWorld();
    // Facing east: the model's +z runs along +x, its +x along −z.
    reserveProps(world, [{ kind: 'hullOnStocks', x: 11, y: 5, z: 20, facing: 1, anchor: null }], catalog(brick()));
    for (let x = 11; x <= 13; x++) for (const z of [19, 20]) expect(world.getVoxel(x, 5, z), `${x},${z}`).toBe(Block.Blocker);
  });

  it('leaves alone props that don’t ask, and refuses one drawn finer than a block a voxel', () => {
    const world = new VoxelWorld();
    expect(reserveProps(world, [{ kind: 'hullOnStocks', x: 0, y: 0, z: 0, facing: 0, anchor: null }], catalog({ ...brick(), reserve: false }))).toBe(0);
    expect(() => reserveProps(world, [{ kind: 'hullOnStocks', x: 0, y: 0, z: 0, facing: 0, anchor: null }], catalog({ ...brick(), scale: 0.25 }))).toThrow();
  });
});
