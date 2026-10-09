import { Sketch } from './sketch';

/**
 * The colours the town's finer props are drawn in (furniture, stalls, the cart), by name, in
 * sRGB hex as a paint program shows it. A few to each prop, so it reads at a glance.
 */
export const COLOURS = {
  // Wood: timber for frames and posts, planks for boards and tops, walnut for the better pieces.
  timber: 0x6b4a2b,
  timberDark: 0x4a3320,
  plank: 0xa57b4c,
  plankDark: 0x8a6238,
  plankLight: 0xc0925a,
  walnut: 0x5a3a22,
  stave: 0x8a5a2e,
  staveDark: 0x6e4524,
  hoop: 0x2f3237,
  lid: 0xa57b4c,
  crate: 0x9a7444,
  crateLight: 0xae8650,
  crateDark: 0x6e5030,
  bark: 0x6e4a2a,
  grain: 0xc9a06a,
  chest: 0x7a4a24,
  // Metal and stone.
  iron: 0x2f3237,
  ironLight: 0x5a5f66,
  gold: 0xe0b83a,
  pewter: 0x9aa0a6,
  stone: 0x8f9193,
  stoneDark: 0x6e7073,
  soot: 0x2a2624,
  // Fire: these glow after dark.
  ember: 0xf07a22,
  flame: 0xffc04a,
  // Cloth.
  linen: 0xf4f0e6,
  canvas: 0xece2c8,
  sack: 0xc9b283,
  blanket: 0xa63a2e,
  blanketDark: 0x7e2a22,
  rugBorder: 0xc9a24a,
  // The ports' own: the Crown's crimson, the Guild's blue, Haven's sea green and sand, the Brethren's tar and bone.
  crimson: 0xa51d24,
  guildBlue: 0x2b5da8,
  seaGreen: 0x3f7f73,
  sand: 0xd8c290,
  tar: 0x2e2624,
  bone: 0xe6dfcb,
  // The shipyard's: rope, and sawdust and shavings.
  rope: 0xb49d6b,
  ropeDark: 0x8f7a4e,
  sawdust: 0xe3cc98,
  awningRed: 0xb8422e,
  awningBlue: 0x356aa3,
  clothPurple: 0x7d4a93,
  clothBlue: 0x3f6590,
  clothOchre: 0xc9a24a,
  // Goods and wares.
  wicker: 0xc49a5a,
  wickerDark: 0xa07a40,
  greens: 0x78b33c,
  fruit: 0xe8892a,
  apple: 0xc23b2b,
  crockery: 0xe9e4d8,
  blueWare: 0x4a6f9a,
  clay: 0xb5653a,
  foam: 0xf2e8c8,
  bottleGreen: 0x2f6b3a,
  bottleBrown: 0x6b3a1f,
  bookRed: 0x8c3a2c,
  bookGreen: 0x2f5d3a,
  bookBlue: 0x2b3f6b,
  bookTan: 0xb08a4a,
  paper: 0xf2eee2,
  ink: 0x1c1c22,
  wax: 0xf2e8c8,
} as const;

export type Colour = keyof typeof COLOURS;

const GLOWING: ReadonlySet<Colour> = new Set<Colour>(['ember', 'flame']);

/** Everything drawn with the kit is drawn an eighth of a block a voxel. */
export const EIGHTH = 1 / 8;

/** A sketch with these of the colours to draw in (fire glows after dark). */
export function kit(...names: Colour[]): Sketch {
  const s = new Sketch();
  for (const name of names) s.paint(name, COLOURS[name], GLOWING.has(name));
  return s;
}

/**
 * A barrel six across and `high` tall from (x0, y0, z0): round, its staves light and dark,
 * an iron hoop near each end, drawn in at top and bottom, a lid on top. Paints: stave,
 * staveDark, hoop, lid.
 */
export function barrelAt(s: Sketch, x0: number, y0: number, z0: number, high = 8): void {
  for (let y = 0; y < high; y++) {
    const end = y === 0 || y === high - 1;
    for (let x = 0; x < 6; x++) {
      for (let z = 0; z < 6; z++) {
        const rimX = x === 0 || x === 5;
        const rimZ = z === 0 || z === 5;
        if ((rimX && rimZ) || (end && (rimX || rimZ))) continue;
        const colour = y === high - 1 ? 'lid' : y === 1 || y === high - 2 ? 'hoop' : (x + z) % 2 ? 'stave' : 'staveDark';
        s.put(x0 + x, y0 + y, z0 + z, colour);
      }
    }
  }
}

/** A crate `w` × `h` × `d` from (x0, y0, z0): planked sides in light and dark rows, dark battens at its edges. Paints: crate, crateLight, crateDark. */
export function crateAt(s: Sketch, x0: number, y0: number, z0: number, w: number, h: number, d: number): void {
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      for (let z = 0; z < d; z++) {
        const edges = Number(x === 0 || x === w - 1) + Number(y === 0 || y === h - 1) + Number(z === 0 || z === d - 1);
        if (edges === 0) continue;
        s.put(x0 + x, y0 + y, z0 + z, edges >= 2 ? 'crateDark' : y % 2 ? 'crate' : 'crateLight');
      }
    }
  }
}

/** A basket four across from (x0, y0, z0): a wicker rim two high round its goods, heaped above it. Paints: wicker, wickerDark and the goods. */
export function basketAt(s: Sketch, x0: number, y0: number, z0: number, goods: Colour): void {
  for (let x = 0; x < 4; x++) {
    for (let z = 0; z < 4; z++) {
      const rim = x === 0 || x === 3 || z === 0 || z === 3;
      for (let y = 0; y < 2; y++) s.put(x0 + x, y0 + y, z0 + z, rim ? ((x + z + y) % 2 ? 'wicker' : 'wickerDark') : goods);
    }
  }
  s.put(x0 + 1, y0 + 2, z0 + 2, goods);
  s.put(x0 + 2, y0 + 2, z0 + 1, goods);
}
