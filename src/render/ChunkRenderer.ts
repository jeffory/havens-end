import { Group, Mesh, MeshLambertMaterial } from 'three';
import type { Chunk } from '../voxel/Chunk';
import { CHUNK_SIZE } from '../voxel/Chunk';
import { buildPaddedVolume, meshPaddedVolume, PADDED } from '../voxel/mesher';
import type { VoxelWorld } from '../voxel/VoxelWorld';
import { toGeometry } from './voxelGeometry';

/**
 * Keeps one Three.js mesh per non-empty chunk in sync with the voxel data. It never
 * owns game state: it only reacts to chunks the world has marked dirty.
 */
export class ChunkRenderer {
  readonly group = new Group();
  private readonly meshes = new Map<Chunk, Mesh>();
  private readonly material = new MeshLambertMaterial({ vertexColors: true });
  private readonly scratch = new Uint8Array(PADDED ** 3);

  constructor(private readonly world: VoxelWorld) {
    this.group.name = 'terrain';
  }

  get meshCount(): number {
    return this.meshes.size;
  }

  /**
   * Rebuilds up to `budget` dirty chunks, nearest to `near` first when it's given. A
   * chunk costs ~2-3 ms to mesh, so a small per-frame budget keeps big edits (and the
   * far islands at startup) from stalling a frame.
   */
  update(budget: number, near?: { x: number; z: number }): number {
    const chunks = near ? this.world.takeDirtyNear(budget, near.x, near.z) : this.world.takeDirty(budget);
    for (const chunk of chunks) this.rebuild(chunk);
    return chunks.length;
  }

  private rebuild(chunk: Chunk): void {
    const { cx, cy, cz } = chunk;
    const data =
      chunk.filled > 0
        ? meshPaddedVolume(buildPaddedVolume(this.world, cx, cy, cz, this.scratch), cx * CHUNK_SIZE, cy * CHUNK_SIZE, cz * CHUNK_SIZE)
        : null;
    const existing = this.meshes.get(chunk);

    if (!data) {
      if (existing) {
        existing.geometry.dispose();
        this.group.remove(existing);
        this.meshes.delete(chunk);
      }
      return;
    }

    const geometry = toGeometry(data);

    if (existing) {
      existing.geometry.dispose();
      existing.geometry = geometry;
      return;
    }
    const mesh = new Mesh(geometry, this.material);
    mesh.position.set(cx * CHUNK_SIZE, cy * CHUNK_SIZE, cz * CHUNK_SIZE);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    this.meshes.set(chunk, mesh);
  }
}
