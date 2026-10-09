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

  it('hide a sign that would sit under the hotbar and the prompt over it, as if off the screen', () => {
    // On foot at 1280 × 800: the bottom band the hotbar, the pack and the prompt take.
    const band = { x0: 210, y0: 640, x1: 1070, y1: 786 };
    const under = (x: number, y: number) => labelFits(x, y, 80, 24, 1280, 800, band);
    expect(under(290, 730), 'behind the hotbar').toBe(false);
    expect(under(640, 655), 'its top under the prompt').toBe(false);
    expect(under(640, 638), 'just over the band').toBe(true);
    expect(under(120, 760), 'beside the band, low on the screen').toBe(true);
    expect(labelFits(290, 730, 80, 24, 1280, 800, null), 'no band: off foot').toBe(true);
  });
});
