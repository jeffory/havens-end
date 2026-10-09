import { BoxGeometry, Group, Mesh, MeshLambertMaterial, Sprite } from 'three';
import type { IslandPlan } from '../worldgen/archipelago';
import { glowMaterial } from './glow';
import type { Lift } from './lifts';

const BATS = 7;
/** A bat's wing, shoulder to tip, and front to back. */
const WING = 0.2;
const CHORD = 0.12;
/** A bat this near a lifted room as the camera sees it keeps away, and comes back this quickly (1/s) once it's clear. */
const ROOM_MARGIN = 1.5;
const BACK = 4;
const WISPS_PER_ISLE = 5;
/** Ghost lights show this far off: they're a lure across the water. */
const WISP_RANGE = 700;

interface Bat {
  root: Group;
  left: Group;
  right: Group;
  radius: number;
  height: number;
  speed: number;
  phase: number;
}

/**
 * What comes out after dark, for the look of it: bats flitting over the captain's head
 * ashore, and the ghost lights that hang over the cursed islets, seen from far off.
 */
export class NightLife {
  readonly group = new Group();
  private readonly bats: Bat[] = [];
  private time = 0;
  private readonly wisps: Array<{ sprite: Sprite; x: number; z: number; y: number; r: number; phase: number; reach: number }> = [];

  constructor(islands: readonly IslandPlan[]) {
    this.group.name = 'night-life';
    // Shaded, not flat black: a blue-brown body and wings, the wings' leading edges (their
    // bones) lighter and faintly lit, so they read as wings in the moonlight.
    const membrane = new BoxGeometry(WING, 0.025, CHORD);
    const bone = new BoxGeometry(WING, 0.035, 0.03);
    const body = new BoxGeometry(0.07, 0.07, 0.15);
    const fur = new MeshLambertMaterial({ color: 0x4a3a34 });
    const skin = new MeshLambertMaterial({ color: 0x3b3346 });
    const edge = new MeshLambertMaterial({ color: 0xa8957c, emissive: 0x2a2219 });
    const wing = (side: 1 | -1) => {
      // Hinged at the shoulder, so it flaps from there.
      const hinge = new Group();
      const web = new Mesh(membrane, skin);
      const front = new Mesh(bone, edge);
      web.position.x = (side * WING) / 2;
      front.position.set((side * WING) / 2, 0.005, CHORD / 2);
      hinge.add(web, front);
      return hinge;
    };
    for (let i = 0; i < BATS; i++) {
      const root = new Group();
      const left = wing(-1);
      const right = wing(1);
      root.add(new Mesh(body, fur), left, right);
      root.visible = false;
      this.group.add(root);
      this.bats.push({ root, left, right, radius: 5 + (i % 4) * 2.2, height: 6 + (i % 3) * 1.5, speed: 0.9 + (i % 5) * 0.18, phase: i * 1.9 });
    }
    for (const isle of islands) {
      if (!isle.cursed) continue;
      for (let i = 0; i < WISPS_PER_ISLE; i++) {
        const material = glowMaterial(0x9dffc8);
        material.fog = false;
        const sprite = new Sprite(material);
        sprite.scale.setScalar(2.6);
        sprite.visible = false;
        this.group.add(sprite);
        this.wisps.push({ sprite, x: isle.centerX, z: isle.centerZ, y: 12 + isle.peak + 3 + (i % 3) * 1.5, r: isle.radius * (0.2 + 0.12 * i), phase: i * 2.3, reach: isle.radius * 1.5 });
      }
    }
  }

