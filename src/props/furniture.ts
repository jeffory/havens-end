import { barrelAt, type Colour, crateAt, EIGHTH, kit } from './kit';
import type { Sketch } from './sketch';
import type { PropModel } from './types';

/** A barrel standing on the floor, a block high. */
export function barrel(): PropModel {
  const s = kit('stave', 'staveDark', 'hoop', 'lid');
  barrelAt(s, 1, 0, 1);
  return s.model({ x: 4, y: 0, z: 4 }, EIGHTH);
}

/** A crate, three quarters of a block each way. */
export function crate(): PropModel {
  const s = kit('crate', 'crateLight', 'crateDark');
  crateAt(s, 1, 0, 1, 6, 6, 6);
  return s.model({ x: 4, y: 0, z: 4 }, EIGHTH);
}

/**
 * A bed a block wide and two long, its head (z = 0) to the wall: corner posts, taller at the
 * head, side rails and boards at its ends, a mattress, a pillow, and a striped wool blanket
 * turned down at the sheet and hanging over the sides.
 */
export function bed(): PropModel {
  const s = kit('timber', 'timberDark', 'linen', 'canvas', 'blanket', 'blanketDark');
  for (const x of [0, 7]) {
    s.box(x, 0, 0, x, 6, 0, 'timberDark');
    s.box(x, 0, 15, x, 3, 15, 'timberDark');
    s.box(x, 1, 1, x, 2, 14, 'timber');
  }
  s.box(1, 1, 0, 6, 5, 0, 'timber'); // the headboard
  s.box(1, 1, 15, 6, 3, 15, 'timber'); // the footboard
  s.box(1, 2, 1, 6, 3, 14, 'canvas'); // the mattress
  s.box(1, 4, 1, 6, 4, 3, 'linen'); // the pillow
  s.box(1, 4, 5, 6, 4, 5, 'linen'); // the sheet, turned down over the blanket
  for (let z = 6; z <= 14; z++) s.box(1, 4, z, 6, 4, z, z % 3 === 0 ? 'blanketDark' : 'blanket');
  for (const x of [0, 7]) for (let z = 5; z <= 14; z++) s.put(x, 3, z, z % 3 === 0 ? 'blanketDark' : 'blanket');
  return s.model({ x: 4, y: 0, z: 8 }, EIGHTH);
}

/** A table a block square on four legs, a jug, a plate and a tankard of ale on it. */
export function table(): PropModel {
  const s = kit('timber', 'plank', 'plankDark', 'clay', 'crockery', 'pewter', 'foam');
  for (const [x, z] of [[1, 1], [1, 6], [6, 1], [6, 6]]) s.box(x, 0, z, x, 4, z, 'timber');
  s.box(0, 5, 0, 7, 5, 7, 'plank');
  for (const z of [0, 7]) s.box(0, 5, z, 7, 5, z, 'plankDark'); // the top's edges
  s.box(1, 6, 1, 2, 7, 2, 'clay'); // a jug
  s.box(4, 6, 4, 5, 6, 5, 'crockery'); // a plate
  s.put(5, 6, 1, 'pewter'); // a tankard, its ale foaming
  s.put(5, 7, 1, 'foam');
  return s.model({ x: 4, y: 0, z: 4 }, EIGHTH);
}

/** A stool's seat on four legs, toward its front, to draw up to a table. */
function seat(s: Sketch): void {
  for (const [x, z] of [[2, 3], [2, 6], [5, 3], [5, 6]]) s.box(x, 0, z, x, 2, z, 'timber');
  s.box(2, 3, 3, 5, 3, 6, 'plank');
}

/** A stool, half a block high. */
export function stool(): PropModel {
  const s = kit('timber', 'plank');
  seat(s);
  return s.model({ x: 4, y: 0, z: 4 }, EIGHTH);
}

/** A chair: a stool with a slatted back. */
export function chair(): PropModel {
  const s = kit('timber', 'plank');
  seat(s);
  for (const x of [2, 5]) s.box(x, 4, 3, x, 7, 3, 'timber');
  for (const y of [5, 7]) s.box(3, y, 3, 4, y, 3, 'plank');
  return s.model({ x: 4, y: 0, z: 4 }, EIGHTH);
}

