import type { BufferGeometry } from 'three';
import type { Good } from '../economy/goods';
import { paletteFromRgba } from '../voxel/palette';
import { meshCells } from './voxelGeometry';

/** Icons are this many pixels a side. */
export const ICON_SIZE = 12;

/** A little pixel-art picture: rows top to bottom, one character per pixel ('.' is clear). */
export interface Icon {
  colors: Record<string, number>;
  rows: readonly string[];
}

const STONE_COLORS = { a: 0x4f5358, b: 0x8e9398, c: 0xb9bec2, d: 0x6c7075 };
const CLOD = ['............', '............', '............', '....aaaa....', '..aabbbbaa..', '.abbcbbbbba.', 'abbbbbbcbbba', 'abcbbbbbbbba', 'abbbbbcbbbba', '.abbbbbbbca.', '..aaaaaaaa..', '............'];

/** What things look like lying on the ground: drawn here, pixel by pixel. */
export const ICONS: Partial<Record<Good, Icon>> = {
  // A log, cut end on.
  timber: {
    colors: { a: 0x3e2614, b: 0x6b4526, c: 0xd9b07a, d: 0xb07f45, e: 0x8a5a2e },
    rows: ['............', '............', '............', '...aaaaaacc.', '..abbbbbcddc', '.abbabbbcdec', '.abbbbabcdec', '.abbbbbbcddc', '.aaaaaaaacc.', '............', '............', '............'],
  },
  // A leafy sprig with a clod of earth at its roots.
  sapling: {
    colors: { g: 0x3f7d2c, G: 0x6fb04a, s: 0x6b4a2a, b: 0x7a5a3a },
    rows: ['....gg......', '...gGGg.gg..', '...gGGggGGg.', '....ggGGGg..', '.gg..gsGg...', 'gGGg..s.....', '.gGGgss.....', '..gggs......', '.....s......', '.....s......', '....bbb.....', '...bbbbb....'],
  },
  stone: {
    colors: STONE_COLORS,
    rows: ['............', '............', '....aaaa....', '..aabbbbaa..', '.abbcbbbbba.', '.abccbbbdba.', 'abbbbbbddbba', 'abbbdbbbbbba', '.abbbbbbbda.', '..aaaaaaaa..', '............', '............'],
  },
  ore: {
    colors: { ...STONE_COLORS, o: 0xc0703a },
    rows: ['............', '............', '....aaaa....', '..aabbobaa..', '.abbcbbbooa.', '.aoccbbbdba.', 'abobbbbddbba', 'abbbdboobbba', '.abbbbbobda.', '..aaaaaaaa..', '............', '............'],
  },
  copperOre: {
    colors: { ...STONE_COLORS, o: 0x3f9a7d },
    rows: ['............', '............', '....aaaa....', '..aabbobaa..', '.abbcbbbooa.', '.aoccbbbdba.', 'abobbbbddbba', 'abbbdboobbba', '.abbbbbobda.', '..aaaaaaaa..', '............', '............'],
  },
  silverOre: {
    colors: { ...STONE_COLORS, o: 0xe8eef2 },
    rows: ['............', '............', '....aaaa....', '..aabbobaa..', '.abbcbbbooa.', '.aoccbbbdba.', 'abobbbbddbba', 'abbbdboobbba', '.abbbbbobda.', '..aaaaaaaa..', '............', '............'],
  },
  goldOre: {
    colors: { ...STONE_COLORS, o: 0xf2c94c },
    rows: ['............', '............', '....aaaa....', '..aabbobaa..', '.abbcbbbooa.', '.aoccbbbdba.', 'abobbbbddbba', 'abbbdboobbba', '.abbbbbobda.', '..aaaaaaaa..', '............', '............'],
  },
  earth: { colors: { a: 0x4a3020, b: 0x7a5234, c: 0x5e3e26 }, rows: CLOD },
  sand: { colors: { a: 0xb09a62, b: 0xe3d29a, c: 0xc9b27a }, rows: CLOD },
  // Two stalks of cane, jointed.
  cane: {
    colors: { a: 0xa9c75a, b: 0x7d9a3a, c: 0xd8d08a },
    rows: ['..........a.', '.........ab.', '....a...ab..', '...ab..cc...', '..ab..ab....', '.cc..ab.....', '.b..ab......', '...cc.......', '..ab........', '.ab.........', '.b..........', '............'],
  },
  // A broad tobacco leaf and its rib.
  leaf: {
    colors: { a: 0x4d6b2a, b: 0x7fa046, c: 0xc9d58a },
    rows: ['............', '......aa....', '....aabbaa..', '...abbcbbba.', '..abbbcbbba.', '..abbcbbba..', '.abbbcbbba..', '.abbcbbba...', '.abcbbaa....', '..cca.......', '.c..........', '............'],
  },
  // A cob in its husk.
  maize: {
    colors: { y: 0xe8c64a, Y: 0xf6de7a, g: 0x6f9a3a, G: 0x8fbf55 },
    rows: ['.......gg...', '......gyyg..', '.....gyYyg..', '....gyYyyg..', '...gyyYyg...', '..gyYyyg....', '..gyyYg.....', '.ggyyg......', '.gGgg.......', 'gG..........', '............', '............'],
  },
  // A red pepper.
  spice: {
    colors: { r: 0xc0392b, R: 0xe8705a, g: 0x4f7d2c },
    rows: ['......g.....', '.....gg.....', '....rrrr....', '...rRrrrr...', '...rRrrrr...', '...rrrrrr...', '....rrrrr...', '....rrrr....', '.....rrr....', '......rr....', '.......r....', '............'],
  },
  fish: {
    colors: { a: 0x3d5a73, b: 0x6f97b5, c: 0xc9dbe6, e: 0x111111 },
    rows: ['............', '............', '............', '...aaaa.....', '.aabbbbaa..a', 'abebbbbbbaaa', 'abbbbbbbbba.', 'abcccccbbaaa', '.aacccaaa..a', '...aaaa.....', '............', '............'],
  },
  // A joint on the bone.
  meat: {
    colors: { a: 0x7a2b22, r: 0xb5473a, R: 0xd9725f, w: 0xf2ead8 },
    rows: ['............', '......aaa...', '....aarrraa.', '...arrRrrra.', '..arRrrrrra.', '..arrrrrra..', '..arrrrraa..', '...aarraa...', '....aww.....', '...wwww.....', '...ww.......', '............'],
  },
};

