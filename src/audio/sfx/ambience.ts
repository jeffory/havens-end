/** The ambience mix: how loud each looping bed should be, from where the captain is and what is happening. */
import { SEA_LEVEL } from '../../config';
import { Block } from '../../voxel/blocks';
import type { VoxelReader } from '../../voxel/raycast';
import type { LoopId } from './sounds';

export interface Surroundings {
  readonly where: 'sea' | 'land' | null;
  /** The ship's speed over her top speed, 0..1. */
  readonly speed: number;
  /** Wind.strength where the captain is (0..~1.8). */
  readonly wind: number;
  /** On foot: distance to open water (Infinity if none within reach). */
  readonly shore: number;
  /** Distance to the nearest port's centre. */
  readonly port: number;
  /** Distance to the nearest lit campfire or bandit fire. */
  readonly fire: number;
  readonly night: boolean;
}

const SURF_REACH = 30;
const GULL_REACH = 150;
const HARBOUR_REACH = 60;
const FIRE_REACH = 12;

/** 1 at distance 0, falling to 0 at `reach`. */
const closeness = (distance: number, reach: number) => Math.max(0, 1 - distance / reach);

/** The level of each loop, 0..1. Silent everywhere when the captain is nowhere (menus, the sunk). */
export function ambience(s: Surroundings): Record<LoopId, number> {
  const levels: Record<LoopId, number> = {
    waves: 0, timbers: 0, rigging: 0, surf: 0, gulls: 0, harbour: 0, campfire: 0,
  };
  if (s.where === null) return levels;
  if (s.where === 'sea') {
    levels.waves = 0.5 + 0.4 * s.speed;
    levels.timbers = 0.25 + 0.45 * s.speed;
    levels.rigging = 0.7 * Math.min(1, s.wind);
  } else {
    levels.surf = 0.8 * closeness(s.shore, SURF_REACH) ** 2;
    levels.harbour = 0.7 * closeness(s.port, HARBOUR_REACH) * (s.night ? 0.5 : 1);
    levels.campfire = 0.9 * closeness(s.fire, FIRE_REACH) ** 2;
  }
  if (!s.night) levels.gulls = 0.6 * closeness(s.port, GULL_REACH);
  return levels;
}

const RING_STEP = 3;
const RING_SAMPLES = 12;

/** How far to the nearest open water from (x, z): the radius of the first sampled ring that has some, or Infinity. */
export function shoreDistance(world: VoxelReader, x: number, z: number, reach = 30): number {
  for (let radius = RING_STEP; radius <= reach; radius += RING_STEP) {
    for (let i = 0; i < RING_SAMPLES; i++) {
      const angle = (i / RING_SAMPLES) * Math.PI * 2;
      const sx = Math.round(x + Math.cos(angle) * radius);
      const sz = Math.round(z + Math.sin(angle) * radius);
      if (world.getVoxel(sx, SEA_LEVEL - 1, sz) === Block.Air) return radius;
    }
  }
  return Infinity;
}
