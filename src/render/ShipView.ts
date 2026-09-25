import { BoxGeometry, BufferAttribute, Color, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, Sprite } from 'three';
import type { Side, VesselStatus } from '../combat/vessel';
import { WATER_LEVEL, waterSurfaceY } from '../ocean/waves';
import { angleOffWind } from '../sailing/pointOfSail';
import type { ShipState } from '../sailing/ship';
import type { ModelPart, ShipModel } from '../sailing/shipModel';
import type { Wind } from '../sailing/weather';
import { paletteFromRgba, type VoxelPalette } from '../voxel/palette';
import { glowMaterial } from './glow';
import { meshCells } from './voxelGeometry';

/** True wind speed in u/s for wind strength 1; only used to work out apparent wind for the flag. */
const WIND_SPEED = 15;
/** Gun barrels: length and thickness, how far the muzzle stands out of the side when run out, and how far back the recoil takes it. */
const BARREL_LENGTH = 1.3;
const BARREL_WIDTH = 0.4;
const MUZZLE_OUT = 0.9;
const RECOIL = 1.1;
/** Barrels sit in the painted gun ports, this far below where the shot leaves (the gun deck's top). */
const PORT_DROP = 0.8;
const IRON = 0x2c2c31;

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
  /** Wave motion and heel happen on this inner group, so the root keeps the true pose. Things on deck go here. */
  readonly body = new Group();
  private readonly sails: Sail[] = [];
  private readonly flags: Group[] = [];
  /** Each side's gun barrels, and where each sits when run out. */
  private readonly guns: Record<Side, Array<{ barrel: Mesh; x: number; inboard: number }>> = { port: [], starboard: [] };
  private gunGeometry: BoxGeometry | null = null;
  private heave = 0;
  private pitch = 0;
  private roll = 0;
  private brace = 0;

  private readonly material = new MeshLambertMaterial({ vertexColors: true });
  /** The stern lantern, lit at night: how you see a ship in the dark. */
  private readonly lantern = new Mesh(new BoxGeometry(0.45, 0.6, 0.45), new MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, toneMapped: false }));
  private readonly halo = new Sprite(glowMaterial(0xffb45a));

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
    this.lantern.position.set(0, model.deck + 1.8, model.stern + 1.2);
    this.halo.position.copy(this.lantern.position);
    this.halo.scale.setScalar(4);
    this.lantern.visible = this.halo.visible = false;
    this.body.add(this.lantern, this.halo);
  }

  /** How many guns a side is drawn with. */
  get gunCount(): number {
    return this.guns.port.length;
  }

  /**
   * Puts a barrel at each gun place (muzzle positions from the simulation, ship-local),
   * poking out of the hull's side there. They start run out.
   */
  mountGuns(slots: Record<Side, ReadonlyArray<readonly [number, number, number]>>): void {
    for (const side of ['port', 'starboard'] as const) {
      for (const gun of this.guns[side]) this.body.remove(gun.barrel);
      this.guns[side] = [];
    }
    this.gunGeometry?.dispose();
    const geometry = (this.gunGeometry = ironBox(BARREL_LENGTH, BARREL_WIDTH, BARREL_WIDTH));
    for (const side of ['port', 'starboard'] as const) {
      for (const [x, y, z] of slots[side]) {
        const out = Math.sign(x);
        const hullSide = this.hullSide(out, y - PORT_DROP, z) ?? Math.abs(x);
        const barrel = new Mesh(geometry, this.material);
        barrel.castShadow = true;
        // Run out: the muzzle stands clear of the side, the breech inside the hull.
        const runOut = out * (hullSide + MUZZLE_OUT - BARREL_LENGTH / 2);
        barrel.position.set(runOut, y - PORT_DROP, z);
        this.body.add(barrel);
        this.guns[side].push({ barrel, x: runOut, inboard: -out * RECOIL });
      }
    }
  }

  /** Runs a side's guns out (1) or in (0); `manned` lists the guns with hands to work them, and the rest stay in. */
  runGuns(side: Side, out: number, manned: readonly number[]): void {
    this.guns[side].forEach((gun, i) => {
      const run = manned.includes(i) ? out : 0;
      gun.barrel.position.x = gun.x + gun.inboard * (1 - run);
    });
  }

  /** How far the hull reaches out to one side (+1 port, −1 starboard) at a height and station, ship-local; null if there's no hull there. */
  private hullSide(out: number, y: number, z: number): number | null {
    const { cells } = this.model.hull;
    const o = this.model.origin;
    let reach: number | null = null;
    for (let i = 0; i < cells.length; i += 4) {
      const cy = cells[i + 1] - o.y;
      const cz = cells[i + 2] - o.z;
      if (y < cy || y >= cy + 1 || z < cz || z >= cz + 1) continue;
      const cx = cells[i] - o.x;
      const edge = out > 0 ? cx + 1 : -cx;
      if (reach === null || edge > reach) reach = edge;
    }
    return reach;
  }

  /** Lights the stern lantern: 0 by day, 1 on a dark night. */
  setLantern(amount: number): void {
    const lit = amount > 0.02;
    this.lantern.visible = this.halo.visible = lit;
    this.lantern.material.opacity = Math.min(1, amount * 1.5);
    this.halo.material.opacity = amount * 0.85;
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
    this.lantern.material.dispose();
    this.halo.material.dispose();
  }

  private pivotGroup(part: ModelPart): Group {
    const o = this.model.origin;
    const pivot = new Group();
    pivot.position.set(part.pivot.x - o.x, part.pivot.y - o.y, part.pivot.z - o.z);
    this.body.add(pivot);
    return pivot;
  }

  /** Fades the whole ship (1 = solid): she mustn't hide the captain working on the beach beside her. */
  setFade(opacity: number): void {
    const faded = opacity < 0.99;
    if (this.material.transparent !== faded) {
      this.material.transparent = faded;
      this.material.depthWrite = !faded;
      this.material.needsUpdate = true;
    }
    this.material.opacity = opacity;
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

/** A box coloured iron through its vertex colours, so it can share the ship's material (and fade with her). */
function ironBox(x: number, y: number, z: number): BoxGeometry {
  const geometry = new BoxGeometry(x, y, z);
  const n = geometry.getAttribute('position').count;
  const colours = new Float32Array(n * 3);
  const { r, g, b } = new Color(IRON); // in the working (linear) colour space, as vertex colours are
  for (let i = 0; i < n; i++) colours.set([r, g, b], i * 3);
  geometry.setAttribute('color', new BufferAttribute(colours, 3));
  return geometry;
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
