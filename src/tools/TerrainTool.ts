import {
  BoxGeometry,
  type Camera,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  type Object3D,
  Raycaster,
  Vector2,
} from 'three';
import type { Input } from '../core/Input';
import { Block, type BlockId } from '../voxel/blocks';
import { raycastVoxels, type VoxelHit } from '../voxel/raycast';
import type { VoxelWorld } from '../voxel/VoxelWorld';

const REACH = 400;
const PLACE_BLOCK: BlockId = Block.Dirt;

/**
 * Dev tool proving the deformation pipeline end to end: left click digs a voxel,
 * right click places one. Edits go through VoxelWorld.setVoxel, and the chunk meshes
 * and ocean follow on their own. This becomes the shovel and build tools on foot.
 */
export class TerrainTool {
  readonly highlight: Object3D;
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();

  constructor(
    private readonly world: VoxelWorld,
    private readonly camera: Camera,
  ) {
    this.highlight = new LineSegments(
      new EdgesGeometry(new BoxGeometry(1.02, 1.02, 1.02)),
      new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }),
    );
    this.highlight.visible = false;
  }

  update(input: Input): void {
    const hover = input.pointer.inside ? this.pick(input.pointer.x, input.pointer.y) : null;
    this.highlight.visible = hover !== null;
    if (hover) this.highlight.position.set(hover.x + 0.5, hover.y + 0.5, hover.z + 0.5);

    for (const click of input.takeClicks()) {
      const hit = this.pick(click.x, click.y);
      if (!hit) continue;
      if (click.button === 0) this.dig(hit);
      else if (click.button === 2) this.place(hit);
    }
  }

  private pick(x: number, y: number): VoxelHit | null {
    this.raycaster.setFromCamera(this.ndc.set(x, y), this.camera);
    const { origin: o, direction: d } = this.raycaster.ray;
    return raycastVoxels(this.world, o.x, o.y, o.z, d.x, d.y, d.z, REACH);
  }

  private dig(hit: VoxelHit): void {
    if (hit.y <= 0) return; // bedrock: the mesher assumes nothing is visible below y = 0
    this.world.setVoxel(hit.x, hit.y, hit.z, Block.Air);
  }

  private place(hit: VoxelHit): void {
    const x = hit.x + hit.nx;
    const y = hit.y + hit.ny;
    const z = hit.z + hit.nz;
    if (this.world.getVoxel(x, y, z) === Block.Air) this.world.setVoxel(x, y, z, PLACE_BLOCK);
  }
}
