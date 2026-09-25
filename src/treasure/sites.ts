import { SEA_LEVEL } from '../config';
import { Block, type BlockId } from '../voxel/blocks';
import type { VoxelWorld } from '../voxel/VoxelWorld';
import { groundHeight, TREE_BLOCKS } from '../worldgen/buildings';
import { type IslandPlan, islandName } from '../worldgen/archipelago';

export type LandmarkKind = 'skull' | 'cairn' | 'deadTree';
export const LANDMARKS: readonly LandmarkKind[] = ['skull', 'cairn', 'deadTree'];
export const LANDMARK_NAMES: Record<LandmarkKind, string> = { skull: 'the skull rock', cairn: 'the cairn', deadTree: 'the dead tree' };

/** The four ways a riddle can send you: north is −z, as on the chart. */
export type Heading = 'north' | 'south' | 'east' | 'west';
export const HEADINGS: Record<Heading, { dx: number; dz: number; sun: string }> = {
  north: { dx: 0, dz: -1, sun: 'the pole star' },
  south: { dx: 0, dz: 1, sun: 'the noonday sun' },
  east: { dx: 1, dz: 0, sun: 'the sunrise' },
  west: { dx: -1, dz: 0, sun: 'the sunset' },
};
const HEADING_LIST = Object.keys(HEADINGS) as Heading[];

/** Something to count paces from, built where it can be seen: `x`, `z` its middle, `y` the ground it stands on. */
export interface Landmark {
  kind: LandmarkKind;
  x: number;
  y: number;
  z: number;
}

/** One stretch of a riddle's walk: so many paces (blocks) one way. */
export interface Leg {
  heading: Heading;
  paces: number;
}

/** Where a chest is buried: the chest's own cell (two blocks down), the landmark, and the walk from one to the other. */
export interface Site {
  island: number;
  x: number;
  y: number;
  z: number;
  landmark: Landmark;
  legs: Leg[];
}

/** Chests lie this many blocks under the surface. */
export const DEPTH = 2;
const TRIES = 300;
const PACES = [4, 9] as const;

/** Can a chest be buried here, and dug up again? Dry, open earth with no tree on it. */
function diggable(world: VoxelWorld, x: number, z: number): boolean {
  const top = groundHeight(world, x, z);
  const ground = world.getVoxel(x, top - 1, z);
  if (top < SEA_LEVEL + DEPTH || ![Block.Grass, Block.Dirt, Block.Sand].includes(ground as never)) return false;
  return world.getVoxel(x, top, z) === Block.Air && !TREE_BLOCKS.has(world.getVoxel(x, top + 1, z));
}

/** Room for a landmark: a 3 × 3 patch of dry ground within a block of level, clear of trees. Returns the ground height. */
function landmarkRoom(world: VoxelWorld, x: number, z: number): number | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const top = groundHeight(world, x + dx, z + dz);
      if (top < SEA_LEVEL + 1 || world.getVoxel(x + dx, top, z + dz) !== Block.Air) return null;
      for (let y = top; y < top + 6; y++) if (TREE_BLOCKS.has(world.getVoxel(x + dx, y, z + dz))) return null;
      lo = Math.min(lo, top);
      hi = Math.max(hi, top);
    }
  }
  return hi - lo <= 1 ? hi : null;
}

/**
 * Picks a spot to bury a chest on an island, and a landmark to find it by: the
 * landmark on open ground, the chest a walk of `legs` legs from it. Doesn't touch the
 * world (see `raiseLandmark`). Null if the island has no room.
 */
export function planSite(
  world: VoxelWorld,
  islands: readonly IslandPlan[],
  island: number,
  legs: number,
  random: () => number,
  avoid: (x: number, z: number) => boolean = () => false,
): Site | null {
  const plan = islands[island];
  for (let attempt = 0; attempt < TRIES; attempt++) {
    const angle = random() * Math.PI * 2;
    const r = random() * plan.radius * 0.7;
    const lx = Math.round(plan.centerX + Math.sin(angle) * r);
    const lz = Math.round(plan.centerZ + Math.cos(angle) * r);
    const ly = landmarkRoom(world, lx, lz);
    if (ly === null || avoid(lx, lz)) continue;
    const walk: Leg[] = [];
    let x = lx;
    let z = lz;
    for (let i = 0; i < legs; i++) {
      // Never straight back the way it came.
      const choices = HEADING_LIST.filter((h) => !walk.length || (HEADINGS[h].dx !== -HEADINGS[walk[walk.length - 1].heading].dx || HEADINGS[h].dz !== -HEADINGS[walk[walk.length - 1].heading].dz));
      const heading = choices[Math.floor(random() * choices.length)];
      const paces = PACES[0] + Math.floor(random() * (PACES[1] - PACES[0] + 1));
      walk.push({ heading, paces });
      x += HEADINGS[heading].dx * paces;
      z += HEADINGS[heading].dz * paces;
    }
    if (Math.max(Math.abs(x - lx), Math.abs(z - lz)) < 3 || !diggable(world, x, z) || avoid(x, z)) continue;
    const kind = LANDMARKS[Math.floor(random() * LANDMARKS.length)];
    return { island, x, y: groundHeight(world, x, z) - DEPTH, z, landmark: { kind, x: lx, y: ly, z: lz }, legs: walk };
  }
  return null;
}

