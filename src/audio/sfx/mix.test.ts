import { describe, expect, it } from 'vitest';
import { falloff, MAX_VOICES, panFor, pickVariant, pitchFor, VoicePool } from './mix';

describe('the mixing rules', () => {
  it('pickVariant never repeats the last take when there is a choice', () => {
    for (let i = 0; i < 200; i++) {
      const v = pickVariant(3, 1, Math.random);
      expect(v).not.toBe(1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(2);
    }
    expect(pickVariant(1, 0, Math.random)).toBe(0);
    expect(pickVariant(0, -1, Math.random)).toBe(-1);
  });

  it('falloff is full at the focus, gone at reach, and quadratic between', () => {
    expect(falloff(0, 100)).toBe(1);
    expect(falloff(50, 100)).toBe(0.25);
    expect(falloff(100, 100)).toBe(0);
    expect(falloff(150, 100)).toBe(0);
    expect(falloff(1e6, 0)).toBe(1);
  });

  it('panFor keeps sounds off the hard edges', () => {
    expect(panFor(0)).toBe(0);
    expect(panFor(1)).toBe(0.7);
    expect(panFor(-3)).toBe(-0.7);
  });

  it('pitchFor stays within the spread', () => {
    expect(pitchFor(0.1, () => 0)).toBeCloseTo(0.9);
    expect(pitchFor(0.1, () => 0.5)).toBe(1);
    expect(pitchFor(0.1, () => 1)).toBeCloseTo(1.1);
  });
});

describe('VoicePool', () => {
  it('never holds more than the cap per key, nor MAX_VOICES in all', () => {
    const pool = new VoicePool<number>();
    const cannons: number[] = [];
    for (let i = 0; i < 10; i++) {
      const cut = pool.admit('cannon', 8, i);
      cannons.push(i);
      if (i < 8) expect(cut).toEqual([]);
      else expect(cut).toEqual([i - 8]);
      expect(pool.size).toBe(Math.min(i + 1, 8));
    }
    // 2..9 are live cannons; 30 more under distinct keys
    const live = [2, 3, 4, 5, 6, 7, 8, 9];
    for (let i = 100; i < 130; i++) {
      const cut = pool.admit(`k${i}`, 4, i);
      live.push(i);
      if (live.length > MAX_VOICES) {
        expect(cut).toEqual([live[0]]);
        live.shift();
      } else expect(cut).toEqual([]);
      expect(pool.size).toBeLessThanOrEqual(MAX_VOICES);
    }
    expect(pool.size).toBe(MAX_VOICES);
  });

  it("release frees a voice's slot", () => {
    const pool = new VoicePool<string>(2);
    pool.admit('a', 1, 'x');
    pool.release('x');
    expect(pool.size).toBe(0);
    expect(pool.admit('a', 1, 'y')).toEqual([]);
  });
});
