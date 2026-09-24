import { Group, Mesh, MeshLambertMaterial } from 'three';
import type { VesselStatus } from '../combat/vessel';
import { WATER_LEVEL, waterSurfaceY } from '../ocean/waves';
import { angleOffWind } from '../sailing/pointOfSail';
import type { ShipState } from '../sailing/ship';
import type { ModelPart, ShipModel } from '../sailing/shipModel';
import type { Wind } from '../sailing/weather';
import { paletteFromRgba, type VoxelPalette } from '../voxel/palette';
import { meshCells } from './voxelGeometry';

/** True wind speed in u/s for wind strength 1; only used to work out apparent wind for the flag. */
const WIND_SPEED = 15;

/** Flag colours: `field` replaces the flag's main colour, `emblem` every other colour on it. */
export interface Livery {
  field: number;
  emblem: number;
}

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

  private readonly material = new MeshLambertMaterial({ vertexColors: true });

  constructor(
    readonly model: ShipModel,
    livery?: Livery,
  ) {
    this.root.name = 'ship';
    const palette = paletteFromRgba(model.palette);
    const material = this.material;
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
      const flagPalette = livery ? paletteFromRgba(recolorFlag(part, model.palette, livery)) : palette;
      pivot.add(this.partMesh(part.cells, flagPalette, material, part.pivot.x, part.pivot.y, part.pivot.z));
      this.flags.push(pivot);
    }
    this.root.add(this.body);
  }

  update(pose: ShipPose, ship: ShipState, wind: Wind, time: number, frameSeconds: number, status: VesselStatus = 'afloat', fate = 0): void {
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
    // Going down: settle by the stern and roll over as she fills.
    const sinking = status === 'sinking' ? fate : 0;
    this.body.position.y = this.heave - sinking * 0.9 - sinking * sinking * 0.12;
    this.body.rotation.set(-this.pitch + sinking * 0.05, 0, this.roll + ship.heel + sinking * 0.11);

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
      // A ship that has struck her colours has hauled her flag down.
      flag.visible = status === 'afloat' || status === 'sinking';
      flag.rotation.y = Math.atan2(-localX, -localZ) + 0.12 * Math.sin(time * 9 + i * 1.7);
    });
  }

  dispose(): void {
    this.root.traverse((object) => {
      if (object instanceof Mesh) object.geometry.dispose();
    });
    this.material.dispose();
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

/** A copy of the palette with the flag's own colours swapped for a faction's. */
function recolorFlag(part: ModelPart, rgba: Uint8Array, livery: Livery): Uint8Array {
  const counts = new Map<number, number>();
  for (let i = 3; i < part.cells.length; i += 4) counts.set(part.cells[i], (counts.get(part.cells[i]) ?? 0) + 1);
  const field = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const out = rgba.slice();
  for (const index of counts.keys()) {
    const hex = index === field ? livery.field : livery.emblem;
    out.set([(hex >> 16) & 255, (hex >> 8) & 255, hex & 255, 255], index * 4);
  }
  return out;
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
