import { basketAt, type Colour, crateAt, EIGHTH, kit } from './kit';
import type { PropModel } from './types';

/**
 * A market stall, three blocks across and two deep, its front (+z) to the customers: a
 * counter of upright boards with its goods along it, the stallholder's stock behind, a post
 * at each corner, and a striped awning falling from the back out over the counter, its edge
 * scalloped. What reads at play zoom is the awning's stripes and the colours of the goods.
 */
export function stall(awning: 'red' | 'blue', goods: 'produce' | 'cloth'): PropModel {
  const stripe: Colour = awning === 'red' ? 'awningRed' : 'awningBlue';
  const s = kit('timber', 'plank', 'plankDark', 'plankLight', stripe, 'canvas', 'crate', 'crateLight', 'crateDark', 'sack', 'wicker', 'wickerDark', 'greens', 'fruit', 'apple', 'clothPurple', 'clothBlue', 'clothOchre', 'linen');
  // Posts at the corners, a quarter of a block square: the back pair taller, for the awning's fall.
  for (const x of [0, 22]) {
    s.box(x, 0, 0, x + 1, 21, 1, 'timber');
    s.box(x, 0, 14, x + 1, 19, 15, 'timber');
  }
  // The counter across the front: upright boards under a lighter top.
  for (let x = 2; x <= 21; x++) s.box(x, 0, 10, x, 5, 14, x % 3 === 2 ? 'plankDark' : 'plank');
  s.box(2, 6, 9, 21, 6, 15, 'plankLight');
  // The goods along it.
  if (goods === 'produce') {
    basketAt(s, 3, 7, 10, 'greens');
    basketAt(s, 9, 7, 11, 'fruit');
    basketAt(s, 15, 7, 10, 'apple');
  } else {
    for (const [z, colour] of [[10, 'clothPurple'], [12, 'clothBlue'], [14, 'clothOchre']] as const) {
      s.box(3, 7, z, 12, 8, z + 1, colour);
      s.box(3, 7, z, 3, 8, z + 1, 'linen'); // the bolt's end
    }
    basketAt(s, 15, 7, 10, 'greens');
  }
  // The stallholder's stock behind it: a crate and a sack.
  crateAt(s, 3, 0, 2, 6, 5, 5);
  s.box(15, 0, 2, 19, 3, 6, 'sack');
  s.box(16, 4, 3, 18, 4, 5, 'sack');
  // The awning: striped, falling from the back to the front and out over the counter, with a scalloped edge.
  for (let z = 0; z <= 17; z++) {
    const y = 22 - Math.floor(z / 6);
    for (let x = 0; x <= 23; x++) s.put(x, y, z, Math.floor(x / 3) % 2 === 0 ? stripe : 'canvas');
  }
  for (let x = 0; x <= 23; x++) if (x % 3 !== 2) s.put(x, 19, 17, Math.floor(x / 3) % 2 === 0 ? stripe : 'canvas');
  return s.model({ x: 12, y: 0, z: 8 }, EIGHTH);
}

/**
 * A hand cart of timber, two blocks across and three long, its shafts to the front (+z): two
 * spoked wheels on an iron axle, a plank bed with low sides, legs at the back to stand it
 * level, the shafts down to the ground, and a load of logs with a sack on top.
 */
export function handCart(): PropModel {
  const s = kit('timber', 'timberDark', 'plank', 'plankDark', 'iron', 'bark', 'grain', 'sack');
  // The wheels, one either side: a rim, eight spokes and an iron hub.
  const [cy, cz, r] = [5, 9, 5];
  for (const x of [1, 14]) {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let z = cz - r; z <= cz + r; z++) {
        const [dy, dz] = [y - cy, z - cz];
        const d = Math.hypot(dy, dz);
        if (Math.round(d) === r) s.put(x, y, z, 'timberDark');
        else if (d <= 1) s.put(x, y, z, 'iron');
        else if (d < r && (dy === 0 || dz === 0 || Math.abs(dy) === Math.abs(dz))) s.put(x, y, z, 'timber');
      }
    }
  }
  s.box(2, cy, cz, 13, cy, cz, 'iron'); // the axle
  // The bed: a plank floor, low sides, and a leg either side at the back.
  s.box(2, 6, 3, 13, 6, 16, 'plank');
  for (const x of [2, 13]) s.box(x, 7, 3, x, 8, 16, 'plankDark');
  for (const z of [3, 16]) s.box(3, 7, z, 12, 8, z, 'plankDark');
  for (const x of [3, 12]) s.box(x, 0, 4, x, 5, 4, 'timber');
  // The shafts, out in front and down to the ground.
  for (const x of [4, 11]) for (let z = 17; z <= 23; z++) s.put(x, Math.round(5 - ((z - 17) * 5) / 6), z, 'timber');
  // A load of logs, their cut ends showing, and a sack on top.
  for (const x0 of [3, 6, 9]) {
    s.box(x0, 7, 4, x0 + 2, 9, 15, 'bark');
    for (const z of [4, 15]) s.box(x0, 7, z, x0 + 2, 9, z, 'grain');
  }
  s.box(5, 10, 5, 7, 12, 14, 'bark');
  for (const z of [5, 14]) s.box(5, 10, z, 7, 12, z, 'grain');
  s.box(9, 10, 10, 11, 11, 13, 'sack');
  return s.model({ x: 8, y: 0, z: 12 }, EIGHTH);
}

/** A trestle counter in the market hall, a block square, a sack under it, its goods on it: baskets of produce, or bolts of cloth. */
export function counter(goods: 'produce' | 'cloth'): PropModel {
  const s = kit('timber', 'plank', 'sack', 'wicker', 'wickerDark', 'greens', 'fruit', 'apple', 'clothPurple', 'clothBlue', 'clothOchre', 'linen');
  for (const x of [0, 7]) s.box(x, 0, 1, x, 4, 6, 'timber'); // the trestles
  s.box(0, 5, 0, 7, 5, 7, 'plank'); // the board
  s.box(2, 0, 2, 5, 2, 5, 'sack');
  if (goods === 'produce') {
    basketAt(s, 0, 6, 0, 'greens');
    basketAt(s, 4, 6, 4, 'fruit');
    for (const [x, z] of [[5, 1], [6, 2], [5, 2]]) s.put(x, 6, z, 'apple');
  } else {
    for (const [z, colour] of [[1, 'clothPurple'], [3, 'clothBlue'], [5, 'clothOchre']] as const) {
      s.box(1, 6, z, 6, 7, z + 1, colour);
      s.box(1, 6, z, 1, 7, z + 1, 'linen');
    }
    s.box(2, 8, 3, 5, 8, 4, 'clothBlue'); // one laid on top
  }
  return s.model({ x: 4, y: 0, z: 4 }, EIGHTH);
}
