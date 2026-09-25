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

  it('has the crew strike up a shanty (or fall quiet) on the right stick’s click, at sea only', () => {
    expect(readPad(pad(undefined, [PAD.RS]), new Set()).actions).toEqual(['shanty']);
    expect(readPad(pad(undefined, [PAD.RS]), new Set(), 'foot').actions).toEqual([]);
  });

  it('reports a button as an action only on the frame it goes down', () => {
    const first = readPad(pad(undefined, [PAD.UP, PAD.RB]), new Set());
    expect(first.actions.sort()).toEqual(['rotateRight', 'sailUp']);
    const held = readPad(pad(undefined, [PAD.UP, PAD.RB]), first.pressed);
    expect(held.actions).toEqual([]);
  });

  it('fires port and starboard broadsides with the triggers', () => {
    expect(readPad(pad(undefined, [PAD.LT]), new Set()).actions).toEqual(['firePort']);
    expect(readPad(pad(undefined, [PAD.RT]), new Set()).actions).toEqual(['fireStarboard']);
    expect(readPad(pad(undefined, [PAD.B, PAD.X]), new Set()).actions.sort()).toEqual(['ammoNext', 'board']);
  });

  it('maps face buttons to the sails', () => {
    expect(readPad(pad(undefined, [PAD.Y]), new Set()).actions).toEqual(['sailUp']);
    expect(readPad(pad(undefined, [PAD.A]), new Set()).actions).toEqual(['sailDown']);
  });
});

describe('readPad in a duel', () => {
  it('maps the face buttons to sword work', () => {
    expect(readPad(pad(undefined, [PAD.X]), new Set(), 'duel').actions).toEqual(['light']);
    expect(readPad(pad(undefined, [PAD.Y]), new Set(), 'duel').actions).toEqual(['heavy']);
    expect(readPad(pad(undefined, [PAD.A]), new Set(), 'duel').actions).toEqual(['roll']);
    expect(readPad(pad(undefined, [PAD.B]), new Set(), 'duel').actions).toEqual(['kick']);
    expect(readPad(pad(undefined, [PAD.RB]), new Set(), 'duel').actions).toEqual(['thrust']);
  });

  it('holds the guard up on either left shoulder button', () => {
    expect(readPad(pad(undefined, [PAD.LB]), new Set(), 'duel').block).toBe(true);
    expect(readPad(pad(undefined, [PAD.LT]), new Set(), 'duel').block).toBe(true);
    expect(readPad(pad(), new Set(), 'duel').block).toBe(false);
  });
});

describe('readPad in menus', () => {
  it('maps the face buttons, shoulders and d-pad to menu actions', () => {
    const read = (pressed: number[]) => readPad(pad([0, 0, 0, 0], pressed), new Set(), 'menu').actions;
    expect(read([PAD.A])).toEqual(['confirm']);
    expect(read([PAD.B])).toEqual(['back']);
    expect(read([PAD.RB])).toEqual(['tabNext']);
    expect(read([PAD.DOWN])).toEqual(['navDown']);
    expect(read([PAD.BACK])).toEqual(['chart']);
  });

  it('turns a pushed stick into a direction, and a resting one into none', () => {
    expect(readPad(pad([0, 0.9, 0, 0]), new Set(), 'menu').stickNav).toBe('navDown');
    expect(readPad(pad([-0.8, 0.2, 0, 0]), new Set(), 'menu').stickNav).toBe('navLeft');
    expect(readPad(pad([0.2, -0.3, 0, 0]), new Set(), 'menu').stickNav).toBeNull();
  });
});

describe('readPad on foot', () => {
  it('walks with the stick as a direction and works with the face buttons', () => {
    const state = readPad(pad([0, -1, 0, 0], [PAD.A, PAD.X]), new Set(), 'foot');
    expect(state.walkX).toBeCloseTo(0);
    expect(state.walkY).toBeCloseTo(1); // stick pushed up walks up the screen
    expect(state.actions).toEqual(['interact', 'use']);
    const diagonal = readPad(pad([0.7, 0.7, 0, 0]), new Set(), 'foot');
    expect(Math.hypot(diagonal.walkX, diagonal.walkY)).toBeCloseTo(1, 1);
    expect(readPad(pad([0.1, 0.1, 0, 0]), new Set(), 'foot').walkX).toBe(0);
  });
});
