/**
 * Generates the placeholder ships in public/models/ships/ (sloop.vox, brig.vox,
 * frigate.vox). They double as MagicaVoxel templates: named hull / sail / flag objects
 * and a labelled palette. Open one in MagicaVoxel, restyle it, save over it.
 * Run: npm run make:placeholder-ship [sloop brig frigate]  (all of them if none are named)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { writeVox, type VoxObject } from '../src/vox/writeVox';

const OUT_DIR = 'public/models/ships';

// Palette slots (MagicaVoxel colour index -> sRGB).
const C = { tar: 1, wood: 2, stripe: 3, deck: 4, rail: 5, spar: 6, canvas: 7, seam: 8, flag: 9, bone: 10, port: 11 };
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
  [C.port]: 0x160f0a,
};

type Voxel = [number, number, number, number];

interface Mast {
  /** Row (MagicaVoxel Y) the mast stands on. */
  y: number;
  top: number;
  sailWidth: number;
  sailHeight: number;
}

interface Design {
  file: string;
  length: number;
  /** Odd, so masts sit on the centre line. */
  beam: number;
  masts: Mast[];
  gunsPerSide: number;
  /** Rows of raised quarterdeck at the stern. */
  quarterdeck: number;
  bowsprit: number;
}

const DESIGNS: Design[] = [
  {
    file: 'sloop.vox',
    length: 15,
    beam: 5,
    masts: [{ y: 9, top: 17, sailWidth: 9, sailHeight: 5 }],
    gunsPerSide: 4,
    quarterdeck: 4,
    bowsprit: 3,
  },
  {
    file: 'brig.vox',
    length: 21,
    beam: 7,
    masts: [
      { y: 14, top: 19, sailWidth: 9, sailHeight: 5 },
      { y: 7, top: 22, sailWidth: 11, sailHeight: 6 },
    ],
    gunsPerSide: 7,
    quarterdeck: 5,
    bowsprit: 4,
  },
  {
    // A three-masted frigate: the admiral's flagship.
    file: 'frigate.vox',
    length: 27,
    beam: 9,
    masts: [
      { y: 20, top: 21, sailWidth: 11, sailHeight: 5 },
      { y: 13, top: 25, sailWidth: 13, sailHeight: 7 },
      { y: 6, top: 22, sailWidth: 11, sailHeight: 6 },
    ],
    gunsPerSide: 10,
    quarterdeck: 7,
    bowsprit: 5,
  },
];

// MagicaVoxel axes: +X starboard, +Y toward the bow, +Z up.
const LAYER_TAPER = [0.55, 0.8, 0.95, 1]; // keel to deck
const DECK = LAYER_TAPER.length - 1;

function build(d: Design): VoxObject[] {
  const centre = Math.floor(d.beam / 2);

  /** Half-width at row y: a full stern tapering to a pointed bow. */
  const halfBeam = (y: number) => {
    const t = (y + 0.5) / d.length;
    const half = d.beam / 2;
    return t < 0.6 ? half * (0.8 + 0.2 * Math.min(1, t / 0.25)) : half * Math.cos(((t - 0.6) / 0.4) * (Math.PI / 2));
  };
  const inHull = (x: number, y: number, z: number) =>
    y >= 0 && y < d.length && z >= 0 && z <= DECK && Math.abs(x + 0.5 - d.beam / 2) <= halfBeam(y) * LAYER_TAPER[z] + 0.25;
  const edge = (x: number, y: number, z: number) =>
    !inHull(x - 1, y, z) || !inHull(x + 1, y, z) || !inHull(x, y - 1, z) || !inHull(x, y + 1, z);

  // Gun ports: evenly spaced along the stripe, clear of the bow and stern.
  const portRows = new Set<number>();
  for (let i = 0; i < d.gunsPerSide; i++) portRows.add(Math.round(2 + ((i + 0.5) * (d.length - 6)) / d.gunsPerSide));

  const hull: Voxel[] = [];
  for (let z = 0; z <= DECK; z++) {
    for (let y = 0; y < d.length; y++) {
      for (let x = 0; x < d.beam; x++) {
        if (!inHull(x, y, z)) continue;
        const onSide = !inHull(x - 1, y, z) || !inHull(x + 1, y, z);
        let color: number = C.wood;
        if (z === DECK && !edge(x, y, z)) color = C.deck;
        else if (edge(x, y, z)) color = z < 2 ? C.tar : z === 2 ? (onSide && portRows.has(y) ? C.port : C.stripe) : C.wood;
        hull.push([x, y, z, color]);
      }
    }
  }
  // Quarterdeck at the stern, then rails around everything.
  for (let y = 0; y < d.length; y++) {
    for (let x = 0; x < d.beam; x++) {
      if (!inHull(x, y, DECK)) continue;
      const rim = edge(x, y, DECK);
      if (y < d.quarterdeck) {
        hull.push([x, y, DECK + 1, rim ? C.wood : C.deck]);
        if (rim) hull.push([x, y, DECK + 2, C.rail]);
      } else if (rim) {
        hull.push([x, y, DECK + 1, C.rail]);
      }
    }
  }
  const tallest = Math.max(...d.masts.map((m) => m.top));
  for (const mast of d.masts) for (let z = DECK + 1; z <= mast.top; z++) hull.push([centre, mast.y, z, C.spar]);
  for (let y = d.length; y < d.length + d.bowsprit; y++) hull.push([centre, y, DECK + 1, C.spar]);

  const objects: VoxObject[] = [{ name: 'hull', size: [d.beam, d.length + d.bowsprit, tallest + 1], min: [0, 0, 0], voxels: hull }];

  // Square sails on their yards, hung just forward of each mast.
  d.masts.forEach((mast, i) => {
    const w = mast.sailWidth;
    const h = mast.sailHeight;
    const voxels: Voxel[] = [];
    for (let x = 0; x < w; x++) voxels.push([x, 0, h, C.spar]);
    for (let z = 0; z < h; z++) {
      for (let x = 1; x < w - 1; x++) voxels.push([x, 0, z, x === (w - 1) / 2 || z === Math.floor(h / 2) ? C.seam : C.canvas]);
    }
    objects.push({
      name: i === 0 ? 'sail' : `sail_${i + 1}`,
      size: [w, 1, h + 1],
      min: [centre + 0.5 - w / 2, mast.y + 1, mast.top - h - 2],
      voxels,
    });
  });

  // The black flag, streaming aft from the tallest masthead.
  const flagMast = d.masts.find((m) => m.top === tallest)!;
  const flag: Voxel[] = [];
  for (let y = 0; y < 4; y++) for (let z = 0; z < 3; z++) flag.push([0, y, z, y === 2 && z === 1 ? C.bone : C.flag]);
  objects.push({ name: 'flag', size: [1, 4, 3], min: [centre, flagMast.y - 4, tallest - 2], voxels: flag });
  return objects;
}

function palette(): Uint8Array {
  const rgba = new Uint8Array(256 * 4);
  for (let i = 1; i < 256; i++) {
    // Spare slots: a hue x brightness grid to paint with.
    const hue = ((i - 12) % 24) / 24;
    const value = 1 - Math.floor((i - 12) / 24) * 0.085;
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

mkdirSync(OUT_DIR, { recursive: true });
const wanted = process.argv.slice(2);
for (const design of DESIGNS.filter((d) => wanted.length === 0 || wanted.includes(d.file.replace('.vox', '')))) {
  writeFileSync(`${OUT_DIR}/${design.file}`, writeVox(build(design), palette()));
  console.log(`wrote ${OUT_DIR}/${design.file}`);
}
