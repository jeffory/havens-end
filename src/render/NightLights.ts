import { Group, PointLight } from 'three';

/** Something that lights its surroundings after dark: a fire, a torch, a lamp or a lantern. */
export interface LightSource {
  /** Where the light hangs: a little above the flame, so nothing beside it burns white. */
  x: number;
  y: number;
  z: number;
  /** 1 a campfire; smaller for a torch or a lantern. */
  strength: number;
  /** Flames flicker; lamps behind glass don't. */
  flicker: boolean;
}

/** A fixed number of point lights, so the shaders never recompile as lights come and go. */
const POOL = 6;
const RANGE = 16;
const INTENSITY = 16;
/** Only sources this close to the view get a light. */
const REACH = 90;

/**
 * Real light from fires, torches, lamps and lanterns at night: the few nearest the
 * view each get one of a small pool of point lights. By day the pool is dark.
 */
export class NightLights {
  readonly group = new Group();
  private readonly lights: PointLight[] = [];

  constructor() {
    this.group.name = 'night-lights';
    for (let i = 0; i < POOL; i++) {
      const light = new PointLight(0xffa040, 0, RANGE, 1.6);
      light.castShadow = false;
      this.lights.push(light);
      this.group.add(light);
    }
  }

  /** Places the pool on the sources nearest `focus`; `dark` is 0 by day, 1 at night. */
  update(sources: readonly LightSource[], focus: { x: number; z: number }, dark: number, time: number): void {
    const near =
      dark < 0.05
        ? []
        : sources
            .map((s) => ({ s, d: Math.hypot(s.x - focus.x, s.z - focus.z) }))
            .filter((e) => e.d < REACH)
            .sort((a, b) => a.d - b.d)
            .slice(0, POOL);
    this.lights.forEach((light, i) => {
      const e = near[i];
      if (!e) {
        light.intensity = 0;
        return;
      }
      const { s } = e;
      const flicker = s.flicker ? 0.85 + 0.15 * Math.sin(time * 11 + i * 1.7) * Math.sin(time * 7.3 + i) : 1;
      light.position.set(s.x, s.y, s.z);
      light.intensity = INTENSITY * s.strength * dark * flicker;
    });
  }
}
