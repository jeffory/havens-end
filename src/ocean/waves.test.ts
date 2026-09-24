import { describe, expect, it } from 'vitest';
import { WAVE_AMPLITUDE, WAVE_GLSL, WAVE_STEPS, waveOffset } from './waves';

describe('waveOffset', () => {
  it('snaps to discrete steps within the amplitude', () => {
    const allowed = new Set<number>();
    for (let k = -WAVE_STEPS; k <= WAVE_STEPS; k++) allowed.add(Math.round((k / WAVE_STEPS) * WAVE_AMPLITUDE * 1e6));
    for (let i = 0; i < 500; i++) {
      const h = waveOffset(i * 7.3 - 900, i * 3.1 + 40, i * 0.37);
      expect(Math.abs(h)).toBeLessThanOrEqual(WAVE_AMPLITUDE + 1e-9);
      expect(allowed.has(Math.round(h * 1e6))).toBe(true);
    }
  });

  it('is constant across a voxel cell, so a column moves as one block', () => {
    expect(waveOffset(10.05, -3.9, 12)).toBe(waveOffset(10.95, -3.05, 12));
  });

  it('exposes a GLSL twin with the same entry point', () => {
    expect(WAVE_GLSL).toContain('float waveOffset(vec2 cell)');
  });
});
