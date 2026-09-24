import type { VoxelWorld } from '../voxel/VoxelWorld';

/**
 * Terrain surface height for every column of a square region, one byte per column.
 * The ocean shader samples it as a texture to tint shallow water and to hide water
 * columns inside dry land. It follows terrain edits, so digging a channel floods it.
 */
export class SeabedMap {
  /** Row-major by z: heights[(z - originZ) * size + (x - originX)]. Columns outside the region read as open sea. */
  readonly heights: Uint8Array;
  /** Bumped on every change, so the renderer knows when to re-upload the texture. */
  version = 0;

  constructor(
    private readonly world: VoxelWorld,
    readonly originX: number,
    readonly originZ: number,
    readonly size: number,
  ) {
    this.heights = new Uint8Array(size * size);
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        this.heights[row * size + col] = world.surfaceHeight(originX + col, originZ + row);
      }
    }
    world.onChange((x, _y, z) => this.refresh(x, z));
  }

  private refresh(x: number, z: number): void {
    const col = x - this.originX;
    const row = z - this.originZ;
    if (col < 0 || row < 0 || col >= this.size || row >= this.size) return;
    const height = this.world.surfaceHeight(x, z);
    const i = row * this.size + col;
    if (this.heights[i] !== height) {
      this.heights[i] = height;
      this.version++;
    }
  }
}
