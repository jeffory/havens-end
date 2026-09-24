import { Group, Mesh, MeshLambertMaterial, Quaternion, Vector3 } from 'three';
import { cutlassCells, type CharacterModel, type PartName } from '../duel/characterModel';
import type { Fighter } from '../duel/duel';
import { MOVES, PARRY_WINDOW, ROLL } from '../duel/moves';
import { windup } from '../duel/timing';
import type { Point3 } from '../sailing/shipModel';
import { paletteFromRgba } from '../voxel/palette';
import { meshCells } from './voxelGeometry';

/**
 * A pose, in the character's own frame: +z is forward (toward the opponent), +y up,
 * -x the character's right (the sword side). Limbs are given as directions, which
 * keeps every pose readable from the side.
 */
interface Pose {
  crouch: number;
  lean: number;
  twist: number;
  head: number;
  armR: Vector3;
  armL: Vector3;
  /** Which way the blade points. */
  blade: Vector3;
  legR: Vector3;
  legL: Vector3;
  /** Somersault angle for rolls. */
  flip: number;
  /** 0 standing .. 1 flat on the deck. */
  fall: number;
}

const v = (x: number, y: number, z: number) => new Vector3(x, y, z).normalize();

const GUARD: Pose = {
  crouch: 0.06, lean: 0.08, twist: 0, head: 0,
  armR: v(-0.25, -0.55, 0.8), armL: v(0.35, -0.9, -0.25), blade: v(-0.1, 0.55, 0.85),
  legR: v(-0.1, -1, -0.3), legL: v(0.1, -1, 0.3), flip: 0, fall: 0,
};

const REST_ARM_R = new Vector3(-1, 0, 0);
const REST_ARM_L = new Vector3(1, 0, 0);
const REST_LEG = new Vector3(0, -1, 0);
const REST_BLADE = new Vector3(-1, 0, 0);

/** On foot: stood with arms at the sides. */
const STAND: Pose = {
  crouch: 0, lean: 0.03, twist: 0, head: 0,
  armR: v(-0.14, -1, 0.06), armL: v(0.14, -1, 0.06), blade: v(0, -0.35, 1),
  legR: v(-0.04, -1, 0), legL: v(0.04, -1, 0), flip: 0, fall: 0,
};

/** What someone on foot is doing this frame. */
export interface Stride {
  /** Ground speed, u/s. */
  speed: number;
  /** 0..1 through a swing of whatever's in hand, or null when not swinging. */
  swing: number | null;
  /** Asleep on the ground. */
  lying?: boolean;
  /** Holding a rod out over the water. */
  fishing?: boolean;
}

/** An animated voxel captain: a duelist with a cutlass, or on foot with a tool in hand. */
export class CharacterView {
  readonly root = new Group();
  private readonly fallPivot = new Group();
  private readonly flipPivot = new Group();
  private readonly torso = new Group();
  private readonly neck = new Group();
  private readonly shoulderR = new Group();
  private readonly shoulderL = new Group();
  private readonly hipR = new Group();
  private readonly hipL = new Group();
  private readonly sword = new Group();
  private readonly material = new MeshLambertMaterial({ vertexColors: true });
  private readonly pose: Pose = clonePose(GUARD);
  private readonly target: Pose = clonePose(GUARD);
  private readonly armLength: number;
  private readonly hipHeight: number;
  private stride = 0;
  private lastX = 0;
  private swordMesh: Mesh;
  private readonly q = new Quaternion();
  private readonly hand = new Vector3();

