import { Group, Mesh, MeshLambertMaterial } from 'three';
import { WATER_LEVEL, waterSurfaceY } from '../ocean/waves';
import { angleOffWind } from '../sailing/pointOfSail';
import type { ShipState } from '../sailing/ship';
import type { ModelPart, ShipModel } from '../sailing/shipModel';
import type { Wind } from '../sailing/weather';
import { paletteFromRgba, type VoxelPalette } from '../voxel/palette';
import { meshCells } from './voxelGeometry';

/** True wind speed in u/s for wind strength 1; only used to work out apparent wind for the flag. */
const WIND_SPEED = 15;

export interface ShipPose {
  x: number;
  z: number;
  heading: number;
}

interface Sail {
  pivot: Group;
  furl: Group;
  /** Height in voxels, so a furled sail never shrinks below one voxel. */
  height: number;
}

/**
 * Draws a ship from its MagicaVoxel model. All motion here is cosmetic and derived
 * from the simulation: riding the waves, heeling, bracing and furling sails, the flag.
 */
export class ShipView {
  readonly root = new Group();
  /** Wave motion and heel happen on this inner group, so the root keeps the true pose. */
  private readonly body = new Group();
  private readonly sails: Sail[] = [];
  private readonly flags: Group[] = [];
  private heave = 0;
  private pitch = 0;
  private roll = 0;
  private brace = 0;

  constructor(readonly model: ShipModel) {
    this.root.name = 'ship';
    const palette = paletteFromRgba(model.palette);
    const material = new MeshLambertMaterial({ vertexColors: true });
    const o = model.origin;

    this.body.add(this.partMesh(model.hull.cells, palette, material, o.x, o.y, o.z));
    for (const part of model.sails) {
      const pivot = this.pivotGroup(part);
      const furl = new Group();
      furl.add(this.partMesh(part.cells, palette, material, part.pivot.x, part.pivot.y, part.pivot.z));
      pivot.add(furl);
      this.sails.push({ pivot, furl, height: partHeight(part) });
    }
    for (const part of model.flags) {
      const pivot = this.pivotGroup(part);
      pivot.add(this.partMesh(part.cells, palette, material, part.pivot.x, part.pivot.y, part.pivot.z));
      this.flags.push(pivot);
    }
    this.root.add(this.body);
  }

  update(pose: ShipPose, ship: ShipState, wind: Wind, time: number, frameSeconds: number): void {
    const { model } = this;
    this.root.position.set(pose.x, WATER_LEVEL, pose.z);
    this.root.rotation.y = pose.heading;

    // Ride the same stepped waves the ocean draws, sampled at bow, stern and both sides, then smoothed.
    const s = Math.sin(pose.heading);
    const c = Math.cos(pose.heading);
    const surface = (lx: number, lz: number) => waterSurfaceY(pose.x + lx * c + lz * s, pose.z - lx * s + lz * c, time);
    const bow = surface(0, model.bow - 1);
    const stern = surface(0, model.stern + 1);
    const port = surface(model.halfBeam, 0);
    const starboard = surface(-model.halfBeam, 0);
    const ease = 1 - Math.exp(-3 * frameSeconds);
    this.heave += ((bow + stern + port + starboard) / 4 - WATER_LEVEL - this.heave) * ease;
    this.pitch += (Math.atan2(bow - stern, model.bow - model.stern - 2) - this.pitch) * ease;
    this.roll += (Math.atan2(port - starboard, 2 * model.halfBeam) - this.roll) * ease;
    this.body.position.y = this.heave;
    this.body.rotation.set(-this.pitch, 0, this.roll + ship.heel);

    // Brace the yards round to the wind: square when running, hard over when close-hauled.
    const fx = s;
    const fz = c;
    const windToPort = wind.dirX * c - wind.dirZ * s;
    const braceTarget = -(1 - angleOffWind(fx, fz, wind) / Math.PI) * 1.1 * Math.max(-1, Math.min(1, windToPort * 4));
    this.brace += (braceTarget - this.brace) * (1 - Math.exp(-1.5 * frameSeconds));
    for (const sail of this.sails) {
      sail.pivot.rotation.y = this.brace;
      sail.furl.scale.y = Math.max(1 / sail.height, ship.sail);
    }

    // Flags stream with the apparent wind: the true wind minus the ship's own motion.
    const ax = wind.dirX * wind.strength * WIND_SPEED - (fx * ship.surge + c * ship.sway);
    const az = wind.dirZ * wind.strength * WIND_SPEED - (fz * ship.surge - s * ship.sway);
    const localX = ax * c - az * s; // toward port
    const localZ = ax * s + az * c; // toward the bow
    this.flags.forEach((flag, i) => {
      flag.rotation.y = Math.atan2(-localX, -localZ) + 0.12 * Math.sin(time * 9 + i * 1.7);
    });
  }

  private pivotGroup(part: ModelPart): Group {
    const o = this.model.origin;
    const pivot = new Group();
    pivot.position.set(part.pivot.x - o.x, part.pivot.y - o.y, part.pivot.z - o.z);
    this.body.add(pivot);
    return pivot;
  }

  private partMesh(cells: Int32Array, palette: VoxelPalette, material: MeshLambertMaterial, ox: number, oy: number, oz: number): Mesh {
    const mesh = new Mesh(meshCells(cells, palette), material);
    mesh.position.set(-ox, -oy, -oz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

function partHeight(part: ModelPart): number {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 1; i < part.cells.length; i += 4) {
    min = Math.min(min, part.cells[i]);
    max = Math.max(max, part.cells[i]);
  }
  return max - min + 1;
}
