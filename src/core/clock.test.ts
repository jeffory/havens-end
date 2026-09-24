import { describe, expect, it } from 'vitest';
import { advanceClock, clockText, createClock, darkness, DAYLIGHT, hourOf, isNight, partOfDay, phaseOf, secondsUntil, sunHeight, WAKE_AT } from './clock';

describe('clock', () => {
  it('starts in the morning of day 1', () => {
    const c = createClock();
    expect(c.day).toBe(1);
    expect(partOfDay(c.phase)).toBe('dawn');
    expect(isNight(c.phase)).toBe(false);
    expect(c.length).toBe(12 * 60);
  });

  it('counts a new day at each sunrise', () => {
    const c = createClock(12);
    expect(advanceClock(c, 12 * 60 * (1 - c.phase) - 1)).toBe(0);
    expect(c.day).toBe(1);
    expect(advanceClock(c, 2)).toBe(1);
    expect(c.day).toBe(2);
    expect(advanceClock(c, 12 * 60 * 3)).toBe(3);
    expect(c.day).toBe(5);
  });

  it('keeps its place when the day length changes', () => {
    const c = createClock(12);
    advanceClock(c, 100);
    const phase = c.phase;
    c.length = 30 * 60;
    expect(c.phase).toBe(phase);
    advanceClock(c, 30 * 60);
    expect(c.phase).toBeCloseTo(phase);
  });

  it('runs 06:00 to 19:00 by daylight, and the rest by night', () => {
    expect(hourOf(0)).toBeCloseTo(6);
    expect(hourOf(DAYLIGHT)).toBeCloseTo(19);
    expect(hourOf(0.999)).toBeGreaterThan(5.9);
    for (const h of [0, 3, 6.5, 12, 18.9, 19.5, 23.99]) expect(hourOf(phaseOf(h))).toBeCloseTo(h);
    expect(clockText(phaseOf(14.1))).toBe('14:06');
  });

  it('is dark from dusk until dawn', () => {
    expect(sunHeight(DAYLIGHT / 2)).toBeCloseTo(1);
    expect(sunHeight((1 + DAYLIGHT) / 2)).toBeCloseTo(-1);
    expect(darkness(DAYLIGHT / 2)).toBe(0);
    expect(darkness((1 + DAYLIGHT) / 2)).toBe(1);
    expect(isNight(phaseOf(12))).toBe(false);
    expect(isNight(phaseOf(18))).toBe(false);
    expect(isNight(phaseOf(20))).toBe(true);
    expect(isNight(phaseOf(3))).toBe(true);
    expect(isNight(WAKE_AT.morning)).toBe(false);
    expect(isNight(WAKE_AT.dusk)).toBe(true);
  });

  it('knows how long until a given time', () => {
    const c = createClock(12);
    c.phase = 0.5;
    expect(secondsUntil(c, 0.75)).toBeCloseTo(0.25 * 720);
    expect(secondsUntil(c, 0.25)).toBeCloseTo(0.75 * 720);
  });
});
