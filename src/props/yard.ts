import { EIGHTH, kit } from './kit';
import type { Sketch } from './sketch';
import type { PropModel } from './types';

/** The ship on the stocks: 18 blocks long, stern to stem. */
const LENGTH = 144;
/** Her half-breadth amidships (two and a half blocks), either side of the middle of her keel (between x 19 and 20). */
const HALF = 20;
/** Her frames stand a block apart, this far along each block. */
const FRAME_AT = 4;

/** Her half-breadth at the sheer, `z` along her from the stern: a narrower transom aft, full amidships, a fine bow. */
function breadth(z: number): number {
  const t = (z + 0.5) / LENGTH;
  if (t < 0.3) return 14 + 6 * Math.sin(((t / 0.3) * Math.PI) / 2);
  if (t < 0.6) return HALF;
  return HALF * Math.sqrt(Math.max(0, 1 - ((t - 0.6) / 0.4) ** 2));
}

/** The height of her sheer over her keel: lowest amidships, rising to either end. */
const sheer = (z: number): number => Math.round(28 + 24 * ((z + 0.5) / LENGTH - 0.5) ** 2);

/** Where her bottom is: on the keel, but for the forefoot sweeping up into the stem. */
function bottom(z: number): number {
  const t = (z + 0.5) / LENGTH;
  return t < 0.85 ? 0 : Math.round(((t - 0.85) / 0.15) ** 2 * 18);
}

/** Her half-breadth `y` up from the keel's foot at `z`: a full, round section, swelling quickly out from the keel. */
function section(z: number, y: number): number {
  const [low, high] = [bottom(z), sheer(z)];
  if (y < low) return 0;
  const r = Math.min(1, (y - low + 1) / (high - low));
  return breadth(z) * (1 - (1 - r) ** 3);
}

/**
 * Her shell at `z`, `y` up: how far out from the keel's middle it runs on either side (whole
 * voxels, from `lo` out to `hi`), joining the row below so the shell has no gaps.
 */
function shellAt(z: number, y: number): { lo: number; hi: number } {
  const [w, below] = [section(z, y), y > bottom(z) ? section(z, y - 1) : 0];
  const lo = Math.floor(Math.min(below, w));
  return { lo, hi: Math.max(lo, Math.ceil(Math.max(below, w)) - 1) };
}

/** Puts the voxels `lo` to `hi` out from her middle on both sides, at (y, z). */
function bothSides(s: Sketch, y: number, z: number, lo: number, hi: number, colour: string): void {
  for (let i = lo; i <= hi; i++) s.put(HALF + i, y, z, colour).put(HALF - 1 - i, y, z, colour);
}

/**
 * A ship on the stocks, being built, an eighth of a block a voxel: her keel, stem and sternpost
 * in dark timber, her frames standing a block apart up to their heads over the sheer, her
 * bottom planked in fresh timber to a dark wale, the upper strakes laid from aft, a keelson
 * along her floors and beams across her here and there. No deck and no mast yet: from above
 * you look down into her between her frames. (The sloop's own hull, closed in under a deck
 * and a block a voxel, read from above as a hollow crate, and her mast as a beam across the
 * view.) Her origin is the middle of her stern's foot; she keeps people out of the cells she
 * fills (`reserveProps`).
 */
export function shipOnStocks(): PropModel {
  const s = kit('timberDark', 'timber', 'plank', 'plankLight');
  for (let z = 0; z < LENGTH; z++) {
    const [low, high] = [bottom(z), sheer(z)];
    const plankTop = low + 13;
    const framed = z % 8 === FRAME_AT || z === 0;
    for (let y = low; y <= high; y++) {
      const { lo, hi } = shellAt(z, y);
      // Planked: the bottom to the wale, and the strakes under the sheer from aft to amidships.
      if (y <= plankTop || (z < LENGTH / 2 && y >= high - 2)) bothSides(s, y, z, lo, hi, y === plankTop ? 'timberDark' : 'plankLight');
      // A frame: the shell's whole round, a voxel thicker inboard, up past the sheer.
      if (framed) bothSides(s, y, z, Math.max(0, lo - 1), hi, 'plank');
    }
    if (framed) {
      const { lo, hi } = shellAt(z, high);
      for (let y = high + 1; y <= high + 2; y++) bothSides(s, y, z, Math.max(0, lo - 1), hi, 'plank'); // its heads
    }
    // Beams across her at every third frame, under the sheer.
    if (z % 24 === FRAME_AT) for (let y = high - 3; y <= high - 2; y++) bothSides(s, y, z, 0, Math.ceil(section(z, y)) - 1, 'plank');
    // The keel along her foot, sweeping up into the stem at the bow; the keelson inside, along her floors.
    s.box(HALF - 1, low, z, HALF, low + 2, z, 'timberDark');
    if (z > 4 && low === 0) s.box(HALF - 1, 3, z, HALF, 3, z, 'timber');
  }
  // The stem, up from the forefoot past the sheer; the sternpost; a transom plank or two across her stern.
  for (let z = LENGTH - 3; z < LENGTH; z++) s.box(HALF - 1, bottom(z), z, HALF, sheer(z) + 4, z, 'timberDark');
  s.box(HALF - 1, 0, 0, HALF, sheer(0) + 4, 1, 'timberDark');
  for (const y of [sheer(0) - 6, sheer(0) - 3]) bothSides(s, y, 1, 0, Math.ceil(section(0, y)) - 1, 'plankLight');
  return { ...s.model({ x: HALF, y: 0, z: 0 }, EIGHTH), reserve: true };
}

/**
 * A shipwright's workbench, two blocks long, its back (z = 0) to the wall: a heavy top on four
 * legs and a stretcher, a vice at one end, and on it a saw, a mallet and an adze; shavings
 * curled on the floor under it.
 */
