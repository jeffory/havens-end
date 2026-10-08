import { describe, expect, it } from 'vitest';
import { Block, BLOCK_PALETTE } from '../voxel/blocks';
import { FLAG_CUTAWAY } from '../voxel/palette';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { planArchipelago } from '../worldgen/archipelago';
import type { Footprint } from '../worldgen/buildings';
import { buildHarbour } from '../worldgen/harbour';
import { generateIsland } from '../worldgen/island';
import { type Lift, RoofLifter } from './RoofLifter';

/** As the terrain shader tests it: the middle of the voxel, inside a box and above where it lifts from. */
const lifted = (lifts: Lift[], x: number, y: number, z: number) =>
  lifts.some((l) => y + 0.5 > l.from && x + 0.5 > l.x0 && x + 0.5 < l.x1 && z + 0.5 > l.z0 && z + 0.5 < l.z1);
const cutaway = (id: number) => ((BLOCK_PALETTE.flags?.[id] ?? 0) & FLAG_CUTAWAY) !== 0;
/** How far (x, z) lies outside a plot, in blocks either way (0 inside it). */
const outside = (f: Footprint, x: number, z: number) => Math.max(f.x0 - x, x - (f.x0 + f.w - 1), f.z0 - z, z - (f.z0 + f.d - 1), 0);

describe('shops in the real ports', () => {
  it('lift from their door and from anywhere inside, down to head height, as a house does', () => {
    let stands = 0;
    planArchipelago(1717)
      .filter((plan) => plan.port)
      .forEach((plan, i) => {
        const world = new VoxelWorld();
        generateIsland(world, plan);
        const harbour = buildHarbour(world, plan, plan.port!.faction, i === 0);
        const yard = harbour.places.find((p) => p.kind === 'shipyard')!;
        for (const place of harbour.places) {
          // A shop with no building of its own shares the shipyard's way in.
          if (place.kind !== 'shipyard' && place.x === yard.x && place.z === yard.z) continue;
          const plot = place.kind === 'shipyard' ? harbour.town.shed : harbour.town.houses.find((h) => outside(h, Math.floor(place.x), Math.floor(place.z)) <= 1)!;
          const floor = Math.floor(place.y);
          // The shop from head height up: everything of it that lifts, in its plot and its eaves.
          const shop: Array<[number, number, number]> = [];
          for (let x = plot.x0 - 1; x <= plot.x0 + plot.w; x++) {
            for (let z = plot.z0 - 1; z <= plot.z0 + plot.d; z++) {
              for (let y = floor + 2; y < floor + 16; y++) if (cutaway(world.getVoxel(x, y, z))) shop.push([x, y, z]);
            }
          }
          // Where the captain stands: at the door, and on every clear floor cell inside.
          const at = [{ x: place.x, y: place.y, z: place.z }];
          for (let x = plot.x0 + 1; x < plot.x0 + plot.w - 1; x++) {
            for (let z = plot.z0 + 1; z < plot.z0 + plot.d - 1; z++) {
              const clear = world.getVoxel(x, floor, z) === Block.Air && world.getVoxel(x, floor + 1, z) === Block.Air && world.getVoxel(x, floor - 1, z) !== Block.Air;
              if (clear) at.push({ x: x + 0.5, y: floor, z: z + 0.5 });
            }
          }
          for (const p of at) {
            stands++;
            const lifts = new RoofLifter(world).update({ x: p.x, y: p.y + 1.2, z: p.z }, p.y, { x: p.x, y: p.y + 40, z: p.z + 0.01 }, 1 / 60, 2);
            const left = shop.filter(([x, y, z]) => !lifted(lifts, x, y, z));
            expect(left, `${plan.port!.name} ${place.kind}, the captain at ${p.x},${p.y},${p.z}`).toEqual([]);
          }
        }
      });
    expect(stands).toBeGreaterThan(40);
  }, 20_000); // builds all five ports and lifts from every cell of every shop
});
