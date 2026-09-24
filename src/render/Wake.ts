import { Vector4 } from 'three';

export const WAKE_POINTS = 24;
const INTERVAL = 0.18;
export const WAKE_LIFETIME = WAKE_POINTS * INTERVAL;

/**
 * Recent stern positions, for the ocean shader to draw as foam. Each point is a
 * Vector4 (x, z, age in seconds, strength 0..1); the ocean holds these same objects
 * as a uniform, so updating them here is all it takes.
 */
export class Wake {
  readonly points = Array.from({ length: WAKE_POINTS }, () => new Vector4());
  private readonly born = new Float64Array(WAKE_POINTS).fill(-Infinity);
  private readonly strength = new Float32Array(WAKE_POINTS);
  private next = 0;
  private lastEmit = -Infinity;

  update(time: number, sternX: number, sternZ: number, strength: number): void {
    if (strength > 0.05 && time - this.lastEmit >= INTERVAL) {
      this.points[this.next].x = sternX;
      this.points[this.next].y = sternZ;
      this.born[this.next] = time;
      this.strength[this.next] = Math.min(1, strength);
      this.next = (this.next + 1) % WAKE_POINTS;
      this.lastEmit = time;
    }
    for (let i = 0; i < WAKE_POINTS; i++) {
      const age = time - this.born[i];
      this.points[i].z = age;
      this.points[i].w = age < WAKE_LIFETIME ? this.strength[i] : 0;
    }
  }
}