export function workbench(): PropModel {
  const s = kit('timber', 'timberDark', 'plank', 'plankDark', 'iron', 'ironLight', 'sawdust');
  for (const x of [1, 14]) for (const z of [1, 6]) s.box(x, 0, z, x, 4, z, 'timber');
  for (const z of [1, 6]) s.box(2, 1, z, 13, 1, z, 'timberDark'); // stretchers
  s.box(0, 5, 0, 15, 6, 7, 'plank'); // the top, thick
  s.box(0, 6, 7, 15, 6, 7, 'plankDark'); // its front edge
  s.box(13, 4, 7, 14, 6, 7, 'iron'); // the vice's jaw
  s.put(13, 7, 7, 'ironLight');
  // The saw: its blade along the bench, its handle.
  s.box(2, 7, 4, 7, 7, 4, 'ironLight');
  s.box(8, 7, 4, 9, 8, 4, 'timberDark');
  // The mallet: a head of timber, its handle.
  s.box(10, 7, 2, 11, 8, 3, 'timber');
  s.box(12, 7, 2, 14, 7, 2, 'timberDark');
  // The adze: its handle, its iron blade turned down.
  s.box(3, 7, 1, 6, 7, 1, 'timberDark');
  s.box(2, 7, 1, 2, 8, 2, 'iron');
  for (const [x, z] of [[3, 2], [5, 4], [8, 3], [11, 5], [12, 2], [6, 6]]) s.put(x, 0, z, 'sawdust');
  return s.model({ x: 8, y: 0, z: 4 }, EIGHTH);
}

/** A sawhorse two blocks long, a plank laid across it half sawn through, a saw standing in the cut, sawdust under it. */
export function sawhorse(): PropModel {
  const s = kit('timber', 'timberDark', 'plankLight', 'plank', 'ironLight', 'sawdust');
  for (const x of [2, 13]) {
    for (const z of [1, 6]) s.box(x, 0, z, x, 2, z, 'timber'); // splayed legs
    for (const z of [2, 5]) s.box(x, 3, z, x, 4, z, 'timber');
  }
  s.box(1, 5, 3, 14, 5, 4, 'timberDark'); // the top bar
  s.box(0, 6, 2, 15, 6, 5, 'plankLight'); // the plank across it
  s.box(9, 6, 2, 9, 6, 3, 'plank'); // the cut
  s.box(9, 7, 3, 9, 8, 3, 'ironLight'); // the saw in it
  s.box(9, 9, 3, 9, 9, 5, 'timberDark'); // its handle
  for (let x = 6; x <= 11; x++) for (let z = 1; z <= 6; z++) if ((x * 5 + z * 3) % 4 === 0) s.put(x, 0, z, 'sawdust');
  return s.model({ x: 8, y: 0, z: 4 }, EIGHTH);
}

/** A rack of timber three blocks long against a wall: dark uprights, three arms, and planks and a beam laid along them. */
export function timberRack(): PropModel {
  const s = kit('timberDark', 'timber', 'plank', 'plankLight', 'bark');
  for (const x of [1, 12, 22]) s.box(x, 0, 0, x, 12, 1, 'timberDark'); // uprights
  for (const y of [3, 7, 11]) for (const x of [1, 12, 22]) s.box(x, y, 2, x, y, 6, 'timber'); // arms
  // What's laid on the arms: long planks, a squared beam, a log in its bark.
  s.box(0, 4, 2, 23, 4, 6, 'plankLight');
  s.box(0, 5, 2, 20, 5, 4, 'plank');
  s.box(0, 8, 3, 23, 9, 5, 'timber');
  s.box(2, 12, 2, 21, 12, 6, 'plankLight');
  s.box(0, 1, 3, 23, 2, 5, 'bark');
  return s.model({ x: 12, y: 0, z: 4 }, EIGHTH);
}

/** A coil of rope on the floor, three turns high round an open middle, its end trailing. */
export function ropeCoil(): PropModel {
  const s = kit('rope', 'ropeDark');
  for (let y = 0; y < 3; y++) {
    for (let x = 1; x <= 6; x++) {
      for (let z = 1; z <= 6; z++) {
        const d = Math.hypot(x - 3.5, z - 3.5);
        if (d >= 1.2 && d <= 2.9) s.put(x, y, z, (x + z + y) % 3 === 0 ? 'ropeDark' : 'rope');
      }
    }
  }
  for (const x of [5, 6, 7]) s.put(x, 0, 7, 'rope'); // the end, trailing off
  return s.model({ x: 4, y: 0, z: 4 }, EIGHTH);
}

/** A pot of pitch for caulking her seams: black iron on three stones over a cold hearth, the pitch in it, a ladle standing in it. */
export function pitchPot(): PropModel {
  const s = kit('iron', 'ironLight', 'tar', 'stone', 'stoneDark', 'soot', 'timber');
  s.box(1, 0, 1, 6, 0, 6, 'soot'); // the cold ashes
  for (const [x, z] of [[1, 1], [6, 1], [3, 6]]) s.put(x, 1, z, 'stone');
  s.box(2, 1, 2, 5, 3, 5, 'iron'); // the pot
  for (let x = 2; x <= 5; x++) for (let z = 2; z <= 5; z++) s.put(x, 4, z, x === 2 || x === 5 || z === 2 || z === 5 ? 'ironLight' : 'tar'); // its rim, round the pitch
  s.box(4, 5, 3, 4, 6, 3, 'timber'); // the ladle's handle
  s.put(5, 6, 2, 'timber');
  return s.model({ x: 4, y: 0, z: 4 }, EIGHTH);
}
