import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../config';
import { Block } from '../voxel/blocks';
import { collides, STEP_UP, standable } from '../land/walker';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { buildArchipelago, islandName, planArchipelago } from './archipelago';

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

  it('curses three islets, and never a port', () => {
    const islands = planArchipelago(1717);
    const cursed = islands.filter((i) => i.cursed);
    expect(cursed).toHaveLength(3);
    expect(cursed.every((i) => !i.port)).toBe(true);
  });

  it('names every islet, each its own name, and the cursed ones grimly', () => {
    const islands = planArchipelago(1717);
    const islets = islands.filter((i) => !i.port);
    const names = islets.map(islandName);
    expect(new Set(names).size).toBe(islets.length);
    expect(islets.every((i) => i.name)).toBe(true);
    expect(islands.filter((i) => i.cursed).every((i) => ["Dead Man's Cay", 'Wraith Key', 'Weeping Isle', 'Hollow Cay', 'Bonefire Key'].includes(i.name!))).toBe(true);
    expect(islandName(islands[0])).toBe('Haven');
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
        // On foot: the pier and every door can be stood on, and each place is there once.
        expect(standable(world, port.pier.x, port.pier.z, port.pier.y + 1)).toBe(port.pier.y);
        expect(port.places.map((p) => p.kind).sort()).toEqual(['market', 'office', 'shipyard', 'tavern']);
        for (const place of port.places) expect(standable(world, place.x, place.z, place.y + 1)).not.toBeNull();
        // And every one of them can be walked to from the pier.
        const reached = walkableFrom(world, port.pier.x, port.pier.y, port.pier.z, 90);
        for (const place of port.places) expect(reached.has(`${Math.floor(place.x)},${Math.floor(place.z)}`), `${port.name} ${place.kind}`).toBe(true);
        // Leaving port, the bow points out to sea: the water ahead is open.
        const ahead = { x: port.x + Math.sin(port.heading) * 40, z: port.z + Math.cos(port.heading) * 40 };
        expect(world.surfaceHeight(Math.floor(ahead.x), Math.floor(ahead.z))).toBeLessThanOrEqual(SEA_LEVEL - 4);
      }
    }
  }, 20_000); // builds three whole worlds: slow under a full parallel run
});

/**
 * Every column someone on foot could reach from a point, by the walker's rules:
 * scramble up to STEP_UP, drop any height, never into water over their depth.
 */
function walkableFrom(world: VoxelWorld, x: number, y: number, z: number, radius: number): Set<string> {
  const seen = new Set<string>();
  const queue: Array<[number, number, number]> = [[Math.floor(x), y, Math.floor(z)]];
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  while (queue.length > 0) {
    const [cx, cy, cz] = queue.shift()!;
    const key = `${cx},${cz}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (Math.abs(nx - x0) > radius || Math.abs(nz - z0) > radius || seen.has(`${nx},${nz}`)) continue;
      const ny = standable(world, nx + 0.5, nz + 0.5, cy + STEP_UP + 0.5);
      if (ny === null || (ny > cy && collides(world, cx + 0.5, ny, cz + 0.5))) continue;
      queue.push([nx, ny, nz]);
    }
  }
  return seen;
}