/** Anything without a picture of its own: a sack. */
export const SACK: Icon = {
  colors: { a: 0x6e5433, b: 0xc9ab74, c: 0xa88a57 },
  rows: ['............', '.....aa.....', '....abba....', '.....aa.....', '...abbbba...', '..abbbbbba..', '.abbbcbbbba.', '.abbbbbbbba.', '.abbbbbcbba.', '..abbbbbba..', '...aaaaaa...', '............'],
};

/**
 * An icon as a solid: every pixel a voxel, one deep, like a picture cut out of card.
 * Centred on the origin, in pixels (scale it down to size).
 */
export function iconGeometry(icon: Icon): BufferGeometry {
  const palette = new Uint8Array(256 * 4);
  const slots = new Map<string, number>();
  const cells: number[] = [];
  icon.rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const ch = row[c];
      if (ch === '.') continue;
      let slot = slots.get(ch);
      if (slot === undefined) {
        slot = slots.size + 1;
        slots.set(ch, slot);
        const hex = icon.colors[ch];
        palette.set([(hex >> 16) & 255, (hex >> 8) & 255, hex & 255, 255], slot * 4);
      }
      cells.push(c, ICON_SIZE - 1 - r, 0, slot);
    }
  });
  const geometry = meshCells(Int32Array.from(cells), paletteFromRgba(palette));
  geometry.translate(-ICON_SIZE / 2, -ICON_SIZE / 2, -0.5);
  return geometry;
}
