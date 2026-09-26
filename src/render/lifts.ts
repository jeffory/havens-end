import { Vector4 } from 'three';
import { type Lift, MAX_LIFTS } from './RoofLifter';

/** A lift not in use sits under a height nothing reaches. */
const NEVER = 1e6;

/** GLSL: the lifted boxes, and whether a voxel (by its centre) is lifted away. */
export const LIFT_GLSL = /* glsl */ `
uniform vec4 uLiftBox[${MAX_LIFTS}];
uniform float uLiftFrom[${MAX_LIFTS}];
bool lifted(vec3 cell) {
  for (int k = 0; k < ${MAX_LIFTS}; k++) {
    vec4 b = uLiftBox[k];
    if (cell.y > uLiftFrom[k] && cell.x > b.x && cell.x < b.z && cell.z > b.y && cell.z < b.w) return true;
  }
  return false;
}`;

/**
 * What's lifted away on foot, as shader uniforms shared by everything drawn that lifts:
 * the terrain, and props hung on buildings. Up to MAX_LIFTS boxes (x0, z0, x1, z1 on the
 * grid, x1 and z1 not included), each lifted above its own height.
 */
export class Lifts {
  readonly uniforms = {
    uLiftBox: { value: Array.from({ length: MAX_LIFTS }, () => new Vector4()) },
    uLiftFrom: { value: new Array<number>(MAX_LIFTS).fill(NEVER) },
  };

  set(lifts: ReadonlyArray<Lift>): void {
    for (let k = 0; k < MAX_LIFTS; k++) {
      const l = lifts[k];
      this.uniforms.uLiftBox.value[k].set(l?.x0 ?? 0, l?.z0 ?? 0, l?.x1 ?? 0, l?.z1 ?? 0);
      this.uniforms.uLiftFrom.value[k] = l ? l.from : NEVER;
    }
  }

  /** Is the voxel at (x, y, z) lifted away? The shader's test, at the voxel's centre. */
  holds(x: number, y: number, z: number): boolean {
    const boxes = this.uniforms.uLiftBox.value;
    for (let k = 0; k < MAX_LIFTS; k++) {
      const b = boxes[k];
      if (y + 0.5 > this.uniforms.uLiftFrom.value[k] && x + 0.5 > b.x && x + 0.5 < b.z && z + 0.5 > b.y && z + 0.5 < b.w) return true;
    }
    return false;
  }
}
