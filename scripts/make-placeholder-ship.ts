/**
 * Generates public/models/ships/sloop.vox: a placeholder sloop that doubles as a
 * MagicaVoxel template (named hull / sail / flag objects, a labelled palette).
 * Open it in MagicaVoxel, restyle it, save over it. Run: npm run make:placeholder-ship
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { writeVox, type VoxObject } from '../src/vox/writeVox';

const OUT = 'public/models/ships/sloop.vox';

// Palette slots (MagicaVoxel colour index -> sRGB).
const C = { tar: 1, wood: 2, stripe: 3, deck: 4, rail: 5, spar: 6, canvas: 7, seam: 8, flag: 9, bone: 10 };
const COLORS: Record<number, number> = {
  [C.tar]: 0x3b2a1f,
  [C.wood]: 0x7a5230,
  [C.stripe]: 0xc9973f,
  [C.deck]: 0xb58a57,
  [C.rail]: 0x2a1d15,
  [C.spar]: 0x8a6a45,
  [C.canvas]: 0xefe6cc,
  [C.seam]: 0xd6cbad,
  [C.flag]: 0x1a1a1a,
  [C.bone]: 0xeeeeee,
};

type Voxel = [number, number, number, number];

// MagicaVoxel axes: +X starboard, +Y toward the bow, +Z up.
const LENGTH = 15;
const BEAM = 5;
const MAST_Y = 9;
const MAST_TOP = 17;

/** Half-width of the hull at row y: a full stern tapering to a pointed bow. */
function halfBeam(y: number): number {
  const t = (y + 0.5) / LENGTH;
  const half = BEAM / 2;
  return t < 0.6 ? half * (0.8 + 0.2 * Math.min(1, t / 0.25)) : half * Math.cos(((t - 0.6) / 0.4) * (Math.PI / 2));
}

const LAYER_TAPER = [0.55, 0.8, 0.95, 1]; // keel to deck
const inHull = (x: number, y: number, z: number) =>
  y >= 0 && y < LENGTH && z >= 0 && z < LAYER_TAPER.length && Math.abs(x + 0.5 - BEAM / 2) <= halfBeam(y) * LAYER_TAPER[z] + 0.25;

function hullObject(): VoxObject {
  const voxels: Voxel[] = [];
  const edge = (x: number, y: number, z: number) =>
    !inHull(x - 1, y, z) || !inHull(x + 1, y, z) || !inHull(x, y - 1, z) || !inHull(x, y + 1, z);

  for (let z = 0; z < LAYER_TAPER.length; z++) {
    for (let y = 0; y < LENGTH; y++) {
      for (let x = 0; x < BEAM; x++) {
        if (!inHull(x, y, z)) continue;
        const side = z < 2 ? C.tar : z === 2 ? C.stripe : C.wood;
        voxels.push([x, y, z, z === 3 && !edge(x, y, z) ? C.deck : edge(x, y, z) ? side : C.wood]);
      }
    }
  }
  // Quarterdeck at the stern, then rails around everything.
  const DECK = LAYER_TAPER.length - 1;
  for (let y = 0; y < LENGTH; y++) {
    for (let x = 0; x < BEAM; x++) {
      if (!inHull(x, y, DECK)) continue;
      const edge3 = edge(x, y, DECK);
      if (y < 4) {
        voxels.push([x, y, DECK + 1, edge3 ? C.wood : C.deck]);
        if (edge3) voxels.push([x, y, DECK + 2, C.rail]);
      } else if (edge3) {
        voxels.push([x, y, DECK + 1, C.rail]);
      }
    }
  }
  // Mast and bowsprit.
  for (let z = DECK + 1; z <= MAST_TOP; z++) voxels.push([2, MAST_Y, z, C.spar]);
  for (let y = LENGTH; y < LENGTH + 3; y++) voxels.push([2, y, DECK + 1, C.spar]);
  return { name: 'hull', size: [BEAM, LENGTH + 3, MAST_TOP + 1], min: [0, 0, 0], voxels };
}

/** Square sail on its yard, hung just forward of the mast. */
function sailObject(): VoxObject {
  const voxels: Voxel[] = [];
  for (let x = 0; x < 9; x++) voxels.push([x, 0, 5, C.spar]);
  for (let z = 0; z < 5; z++) for (let x = 1; x < 8; x++) voxels.push([x, 0, z, x === 4 || z === 2 ? C.seam : C.canvas]);
  return { name: 'sail', size: [9, 1, 6], min: [BEAM / 2 - 4.5, MAST_Y + 1, MAST_TOP - 7], voxels };
}

/** The black flag, streaming aft from the masthead. */
function flagObject(): VoxObject {
  const voxels: Voxel[] = [];
  for (let y = 0; y < 4; y++) for (let z = 0; z < 3; z++) voxels.push([0, y, z, y === 2 && z === 1 ? C.bone : C.flag]);
  return { name: 'flag', size: [1, 4, 3], min: [2, MAST_Y - 4, MAST_TOP - 2], voxels };
}

function palette(): Uint8Array {
  const rgba = new Uint8Array(256 * 4);
  for (let i = 1; i < 256; i++) {
    // Spare slots: a hue x brightness grid to paint with.
    const hue = ((i - 11) % 24) / 24;
    const value = 1 - Math.floor((i - 11) / 24) * 0.085;
    const [r, g, b] = hsv(hue, 0.55, Math.max(0.1, value));
    rgba.set([r, g, b, 255], i * 4);
  }
  for (const [index, hex] of Object.entries(COLORS)) {
    rgba.set([(hex >> 16) & 255, (hex >> 8) & 255, hex & 255, 255], Number(index) * 4);
  }
  return rgba;
}

function hsv(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return [f(5), f(3), f(1)];
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, writeVox([hullObject(), sailObject(), flagObject()], palette()));
console.log(`wrote ${OUT}`);
