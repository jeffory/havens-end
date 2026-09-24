import { Vector4 } from 'three';

export const WAKE_POINTS = 200;
const TRAIL_INTERVAL = 0.25;
export const WAKE_LIFETIME = 4;

/**
 * Foam on the water: ship wakes and shot splashes. Each point is a Vector4 (x, z, age
 * in seconds, strength 0..1), which the ocean stamps into its foam map every frame.
 * One pool for every ship: when it's full, the oldest foam goes first.
 */
export class WakePool {
  readonly points = Array.from({ length: WAKE_POINTS }, () => new Vector4());
  private readonly born = new Float64Array(WAKE_POINTS).fill(-Infinity);
  private readonly strength = new Float32Array(WAKE_POINTS);
  private readonly lastTrail = new Map<number, number>();
  private next = 0;

  /** A ship's wake: called every frame, lays a point every quarter second. */
  trail(ship: number, time: number, x: number, z: number, strength: number): void {
    if (strength <= 0.05 || time - (this.lastTrail.get(ship) ?? -Infinity) < TRAIL_INTERVAL) return;
    this.lastTrail.set(ship, time);
    this.add(time, x, z, strength);
  }

  /** A one-off patch of foam: a splash, an explosion. */
  burst(time: number, x: number, z: number, strength: number): void {
    this.add(time, x, z, strength);
  }

  forget(ship: number): void {
    this.lastTrail.delete(ship);
  }

  /** Ages every point; call once per frame before rendering. */
  update(time: number): void {
    for (let i = 0; i < WAKE_POINTS; i++) {
      const age = time - this.born[i];
      this.points[i].z = age;
      this.points[i].w = age < WAKE_LIFETIME ? this.strength[i] : 0;
    }
  }

  private add(time: number, x: number, z: number, strength: number): void {
    const i = this.next;
    this.points[i].x = x;
    this.points[i].y = z;
    this.born[i] = time;
    this.strength[i] = Math.min(1, strength);
    this.next = (i + 1) % WAKE_POINTS;
  }
}