/** What's on a set of shelves. */
export type Wares = 'crockery' | 'bottles' | 'books';

/**
 * Shelves against a wall, half a block deep: three boards and a top in a timber frame, and their
 * wares on them. The back is panelled, rails in line with the boards: over a wall cut low, a
 * plain back read as a stray block.
 */
export function shelf(wares: Wares): PropModel {
  const s = kit('timber', 'plank', 'plankDark', 'crockery', 'blueWare', 'clay', 'pewter', 'bottleGreen', 'bottleBrown', 'stave', 'hoop', 'bookRed', 'bookGreen', 'bookBlue', 'bookTan');
  for (const x of [0, 7]) s.box(x, 0, 0, x, 13, 3, 'timber');
  for (let y = 0; y <= 13; y++) s.box(1, y, 0, 6, y, 0, [0, 5, 9, 13].includes(y) ? 'timber' : 'plankDark');
  for (const y of [0, 5, 9]) s.box(1, y, 1, 6, y, 3, 'plank');
  s.box(0, 13, 0, 7, 13, 3, 'timber');
  // Its wares, on the shelves' three spaces: y 1–4, 6–8 and 10–12.
  if (wares === 'crockery') {
    s.box(1, 1, 1, 2, 3, 2, 'clay'); // a jug
    s.box(4, 1, 1, 6, 1, 3, 'blueWare'); // bowls, stacked
    s.box(5, 2, 2, 6, 2, 2, 'blueWare');
    for (const [x, colour] of [[1, 'crockery'], [3, 'blueWare'], [5, 'crockery']] as const) s.box(x, 6, 1, x + 1, 8, 1, colour); // plates on edge
    for (const x of [2, 4, 6]) s.box(x, 10, 2, x, 11, 2, 'pewter'); // tankards
  } else if (wares === 'bottles') {
    for (const x of [1, 3, 5]) {
      const colour = x === 3 ? 'bottleBrown' : 'bottleGreen';
      s.box(x, 1, 2, x, 3, 2, colour);
      s.put(x, 4, 2, colour); // the neck
    }
    for (const x of [2, 4, 6]) s.box(x, 6, 2, x, 8, 2, x === 4 ? 'bottleGreen' : 'bottleBrown');
    s.box(1, 10, 1, 3, 12, 3, 'stave'); // a little cask
    s.box(1, 11, 1, 3, 11, 3, 'hoop');
    for (const x of [5, 6]) s.box(x, 10, 2, x, 11, 2, 'pewter');
  } else {
    const colours = ['bookRed', 'bookGreen', 'bookBlue', 'bookTan'] as const;
    for (let x = 1; x <= 6; x++) s.box(x, 1, 1, x, 2 + (x % 2) + (x === 4 ? 1 : 0), 2, colours[x % 4]);
    for (let x = 1; x <= 5; x++) s.box(x, 6, 1, x, 7 + ((x + 1) % 2), 2, colours[(x + 1) % 4]);
    s.box(1, 10, 1, 4, 10, 2, 'bookTan'); // ledgers, lying in a pile
    s.box(1, 11, 1, 4, 11, 2, 'bookRed');
  }
  return s.model({ x: 4, y: 0, z: 4 }, EIGHTH);
}

/** A chest, its back to the wall: iron bands over its front and lid, and a brass lock. */
export function chest(): PropModel {
  const s = kit('chest', 'walnut', 'ironLight', 'gold');
  s.box(1, 0, 1, 6, 3, 5, 'chest');
  s.box(1, 4, 1, 6, 4, 5, 'walnut'); // the lid
  for (const x of [2, 5]) {
    s.box(x, 0, 5, x, 3, 5, 'ironLight');
    s.box(x, 4, 1, x, 4, 5, 'ironLight');
  }
  s.box(3, 2, 5, 4, 3, 5, 'gold'); // the lock
  return s.model({ x: 4, y: 0, z: 4 }, EIGHTH);
}

