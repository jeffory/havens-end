import { SEA_LEVEL } from '../config';
import type { PortFaction, PortPlace, PlaceKind, TownSpot } from '../economy/ports';
import { Block } from '../voxel/blocks';
import type { VoxelWorld } from '../voxel/VoxelWorld';
import { groundHeight } from './buildings';
import type { IslandParams } from './island';
import { mulberry32 } from './noise';
import { buildTown, type TownLayout, type TownStyle } from './town';

/** What a harbour gives its port: the berth, a spot on the pier to step ashore, and the doors in town. */
export interface Harbour {
  /** Where a ship lies: alongside the pier, bow toward the sea. */
  x: number;
  z: number;
  heading: number;
  pier: { x: number; y: number; z: number };
  places: PortPlace[];
  lamps: Array<{ x: number; y: number; z: number }>;
  /** Where the town's square, streets, houses and shipyard lie. */
  town: TownLayout;
  /** Where townsfolk go about the town. */
  spots: TownSpot[];
}

/** Columns this low leave room under any keel (surface ≤ 8 means 3.6+ units of water). */
const DEEP = SEA_LEVEL - 4;
/** The pier deck: one voxel above the beach, a little over a voxel above the water. */
const PIER_Y = SEA_LEVEL;
/** Clear sea the berth must have ahead of it, so ships can leave under sail. */
const APPROACH = 70;
/** How far the pier runs on past the point where the water gets deep. */
const PIER_REACH = 14;
/** The berth: alongside the pier's outer end, this far out and this far to one side of it. */
const BERTH_ALONG = 11;
const BERTH_SIDE = 7.5;

/** Which buildings do what (the shipyard is its own shed). */
const ROLES: readonly Exclude<PlaceKind, 'shipyard'>[] = ['market', 'tavern', 'office'];

const STYLES: Record<PortFaction, TownStyle> = {
  imperial: { walls: Block.Plaster, roof: Block.RoofTile, houses: 9, tower: true, flag: Block.FlagCrimson, blackFlags: false, officeStoreys: 3, dress: 'crown' },
  merchant: { walls: Block.Plaster, roof: Block.RoofSlate, houses: 9, tower: false, flag: Block.FlagBlue, blackFlags: false, mirror: true, dress: 'free' },
  pirate: { walls: Block.Planks, roof: Block.TarredRoof, houses: 7, tower: false, flag: Block.FlagBlack, blackFlags: true, dress: 'brethren' },
};
/** Haven, home: a free port, but thatched, so it's never mistaken for the others. */
const HOME: TownStyle = { ...STYLES.merchant, roof: Block.Thatch, houses: 10, mirror: false, dress: 'haven' };

/**
 * Builds a port on an island that's already in the world: a pier from the beach out to
 * deep water, and a little town behind it in the faction's style. Deterministic in the
 * island's seed.
 */
export function buildHarbour(world: VoxelWorld, island: IslandParams, faction: PortFaction, home = false): Harbour {
  const random = mulberry32(island.seed ^ 0x4a7b);
  const site = chooseSite(world, island, random);
  const { dx, dz } = site;
  const at = (t: number, w = 0) => ({ x: island.centerX + dx * t - dz * w, z: island.centerZ + dz * t + dx * w });

  const foot = at(site.landing - 2);
  const end = site.deep + PIER_REACH;
  const town = buildTown(world, foot.x, foot.z, dx, dz, (t) => at(t), [site.landing - 3, end], home ? HOME : STYLES[faction]);
  buildPier(world, island, dx, dz, site.landing, end);
  // Lamps at the pier head, to find the berth by after dark, and down its sides to the beach.
  const lamps = [-1, 1].map((w) => lampPost(world, at(end - 0.5, w)));
  for (let t = end - 6.5, w = 1; t > site.landing + 1; t -= 6, w = -w) lamps.push(lampPost(world, at(t, w)));
  lamps.push(...town.lamps);
  if (town.beacon) lamps.push(town.beacon);

  // Moored alongside, bow out to sea, on the side of the pier away from the shipyard.
  const berth = at(site.deep + BERTH_ALONG, -town.yardSide * BERTH_SIDE);
  const pier = at(site.deep + BERTH_ALONG);
  const places: PortPlace[] = [{ kind: 'shipyard', ...town.yard, sign: town.yardSign }];
  // A role without a building of its own (a cramped island) joins the shipyard.
  for (const kind of ROLES) {
    const door = town.doors[kind];
    const sign = town.signs[kind];
    places.push(door && sign ? { kind, x: door.outX + 0.5, y: door.y, z: door.outZ + 0.5, sign } : { ...places[0], kind });
  }
  return { x: berth.x, z: berth.z, heading: Math.atan2(dx, dz), pier: { x: pier.x, y: PIER_Y + 1, z: pier.z }, places, lamps, town: town.layout, spots: town.spots };
}

