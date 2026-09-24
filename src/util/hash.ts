/** Deterministic integer hash of a lattice point, returned in [0, 1). Same input, same output, on every machine. */
export function hash3(x: number, y: number, z: number, seed = 0): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x1b873593) ^ Math.imul(seed, 0x68e31da4);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const hash2 = (x: number, z: number, seed = 0): number => hash3(x, 0, z, seed);
