import { describe, expect, it } from 'vitest';
import { PAD, readPad, type PadSnapshot } from './Controls';

function pad(axes: number[] = [0, 0, 0, 0], pressed: number[] = []): PadSnapshot {
  return { axes, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })) };
}

describe('readPad', () => {
  it('ignores stick drift inside the dead zone', () => {
    expect(readPad(pad([0.1, 0, 0, 0.12]), new Set()).rudder).toBe(0);
    expect(readPad(pad([0.1, 0, 0, 0.12]), new Set()).zoom).toBe(0);
  });

  it('steers with the left stick, full scale at full deflection', () => {
    expect(readPad(pad([1, 0, 0, 0]), new Set()).rudder).toBe(1);
    expect(readPad(pad([-1, 0, 0, 0]), new Set()).rudder).toBe(-1);
    const half = readPad(pad([0.6, 0, 0, 0]), new Set()).rudder;
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThan(0.6);
  });

  it('also steers with the d-pad', () => {
    expect(readPad(pad(undefined, [PAD.RIGHT]), new Set()).rudder).toBe(1);
  });

  it('reports a button as an action only on the frame it goes down', () => {
    const first = readPad(pad(undefined, [PAD.UP, PAD.RB]), new Set());
    expect(first.actions.sort()).toEqual(['rotateRight', 'sailUp']);
    const held = readPad(pad(undefined, [PAD.UP, PAD.RB]), first.pressed);
    expect(held.actions).toEqual([]);
  });

  it('maps face buttons to the sails', () => {
    expect(readPad(pad(undefined, [PAD.Y]), new Set()).actions).toEqual(['sailUp']);
    expect(readPad(pad(undefined, [PAD.A]), new Set()).actions).toEqual(['sailDown']);
  });
});
