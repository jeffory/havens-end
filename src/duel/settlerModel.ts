import { hash2 } from '../util/hash';
import { type CharacterModel, characterFromParts, type PartName } from './characterModel';
import { type Dress, settlerDress } from './dress';

const SKIN = [0xf1c9a5, 0xd9a47a, 0xa86f48, 0x6e4630];
const HAIR = [0x2a1b10, 0x5a3a1e, 0xc9a24a, 0x8e3b1f, 0x9a9a9a];

/** Palette slots. The last three are only filled for those who wear them. */
const C = { skin: 1, hair: 2, shirt: 3, trousers: 4, boots: 5, belt: 6, eyes: 7, hat: 8, band: 9, over: 10, stripe: 11, whites: 12 } as const;
/** How tall a settler is without a hat, in voxels. */
const HEIGHT = 26;
/** A soldier's cross-belts and cuffs. */
const WHITES = 0xefeadf;

/**
 * A settler, or someone about town, built from code rather than drawn: legs, a shirt,
 * arms out in a T-pose, a head with hair and eyes, and whatever they wear. `look` picks
 * skin and hair, so every one looks their own. `dress` is what they wear; left out, it's
 * a settler's, picked by `look` too (a straw hat half the time), as it always has been.
 * Same parts and joints as the captains.
 */
export function buildSettlerModel(look: number, dress: Dress = settlerDress(look)): CharacterModel {
  const pick = (list: readonly number[], salt: number) => list[Math.floor(hash2(look, salt) * list.length)];
  const palette = new Uint8Array(256 * 4);
  const set = (slot: number, hex: number) => palette.set([(hex >> 16) & 255, (hex >> 8) & 255, hex & 255, 255], slot * 4);
  set(C.skin, pick(SKIN, 1));
  set(C.hair, pick(HAIR, 2));
  set(C.shirt, dress.shirt);
  set(C.trousers, dress.trousers);
  set(C.boots, dress.boots);
  set(C.belt, dress.belt);
  set(C.eyes, 0x161616);
  set(C.hat, dress.head.colour);
  set(C.band, dress.head.band);
  const over = dress.over.kind;
  const head = dress.head.kind;
  if (over !== 'none') set(C.over, dress.over.colour);
  if (dress.stripe !== undefined) set(C.stripe, dress.stripe);
  if (dress.soldier) set(C.whites, WHITES);
  const longHair = hash2(look, 6) < 0.4;
  const longSleeves = over === 'smock' || over === 'coat';
  const shirt = (y: number) => (dress.stripe !== undefined && y % 2 === 0 ? C.stripe : C.shirt);

  const parts: Record<PartName, number[]> = { head: [], torso: [], arm_l: [], arm_r: [], leg_l: [], leg_r: [] };
  const box = (part: PartName, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, colour: (x: number, y: number, z: number) => number) => {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) parts[part].push(x, y, z, colour(x, y, z));
  };

  // Legs: boots, then trousers, under whatever hangs over them. The right leg is on -x.
  const leg = (x: number, y: number, z: number) => {
    if (y <= 2) return C.boots;
    if (over === 'apron' && z === 1 && y >= 4) return C.over; // to the knee, in front
    if (over === 'smock' && y >= 7) return C.over; // to mid-thigh, all round
    if (over === 'coat' && y >= 5 && (z === -1 || Math.abs(x) === 3)) return C.over; // skirts behind and at the sides, open in front
    if (dress.sash && x === 3 && z === 0 && y >= 7) return C.belt; // the sash's end, down the left hip
    return C.trousers;
  };
  box('leg_r', -3, -1, 0, 10, -1, 1, leg);
  box('leg_l', 1, 3, 0, 10, -1, 1, leg);
  // The body: a belt (or a wide sash), then the shirt, open at the neck, under a waistcoat, apron, smock or coat.
  box('torso', -4, 4, 11, 18, -2, 2, (x, y, z) => {
    const front = z === 2;
    if (dress.soldier && Math.abs(z) === 2 && y >= 12 && Math.abs(x) === Math.abs(y - 15)) return C.whites; // belts crossed, shoulder to hip
    if (y === 11 || (dress.sash && y === 12)) return over === 'smock' || (over === 'apron' && front && Math.abs(x) <= 3) ? C.over : C.belt;
    if (y === 18 && Math.abs(x) <= 1 && front) return C.skin;
    if (dress.ragged && y === 17 && x === 0 && front) return C.skin;
    if (over === 'waistcoat') return front && Math.abs(x) <= 1 ? shirt(y) : C.over;
    if (over === 'apron') return front && Math.abs(x) <= 3 && y <= 17 && (Math.abs(x) <= 2 || y <= 13) ? C.over : shirt(y);
    if (longSleeves) return C.over;
    return shirt(y);
  });
  // Arms straight out: sleeves, then bare forearms and hands (hands only, in a smock or coat; torn off short, when ragged).
  const sleeve = (x: number, y: number, z: number) => {
    const out = Math.abs(x);
    const bare = dress.ragged ? out >= 8 + ((y + z) & 1) : out >= (longSleeves ? 11 : 10);
    if (bare) return C.skin;
    if (longSleeves) return dress.soldier && out === 10 ? C.whites : C.over;
    return dress.stripe !== undefined && out % 2 === 0 ? C.stripe : C.shirt;
  };
  box('arm_r', -12, -5, 16, 18, -1, 1, sleeve);
  box('arm_l', 5, 12, 16, 18, -1, 1, sleeve);
  // The head: a face at the front (+z), hair over the top and back, or a cloth or cap over it.
  const covered = (x: number, y: number, z: number) =>
    head === 'bandana' ? y >= 23 : head === 'cap' ? y >= 24 : head === 'scarf' ? y >= 24 || z === -3 || (Math.abs(x) === 3 && y >= 20 && z <= 1) : false;
  box('head', -3, 3, 19, 25, -3, 3, (x, y, z) => {
    if (y === 22 && z === 3 && Math.abs(x) === 2) return C.eyes;
    if (covered(x, y, z)) return head === 'cap' && y === 24 ? C.band : C.hat;
    if (y >= 24 || z === -3 || (Math.abs(x) === 3 && y >= 23 && z < 2)) return C.hair;
    if (longHair && z <= -1 && y >= 20 && Math.abs(x) === 3) return C.hair;
    return C.skin;
  });
  // Long hair down the back of the neck, or the scarf hanging there instead.
  if (head === 'scarf') box('head', -3, 3, 17, 18, -3, -3, () => C.hat);
  else if (longHair) box('head', -3, 3, 17, 18, -3, -3, () => C.hair);
  if (head === 'straw') {
    // A wide straw brim and a crown with a band.
    for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) if (x * x + z * z <= 28) parts.head.push(x, 26, z, C.hat);
    box('head', -3, 3, 27, 28, -3, 3, (_x, y) => (y === 27 ? C.band : C.hat));
  } else if (head === 'cap') {
    box('head', -2, 2, 26, 26, -2, 2, () => C.hat);
    box('head', -1, 1, 27, 27, -1, 1, () => C.hat);
  } else if (head === 'bandana') {
    // Knotted at the back, the ends hanging.
    box('head', -1, 0, 22, 23, -4, -4, () => C.hat);
    box('head', 0, 0, 20, 21, -4, -4, () => C.hat);
  } else if (head === 'tricorn') {
    tricorn(parts.head, box);
  }
  return characterFromParts(parts, palette, HEIGHT);
}