  constructor(private readonly model: CharacterModel) {
    const { parts, feet } = model;
    const palette = paletteFromRgba(model.palette);
    const hip = parts.torso.pivot;
    this.hipHeight = hip.y - feet.y;

    const mesh = (name: PartName, joint: Group, origin: Point3) => {
      const m = new Mesh(meshCells(parts[name].cells, palette), this.material);
      m.position.set(-origin.x, -origin.y, -origin.z);
      m.castShadow = true;
      joint.add(m);
    };
    const place = (joint: Group, at: Point3, from: Point3) => joint.position.set(at.x - from.x, at.y - from.y, at.z - from.z);

    // Feet -> fall pivot (topples about the feet) -> flip pivot at the hips (somersaults about the middle).
    this.root.add(this.fallPivot);
    this.fallPivot.add(this.flipPivot);
    this.flipPivot.position.set(hip.x - feet.x, this.hipHeight, hip.z - feet.z);
    this.flipPivot.add(this.torso, this.hipR, this.hipL);
    mesh('torso', this.torso, hip);
    for (const [joint, name] of [[this.neck, 'head'], [this.shoulderR, 'arm_r'], [this.shoulderL, 'arm_l']] as const) {
      place(joint, parts[name].pivot, hip);
      mesh(name, joint, parts[name].pivot);
      this.torso.add(joint);
    }
    for (const [joint, name] of [[this.hipR, 'leg_r'], [this.hipL, 'leg_l']] as const) {
      place(joint, parts[name].pivot, hip);
      mesh(name, joint, parts[name].pivot);
    }
    this.armLength = parts.arm_r.pivot.x - model.hand.x;

    const blade = cutlassCells();
    this.swordMesh = new Mesh(meshCells(blade.cells, paletteFromRgba(blade.palette)), this.material);
    this.swordMesh.position.set(-0.5, -0.5, -0.5);
    this.swordMesh.castShadow = true;
    this.sword.add(this.swordMesh);
    this.torso.add(this.sword);

    this.root.scale.setScalar(model.scale);
  }

  /** Poses the character for this moment of the fight, easing from the last frame. */
  update(f: Fighter, dt: number, time: number): void {
    this.targetPose(f, time);
    const snappy = f.state === 'attack' || f.state === 'roll' ? 40 : 20;
    const k = 1 - Math.exp(-snappy * dt);
    const p = this.pose;
    const t = this.target;
    p.crouch += (t.crouch - p.crouch) * k;
    p.lean += (t.lean - p.lean) * k;
    p.twist += (t.twist - p.twist) * k;
    p.head += (t.head - p.head) * k;
    p.flip = t.flip; // rolls are driven exactly, never eased
    p.fall += (t.fall - p.fall) * Math.min(1, 6 * dt);
    for (const key of ['armR', 'armL', 'blade', 'legR', 'legL'] as const) p[key].lerp(t[key], k).normalize();
    this.apply();
  }

  /** Lifts the darkest colours a little: dark coats read as silhouettes from the diorama camera. */
  lift(amount: number): void {
    this.material.emissive.setRGB(amount, amount, amount);
  }

  /**
   * Puts something else in the right hand: voxel cells laid along −x from the grip at
   * the origin, like the cutlass. Null leaves the hand empty.
   */
  hold(item: { cells: Int32Array; palette: Uint8Array } | null): void {
    this.swordMesh.geometry.dispose();
    this.swordMesh.visible = item !== null;
    if (item) this.swordMesh.geometry = meshCells(item.cells, paletteFromRgba(item.palette));
  }

  /** Poses the character walking, standing, or swinging a tool, easing from the last frame. */
  walk(stride: Stride, dt: number, time: number): void {
    const t = this.target;
    copyPose(t, STAND);
    t.crouch += Math.sin(time * 2.2) * 0.01;
    const pace = Math.min(1, stride.speed / 4.6);
    if (pace > 0.05) {
      this.stride += stride.speed * dt * 2.1;
      const s = Math.sin(this.stride) * 0.55 * pace;
      t.legR.set(-0.04, -1, s).normalize();
      t.legL.set(0.04, -1, -s).normalize();
      t.armR.set(-0.14, -1, -s * 0.7).normalize();
      t.armL.set(0.14, -1, s * 0.7).normalize();
      t.crouch += Math.abs(Math.cos(this.stride)) * 0.03 * pace;
      t.lean += 0.06 * pace;
    }
    if (stride.fishing) {
      t.armR.set(-0.2, -0.15, 1).normalize();
      t.blade.set(0, 0.35, 1).normalize();
    }
    if (stride.swing !== null) {
      // Up and back, then down and forward through the work.
      const k = stride.swing;
      if (k < 0.45) {
        t.armR.set(-0.25, 0.95, -0.25).normalize();
        t.blade.set(0, 0.6, -0.8).normalize();
        t.lean = -0.1;
      } else {
        t.armR.set(-0.15, -0.35, 1).normalize();
        t.blade.set(0, -0.85, 0.5).normalize();
        t.lean = 0.3;
        t.crouch = 0.12;
      }
    }
    const k = 1 - Math.exp(-(stride.swing !== null ? 30 : 14) * dt);
    const p = this.pose;
    p.crouch += (t.crouch - p.crouch) * k;
    p.lean += (t.lean - p.lean) * k;
    p.twist += (t.twist - p.twist) * k;
    p.head += (t.head - p.head) * k;
    p.flip = 0;
    p.fall += ((stride.lying ? 1 : 0) - p.fall) * Math.min(1, 4 * dt);
    for (const key of ['armR', 'armL', 'blade', 'legR', 'legL'] as const) p[key].lerp(t[key], k).normalize();
    this.apply();
  }

