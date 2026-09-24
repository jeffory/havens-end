import { DynamicDrawUsage, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Vector3 } from 'three';
import type { Barrel } from '../combat/barrels';
import { waterSurfaceY } from '../ocean/waves';
import { paletteFromRgba } from '../voxel/palette';
import { meshCells } from './voxelGeometry';

const CAPACITY = 32;
const SCALE = 0.42;

/** A little voxel powder keg: staves, dark hoops and a red warning band. */
function barrelCells(): Int32Array {
  const cells: number[] = [];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 3; x++) {
      for (let z = 0; z < 3; z++) {
        const color = y === 0 || y === 3 ? 2 : y === 2 ? 3 : 1;
        cells.push(x, y, z, color);
      }
    }
  }
  return Int32Array.from(cells);
}

function barrelPalette() {
  const rgba = new Uint8Array(256 * 4);
  rgba.set([138, 96, 56, 255], 1 * 4); // staves
  rgba.set([40, 30, 24, 255], 2 * 4); // hoops
  rgba.set([178, 40, 34, 255], 3 * 4); // warning band
  return paletteFromRgba(rgba);
}

/** Explosive barrels bobbing on the waves, slowly turning. */
export class BarrelsView {
  readonly mesh: InstancedMesh;
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly scale = new Vector3(SCALE, SCALE, SCALE);
  private readonly up = new Vector3(0, 1, 0);

  constructor() {
    const geometry = meshCells(barrelCells(), barrelPalette()).translate(-1.5, -1.2, -1.5);
    this.mesh = new InstancedMesh(geometry, new MeshLambertMaterial({ vertexColors: true }), CAPACITY);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'barrels';
  }

  update(barrels: readonly Barrel[], time: number): void {
    const count = Math.min(barrels.length, CAPACITY);
    for (let i = 0; i < count; i++) {
      const b = barrels[i];
      this.position.set(b.x, waterSurfaceY(b.x, b.z, time), b.z);
      this.rotation.setFromAxisAngle(this.up, time * 0.4 + b.id);
      this.mesh.setMatrixAt(i, this.matrix.compose(this.position, this.rotation, this.scale));
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
