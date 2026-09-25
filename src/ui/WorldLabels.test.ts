import { describe, expect, it } from 'vitest';
import { labelFits } from './WorldLabels';

describe('world labels', () => {
  // A sign 80 wide and 24 tall, hung by the middle of its foot, on a 1920 × 1080 screen.
  const fits = (x: number, y: number) => labelFits(x, y, 80, 24, 1920, 1080);

  it('show a sign that fits on screen whole', () => {
    expect(fits(960, 540)).toBe(true);
    expect(fits(60, 40)).toBe(true);
  });

  it('hide a sign cut off at any edge, rather than show part of it', () => {
    expect(fits(20, 540), 'left').toBe(false);
    expect(fits(1900, 540), 'right').toBe(false);
    expect(fits(960, 10), 'top').toBe(false);
    expect(fits(960, 1090), 'bottom').toBe(false);
  });
});
