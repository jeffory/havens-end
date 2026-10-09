import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../../config';
import { Block } from '../../voxel/blocks';
import { VoxelWorld } from '../../voxel/VoxelWorld';
import { ambience, shoreDistance, type Surroundings } from './ambience';
import { LOOP_IDS } from './sounds';

const base: Surroundings = { where: 'sea', speed: 0, wind: 0, shore: Infinity, port: Infinity, fire: Infinity, night: false };
const at = (s: Partial<Surroundings>) => ambience({ ...base, ...s });

describe('ambience', () => {
  it('everything is silent when where is null', () => {
    const levels = at({ where: null, speed: 1, wind: 1, shore: 0, port: 0, fire: 0 });
    for (const id of LOOP_IDS) expect(levels[id]).toBe(0);
  });

  it('at sea, waves and timbers rise with speed and the rigging follows the wind', () => {
    const idle = at({ speed: 0, wind: 0 });
    expect(idle.waves).toBeCloseTo(0.5);
    expect(idle.timbers).toBeCloseTo(0.25);
    expect(idle.rigging).toBe(0);
    const fast = at({ speed: 1, wind: 1.8 });
    expect(fast.waves).toBeCloseTo(0.9);
    expect(fast.timbers).toBeCloseTo(0.7);
    expect(fast.rigging).toBeCloseTo(0.7);
    expect(at({ speed: 0.5, wind: 0.5 }).rigging).toBeCloseTo(0.35);
    expect(fast.surf).toBe(0);
  });

  it("on foot, the surf fades out over 30 blocks from the water and the ship's sounds are gone", () => {
    expect(at({ where: 'land', shore: 0 }).surf).toBeCloseTo(0.8);
    expect(at({ where: 'land', shore: 15 }).surf).toBeCloseTo(0.2);
    expect(at({ where: 'land', shore: 30 }).surf).toBe(0);
    expect(at({ where: 'land', shore: Infinity }).surf).toBe(0);
    const land = at({ where: 'land', shore: 0, speed: 1, wind: 1 });
    expect(land.waves).toBe(0);
    expect(land.timbers).toBe(0);
    expect(land.rigging).toBe(0);
  });

  it('gulls by day near a port, at sea or ashore; the harbour bustle only ashore in port', () => {
    expect(at({ port: 0 }).gulls).toBeCloseTo(0.6);
    expect(at({ port: 75, where: 'land' }).gulls).toBeCloseTo(0.3);
    expect(at({ port: 150 }).gulls).toBe(0);
    expect(at({ port: 0, night: true }).gulls).toBe(0);
    expect(at({ where: 'land', port: 0 }).harbour).toBeCloseTo(0.7);
    expect(at({ where: 'land', port: 30 }).harbour).toBeCloseTo(0.35);
    expect(at({ where: 'land', port: 60 }).harbour).toBe(0);
    expect(at({ where: 'land', port: 0, night: true }).harbour).toBeCloseTo(0.35);
    expect(at({ where: 'sea', port: 0 }).harbour).toBe(0);
  });

  it('the campfire crackles within 12 blocks', () => {
    expect(at({ where: 'land', fire: 0 }).campfire).toBeCloseTo(0.9);
    expect(at({ where: 'land', fire: 6 }).campfire).toBeCloseTo(0.9 * 0.25);
    expect(at({ where: 'land', fire: 12 }).campfire).toBe(0);
    expect(at({ where: 'sea', fire: 0 }).campfire).toBe(0);
  });
});

describe('shoreDistance', () => {
  it('finds the nearest open water', () => {
    const world = new VoxelWorld();
    for (let x = -30; x <= 9; x++) for (let z = -40; z <= 40; z++) world.setVoxel(x, SEA_LEVEL - 1, z, Block.Sand);
    expect(Math.abs(shoreDistance(world, 0, 0) - 10)).toBeLessThanOrEqual(3);
  });

  it('is Infinity with ground all round', () => {
    const world = new VoxelWorld();
    for (let x = -40; x <= 40; x++) for (let z = -40; z <= 40; z++) world.setVoxel(x, SEA_LEVEL - 1, z, Block.Sand);
    expect(shoreDistance(world, 0, 0)).toBe(Infinity);
  });
});
