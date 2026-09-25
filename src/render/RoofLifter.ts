import { Block, BLOCK_PALETTE } from '../voxel/blocks';
import { FLAG_CUTAWAY } from '../voxel/palette';
import { raycastVoxels, type VoxelReader } from '../voxel/raycast';

/** A box lifted away: on the grid from (x0, z0) up to but not including (x1, z1), everything a tree or building has above `from`. */
export interface Lift {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  from: number;
}

/** A tree or building found whole: the box to lift, whether it has a roof, and whether anything of it stands above the cut. */
interface Found extends Lift {
  roofed: boolean;
  above: boolean;
}

/** At most this many lifted at once (the terrain shader's limit). */
export const MAX_LIFTS = 12;
/** A structure is flood-filled out to this many blocks at most (a big house is well under). */
const MAX_BLOCKS = 6000;
/** A lift stays this long after the captain moves clear, so it doesn't flicker at the edge. */
const HOLD_SECONDS = 0.6;
/** Blocks this far above the floor lift: a storey (the roof, or the floor above) and up. */
const STOREY = 3;
/** Roofing: a roof lifts whole, down to its eaves, which hang at the height of a one-storey house's wall tops. */
const ROOFING: ReadonlySet<number> = new Set([Block.Thatch, Block.RoofTile, Block.RoofSlate, Block.TarredRoof]);
/** Trees: lifted when they're in the way, never just for being near. */
const TREES: ReadonlySet<number> = new Set([Block.Wood, Block.Leaves, Block.PalmLeaves, Block.Deadwood]);
/** In town, buildings are looked for this often (seconds), as the captain walks... */
const NEAR_EVERY = 0.25;
/** ...from their feet to this far above, */
const NEAR_HEIGHT = 14;
/** ...and one stays lifted till the captain is this much further off than the radius that lifted it. */
const NEAR_SLACK = 2;

/**
 * A block's neighbours for finding a structure whole: across its faces and its edges, as
 * the courses of a stepped roof with no gable wall under it meet only at their edges.
 */
const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = (() => {
  const out: Array<[number, number, number]> = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    const n = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
    if (n === 1 || n === 2) out.push([dx, dy, dz]);
  }
  return out;
})();

const key = (l: Lift) => `${l.x0},${l.z0},${l.x1},${l.z1}`;
const box = ({ x0, z0, x1, z1, from }: Lift): Lift => ({ x0, z0, x1, z1, from });

/** How far (x, z) is from a lift's box, across the ground (0 inside it). */
function distance(l: Lift, x: number, z: number): number {
  return Math.hypot(Math.max(l.x0 - x, 0, x - l.x1), Math.max(l.z0 - z, 0, z - l.z1));
}

/**
 * Lifts roofs and canopies out of the way on foot. Each frame it looks from the captain
 * toward the camera; a tree or building in the way is found whole (its connected blocks)
 * and lifted from a storey above its floor, or from its eaves, so the rooms below show,
 * as in a doll's house. In town it also lifts every building near the captain, so the
 * streets, doors and rooms round them show too. Plain presentation over the world.
 */
export class RoofLifter {
  private held: Array<Lift & { until: number }> = [];
  /** Buildings lifted for being near, and when they were last looked for. */
  private near: Lift[] = [];
  private nextLook = 0;
  private clock = 0;
  /** The world as the lifter sees it: only trees and buildings. */
  private readonly structures: VoxelReader;

  constructor(world: VoxelReader) {
    this.structures = {
      getVoxel: (x, y, z) => {
        const id = world.getVoxel(x, y, z);
        return ((BLOCK_PALETTE.flags?.[id] ?? 0) & FLAG_CUTAWAY) !== 0 ? id : Block.Air;
      },
    };
  }

