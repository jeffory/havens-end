import { MAX_TERRAIN_HEIGHT } from '../config';
import { Block, type BlockId } from './blocks';
import { Chunk, CHUNK_MASK, CHUNK_SHIFT } from './Chunk';

export type VoxelChangeListener = (x: number, y: number, z: number, prev: BlockId, next: BlockId) => void;

// Chunk coordinates pack into one number: 17 bits per axis (±65536 chunks, ±2M voxels) fits in 51 bits.
const KEY_BIAS = 1 << 16;
const KEY_SPAN = 2 ** 17;
const chunkKey = (cx: number, cy: number, cz: number) =>
  ((cx + KEY_BIAS) * KEY_SPAN + (cy + KEY_BIAS)) * KEY_SPAN + (cz + KEY_BIAS);

/**
 * Sparse voxel storage: only chunks that contain something exist. The open sea has
 * no voxels at all (the ocean is drawn separately), so memory scales with islands,
 * not with the size of the map.
 *
 * Coordinates are integer world voxel positions. This class has no rendering
 * dependencies, so it can move into a worker or be driven by headless tests.
 */
export class VoxelWorld {
  private readonly chunks = new Map<number, Chunk>();
  /** Chunks whose mesh is stale. A Map keeps insertion order, so remeshing is first-in, first-out. */
  private readonly dirty = new Map<number, Chunk>();
  private readonly listeners = new Set<VoxelChangeListener>();

  get chunkCount(): number {
    return this.chunks.size;
  }

  allChunks(): IterableIterator<Chunk> {
    return this.chunks.values();
  }

  getChunk(cx: number, cy: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cy, cz));
  }

  getOrCreateChunk(cx: number, cy: number, cz: number): Chunk {
    const key = chunkKey(cx, cy, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new Chunk(cx, cy, cz);
      this.chunks.set(key, chunk);
      this.dirty.set(key, chunk);
    }
    return chunk;
  }

  getVoxel(x: number, y: number, z: number): BlockId {
    const chunk = this.chunks.get(chunkKey(x >> CHUNK_SHIFT, y >> CHUNK_SHIFT, z >> CHUNK_SHIFT));
    return chunk ? chunk.data[Chunk.index(x & CHUNK_MASK, y & CHUNK_MASK, z & CHUNK_MASK)] : Block.Air;
  }

  /** Changes one voxel. Returns false if nothing changed. Affected meshes are queued for rebuild. */
  setVoxel(x: number, y: number, z: number, id: BlockId): boolean {
    const cx = x >> CHUNK_SHIFT;
    const cy = y >> CHUNK_SHIFT;
    const cz = z >> CHUNK_SHIFT;
    let chunk = this.getChunk(cx, cy, cz);
    if (!chunk) {
      if (id === Block.Air) return false;
      chunk = this.getOrCreateChunk(cx, cy, cz);
    }
    const lx = x & CHUNK_MASK;
    const ly = y & CHUNK_MASK;
    const lz = z & CHUNK_MASK;
    const prev = chunk.set(lx, ly, lz, id);
    if (prev === id) return false;

    this.markDirtyAround(cx, cy, cz, lx, ly, lz);
    for (const listener of this.listeners) listener(x, y, z, prev, id);
    return true;
  }

  /** Height of the first empty cell above the highest solid voxel in a column (0 if the column is empty). */
  surfaceHeight(x: number, z: number, maxY = MAX_TERRAIN_HEIGHT): number {
    const cx = x >> CHUNK_SHIFT;
    const cz = z >> CHUNK_SHIFT;
    const lx = x & CHUNK_MASK;
    const lz = z & CHUNK_MASK;
    for (let y = maxY - 1; y >= 0; ) {
      const cy = y >> CHUNK_SHIFT;
      const chunk = this.getChunk(cx, cy, cz);
      if (!chunk || chunk.filled === 0) {
        y = (cy << CHUNK_SHIFT) - 1; // skip the whole empty chunk
        continue;
      }
      if (chunk.data[Chunk.index(lx, y & CHUNK_MASK, lz)] !== Block.Air) return y + 1;
      y--;
    }
    return 0;
  }

  onChange(listener: VoxelChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Removes and returns up to `limit` stale chunks, oldest first. */
  takeDirty(limit: number): Chunk[] {
    const out: Chunk[] = [];
    for (const [key, chunk] of this.dirty) {
      if (out.length >= limit) break;
      this.dirty.delete(key);
      out.push(chunk);
    }
    return out;
  }

  /**
   * A voxel on a chunk's face, edge or corner also changes its neighbours' meshes
   * (face culling and ambient occlusion both look one voxel across the border).
   */
  private markDirtyAround(cx: number, cy: number, cz: number, lx: number, ly: number, lz: number): void {
    const sx = lx === 0 ? -1 : lx === CHUNK_MASK ? 1 : 0;
    const sy = ly === 0 ? -1 : ly === CHUNK_MASK ? 1 : 0;
    const sz = lz === 0 ? -1 : lz === CHUNK_MASK ? 1 : 0;
    for (let dy = Math.min(0, sy); dy <= Math.max(0, sy); dy++) {
      for (let dz = Math.min(0, sz); dz <= Math.max(0, sz); dz++) {
        for (let dx = Math.min(0, sx); dx <= Math.max(0, sx); dx++) {
          const key = chunkKey(cx + dx, cy + dy, cz + dz);
          const chunk = this.chunks.get(key);
          if (chunk) this.dirty.set(key, chunk);
        }
      }
    }
  }
}
