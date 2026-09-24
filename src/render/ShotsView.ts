import { BoxGeometry, DynamicDrawUsage, InstancedMesh, Matrix4, MeshLambertMaterial } from 'three';
import type { Shot } from '../combat/gunnery';

const CAPACITY = 400;
const SIZE = { round: 0.45, chain: 0.5, grape: 0.22 } as const;

/** Cannonballs in flight: small dark cubes, drawn where the sim says they are, eased between ticks. */
export class ShotsView {
  readonly mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshLambertMaterial({ color: 0x222222 }), CAPACITY);
  private readonly matrix = new Matrix4();

  constructor() {
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.name = 'shots';
  }

  /** `behind` is how far (seconds) the rendered moment lags the latest sim step. */
  update(shots: readonly Shot[], behind: number): void {
    const count = Math.min(shots.length, CAPACITY);
    for (let i = 0; i < count; i++) {
      const s = shots[i];
      const size = SIZE[s.ammo];
      this.matrix.makeScale(size, size, size);
      this.matrix.setPosition(s.x - s.vx * behind, s.y - s.vy * behind, s.z - s.vz * behind);
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