/** A post on the pier deck with a lantern on top; returns where the light is. */
function lampPost(world: VoxelWorld, at: { x: number; z: number }): { x: number; y: number; z: number } {
  const x = Math.floor(at.x);
  const z = Math.floor(at.z);
  world.setVoxel(x, PIER_Y + 1, z, Block.Wood);
  world.setVoxel(x, PIER_Y + 2, z, Block.Wood);
  world.setVoxel(x, PIER_Y + 3, z, Block.Lantern);
  return { x: x + 0.5, y: PIER_Y + 3.5, z: z + 0.5 };
}

interface Site {
  dx: number;
  dz: number;
  /** Distances from the island centre along (dx, dz) to the waterline and to deep water. */
  landing: number;
  deep: number;
}

/**
 * Picks the stretch of coast for the pier: a spot where deep water comes close to the
 * beach and the sea beyond is open.
 */
function chooseSite(world: VoxelWorld, island: IslandParams, random: () => number): Site {
  // Square to the grid first, then true diagonals: voxel piers look cleanest that way.
  const start = Math.floor(random() * 4);
  const angles = [
    ...Array.from({ length: 4 }, (_, k) => ((start + k) % 4) * (Math.PI / 2)),
    ...Array.from({ length: 4 }, (_, k) => ((start + k) % 4) * (Math.PI / 2) + Math.PI / 4),
    ...Array.from({ length: 24 }, (_, k) => (k + 0.5) * (Math.PI / 12)),
  ];
  let best: Site | null = null;
  for (const angle of angles) {
    const dx = Math.sin(angle);
    const dz = Math.cos(angle);
    const height = (t: number, w = 0) =>
      world.surfaceHeight(Math.floor(island.centerX + dx * t - dz * w), Math.floor(island.centerZ + dz * t + dx * w));
    let landing = -1;
    let deep = -1;
    for (let t = 0; t < island.radius * 2.5; t += 0.5) {
      const h = height(t);
      if (landing < 0 && h < SEA_LEVEL) landing = t;
      if (landing >= 0 && h >= SEA_LEVEL) landing = -1; // a lagoon or a spit: the real coast is further out
      if (landing >= 0 && h <= DEEP) {
        deep = t;
        break;
      }
    }
    if (landing < 0 || deep < 0) continue;
    let open = true;
    for (let t = deep + 2; t <= deep + PIER_REACH + APPROACH && open; t += 3) {
      for (const w of [-12, -6, 0, 6, 12]) if (height(t, w) > DEEP) open = false;
    }
    if (!open) continue;
    const site = { dx, dz, landing, deep };
    const length = deep - landing;
    if (length >= 4 && length <= 16) return site;
    if (!best || Math.abs(length - 10) < Math.abs(best.deep - best.landing - 10)) best = site;
  }
  if (!best) throw new Error(`buildHarbour: no coast with open water around island ${island.seed}`);
  return best;
}

/**
 * The pier: planks three wide from the beach out to `end`, on
 * pilings. Cells are chosen by their centre's distance from the pier's centre line,
 * so a pier at any angle has clean, even edges.
 */
function buildPier(world: VoxelWorld, island: IslandParams, dx: number, dz: number, landing: number, end: number): void {
  const start = landing - 3;
  const corners = [start, end].map((t) => [island.centerX + dx * t, island.centerZ + dz * t]);
  const [x0, x1] = [Math.min(corners[0][0], corners[1][0]) - 4, Math.max(corners[0][0], corners[1][0]) + 4];
  const [z0, z1] = [Math.min(corners[0][1], corners[1][1]) - 4, Math.max(corners[0][1], corners[1][1]) + 4];
  for (let x = Math.floor(x0); x <= x1; x++) {
    for (let z = Math.floor(z0); z <= z1; z++) {
      const rx = x + 0.5 - island.centerX;
      const rz = z + 0.5 - island.centerZ;
      const t = rx * dx + rz * dz;
      const w = Math.abs(rz * dx - rx * dz);
      if (t < start || t > end || w > 1.5) continue;
      if (groundHeight(world, x, z) > PIER_Y + 1) continue; // the pier ends where it meets the land
      world.setVoxel(x, PIER_Y, z, Block.Planks);
      for (let y = PIER_Y + 1; y < PIER_Y + 8; y++) world.setVoxel(x, y, z, Block.Air);
      // Pilings under the edges, every few voxels.
      if (w > 0.7 && t > landing && Math.floor(t) % 3 === 0) {
        for (let y = world.surfaceHeight(x, z, PIER_Y); y < PIER_Y; y++) world.setVoxel(x, y, z, Block.Wood);
      }
    }
  }
}
