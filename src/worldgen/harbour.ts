import { SEA_LEVEL } from '../config';
import type { PortFaction, PortPlace, PlaceKind } from '../economy/ports';
import { Block, type BlockId } from '../voxel/blocks';
import type { VoxelWorld } from '../voxel/VoxelWorld';
import { buildHouse, buildTower, clearSite, type Door, type Footprint, groundHeight, levelGround, overlaps } from './buildings';
import type { IslandParams } from './island';
import { mulberry32 } from './noise';

/** What a harbour gives its port: the berth, a spot on the pier to step ashore, and the doors in town. */
export interface Harbour {
  /** Where a ship lies: alongside the pier, bow toward the sea. */
  x: number;
  z: number;
  heading: number;
  pier: { x: number; y: number; z: number };
  places: PortPlace[];
  lamps: Array<{ x: number; y: number; z: number }>;
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

interface Style {
  walls: BlockId;
  roof: BlockId;
  houses: number;
  tower: boolean;
}

/** Which houses do what: the first built (nearest the pier) is the market, and so on. */
const ROLES: readonly PlaceKind[] = ['market', 'tavern', 'office'];

const STYLES: Record<PortFaction, Style> = {
  imperial: { walls: Block.Plaster, roof: Block.RoofTile, houses: 5, tower: true },
  merchant: { walls: Block.Plaster, roof: Block.RoofSlate, houses: 5, tower: false },
  pirate: { walls: Block.Planks, roof: Block.Thatch, houses: 4, tower: false },
};

/**
 * Builds a port on an island that's already in the world: a pier from the beach out to
 * deep water, and a little town behind it in the faction's style. Deterministic in the
 * island's seed.
 */
export function buildHarbour(world: VoxelWorld, island: IslandParams, faction: PortFaction): Harbour {
  const random = mulberry32(island.seed ^ 0x4a7b);
  const site = chooseSite(world, island, random);
  const { dx, dz } = site;
  const at = (t: number, w = 0) => ({ x: island.centerX + dx * t - dz * w, z: island.centerZ + dz * t + dx * w });

  const landing = at(site.landing);
  const { doors, plots, beacon } = buildTown(world, landing.x, landing.z, dx, dz, STYLES[faction], random);
  const foot = at(site.landing - 2);
  for (const door of doors) buildRoad(world, foot.x, foot.z, door, plots);
  const end = site.deep + PIER_REACH;
  buildPier(world, island, dx, dz, site.landing, end);
  // Lamps at the pier head, to find the berth by after dark.
  const lamps = [-1, 1].map((w) => lampPost(world, at(end - 0.5, w)));
  if (beacon) lamps.push(beacon);

  // Moored alongside, bow out to sea.
  const berth = at(site.deep + BERTH_ALONG, random() < 0.5 ? BERTH_SIDE : -BERTH_SIDE);
  const pier = at(site.deep + BERTH_ALONG);
  // The shipyard works the foot of the pier; any role without a house of its own joins it there.
  const yard = at(site.landing - 2);
  const yardY = groundHeight(world, Math.floor(yard.x), Math.floor(yard.z));
  const places: PortPlace[] = [{ kind: 'shipyard', x: yard.x, y: yardY, z: yard.z }];
  ROLES.forEach((kind, i) => places.push(doors[i] ? { kind, x: doors[i].outX + 0.5, y: doors[i].y, z: doors[i].outZ + 0.5 } : { ...places[0], kind }));
  return { x: berth.x, z: berth.z, heading: Math.atan2(dx, dz), pier: { x: pier.x, y: PIER_Y + 1, z: pier.z }, places, lamps };
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

/** Houses (and, in Imperial ports, a watchtower) on level-ish ground behind the landing. Returns the doors, nearest first. */
function buildTown(world: VoxelWorld, lx: number, lz: number, dx: number, dz: number, style: Style, random: () => number) {
  const doors: Door[] = [];
  const placed: Footprint[] = [];
  let beacon: { x: number; y: number; z: number } | null = null;
  const candidates: Array<{ x: number; z: number }> = [];
  for (let back = 6; back <= 40; back += 4) {
    for (let side = -32; side <= 32; side += 4) {
      candidates.push({ x: lx - dx * back - dz * side, z: lz - dz * back + dx * side });
    }
  }
  // Nearer the landing first, with a little shuffle so towns differ.
  candidates.sort((a, b) => Math.hypot(a.x - lx, a.z - lz) + random() * 8 - (Math.hypot(b.x - lx, b.z - lz) + random() * 8));

  const want = style.houses + (style.tower ? 1 : 0);
  for (const c of candidates) {
    if (placed.length >= want) break;
    const tower = style.tower && placed.length === 0;
    const [w, d] = tower ? [3, 3] : SIZES[Math.floor(random() * SIZES.length)];
    const fp = { x0: Math.floor(c.x - w / 2), z0: Math.floor(c.z - d / 2), w, d };
    if (placed.some((p) => overlaps(fp, p, 2))) continue;
    const base = levelGround(world, fp, 3);
    if (base === null || base > SEA_LEVEL + 14) continue;
    placed.push(fp);
    clearSite(world, fp, base, 4);
    if (tower) beacon = buildTower(world, fp, base);
    else doors.push(buildHouse(world, fp, base, style, lx, lz));
  }
  return { doors, plots: placed, beacon };
}

/**
 * A gravel road from the foot of the pier to a door, graded so it never rises or falls
 * more than a voxel from one cell to the next: every door in town can be walked to.
 * Cells under other buildings are left alone.
 */
function buildRoad(world: VoxelWorld, fromX: number, fromZ: number, door: Door, plots: readonly Footprint[]): void {
  const toX = door.outX + 0.5;
  const toZ = door.outZ + 0.5;
  const length = Math.hypot(toX - fromX, toZ - fromZ);
  const cells: Array<{ x: number; z: number; h: number }> = [];
  for (let t = 0; t <= length; t += 0.5) {
    const x = Math.floor(fromX + ((toX - fromX) * t) / length);
    const z = Math.floor(fromZ + ((toZ - fromZ) * t) / length);
    const last = cells[cells.length - 1];
    if (!last || last.x !== x || last.z !== z) cells.push({ x, z, h: Math.max(SEA_LEVEL, groundHeight(world, x, z)) });
  }
  if (cells.length === 0) return;
  // Grade it: no more than a voxel between neighbours, starting from the beach and arriving level with the door.
  for (let i = 1; i < cells.length; i++) cells[i].h = Math.min(cells[i - 1].h + 1, Math.max(cells[i - 1].h - 1, cells[i].h));
  cells[cells.length - 1].h = door.y;
  for (let i = cells.length - 2; i >= 0; i--) cells[i].h = Math.min(cells[i + 1].h + 1, Math.max(cells[i + 1].h - 1, cells[i].h));
  const inPlot = (x: number, z: number) => plots.some((p) => x >= p.x0 - 1 && x <= p.x0 + p.w && z >= p.z0 - 1 && z <= p.z0 + p.d);
  const lay = (x: number, z: number, h: number) => {
    if (inPlot(x, z)) return;
    for (let y = groundHeight(world, x, z); y < h - 1; y++) world.setVoxel(x, y, z, Block.Dirt);
    world.setVoxel(x, h - 1, z, Block.Gravel);
    for (let y = h; y < h + 4; y++) world.setVoxel(x, y, z, Block.Air);
  };
  for (const c of cells) {
    lay(c.x, c.z, c.h);
    // Two wide: the neighbour across the line of the road.
    if (Math.abs(toX - fromX) > Math.abs(toZ - fromZ)) lay(c.x, c.z + 1, c.h);
    else lay(c.x + 1, c.z, c.h);
  }
}

const SIZES: ReadonlyArray<readonly [number, number]> = [
  [5, 5],
  [5, 7],
  [7, 5],
  [6, 6],
];