  /**
   * What to lift now, the captain (their chest) at `focus` and the camera at `camera`. In
   * town, `near` is how close a building must be to lift for that alone (0 out of town).
   */
  update(focus: { x: number; y: number; z: number }, feet: number, camera: { x: number; y: number; z: number }, dt: number, near = 0): Lift[] {
    this.clock += dt;
    // A few lines of sight: chest and head, and a little either side, so a wide
    // canopy can't hide the captain between two rays.
    const origins = [
      [0, 0, 0],
      [0, 0.8, 0],
      [0.45, 0.4, 0],
      [-0.45, 0.4, 0],
      [0, 0.4, 0.45],
      [0, 0.4, -0.45],
    ];
    for (const [ox, oy, oz] of origins) {
      const x = focus.x + ox;
      const y = focus.y + oy;
      const z = focus.z + oz;
      const d = Math.hypot(camera.x - x, camera.y - y, camera.z - z) || 1;
      const hit = raycastVoxels(this.structures, x, y, z, (camera.x - x) / d, (camera.y - y) / d, (camera.z - z) / d, Math.min(d, 40));
      if (!hit) continue;
      const known = this.held.find((l) => hit.x >= l.x0 && hit.x < l.x1 && hit.z >= l.z0 && hit.z < l.z1 && hit.y >= l.from);
      if (known) {
        known.until = this.clock + HOLD_SECONDS;
        continue;
      }
      // Lifted from where it would be anyway, or lower if that's where the line of sight
      // runs through it (the captain just behind a tall building's wall).
      const found = this.structureAt(hit.x, hit.y, hit.z, feet, new Set());
      if (found) this.held.push({ ...box(found), from: Math.min(found.from, hit.y - 0.5), until: this.clock + HOLD_SECONDS });
    }
    this.held = this.held.filter((l) => l.until >= this.clock).slice(-MAX_LIFTS);

    if (near <= 0) this.near = [];
    else if (this.clock >= this.nextLook) {
      this.nextLook = this.clock + NEAR_EVERY;
      this.near = this.lookNear(focus.x, focus.z, feet, near);
    }
    // What's in the way first; then the nearest buildings, as many as there's room for.
    const out: Lift[] = [...this.held];
    const taken = new Set(out.map(key));
    for (const l of this.near) {
      if (out.length >= MAX_LIFTS) break;
      if (!taken.has(key(l))) out.push(l);
    }
    return out;
  }

  /** Nothing lifted (the captain's gone aboard, or into a menu). */
  clear(): void {
    this.held = [];
    this.near = [];
  }

  /**
   * Every roofed building with a block within `radius` of (x, z), from the captain's feet
   * up, nearest first; and those lifted before that the captain isn't yet well clear of.
   * (Stalls, carts, guns and flags are low, or thin: they're lifted only if they're in the way.)
   */
  private lookNear(x: number, z: number, feet: number, radius: number): Lift[] {
    const floor = Math.floor(feet);
    const seen = new Set<string>();
    const found = new Map<string, Lift>();
    for (let cx = Math.floor(x - radius); cx <= x + radius; cx++) {
      for (let cz = Math.floor(z - radius); cz <= z + radius; cz++) {
        if (distance({ x0: cx, z0: cz, x1: cx + 1, z1: cz + 1, from: 0 }, x, z) > radius) continue;
        for (let cy = floor; cy < floor + NEAR_HEIGHT; cy++) {
          const id = this.structures.getVoxel(cx, cy, cz);
          if (id === Block.Air || TREES.has(id) || seen.has(`${cx},${cy},${cz}`)) continue;
          const building = this.structureAt(cx, cy, cz, feet, seen);
          if (building?.roofed && building.above) found.set(key(building), box(building));
        }
      }
    }
    for (const l of this.near) if (!found.has(key(l)) && distance(l, x, z) <= radius + NEAR_SLACK) found.set(key(l), l);
    return [...found.values()].sort((a, b) => distance(a, x, z) - distance(b, x, z));
  }

  /**
   * The tree or building with a block at (x, y, z), found whole, as the box to lift; null if
   * it's too big to be one. Only what stands from the captain's feet up counts (never the
   * boards they stand on), and it lifts from a storey above its floor, or from its eaves if
   * those are lower, so no roof is left hanging. `seen` gathers the blocks it finds.
   */
  private structureAt(x: number, y: number, z: number, feet: number, seen: Set<string>): Found | null {
    const floor = Math.floor(feet);
    const queue: Array<[number, number, number]> = [[x, y, z]];
    let [x0, x1, z0, z1, y0, y1, eaves, count] = [x, x, z, z, y, y, Infinity, 0];
    while (queue.length > 0) {
      const [cx, cy, cz] = queue.pop()!;
      const k = `${cx},${cy},${cz}`;
      if (cy < floor || seen.has(k)) continue;
      const id = this.structures.getVoxel(cx, cy, cz);
      if (id === Block.Air) continue;
      seen.add(k);
      if (++count > MAX_BLOCKS) return null;
      x0 = Math.min(x0, cx);
      x1 = Math.max(x1, cx);
      z0 = Math.min(z0, cz);
      z1 = Math.max(z1, cz);
      y0 = Math.min(y0, cy);
      y1 = Math.max(y1, cy);
      if (ROOFING.has(id)) eaves = Math.min(eaves, cy);
      for (const [dx, dy, dz] of NEIGHBOURS) queue.push([cx + dx, cy + dy, cz + dz]);
    }
    const from = Math.min(y0 + STOREY, eaves) - 0.5;
    return { x0, z0, x1: x1 + 1, z1: z1 + 1, from, roofed: eaves !== Infinity, above: y1 + 0.5 > from };
  }
}
