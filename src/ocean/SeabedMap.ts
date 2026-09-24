import type { VoxelWorld } from '../voxel/VoxelWorld';

/**
 * Terrain surface height for every column of a square window, one byte per column.
 * The ocean shader samples it as a texture to tint shallow water and to hide water
 * columns inside dry land. It follows terrain edits, so digging a channel floods it,
 * and it follows the camera around the archipelago (`follow`).
 */
export class SeabedMap {
  /** Row-major by z: heights[(z - originZ) * size + (x - originX)]. Columns outside the window read as open sea. */
  readonly heights: Uint8Array;
  /** Bumped on every change (edits and moves), so the renderer knows when to re-upload the texture. */
  version = 0;
  originX: number;
  originZ: number;
  private readonly previous: Uint8Array;

  constructor(
    private readonly world: VoxelWorld,
    readonly size: number,
    centerX = 0,
    centerZ = 0,
  ) {
    this.heights = new Uint8Array(size * size);
    this.previous = new Uint8Array(size * size);
    this.originX = Math.floor(centerX) - size / 2;
    this.originZ = Math.floor(centerZ) - size / 2;
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        this.heights[row * size + col] = world.surfaceHeight(this.originX + col, this.originZ + row);
      }
    }
    world.onChange((x, _y, z) => this.refresh(x, z));
  }

  /**
   * Re-centres the window on (x, z) once that point strays more than an eighth of the
   * window from the middle. Columns still inside are kept; only the new strip is read
   * from the world.
   */
  follow(x: number, z: number): void {
    const { size } = this;
    const slack = size / 8;
    if (Math.abs(x - (this.originX + size / 2)) <= slack && Math.abs(z - (this.originZ + size / 2)) <= slack) return;
    const oldX = this.originX;
    const oldZ = this.originZ;
    this.previous.set(this.heights);
    this.originX = Math.floor(x) - size / 2;
    this.originZ = Math.floor(z) - size / 2;
    for (let row = 0; row < size; row++) {
      const oldRow = this.originZ + row - oldZ;
      for (let col = 0; col < size; col++) {
        const oldCol = this.originX + col - oldX;
        this.heights[row * size + col] =
          oldRow >= 0 && oldRow < size && oldCol >= 0 && oldCol < size
            ? this.previous[oldRow * size + oldCol]
            : this.world.surfaceHeight(this.originX + col, this.originZ + row);
      }
    }
    this.version++;
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