/** Builds a landmark into the world: a bone-white skull of a rock, a cairn of stones, or a dead tree. */
export function raiseLandmark(world: VoxelWorld, l: Landmark): void {
  const set = (dx: number, dy: number, dz: number, id: BlockId) => world.setVoxel(l.x + dx, l.y + dy, l.z + dz, id);
  // Footings down to the ground, so nothing hangs in the air on a slope.
  const footing = l.kind === 'skull' ? Block.Bone : l.kind === 'cairn' ? Block.Cairn : null;
  if (footing) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let y = groundHeight(world, l.x + dx, l.z + dz); y < l.y; y++) world.setVoxel(l.x + dx, y, l.z + dz, footing);
      }
    }
  }
  switch (l.kind) {
    case 'skull':
      // A rounded block of bone with two dark eyes and a row of teeth, grinning south.
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (let dy = 0; dy <= 2; dy++) if (!(dy === 2 && dx !== 0 && dz !== 0)) set(dx, dy, dz, Block.Bone);
        }
      }
      set(-1, 1, 1, Block.Cairn);
      set(1, 1, 1, Block.Cairn);
      set(0, 0, 1, Block.Cairn);
      break;
    case 'cairn':
      for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) set(dx, 0, dz, Block.Cairn);
      for (const [dx, dz] of [[0, 0], [1, 0], [0, 1]]) set(dx, 1, dz, Block.Cairn);
      set(0, 2, 0, Block.Cairn);
      set(0, 3, 0, Block.Cairn);
      break;
    case 'deadTree':
      for (let dy = 0; dy < 6; dy++) set(0, dy, 0, Block.Deadwood);
      set(1, 3, 0, Block.Deadwood);
      set(2, 4, 0, Block.Deadwood);
      set(-1, 4, 0, Block.Deadwood);
      set(-1, 5, 1, Block.Deadwood);
      set(0, 5, -1, Block.Deadwood);
      break;
  }
}

/** "7 paces north, then 4 east". */
const plainWalk = (legs: readonly Leg[]) => legs.map((l) => `${l.paces} paces ${l.heading}`).join(', then ');
/** "seven paces toward the sunrise, then four toward the pole star". */
const sunWalk = (legs: readonly Leg[]) => legs.map((l) => `${words(l.paces)} paces toward ${HEADINGS[l.heading].sun}`).join(', then ');

/** The writing on a map: plainer the nearer home. */
export function clueFor(site: Site, islands: readonly IslandPlan[], style: 'chart' | 'sketch' | 'riddle' | 'cursed' | 'legend'): string {
  const island = islandName(islands[site.island]);
  const mark = LANDMARK_NAMES[site.landmark.kind];
  switch (style) {
    case 'chart':
      return `${island}, in home waters. Dig where the X is, by ${mark}.`;
    case 'sketch':
      return `${island}. From ${mark}, ${plainWalk(site.legs)}. Dig there.`;
    case 'riddle':
      return `On ${island}, find ${mark} and stand at its heart. Walk ${sunWalk(site.legs)}, and dig two spades deep.`;
    case 'cursed':
      return `On ${island}, where the ghost lights gather, ${mark} keeps watch. Walk ${sunWalk(site.legs)}. Dig by night, if you dare: the dead guard what's theirs.`;
    case 'legend':
      return `Blackwood's chart, made whole. On ${island}, the farthest isle, find ${mark}. Walk ${sunWalk(site.legs)}, and there lies the pirate king's hoard.`;
  }
}

function words(n: number): string {
  return ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'][n] ?? `${n}`;
}
