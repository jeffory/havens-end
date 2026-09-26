import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { FACING_DIRS } from '../voxel/blocks';
import { placementMatrix, toWorld } from './place';
import { Sketch } from './sketch';
import type { PropPlacement } from './types';

const at = (facing: number): PropPlacement => ({ kind: 'lantern', x: 3, y: 4, z: 5, facing, anchor: null });

describe('placing a prop', () => {
  it('faces the model’s front (+z) the way its facing says', () => {
    const model = new Sketch().paint('a', 0).put(0, 0, 0, 'a').model({ x: 0, y: 0, z: 0 }, 1);
    for (let facing = 0; facing < 4; facing++) {
      const [dx, dz] = FACING_DIRS[facing];
      const front = toWorld(at(facing), model, 0, 0, 1);
      expect(front.x - 3).toBeCloseTo(dx);
      expect(front.z - 5).toBeCloseTo(dz);
    }
  });

  it('moves, turns and scales a model the same way for drawing as for reserving', () => {
    const model = new Sketch().paint('a', 0).put(0, 0, 0, 'a').model({ x: 1, y: 0, z: 2 }, 0.5);
    for (let facing = 0; facing < 4; facing++) {
      const matrix = placementMatrix(at(facing), model);
      for (const [vx, vy, vz] of [[0, 0, 0], [3, 1, -2], [1, 0, 2]]) {
        const a = toWorld(at(facing), model, vx, vy, vz);
        const b = new Vector3(vx, vy, vz).applyMatrix4(matrix);
        expect(b.x).toBeCloseTo(a.x);
        expect(b.y).toBeCloseTo(a.y);
        expect(b.z).toBeCloseTo(a.z);
      }
    }
  });
});
