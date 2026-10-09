import { Group, PointLight, Sprite, type SpriteMaterial } from 'three';
import { glowMaterial } from './glow';

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
  /** The height of a lamp's glass, for a halo round it. Fires have none: their embers glow. */
  halo?: number;
}

/** A fixed number of point lights, so the shaders never recompile as lights come and go. */
const POOL = 6;
const RANGE = 16;
/**
 * Soft lamplight: a gentle falloff over a wide pool, rather than a hot spot under the lamp that
 * burns out whoever stands beneath it (a lantern hangs by every shop's door).
 */
const INTENSITY = 5;
const DECAY = 1;
/** A lamp's halo: how wide (blocks) and how strong at full dark. */
const HALO_SIZE = 2.5;
const HALO_OPACITY = 0.55;
/** Only sources this close to the view get a light. */
const REACH = 90;

/**
 * Real light from fires, torches, lamps and lanterns at night: the few nearest the
 * view each get one of a small pool of point lights. By day the pool is dark.
 */
export class NightLights {
  readonly group = new Group();
  private readonly lights: PointLight[] = [];
  private readonly halos: Array<Sprite & { material: SpriteMaterial }> = [];

  constructor() {
    this.group.name = 'night-lights';
    for (let i = 0; i < POOL; i++) {
      const light = new PointLight(0xffa040, 0, RANGE, DECAY);
      light.castShadow = false;
      this.lights.push(light);
      const halo = new Sprite(glowMaterial(0xffb45a));
      halo.scale.setScalar(HALO_SIZE);
      halo.visible = false;
      this.halos.push(halo);
      this.group.add(light, halo);
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
      const halo = this.halos[i];
      halo.visible = e?.s.halo !== undefined;
      if (!e) {
        light.intensity = 0;
        return;
      }
      const { s } = e;
      const flicker = s.flicker ? 0.85 + 0.15 * Math.sin(time * 11 + i * 1.7) * Math.sin(time * 7.3 + i) : 1;
      light.position.set(s.x, s.y, s.z);
      light.intensity = INTENSITY * s.strength * dark * flicker;
      if (s.halo !== undefined) {
        halo.position.set(s.x, s.halo, s.z);
        halo.material.opacity = dark * HALO_OPACITY;
      }
    });
  }
}
