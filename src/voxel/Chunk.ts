import { Block, type BlockId } from './blocks';

export const CHUNK_SHIFT = 5;
export const CHUNK_SIZE = 1 << CHUNK_SHIFT; // 32
export const CHUNK_MASK = CHUNK_SIZE - 1;
export const CHUNK_VOLUME = CHUNK_SIZE ** 3;

/**
 * A 32³ block of voxels. 32 keeps draw calls low (one mesh per chunk) while a
 * single dig still only costs a ~1-2 ms remesh.
 */
export class Chunk {
  /** Layout: x + z * 32 + y * 32 * 32. */
  readonly data = new Uint8Array(CHUNK_VOLUME);
  /** Non-air voxel count, so empty chunks can be skipped without scanning. */
  filled = 0;

  constructor(
    readonly cx: number,
    readonly cy: number,
    readonly cz: number,
  ) {}

  static index(lx: number, ly: number, lz: number): number {
    return lx | (lz << CHUNK_SHIFT) | (ly << (2 * CHUNK_SHIFT));
  }

  /** Raw write with no dirty tracking or events; returns the previous id. Use VoxelWorld.setVoxel for gameplay edits. */
  set(lx: number, ly: number, lz: number, id: BlockId): BlockId {
    const i = Chunk.index(lx, ly, lz);
    const prev = this.data[i];
    if (prev !== id) {
      if (prev === Block.Air) this.filled++;
      else if (id === Block.Air) this.filled--;
      this.data[i] = id;
    }
    return prev;
  }
}
