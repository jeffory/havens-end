import { Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Weather } from '../sailing/weather';
import { Block } from '../voxel/blocks';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { WindStreaks } from './WindStreaks';

/** A steady breeze from the west, everywhere. */
const breeze = { windAt: () => ({ dirX: 1, dirZ: 0, strength: 0.8 }) } as unknown as Weather;

describe('wind streaks', () => {
  it('drift over the sea, never over dry land: no white lines across a beach', () => {
    // Land west of x = 0, its sand a little above the water; the sea east of it.
    const world = new VoxelWorld();
    for (let x = -40; x < 0; x++) for (let z = -40; z < 40; z++) for (let y = 0; y <= 11; y++) world.setVoxel(x, y, z, Block.Sand);
    const streaks = new WindStreaks(breeze, world);
    const at = new Matrix4();
    const [position, turn, scale] = [new Vector3(), new Quaternion(), new Vector3()];
    let [overSea, overLand] = [0, 0];
    for (let frame = 0; frame < 600; frame++) {
      streaks.update(new Vector3(0, 0, 0), 30, frame / 30, 1 / 30);
      for (let i = 0; i < streaks.mesh.count; i++) {
        streaks.mesh.getMatrixAt(i, at);
        at.decompose(position, turn, scale);
        if (scale.x === 0) continue;
        if (position.x < 0) overLand++;
        else overSea++;
      }
    }
    expect(overSea).toBeGreaterThan(100);
    expect(overLand).toBe(0);
  });
});