/**
 * A hearth against a wall (z = 0), two blocks high, drawn to read from above as well as from
 * the room: a fire of logs out on the hearthstone, before the fireplace's mouth and open to
 * the sky, a black pot of stew hung beside it from an iron crane, a stone surround under a
 * timber mantel with a jug and a plate on it, a log pile, and a narrow chimney going on up
 * the wall. (Its old full-width chimney breast over a fire tucked under the lintel read from
 * above as a grey die.)
 */
export function hearth(): PropModel {
  const s = kit('stone', 'stoneDark', 'soot', 'ember', 'flame', 'iron', 'ironLight', 'timber', 'timberDark', 'bark', 'clay', 'crockery');
  s.box(0, 0, 0, 7, 0, 6, 'stoneDark'); // the hearthstone
  for (const x of [0, 6]) s.box(x, 1, 0, x + 1, 5, 1, 'stone'); // the surround's cheeks
  s.box(2, 1, 0, 5, 5, 0, 'soot'); // the fireback, blackened
  s.box(0, 6, 0, 7, 7, 1, 'stone'); // the lintel over the mouth
  s.box(0, 8, 0, 7, 8, 1, 'timber'); // the mantel shelf
  s.box(0, 8, 2, 7, 8, 2, 'timberDark'); // its front edge
  s.box(0, 9, 1, 1, 10, 2, 'clay'); // a jug on it
  s.put(1, 11, 1, 'clay');
  s.box(6, 9, 1, 7, 10, 1, 'crockery'); // a plate stood on edge
  // The chimney, narrower than the hearth, going on up the wall: plain stone between a darker footing and cap.
  for (let y = 9; y <= 15; y++) s.box(2, y, 0, 5, y, 1, y === 9 || y === 15 ? 'stoneDark' : 'stone');
  // The fire: logs across the mouth and out onto the hearthstone, embers between, and flames rising.
  for (const z of [2, 4]) s.box(1, 1, z, 5, 1, z, 'bark');
  s.box(2, 1, 1, 5, 1, 1, 'ember');
  s.box(1, 1, 3, 5, 1, 3, 'ember');
  s.box(1, 2, 2, 4, 2, 4, 'flame');
  for (const [x, z] of [[4, 2], [1, 4]] as const) s.put(x, 2, z, 'ember');
  s.box(1, 3, 3, 4, 3, 3, 'flame');
  s.box(2, 3, 2, 3, 3, 4, 'flame');
  s.box(2, 4, 3, 3, 4, 3, 'flame');
  s.put(2, 5, 3, 'flame');
  // The pot, hung beside the flames from a crane swung out from the right-hand cheek: a dark iron
  // belly, a pale rim, stew in it.
  s.box(7, 6, 2, 7, 6, 5, 'iron'); // the crane's arm
  s.put(6, 6, 5, 'iron'); // its hook
  s.box(5, 3, 4, 7, 4, 6, 'iron'); // the pot
  for (let x = 5; x <= 7; x++) for (let z = 4; z <= 6; z++) s.put(x, 5, z, x === 6 && z === 5 ? 'clay' : 'ironLight'); // its rim, round the stew
  // Firewood stacked on the hearthstone.
  for (const [y, z] of [[1, 5], [1, 6], [2, 5]] as const) s.box(0, y, z, 2, y, z, 'bark');
  s.put(3, 1, 6, 'timberDark'); // a log end
  return s.model({ x: 4, y: 0, z: 4 }, EIGHTH);
}

/** A rug's or a runner's colours: its field, its border and inner line, and the diamonds on it. */
export interface RugColours {
  field: Colour;
  border: Colour;
  motif: Colour;
}

/** A rug two blocks square, a voxel thick: a field, a border and an inner line, a diamond. */
export function rug({ field, border, motif }: RugColours): PropModel {
  const s = kit(field, border, motif);
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      const edge = Math.min(x, z, 15 - x, 15 - z);
      const d = Math.abs(x - 7.5) + Math.abs(z - 7.5);
      s.put(x, 0, z, edge === 0 || edge === 2 ? border : d <= 2 || d === 6 ? motif : field);
    }
  }
  return s.model({ x: 8, y: 0, z: 8 }, EIGHTH);
}

