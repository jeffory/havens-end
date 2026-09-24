import { SEA_LEVEL } from '../config';

/**
 * Mean height of the water surface. It sits between voxel boundaries so the water
 * never z-fights terrain tops: cells topping out at y = 11 are always submerged,
 * cells topping out at y = 12 are always dry beach.
 */
export const WATER_LEVEL = SEA_LEVEL - 0.4;
export const WAVE_AMPLITUDE = 0.3;
/** Each water column snaps to one of 2 * WAVE_STEPS + 1 heights: stepped, voxel-style waves. */
export const WAVE_STEPS = 3;

interface WaveTrain {
  dirX: number;
  dirZ: number;
  frequency: number;
  speed: number;
  weight: number;
}

// Weights sum to 1, so the raw sum stays within [-1, 1] before scaling.
const TRAINS: WaveTrain[] = [
  { dirX: 0.96, dirZ: 0.28, frequency: 0.32, speed: 1.1, weight: 0.5 },
  { dirX: -0.45, dirZ: 0.89, frequency: 0.21, speed: 0.8, weight: 0.3 },
  { dirX: 0.71, dirZ: -0.71, frequency: 0.57, speed: 1.9, weight: 0.2 },
];

const TAU = Math.PI * 2;

/**
 * Phase of each wave train at `time`, wrapped to [0, 2π) in double precision. The
 * shader receives these instead of raw time, so the waves stay accurate after hours of play.
 */
export function wavePhases(time: number, out: number[] = new Array<number>(TRAINS.length)): number[] {
  for (let i = 0; i < TRAINS.length; i++) out[i] = (time * TRAINS[i].speed) % TAU;
  return out;
}

const phaseScratch = new Array<number>(TRAINS.length);

/**
 * Quantized height offset from WATER_LEVEL of the water column containing (x, z).
 * CPU twin of WAVE_GLSL: ships will float on exactly the surface that is drawn.
 */
export function waveOffset(x: number, z: number, time: number): number {
  const phases = wavePhases(time, phaseScratch);
  const cellX = Math.floor(x) + 0.5;
  const cellZ = Math.floor(z) + 0.5;
  let sum = 0;
  for (let i = 0; i < TRAINS.length; i++) {
    const w = TRAINS[i];
    sum += w.weight * Math.sin((cellX * w.dirX + cellZ * w.dirZ) * w.frequency + phases[i]);
  }
  return (Math.round(sum * WAVE_STEPS) / WAVE_STEPS) * WAVE_AMPLITUDE;
}

export const waterSurfaceY = (x: number, z: number, time: number): number => WATER_LEVEL + waveOffset(x, z, time);

/** Formats a number as a GLSL float literal (`1` would be an int in GLSL). */
export const glslFloat = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/** GLSL twin of waveOffset(), generated from the same constants. `cell` is the column centre (x + 0.5, z + 0.5). */
export const WAVE_GLSL = /* glsl */ `
uniform float uWavePhase[${TRAINS.length}];
float waveOffset(vec2 cell) {
  float sum = 0.0;
${TRAINS.map(
  (w, i) =>
    `  sum += ${glslFloat(w.weight)} * sin(dot(cell, vec2(${glslFloat(w.dirX)}, ${glslFloat(w.dirZ)})) * ${glslFloat(w.frequency)} + uWavePhase[${i}]);`,
).join('\n')}
  return floor(sum * ${glslFloat(WAVE_STEPS)} + 0.5) / ${glslFloat(WAVE_STEPS)} * ${glslFloat(WAVE_AMPLITUDE)};
}
`;
