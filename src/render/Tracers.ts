import { BufferAttribute, BufferGeometry, Group, Line, LineBasicMaterial } from 'three';
import type { Point3 } from '../land/firearms';

/** A streak shows this long. */
const LIFE = 0.16;
const OPACITY = 0.8;

/** The faint streak of a shot, from the muzzle to where it ended, gone in a blink. Presentation only. */
export class Tracers {
  readonly group = new Group();
  private readonly live: Array<{ line: Line; age: number }> = [];

  constructor() {
    this.group.name = 'tracers';
  }

  add(from: Point3, to: Point3): void {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([from.x, from.y, from.z, to.x, to.y, to.z]), 3));
    const line = new Line(geometry, new LineBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: OPACITY, depthWrite: false }));
    this.group.add(line);
    this.live.push({ line, age: 0 });
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const t = this.live[i];
      t.age += dt;
      const material = t.line.material as LineBasicMaterial;
      material.opacity = OPACITY * Math.max(0, 1 - t.age / LIFE);
      if (t.age < LIFE) continue;
      this.group.remove(t.line);
      t.line.geometry.dispose();
      material.dispose();
      this.live.splice(i, 1);
    }
  }
}
