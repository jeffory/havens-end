import { SEA_LEVEL } from '../config';
import type { PortFaction } from '../economy/ports';
import { Block, type BlockId } from '../voxel/blocks';
import type { VoxelWorld } from '../voxel/VoxelWorld';
import type { IslandParams } from './island';
import { mulberry32 } from './noise';

/** Where a ship lies in harbour: open water off the pier head, bow toward the sea. */
export interface Berth {
  x: number;
  z: number;
  heading: number;
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

const STYLES: Record<PortFaction, Style> = {
  imperial: { walls: Block.Plaster, roof: Block.RoofTile, houses: 5, tower: true },
  merchant: { walls: Block.Plaster, roof: Block.RoofSlate, houses: 5, tower: false },
  pirate: { walls: Block.Planks, roof: Block.Thatch, houses: 4, tower: false },
};

const TREE_BLOCKS: ReadonlySet<BlockId> = new Set([Block.Wood, Block.Leaves, Block.PalmLeaves]);

/**
 * Builds a port on an island that's already in the world: a pier from the beach out to
 * deep water, and a little town behind it in the faction's style. Deterministic in the
 * island's seed. Returns the berth.
 */
export function buildHarbour(world: VoxelWorld, island: IslandParams, faction: PortFaction): Berth {
  const random = mulberry32(island.seed ^ 0x4a7b);
  const site = chooseSite(world, island, random);
  const { dx, dz } = site;
  const at = (t: number, w = 0) => ({ x: island.centerX + dx * t - dz * w, z: island.centerZ + dz * t + dx * w });

  const landing = at(site.landing);
  buildTown(world, landing.x, landing.z, dx, dz, STYLES[faction], random);
  buildPier(world, island, dx, dz, site.landing, site.deep + PIER_REACH);

  // Moored alongside, bow out to sea.
  const berth = at(site.deep + BERTH_ALONG, random() < 0.5 ? BERTH_SIDE : -BERTH_SIDE);
  return { x: berth.x, z: berth.z, heading: Math.atan2(dx, dz) };
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

interface Footprint {
  x0: number;
  z0: number;
  w: number;
  d: number;
}

/** Houses (and, in Imperial ports, a watchtower) on level-ish ground behind the landing. */
function buildTown(world: VoxelWorld, lx: number, lz: number, dx: number, dz: number, style: Style, random: () => number): void {
  const placed: Footprint[] = [];
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
    const base = levelGround(world, fp, placed);
    if (base === null) continue;
    placed.push(fp);
    clearSite(world, fp, base);
    if (tower) buildTower(world, fp, base);
    else buildHouse(world, fp, base, style, lx, lz);
  }
}

const SIZES: ReadonlyArray<readonly [number, number]> = [
  [5, 5],
  [5, 7],
  [7, 5],
  [6, 6],
];

/** Floor height for a building here, or null if the ground is too steep, wet or taken. */
function levelGround(world: VoxelWorld, fp: Footprint, placed: readonly Footprint[]): number | null {
  const margin = 2;
  if (placed.some((p) => fp.x0 < p.x0 + p.w + margin && p.x0 < fp.x0 + fp.w + margin && fp.z0 < p.z0 + p.d + margin && p.z0 < fp.z0 + fp.d + margin)) {
    return null;
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (let x = fp.x0; x < fp.x0 + fp.w; x++) {
    for (let z = fp.z0; z < fp.z0 + fp.d; z++) {
      const h = groundHeight(world, x, z);
      if (h < SEA_LEVEL || world.getVoxel(x, h - 1, z) === Block.Planks) return null;
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
  }
  return hi - lo <= 3 && hi <= SEA_LEVEL + 14 ? hi : null;
}

/** Surface height ignoring trees. */
function groundHeight(world: VoxelWorld, x: number, z: number): number {
  let h = world.surfaceHeight(x, z);
  while (h > 0 && TREE_BLOCKS.has(world.getVoxel(x, h - 1, z))) h--;
  return h;
}

/** Fills the footprint up to the floor, and clears trees and ground above it (plus a border). */
function clearSite(world: VoxelWorld, fp: Footprint, base: number): void {
  const border = 4;
  for (let x = fp.x0 - border; x < fp.x0 + fp.w + border; x++) {
    for (let z = fp.z0 - border; z < fp.z0 + fp.d + border; z++) {
      const inside = x >= fp.x0 - 1 && x <= fp.x0 + fp.w && z >= fp.z0 - 1 && z <= fp.z0 + fp.d;
      for (let y = base - 2; y < base + 14; y++) {
        const id = world.getVoxel(x, y, z);
        if (TREE_BLOCKS.has(id) || (inside && y >= base && id !== Block.Air)) world.setVoxel(x, y, z, Block.Air);
      }
      if (x >= fp.x0 && x < fp.x0 + fp.w && z >= fp.z0 && z < fp.z0 + fp.d) {
        for (let y = groundHeight(world, x, z); y < base; y++) world.setVoxel(x, y, z, Block.Stone);
      }
    }
  }
}

/** Walls three high with a door facing the harbour, and a stepped gable roof over the long axis. */
function buildHouse(world: VoxelWorld, fp: Footprint, base: number, style: Style, lx: number, lz: number): void {
  const { x0, z0, w, d } = fp;
  const top = base + 2;
  const ridgeAlongX = w >= d;
  const span = ridgeAlongX ? d : w;
  const eave = (span + 1) / 2;
  const roofY = (x: number, z: number) => {
    const across = ridgeAlongX ? Math.abs(z - (z0 + (d - 1) / 2)) : Math.abs(x - (x0 + (w - 1) / 2));
    return Math.round(top + (eave - across));
  };

  // Door in the middle of the wall nearest the landing.
  const cx = x0 + (w - 1) / 2;
  const cz = z0 + (d - 1) / 2;
  const toX = lx - cx;
  const toZ = lz - cz;
  const door = Math.abs(toX) > Math.abs(toZ)
    ? { x: toX > 0 ? x0 + w - 1 : x0, z: Math.floor(cz) }
    : { x: Math.floor(cx), z: toZ > 0 ? z0 + d - 1 : z0 };

  for (let x = x0; x < x0 + w; x++) {
    for (let z = z0; z < z0 + d; z++) {
      const edge = x === x0 || x === x0 + w - 1 || z === z0 || z === z0 + d - 1;
      if (!edge) continue;
      // Gable ends run up to meet the roof.
      const gable = ridgeAlongX ? x === x0 || x === x0 + w - 1 : z === z0 || z === z0 + d - 1;
      const height = gable ? roofY(x, z) - 1 : top;
      for (let y = base; y <= height; y++) {
        const isDoor = x === door.x && z === door.z && y < base + 2;
        const corner = (x === x0 || x === x0 + w - 1) && (z === z0 || z === z0 + d - 1);
        const isWindow = !corner && !gable && y === base + 1 && (ridgeAlongX ? x - x0 === 1 || x0 + w - 1 - x === 1 : z - z0 === 1 || z0 + d - 1 - z === 1);
        if (isDoor || isWindow) continue;
        world.setVoxel(x, y, z, corner && style.walls === Block.Plaster ? Block.Wood : style.walls);
      }
    }
  }
  // Roof, with a one-voxel overhang all round.
  for (let x = x0 - 1; x <= x0 + w; x++) {
    for (let z = z0 - 1; z <= z0 + d; z++) world.setVoxel(x, roofY(x, z), z, style.roof);
  }
}

/** A stone watchtower with crenellations: the Crown's mark on a harbour. */
function buildTower(world: VoxelWorld, fp: Footprint, base: number): void {
  const height = 9;
  for (let x = fp.x0; x < fp.x0 + fp.w; x++) {
    for (let z = fp.z0; z < fp.z0 + fp.d; z++) {
      for (let y = base; y < base + height; y++) world.setVoxel(x, y, z, Block.Stone);
    }
  }
  for (let x = fp.x0 - 1; x <= fp.x0 + fp.w; x++) {
    for (let z = fp.z0 - 1; z <= fp.z0 + fp.d; z++) {
      world.setVoxel(x, base + height, z, Block.Stone);
      if ((x + z) % 2 === 0 && (x < fp.x0 || x >= fp.x0 + fp.w || z < fp.z0 || z >= fp.z0 + fp.d)) world.setVoxel(x, base + height + 1, z, Block.Stone);
    }
  }
}