/**
 * A tricorn: the brim cocked up into a rounded triangle, a corner to the front and two
 * behind, its turned-up edge in the band's colour (a soldier's white lace), over a low crown.
 */
function tricorn(cells: number[], box: (part: PartName, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, colour: () => number) => void): void {
  const brim = (x: number, z: number) => x * x + z * z <= 38 && z >= -4.5 && 0.866 * Math.abs(x) + 0.5 * z <= 4.5;
  for (let x = -7; x <= 7; x++) {
    for (let z = -7; z <= 7; z++) {
      if (!brim(x, z)) continue;
      cells.push(x, 26, z, C.hat);
      if (!brim(x + 1, z) || !brim(x - 1, z) || !brim(x, z + 1) || !brim(x, z - 1)) cells.push(x, 27, z, C.band);
    }
  }
  box('head', -2, 2, 27, 27, -2, 2, () => C.hat);
  box('head', -1, 1, 28, 28, -1, 1, () => C.hat);
}

/**
 * A musket for a soldier's hand, in character voxels from the grip at the origin: butt
 * down by the boot, muzzle and bayonet up past the shoulder. Held things are laid along
 * −x and turned to point where the pose says; standing at ease that turns +y upright,
 * leaning out a little, so the barrel steps a voxel sideways every three to stand straight.
 */
export function musketCells(): { cells: Int32Array; palette: Uint8Array } {
  const palette = new Uint8Array(256 * 4);
  palette.set([106, 68, 40, 255], 1 * 4); // stock
  palette.set([70, 72, 78, 255], 2 * 4); // barrel
  palette.set([200, 204, 210, 255], 3 * 4); // bayonet
  palette.set([176, 140, 70, 255], 4 * 4); // brass
  const cells: number[] = [];
  const put = (x: number, y: number, c: number) => cells.push(x, y, Math.round(y / 3), c);
  put(0, -9, 4); // the butt plate
  put(1, -9, 4);
  for (let y = -8; y <= -3; y++) {
    put(0, y, 1);
    if (y <= -6) put(1, y, 1); // the butt, deeper at the heel
  }
  put(1, -2, 4); // the lock
  for (let y = -2; y <= 11; y++) {
    put(0, y, 2);
    if (y <= 6) put(1, y, 1); // the fore-stock under the barrel
  }
  for (let y = 12; y <= 15; y++) put(0, y, 3);
  return { cells: Int32Array.from(cells), palette };
}
