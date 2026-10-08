import { describe, expect, it } from 'vitest';
import { Block } from '../voxel/blocks';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { clearLine, GUNS, hitChance, isGun, MUSKET, pickTarget, resolveShot, type Shootable } from './firearms';

const target = (x: number, z: number, kind: Shootable['kind'] = 'bandit', id = 1): Shootable => ({ kind, id, x, y: 10, z });
const FROM = { x: 0.5, y: 11.3, z: 0.5 };
const TO = { x: 0.5, y: 11.2, z: 8.5 };

describe('firearms', () => {
  it('the pistol is good close in, the rifle clumsy close in and deadly far out', () => {
    expect(hitChance('pistol', 2)).toBeGreaterThan(hitChance('rifle', 2));
    expect(hitChance('rifle', 20)).toBeGreaterThan(0.7);
    expect(hitChance('rifle', 20)).toBeGreaterThan(hitChance('pistol', 11));
    expect(hitChance('pistol', 11)).toBeLessThan(hitChance('pistol', 3));
    expect(hitChance('musket', 16)).toBeLessThan(hitChance('musket', 8));
  });

  it('can’t hit beyond a gun’s range', () => {
    expect(hitChance('pistol', GUNS.pistol.range + 1)).toBe(0);
    expect(hitChance('rifle', GUNS.rifle.range + 1)).toBe(0);
    expect(hitChance('musket', MUSKET.range + 1)).toBe(0);
  });

  it('knows a gun from a tool or a good', () => {
    expect(isGun('pistol')).toBe(true);
    expect(isGun('rifle')).toBe(true);
    expect(isGun('axe')).toBe(false);
    expect(isGun('timber')).toBe(false);
  });

  it('with keys or a pad, aims at the nearest target within the cone ahead', () => {
    const got = pickTarget({ x: 0, z: 0, facing: 0 }, [target(0, 9, 'bandit', 1), target(0, 5, 'creature', 2), target(5, 0, 'creature', 3), target(0, -3, 'creature', 4)], 12);
    expect(got?.id).toBe(2);
    expect(pickTarget({ x: 0, z: 0, facing: 0 }, [target(6, 1)], 12), 'off to the side').toBeNull();
    expect(pickTarget({ x: 0, z: 0, facing: 0 }, [target(0, 20)], 12), 'out of range').toBeNull();
  });

  it('with the mouse, aims at whatever is at the cursor', () => {
    const got = pickTarget({ x: 0, z: 0, facing: 0 }, [target(8, 0, 'creature', 7), target(0, 4, 'creature', 8)], 12, { x: 8.4, z: 0.6 });
    expect(got?.id).toBe(7);
    expect(pickTarget({ x: 0, z: 0, facing: 0 }, [target(8, 0)], 12, { x: -8, z: 0 })).toBeNull();
  });

  it('hits or misses on the roll, against the chance', () => {
    const world = new VoxelWorld();
    const t = target(0, 8);
    expect(resolveShot(world, FROM, TO, 12, t, 0.6, 0.59).hit).toBe(t);
    const miss = resolveShot(world, FROM, TO, 12, t, 0.6, 0.61);
    expect(miss.hit).toBeNull();
    expect(miss.blocked).toBe(false);
  });

  it('is stopped by rock, trees and walls in the way', () => {
    const world = new VoxelWorld();
    for (let y = 8; y < 14; y++) world.setVoxel(0, y, 4, Block.Stone);
    const shot = resolveShot(world, FROM, TO, 12, target(0, 8), 1, 0);
    expect(shot.hit).toBeNull();
    expect(shot.blocked).toBe(true);
    expect(shot.end.z).toBeCloseTo(4, 0);
  });

  it('a miss flies on to the end of the gun’s reach', () => {
    const shot = resolveShot(new VoxelWorld(), FROM, TO, 12, null, 0, 1);
    expect(Math.hypot(shot.end.x - FROM.x, shot.end.y - FROM.y, shot.end.z - FROM.z)).toBeCloseTo(12, 1);
  });

  it('sees along a clear line, but not through a wall', () => {
    const world = new VoxelWorld();
    expect(clearLine(world, FROM, TO)).toBe(true);
    for (let y = 8; y < 14; y++) world.setVoxel(0, y, 4, Block.Stone);
    expect(clearLine(world, FROM, TO)).toBe(false);
  });
});