  dispose(): void {
    this.root.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
    this.material.dispose();
  }

  private targetPose(f: Fighter, time: number): void {
    const t = this.target;
    copyPose(t, GUARD);
    // Breathing.
    t.crouch += Math.sin(time * 2.2) * 0.02;

    switch (f.state) {
      case 'walk': {
        this.stride += Math.abs(f.x - this.lastX) * 3.2;
        const s = Math.sin(this.stride) * 0.5;
        t.legR.set(-0.1, -1, -0.3 + s).normalize();
        t.legL.set(0.1, -1, 0.3 - s).normalize();
        t.crouch += Math.abs(Math.cos(this.stride)) * 0.04;
        break;
      }
      case 'block': {
        t.crouch = 0.14;
        t.lean = 0;
        t.armR.set(-0.3, 0.15, 0.9).normalize();
        t.blade.set(0, 0.95, 0.3).normalize();
        if (f.parryWindow > PARRY_WINDOW * 0.3) t.blade.set(0.1, 0.75, 0.65).normalize(); // the snap of a parry
        break;
      }
      case 'attack':
        this.attackPose(f);
        break;
      case 'roll': {
        const k = Math.min(1, f.t / ROLL.seconds);
        const forward = f.rollDir === f.facing ? 1 : -1;
        t.flip = forward * k * Math.PI * 2;
        t.crouch = 0.55 * Math.sin(k * Math.PI);
        t.armR.set(-0.2, -0.3, 0.9).normalize();
        t.armL.set(0.2, -0.3, 0.9).normalize();
        t.legR.set(-0.1, -0.5, 0.8).normalize();
        t.legL.set(0.1, -0.5, 0.8).normalize();
        t.blade.set(0, -0.2, -1).normalize();
        break;
      }
      case 'hitstun':
        t.lean = -0.35;
        t.head = -0.25;
        t.armR.set(-0.6, 0.2, -0.3).normalize();
        t.blade.set(-0.2, 0.8, -0.3).normalize();
        break;
      case 'stagger': {
        const wobble = Math.sin(f.t * 14) * 0.08;
        t.lean = -0.5 + wobble;
        t.head = -0.3;
        t.crouch = 0.1;
        t.armR.set(-0.8, 0.5, -0.3).normalize();
        t.armL.set(0.8, 0.4, -0.2).normalize();
        t.blade.set(-0.3, 0.9, -0.4).normalize();
        t.legL.set(0.1, -1, 0.45).normalize();
        break;
      }
      case 'down':
        t.fall = 1;
        t.armR.set(-0.7, 0.3, -0.4).normalize();
        t.armL.set(0.7, 0.3, -0.4).normalize();
        t.blade.set(-0.6, -0.2, -0.7).normalize();
        break;
    }
    this.lastX = f.x;
  }

