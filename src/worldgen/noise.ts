import { createNoise2D } from 'simplex-noise';

export type Noise2D = (x: number, y: number) => number;

/** Small, fast seeded PRNG. The same seed always builds the same world, which keeps saves tiny (seed + edits). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const seededNoise2D = (random: () => number): Noise2D => createNoise2D(random);

/** Fractal (layered) simplex noise, normalised to roughly [-1, 1]. */
export function fbm2(noise: Noise2D, x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let sum = 0;
  let amplitude = 1;
  let frequency = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * frequency, y * frequency) * amplitude;
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return sum / norm;
}
