import { describe, expect, it } from 'vitest';
import { Block } from '../voxel/blocks';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { SeabedMap } from './SeabedMap';

describe('SeabedMap', () => {
  it('follows the camera across the archipelago, matching the world wherever it goes', () => {
    const world = new VoxelWorld();
    for (let x = 300; x < 310; x++) for (let z = -5; z < 5; z++) for (let y = 0; y < 14; y++) world.setVoxel(x, y, z, Block.Stone);
    const map = new SeabedMap(world, 64);
    const at = (x: number, z: number) => map.heights[(z - map.originZ) * map.size + (x - map.originX)];
    expect(map.originX).toBe(-32);
    map.follow(5, 0); // within the slack: stays put
    expect(map.originX).toBe(-32);
    for (let x = 20; x <= 320; x += 20) map.follow(x, 0);
    expect(map.originX).toBe(320 - 32);
    expect(at(305, 0)).toBe(14);
    expect(at(295, 0)).toBe(0);
    // Edits inside the window still show up.
    world.setVoxel(300, 20, 10, Block.Stone);
    expect(at(300, 10)).toBe(21);
  });
});
