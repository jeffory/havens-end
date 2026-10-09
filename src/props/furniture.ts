import { barrelAt, crateAt, EIGHTH, kit } from './kit';
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

/** Shelves against a wall, half a block deep: three boards and a top in a timber frame, and their wares on them. */
export function shelf(wares: Wares): PropModel {
  const s = kit('timber', 'plank', 'plankDark', 'crockery', 'blueWare', 'clay', 'pewter', 'bottleGreen', 'bottleBrown', 'stave', 'hoop', 'bookRed', 'bookGreen', 'bookBlue', 'bookTan');
  for (const x of [0, 7]) s.box(x, 0, 0, x, 13, 3, 'timber');
  s.box(1, 0, 0, 6, 13, 0, 'plankDark');
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
 * A stone hearth against a wall, two blocks high: a hearthstone out into the room, a fire
 * glowing between the cheeks, a pot hung over it from an iron crane, a mantel shelf, and the
 * chimney breast up to head height (it goes on above, with the roof).
 */
export function hearth(): PropModel {
  const s = kit('stone', 'stoneDark', 'soot', 'ember', 'flame', 'iron', 'timber');
  s.box(0, 0, 0, 7, 0, 6, 'stoneDark'); // the hearthstone
  for (const x of [0, 6]) s.box(x, 1, 0, x + 1, 6, 4, 'stone'); // the cheeks
  s.box(2, 1, 0, 5, 6, 0, 'soot'); // the fireback, blackened
  s.box(2, 1, 1, 5, 1, 3, 'ember'); // the fire's bed
  for (const [x, z] of [[2, 2], [3, 1], [4, 2], [5, 1]]) s.put(x, 2, z, 'flame');
  s.box(2, 6, 2, 4, 6, 2, 'iron'); // the crane
  s.put(4, 5, 2, 'iron'); // its hook
  s.box(3, 3, 2, 4, 4, 3, 'iron'); // the pot
  s.box(0, 7, 0, 7, 7, 4, 'stoneDark'); // the lintel
  s.box(0, 8, 0, 7, 8, 5, 'timber'); // the mantel shelf
  for (let y = 9; y <= 15; y++) for (let x = 1; x <= 6; x++) for (let z = 0; z <= 3; z++) s.put(x, y, z, (x * 3 + y * 5 + z) % 7 === 0 ? 'stoneDark' : 'stone');
  return s.model({ x: 4, y: 0, z: 4 }, EIGHTH);
}

/** A rug two blocks square, a voxel thick: a red field, a gold border and an inner line, a blue diamond. */
export function rug(): PropModel {
  const s = kit('rug', 'rugBorder', 'rugMotif');
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      const edge = Math.min(x, z, 15 - x, 15 - z);
      const d = Math.abs(x - 7.5) + Math.abs(z - 7.5);
      s.put(x, 0, z, edge === 0 || edge === 2 ? 'rugBorder' : d <= 2 || d === 6 ? 'rugMotif' : 'rug');
    }
  }
  return s.model({ x: 8, y: 0, z: 8 }, EIGHTH);
}

/** A runner a block wide and two long, a voxel thick, with three small diamonds down it. */
export function runner(): PropModel {
  const s = kit('rug', 'rugBorder', 'rugMotif');
  for (let x = 0; x < 8; x++) {
    for (let z = 0; z < 16; z++) {
      const edge = Math.min(x, z, 7 - x, 15 - z);
      const motif = [3.5, 7.5, 11.5].some((c) => Math.abs(x - 3.5) + Math.abs(z - c) <= 2);
      s.put(x, 0, z, edge === 0 ? 'rugBorder' : motif ? 'rugMotif' : 'rug');
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
