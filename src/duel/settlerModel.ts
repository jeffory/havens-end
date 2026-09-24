import { hash2 } from '../util/hash';
import { type CharacterModel, characterFromParts, type PartName } from './characterModel';

const SKIN = [0xf1c9a5, 0xd9a47a, 0xa86f48, 0x6e4630];
const HAIR = [0x2a1b10, 0x5a3a1e, 0xc9a24a, 0x8e3b1f, 0x9a9a9a];
const SHIRT = [0xf2ede0, 0x6d8fb3, 0xa6423a, 0x5f7d4a, 0xc9a24a, 0x7b5e8f];
const TROUSERS = [0x6b4a2b, 0x2f3d5c, 0x5a5a52, 0x8a7a5a];

/** Palette slots. */
const C = { skin: 1, hair: 2, shirt: 3, trousers: 4, boots: 5, belt: 6, eyes: 7, straw: 8, band: 9 } as const;
/** How tall a settler is without a hat, in voxels. */
const HEIGHT = 26;

/**
 * A settler, built from code rather than drawn: legs, a shirt, arms out in a T-pose, a
 * head with hair and eyes, and perhaps a straw hat. `look` picks skin, hair, clothes and
 * hat, so every settler looks their own. Same parts and joints as the captains.
 */
export function buildSettlerModel(look: number): CharacterModel {
  const pick = (list: readonly number[], salt: number) => list[Math.floor(hash2(look, salt) * list.length)];
  const palette = new Uint8Array(256 * 4);
  const set = (slot: number, hex: number) => palette.set([(hex >> 16) & 255, (hex >> 8) & 255, hex & 255, 255], slot * 4);
  set(C.skin, pick(SKIN, 1));
  set(C.hair, pick(HAIR, 2));
  set(C.shirt, pick(SHIRT, 3));
  set(C.trousers, pick(TROUSERS, 4));
  set(C.boots, 0x3a2616);
  set(C.belt, 0x2a1a0e);
  set(C.eyes, 0x161616);
  set(C.straw, 0xd8bd72);
  set(C.band, 0x7a2a1a);
  const hat = hash2(look, 5) < 0.5;
  const longHair = hash2(look, 6) < 0.4;

  const parts: Record<PartName, number[]> = { head: [], torso: [], arm_l: [], arm_r: [], leg_l: [], leg_r: [] };
  const box = (part: PartName, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, colour: (x: number, y: number, z: number) => number) => {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) parts[part].push(x, y, z, colour(x, y, z));
  };

  // Legs: boots, then trousers. The right leg is on -x.
  const leg = (y: number) => (y <= 2 ? C.boots : C.trousers);
  box('leg_r', -3, -1, 0, 10, -1, 1, (_x, y) => leg(y));
  box('leg_l', 1, 3, 0, 10, -1, 1, (_x, y) => leg(y));
  // The body: a belt, then the shirt, open at the neck.
  box('torso', -4, 4, 11, 18, -2, 2, (x, y, z) => (y === 11 ? C.belt : y === 18 && Math.abs(x) <= 1 && z === 2 ? C.skin : C.shirt));
  // Arms straight out: sleeves, then bare forearms and hands.
  box('arm_r', -12, -5, 16, 18, -1, 1, (x) => (x <= -10 ? C.skin : C.shirt));
  box('arm_l', 5, 12, 16, 18, -1, 1, (x) => (x >= 10 ? C.skin : C.shirt));
  // The head: a face at the front (+z), hair over the top and back.
  box('head', -3, 3, 19, 25, -3, 3, (x, y, z) => {
    if (y === 22 && z === 3 && Math.abs(x) === 2) return C.eyes;
    if (y >= 24 || z === -3 || (Math.abs(x) === 3 && y >= 23 && z < 2)) return C.hair;
    if (longHair && z <= -1 && y >= 20 && Math.abs(x) === 3) return C.hair;
    return C.skin;
  });
  if (longHair) box('head', -3, 3, 17, 18, -3, -3, () => C.hair);
  if (hat) {
    // A wide straw brim and a crown with a band.
    for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) if (x * x + z * z <= 28) parts.head.push(x, 26, z, C.straw);
    box('head', -3, 3, 27, 28, -3, 3, (_x, y) => (y === 27 ? C.band : C.straw));
  }
  return characterFromParts(parts, palette, HEIGHT);
}