/** A runner a block wide and two long, a voxel thick, with three small diamonds down it. */
export function runner({ field, border, motif }: RugColours): PropModel {
  const s = kit(field, border, motif);
  for (let x = 0; x < 8; x++) {
    for (let z = 0; z < 16; z++) {
      const edge = Math.min(x, z, 7 - x, 15 - z);
      const diamond = [3.5, 7.5, 11.5].some((c) => Math.abs(x - 3.5) + Math.abs(z - c) <= 2);
      s.put(x, 0, z, edge === 0 ? border : diamond ? motif : field);
    }
  }
  return s.model({ x: 4, y: 0, z: 8 }, EIGHTH);
}

/** A block's length of bar: a framed walnut panel to the room (+z), a plinth, and a top over it all. */
function barLength(s: Sketch): void {
  s.box(0, 0, 1, 7, 0, 6, 'timberDark');
  s.box(0, 1, 1, 7, 6, 6, 'walnut');
  for (const x of [0, 7]) s.box(x, 1, 7, x, 6, 7, 'timber'); // the stiles
  for (const y of [1, 6]) s.box(1, y, 7, 6, y, 7, 'timber'); // the rails
  s.box(0, 7, 0, 7, 7, 7, 'plankLight'); // the top
}

/** A length of bar with two tankards of ale and a bottle on it. */
export function bar(): PropModel {
  const s = kit('timberDark', 'walnut', 'timber', 'plankLight', 'pewter', 'foam', 'bottleGreen');
  barLength(s);
  for (const [x, z] of [[2, 4], [5, 2]]) {
    s.put(x, 8, z, 'pewter');
    s.put(x, 9, z, 'foam');
  }
  s.box(6, 8, 6, 6, 9, 6, 'bottleGreen');
  return s.model({ x: 4, y: 0, z: 4 }, EIGHTH);
}

/** A length of bar with a cask on it, its tap on the keeper's side. */
export function barCask(): PropModel {
  const s = kit('timberDark', 'walnut', 'timber', 'plankLight', 'stave', 'hoop', 'iron');
  barLength(s);
  s.box(2, 8, 2, 5, 10, 5, 'stave');
  s.box(2, 9, 2, 5, 9, 5, 'hoop');
  s.put(3, 9, 1, 'iron');
  return s.model({ x: 4, y: 0, z: 4 }, EIGHTH);
}

/**
 * A clerk's desk, its front (+z) to the room: drawers on one side (their pulls on the clerk's
 * side), a panel at the front, and on its top papers, a ledger, an inkwell and quill, and a
 * candle that glows after dark.
 */
export function desk(): PropModel {
  const s = kit('walnut', 'timber', 'gold', 'paper', 'ink', 'linen', 'bookRed', 'wax', 'flame');
  s.box(0, 0, 1, 2, 4, 7, 'walnut'); // the drawers
  for (const y of [1, 3]) s.put(1, y, 0, 'gold');
  s.box(7, 0, 1, 7, 4, 7, 'walnut'); // the other end
  s.box(3, 1, 7, 6, 4, 7, 'timber'); // the front
  s.box(0, 5, 0, 7, 5, 7, 'walnut'); // the top
  s.box(2, 6, 3, 4, 6, 5, 'paper');
  s.box(5, 6, 1, 6, 6, 2, 'paper');
  s.box(1, 6, 5, 2, 6, 6, 'bookRed'); // a ledger
  s.put(6, 6, 5, 'ink'); // the inkwell
  s.put(6, 7, 5, 'linen'); // its quill
  s.put(1, 6, 1, 'gold'); // the candlestick
  s.box(1, 7, 1, 1, 8, 1, 'wax');
  s.put(1, 9, 1, 'flame');
  return s.model({ x: 4, y: 0, z: 4 }, EIGHTH);
}

/**
 * The Governor's desk, its front (+z) to the room: as a clerk's, but walnut trimmed in gold on
 * turned legs, a crimson leather top, and on it a silver inkstand, the Crown's seal, papers,
 * and a gilt candlestick whose candle glows after dark.
 */