  /**
   * `bats` when the captain is ashore; `dark` 0 by day, 1 at night. The ghost lights of
   * an isle gather low over its hoard when the captain has a map to it (`hoards`: the
   * ground over each chest). Bats keep out of the air of a room lifted away (`rooms`: what's
   * lifted, and the camera), as the camera sees it: they'd look to be flying round inside.
   */
  update(
    focus: { x: number; y: number; z: number },
    dark: number,
    bats: boolean,
    time: number,
    hoards: ReadonlyArray<{ x: number; y: number; z: number }> = [],
    rooms?: { lifts: readonly Lift[]; camera: { x: number; y: number; z: number } },
  ): void {
    const night = dark > 0.5;
    let last = this.time;
    this.time = time;
    if (!(time > last && time - last < 0.5)) last = time;
    for (const b of this.bats) {
      b.root.visible = night && bats;
      if (!b.root.visible) continue;
      const a = time * b.speed + b.phase;
      // Loops and swerves, not neat circles.
      const r = b.radius + Math.sin(a * 2.3) * 1.5;
      b.root.position.set(focus.x + Math.sin(a) * r, focus.y + b.height + Math.sin(a * 3.1) * 0.8, focus.z + Math.cos(a * 1.3) * r);
      // Gone at once over a lifted room; back gently once clear of it.
      const away = rooms !== undefined && overRoom(b.root.position, rooms.camera, focus.y - 1.2, rooms.lifts);
      b.root.scale.setScalar(away ? 0 : Math.min(1, b.root.scale.x + (time - last) * BACK));
      b.root.visible = b.root.scale.x > 0;
      b.root.rotation.y = a + Math.PI / 2;
      const flap = Math.sin(time * 22 + b.phase) * 0.9;
      b.left.rotation.z = flap;
      b.right.rotation.z = -flap;
    }
    for (const w of this.wisps) {
      const near = Math.hypot(w.x - focus.x, w.z - focus.z) < WISP_RANGE;
      w.sprite.visible = night && near;
      if (!w.sprite.visible) continue;
      const a = time * 0.25 + w.phase;
      const hoard = hoards.find((h) => Math.hypot(h.x - w.x, h.z - w.z) < w.reach);
      if (hoard) {
        const r = 1 + w.phase * 0.25;
        w.sprite.position.set(hoard.x + 0.5 + Math.sin(a * 2) * r, hoard.y + 1.5 + (w.phase % 3) * 0.6 + Math.sin(time * 0.9 + w.phase) * 0.4, hoard.z + 0.5 + Math.cos(a * 1.6) * r);
      } else {
        w.sprite.position.set(w.x + Math.sin(a) * w.r, w.y + Math.sin(time * 0.9 + w.phase) * 1.2, w.z + Math.cos(a * 0.8) * w.r);
      }
      w.sprite.material.opacity = (dark - 0.5) * 2 * (0.55 + 0.45 * Math.sin(time * 1.7 + w.phase * 3));
    }
  }
}

/**
 * Does a bat at `p` look, from the camera, to be in a lifted room's air: does the camera's
 * line through it pass over a lifted room's box (with a margin) on its way down to `floor`?
 */
function overRoom(p: { x: number; y: number; z: number }, camera: { x: number; y: number; z: number }, floor: number, lifts: readonly Lift[]): boolean {
  if (camera.y <= p.y) return false;
  // Across the ground, from over the bat to where the line comes down to the floor.
  const k = Math.max(0, p.y - floor) / (camera.y - p.y);
  const [x0, z0, dx, dz] = [p.x, p.z, (p.x - camera.x) * k, (p.z - camera.z) * k];
  return lifts.some((l) => {
    if (!l.room) return false;
    // Where the segment is inside the box, along it, if anywhere (clipped slab by slab).
    let [enter, leave] = [0, 1];
    for (const [from, d, lo, hi] of [[x0, dx, l.x0 - ROOM_MARGIN, l.x1 + ROOM_MARGIN], [z0, dz, l.z0 - ROOM_MARGIN, l.z1 + ROOM_MARGIN]]) {
      if (d === 0) {
        if (from < lo || from > hi) return false;
        continue;
      }
      const [t0, t1] = [(lo - from) / d, (hi - from) / d];
      [enter, leave] = [Math.max(enter, Math.min(t0, t1)), Math.min(leave, Math.max(t0, t1))];
    }
    return enter <= leave;
  });
}