  /** Windup, strike, follow-through: each attack is three key poses, eased between. */
  private attackPose(f: Fighter): void {
    const t = this.target;
    const spec = MOVES[f.move!];
    const w = windup(f);
    const phase = f.t < w ? 'windup' : f.t < w + spec.active ? 'strike' : 'recover';
    const along = (f.t - w - spec.active) / spec.recovery; // 0..1 through the follow-through

    switch (f.move) {
      case 'light':
        if (f.combo % 2 === 0) {
          // Backhand: up from low.
          if (phase === 'windup') { t.armR.set(-0.5, -0.6, 0.3); t.blade.set(0, -0.6, -0.8); t.twist = 0.3; }
          else { t.armR.set(-0.2, 0.35, 1); t.blade.set(0, 0.6, 0.8); t.twist = -0.25; t.lean = 0.2; }
        } else {
          if (phase === 'windup') { t.armR.set(-0.3, 0.45, -0.4); t.blade.set(0, 0.6, -0.8); t.twist = -0.3; }
          else { t.armR.set(-0.2, -0.2, 1); t.blade.set(0, -0.35, 1); t.twist = 0.3; t.lean = 0.25; }
        }
        break;
      case 'heavy':
        if (phase === 'windup') { t.armR.set(-0.2, 1, -0.25); t.blade.set(0, 0.3, -1); t.lean = -0.15; t.crouch = 0.1; }
        else { t.armR.set(-0.2, -0.5, 1); t.blade.set(0, -0.75, 0.7); t.lean = 0.35; t.crouch = 0.22; }
        break;
      case 'thrust':
        if (phase === 'windup') { t.armR.set(-0.3, 0, -0.55); t.blade.set(0, 0.05, 1); t.crouch = 0.25; t.lean = -0.1; }
        else { t.armR.set(-0.12, 0, 1); t.blade.set(0, 0, 1); t.lean = 0.35; t.crouch = 0.18; t.legL.set(0, -0.75, 0.7); }
        break;
      case 'kick':
        t.armR.set(-0.5, -0.2, -0.45);
        t.blade.set(-0.1, 0.5, -0.9);
        t.armL.set(0.5, 0.1, 0.4);
        if (phase === 'windup') { t.legL.set(0, -0.35, 0.6); t.lean = -0.2; }
        else { t.legL.set(0, -0.1, 1); t.lean = -0.3; }
        break;
    }
    if (phase === 'recover') {
      // Ease back toward guard through the follow-through.
      for (const key of ['armR', 'armL', 'blade', 'legR', 'legL'] as const) t[key].normalize().lerp(GUARD[key], along * 0.8);
      t.lean += (GUARD.lean - t.lean) * along;
      t.twist *= 1 - along;
    }
    for (const key of ['armR', 'armL', 'blade', 'legR', 'legL'] as const) t[key].normalize();
  }

  private apply(): void {
    const p = this.pose;
    this.fallPivot.rotation.x = -p.fall * (Math.PI / 2);
    this.flipPivot.rotation.x = p.flip;
    this.flipPivot.position.y = this.hipHeight - p.crouch / this.model.scale;
    this.torso.rotation.set(p.lean, p.twist, 0);
    this.neck.rotation.x = p.head;
    this.shoulderR.quaternion.setFromUnitVectors(REST_ARM_R, p.armR);
    this.shoulderL.quaternion.setFromUnitVectors(REST_ARM_L, p.armL);
    this.hipR.quaternion.setFromUnitVectors(REST_LEG, p.legR);
    this.hipL.quaternion.setFromUnitVectors(REST_LEG, p.legL);
    // The cutlass sits in the right hand and points where the pose says.
    this.hand.copy(p.armR).multiplyScalar(this.armLength).add(this.shoulderR.position);
    this.sword.position.copy(this.hand);
    this.sword.quaternion.copy(this.q.setFromUnitVectors(REST_BLADE, p.blade));
  }
}

function clonePose(p: Pose): Pose {
  return { ...p, armR: p.armR.clone(), armL: p.armL.clone(), blade: p.blade.clone(), legR: p.legR.clone(), legL: p.legL.clone() };
}

function copyPose(to: Pose, from: Pose): void {
  Object.assign(to, { crouch: from.crouch, lean: from.lean, twist: from.twist, head: from.head, flip: from.flip, fall: from.fall });
  for (const key of ['armR', 'armL', 'blade', 'legR', 'legL'] as const) to[key].copy(from[key]);
}
