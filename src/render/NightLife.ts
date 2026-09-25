import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Sprite } from 'three';
import type { IslandPlan } from '../worldgen/archipelago';
import { glowMaterial } from './glow';

const BATS = 7;
const WISPS_PER_ISLE = 5;
/** Ghost lights show this far off: they're a lure across the water. */
const WISP_RANGE = 700;

interface Bat {
  root: Group;
  left: Mesh;
  right: Mesh;
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
  private readonly wisps: Array<{ sprite: Sprite; x: number; z: number; y: number; r: number; phase: number; reach: number }> = [];

  constructor(islands: readonly IslandPlan[]) {
    this.group.name = 'night-life';
    const wing = new BoxGeometry(0.34, 0.04, 0.2);
    const body = new BoxGeometry(0.1, 0.1, 0.22);
    const dark = new MeshBasicMaterial({ color: 0x14141c });
    for (let i = 0; i < BATS; i++) {
      const root = new Group();
      const left = new Mesh(wing, dark);
      const right = new Mesh(wing, dark);
      left.position.x = -0.18;
      right.position.x = 0.18;
      root.add(new Mesh(body, dark), left, right);
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
   * ground over each chest).
   */
  update(focus: { x: number; y: number; z: number }, dark: number, bats: boolean, time: number, hoards: ReadonlyArray<{ x: number; y: number; z: number }> = []): void {
    const night = dark > 0.5;
    for (const b of this.bats) {
      b.root.visible = night && bats;
      if (!b.root.visible) continue;
      const a = time * b.speed + b.phase;
      // Loops and swerves, not neat circles.
      const r = b.radius + Math.sin(a * 2.3) * 1.5;
      b.root.position.set(focus.x + Math.sin(a) * r, focus.y + b.height + Math.sin(a * 3.1) * 0.8, focus.z + Math.cos(a * 1.3) * r);
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