export function deskGrand(): PropModel {
  const s = kit('walnut', 'timberDark', 'gold', 'crimson', 'paper', 'ink', 'linen', 'pewter', 'wax', 'flame');
  for (const [x, z] of [[0, 0], [0, 7], [7, 0], [7, 7]]) {
    s.put(x, 0, z, 'gold'); // the feet
    s.box(x, 1, z, x, 4, z, 'walnut');
  }
  s.box(0, 1, 1, 0, 4, 6, 'walnut'); // the sides
  s.box(7, 1, 1, 7, 4, 6, 'walnut');
  s.box(1, 2, 7, 6, 4, 7, 'walnut'); // the front panel, framed in gold
  for (const y of [2, 4]) s.box(1, y, 7, 6, y, 7, 'gold');
  s.box(1, 2, 0, 6, 4, 0, 'timberDark'); // the drawers on the Governor's side
  for (const x of [2, 5]) s.put(x, 3, 0, 'gold');
  s.box(0, 5, 0, 7, 5, 7, 'walnut'); // the top
  s.box(1, 5, 1, 6, 5, 6, 'crimson'); // its leather
  s.box(2, 6, 3, 4, 6, 5, 'paper'); // papers
  s.box(5, 6, 5, 6, 6, 6, 'pewter'); // the inkstand
  s.put(5, 7, 5, 'ink');
  s.put(6, 7, 6, 'linen'); // its quill
  s.box(5, 6, 2, 5, 7, 2, 'gold'); // the seal
  s.box(1, 6, 1, 1, 7, 1, 'gold'); // the candlestick
  s.put(1, 8, 1, 'wax');
  s.put(1, 9, 1, 'flame');
  return s.model({ x: 4, y: 0, z: 4 }, EIGHTH);
}

/** A strongbox, its front (+z) to the room: dark oak bound in iron, studded, its lock in brass. */
export function strongbox(): PropModel {
  const s = kit('timberDark', 'iron', 'ironLight', 'gold');
  s.box(1, 0, 1, 6, 4, 6, 'timberDark');
  s.box(1, 5, 1, 6, 5, 6, 'iron'); // the lid, plated
  for (const x of [1, 6]) s.box(x, 0, 1, x, 5, 6, 'iron'); // bands round its ends
  for (const z of [1, 6]) s.box(1, 0, z, 6, 0, z, 'iron'); // and its foot
  for (const x of [3, 4]) s.box(x, 0, 6, x, 5, 6, 'iron'); // a strap down its front and over the lid
  for (const x of [3, 4]) s.box(x, 5, 1, x, 5, 6, 'ironLight');
  for (const [x, z] of [[1, 1], [1, 6], [6, 1], [6, 6]]) s.put(x, 5, z, 'ironLight'); // studs
  s.box(3, 2, 7, 4, 3, 7, 'gold'); // the lock
  return s.model({ x: 4, y: 0, z: 4 }, EIGHTH);
}

/** A chest, its back to the wall, its lid thrown open against it, with what's in it heaped to the brim. */
function openChest(s: Sketch, heap: (x: number, z: number) => string): void {
  s.box(1, 0, 2, 6, 3, 6, 'chest');
  for (const x of [2, 5]) s.box(x, 0, 6, x, 3, 6, 'ironLight'); // its bands
  s.box(3, 2, 6, 4, 2, 6, 'gold'); // its lock
  s.box(1, 4, 1, 6, 8, 1, 'walnut'); // the lid, open
  for (let x = 2; x <= 5; x++) for (let z = 3; z <= 5; z++) s.put(x, 4, z, heap(x, z));
}

/** The Guild's chest of ledgers: open, its ledgers stood in it in rows. */
export function ledgerChest(): PropModel {
  const s = kit('chest', 'walnut', 'ironLight', 'gold', 'bookRed', 'bookGreen', 'bookBlue', 'bookTan');
  const spines = ['bookRed', 'bookTan', 'bookGreen', 'bookBlue'];
  openChest(s, (x, z) => spines[(x + z * 3) % 4]);
  for (const x of [2, 4]) s.put(x, 5, 4, spines[x % 4]); // one or two stood taller
  return s.model({ x: 4, y: 0, z: 4 }, EIGHTH);
}

