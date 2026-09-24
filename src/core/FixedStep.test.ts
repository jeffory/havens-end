import { describe, expect, it } from 'vitest';
import { FixedStep } from './FixedStep';

describe('FixedStep', () => {
  it('runs whole steps and carries the remainder as the interpolation alpha', () => {
    const clock = new FixedStep(0.1);
    const first = clock.advance(0.25);
    expect(first.steps).toBe(2);
    expect(first.alpha).toBeCloseTo(0.5);

    const second = clock.advance(0.06);
    expect(second.steps).toBe(1);
    expect(second.alpha).toBeCloseTo(0.1);
  });

  it('runs zero steps on frames shorter than one tick', () => {
    const clock = new FixedStep(0.1);
    expect(clock.advance(0.04).steps).toBe(0);
    expect(clock.advance(0.04).steps).toBe(0);
    expect(clock.advance(0.04).steps).toBe(1);
  });

  it('clamps long frames (tab switch, breakpoint) so the sim cannot spiral', () => {
    const clock = new FixedStep(0.1, 0.25);
    expect(clock.advance(30).steps).toBe(2);
  });

  it('ignores negative frame times', () => {
    const clock = new FixedStep(0.1);
    expect(clock.advance(-5)).toEqual({ steps: 0, alpha: 0 });
  });
});
