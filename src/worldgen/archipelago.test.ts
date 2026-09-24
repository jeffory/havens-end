import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../config';
import { Block } from '../voxel/blocks';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { buildArchipelago, planArchipelago } from './archipelago';

describe('planArchipelago', () => {
  it('is deterministic in its seed', () => {
    expect(planArchipelago(7)).toEqual(planArchipelago(7));
    expect(planArchipelago(7)).not.toEqual(planArchipelago(8));
  });

  it('puts Haven at the centre and four more ports around it: a free port, a pirate haven and two Imperial ports', () => {
    for (const seed of [1717, 1, 2, 3]) {
      const ports = planArchipelago(seed).filter((i) => i.port);
      expect(ports.map((i) => i.port!.faction)).toEqual(['merchant', 'merchant', 'pirate', 'imperial', 'imperial']);
      expect(ports[0]).toMatchObject({ centerX: 0, centerZ: 0, port: { name: 'Haven' } });
      // Further from home means more dangerous waters: the Imperial capital is the furthest out.
      const distances = ports.map((i) => Math.hypot(i.centerX, i.centerZ));
      expect(Math.max(...distances)).toBe(distances[4]);
      expect(distances[1]).toBeLessThan(700);
    }
  });

  it('keeps islands apart, and islets well clear of harbours', () => {
    const islands = planArchipelago(1717);
    expect(islands.length).toBeGreaterThan(12);
    for (const a of islands) {
      for (const b of islands) {
        if (a === b) continue;
        const gap = Math.hypot(a.centerX - b.centerX, a.centerZ - b.centerZ) - a.radius - b.radius;
        expect(gap).toBeGreaterThanOrEqual(a.port || b.port ? 170 : 90);
      }
    }
  });
});

describe('buildArchipelago', () => {
  it('gives every port a pier, a town and a berth in open, deep water', () => {
    for (const seed of [1717, 1, 2]) {
      const world = new VoxelWorld();
      const ports = buildArchipelago(world, planArchipelago(seed));
      expect(ports).toHaveLength(5);
      for (const port of ports) {
        const near = (radius: number, test: (x: number, z: number) => boolean) => {
          for (let x = Math.floor(port.x) - radius; x <= port.x + radius; x++) {
            for (let z = Math.floor(port.z) - radius; z <= port.z + radius; z++) if (test(x, z)) return true;
          }
          return false;
        };
        // Room for a brig at the berth (21 long, 7 wide, draft 2: the seabed must stay below y = 9).
        const [fx, fz] = [Math.sin(port.heading), Math.cos(port.heading)];
        for (let along = -8; along <= 12; along += 1) {
          for (let across = -3; across <= 3; across += 1) {
            const x = Math.floor(port.x + fx * along + fz * across);
            const z = Math.floor(port.z + fz * along - fx * across);
            expect(world.surfaceHeight(x, z)).toBeLessThanOrEqual(SEA_LEVEL - 3);
          }
        }
        // The pier head is close by.
        expect(near(24, (x, z) => world.getVoxel(x, SEA_LEVEL, z) === Block.Planks)).toBe(true);
        // Buildings stand behind it.
        const walls = port.faction === 'pirate' ? Block.Planks : Block.Plaster;
        expect(near(70, (x, z) => [1, 2, 3].some((dy) => world.getVoxel(x, world.surfaceHeight(x, z) - dy, z) === walls))).toBe(true);
        // Leaving port, the bow points out to sea: the water ahead is open.
        const ahead = { x: port.x + Math.sin(port.heading) * 40, z: port.z + Math.cos(port.heading) * 40 };
        expect(world.surfaceHeight(Math.floor(ahead.x), Math.floor(ahead.z))).toBeLessThanOrEqual(SEA_LEVEL - 4);
      }
    }
  });
});