/** The Pirate Lord's chest of plunder: open, heaped with gold, a jewel or two in it. */
export function treasureChest(): PropModel {
  const s = kit('chest', 'walnut', 'ironLight', 'gold', 'grain', 'apple', 'blueWare');
  openChest(s, (x, z) => (x === 3 && z === 4 ? 'apple' : x === 5 && z === 3 ? 'blueWare' : (x + z) % 3 ? 'gold' : 'grain'));
  for (const [x, z] of [[3, 4], [4, 4], [4, 3]]) s.put(x, 5, z, 'gold'); // heaped over the brim
  return s.model({ x: 4, y: 0, z: 4 }, EIGHTH);
}

/** A table with a chart spread on it: a coast and its soundings, a pair of dividers, and a weight on the corner. */
export function mapTable(): PropModel {
  const s = kit('timber', 'plank', 'plankDark', 'canvas', 'sack', 'blueWare', 'bookRed', 'ironLight', 'pewter');
  for (const [x, z] of [[1, 1], [1, 6], [6, 1], [6, 6]]) s.box(x, 0, z, x, 4, z, 'timber');
  s.box(0, 5, 0, 7, 5, 7, 'plank');
  for (const z of [0, 7]) s.box(0, 5, z, 7, 5, z, 'plankDark');
  // The chart: sea and a coast running across it, soundings, and a course pricked out in red.
  for (let x = 0; x <= 7; x++) for (let z = 1; z <= 6; z++) s.put(x, 6, z, z + (x % 3 === 0 ? 1 : 0) >= 5 ? 'sack' : 'canvas');
  for (const [x, z] of [[1, 3], [3, 2], [6, 3]]) s.put(x, 6, z, 'blueWare');
  for (const [x, z] of [[1, 1], [2, 2], [4, 3], [5, 4]]) s.put(x, 6, z, 'bookRed');
  s.put(4, 7, 2, 'ironLight'); // the dividers
  s.put(5, 7, 1, 'ironLight');
  s.put(7, 7, 6, 'pewter'); // a weight
  return s.model({ x: 4, y: 0, z: 4 }, EIGHTH);
}

/** Whose banner: the Crown's, the Guild's or the Brethren's. */
export type Banner = 'crown' | 'guild' | 'brethren';

/** Each banner's cloth, six across and eleven down from the rod (top first), in its colours: a gold cross on crimson, a white band and a gold boss on blue, a skull over bones on black. */
const BANNER_CLOTH: Record<Banner, { rows: readonly string[]; key: Readonly<Record<string, Colour>> }> = {
  crown: { rows: ['CCGGCC', 'CCGGCC', 'CCGGCC', 'GGGGGG', 'GGGGGG', 'CCGGCC', 'CCGGCC', 'CCGGCC', 'CCGGCC', 'CCGGCC', 'GC..CG'], key: { C: 'crimson', G: 'gold' } },
  guild: { rows: ['BBBBBB', 'BBBBBB', 'BBBBBB', 'BBBBBB', 'WWGGWW', 'WWGGWW', 'BBBBBB', 'BBBBBB', 'BBBBBB', 'BBBBBB', 'BB..BB'], key: { B: 'guildBlue', W: 'linen', G: 'gold' } },
  brethren: { rows: ['KKKKKK', 'KWWWWK', 'KWKKWK', 'KWWWWK', 'KKWWKK', 'KKKKKK', 'WKKKKW', 'KWKKWK', 'KKWWKK', 'KWKKWK', 'WK..KW'], key: { K: 'ink', W: 'bone' } },
};

/**
 * A banner hung on a wall over a seat of power, its owners' colours: a cloth six voxels across
 * and eleven down, swallow-tailed, from an iron rod with gilt ends. Its origin is the middle of
 * the wall's face at the foot of the block it hangs on: it hangs from near that block's top to
 * below its foot.
 */
export function banner(whose: Banner): PropModel {
  const { rows, key } = BANNER_CLOTH[whose];
  const s = kit('iron', 'gold', ...new Set(Object.values(key)));
  s.box(1, 6, 0, 6, 6, 0, 'iron'); // the rod
  for (const x of [0, 7]) s.put(x, 6, 0, 'gold');
  s.rows(1, -5, 0, rows, key);
  return s.model({ x: 4, y: 0, z: 0 }, EIGHTH);
}
