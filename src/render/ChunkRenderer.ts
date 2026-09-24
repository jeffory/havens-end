import { Group, Mesh, MeshLambertMaterial, Vector3, Vector4 } from 'three';
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
  /** The cutaway: feet position and radius (0 = off), and the horizontal way to the camera plus its slope. */
  private readonly cut = { value: new Vector4(0, 0, 0, 0) };
  private readonly cutView = { value: new Vector3(0, 1, 1) };

  constructor(private readonly world: VoxelWorld) {
    this.group.name = 'terrain';
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uCut = this.cut;
      shader.uniforms.uCutView = this.cutView;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float cutaway;\nvarying vec3 vCutWorld;\nvarying float vCutaway;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCutWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvCutaway = cutaway;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec4 uCut;\nuniform vec3 uCutView;\nvarying vec3 vCutWorld;\nvarying float vCutaway;')
        .replace(
          '#include <clipping_planes_fragment>',
          /* glsl */ `#include <clipping_planes_fragment>
// Anything above head height on the camera's line of sight to the captain is cut away.
float cutHeight = vCutWorld.y - uCut.y;
// Only trees and buildings (the ground is solid inside, and would show hollow), and
// only on the camera's side of them.
if (uCut.w > 0.0 && vCutaway > 0.5 && cutHeight > 2.3 && dot(vCutWorld.xz - uCut.xz, uCutView.xy) > 0.5) {
  vec2 onSightLine = uCut.xz + uCutView.xy * cutHeight * uCutView.z;
  if (distance(vCutWorld.xz, onSightLine) < uCut.w) discard;
}`,
        );
    };
    this.material.customProgramCacheKey = () => 'havens-end-terrain-cutaway';
  }

  /**
   * Cuts a hole through canopies and roofs between the camera and someone on foot, so
   * they're never lost under a tree. `toward` is the horizontal direction to the camera;
   * `slope` is its horizontal run per unit of height. Radius 0 turns it off.
   */
  setCutaway(x: number, y: number, z: number, radius: number, towardX = 0, towardZ = 1, slope = 1): void {
    this.cut.value.set(x, y, z, radius);
    this.cutView.value.set(towardX, towardZ, slope);
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
