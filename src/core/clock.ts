/**
 * Time of day. A day runs from one sunrise to the next: `phase` 0 is sunrise, DAYLIGHT
 * is sunset, and the rest is night. The clock is simulation state (it's saved and only
 * moves with the fixed step); how many real seconds a day takes is a player setting.
 */
export interface Clock {
  /** Days since the game began, counting from 1. */
  day: number;
  /** 0..1 through the day, from sunrise. */
  phase: number;
  /** Seconds a whole day and night take. */
  length: number;
}

/** Share of the day the sun is up: 13 of 24 hours, from 06:00 to 19:00. */
export const DAYLIGHT = 0.65;
export const DEFAULT_DAY_MINUTES = 12;
export const DAY_MINUTE_CHOICES: readonly number[] = [6, 12, 20, 30, 60];
const SUNRISE_HOUR = 6;
const SUNSET_HOUR = 19;
/** A new game starts a little after sunrise (about 07:00). */
const START_PHASE = 0.05;

export function createClock(dayMinutes = DEFAULT_DAY_MINUTES): Clock {
  return { day: 1, phase: START_PHASE, length: dayMinutes * 60 };
}

/** Moves the clock on; returns how many sunrises were passed (a new day each). */
export function advanceClock(clock: Clock, seconds: number): number {
  const phase = clock.phase + seconds / clock.length;
  const days = Math.floor(phase);
  clock.phase = phase - days;
  clock.day += days;
  return days;
}

/** Seconds until the clock next reads `phase`. */
export function secondsUntil(clock: Clock, phase: number): number {
  const ahead = (phase - clock.phase + 1) % 1;
  return ahead * clock.length;
}

/**
 * How high the sun is: 0 at sunrise and sunset, 1 at noon; below zero at night, down to
 * -1 at midnight (the moon's hours).
 */
export function sunHeight(phase: number): number {
  return phase < DAYLIGHT ? Math.sin((Math.PI * phase) / DAYLIGHT) : -Math.sin((Math.PI * (phase - DAYLIGHT)) / (1 - DAYLIGHT));
}

/** 0 in daylight, 1 in the dark, easing through dusk and dawn. */
export function darkness(phase: number): number {
  const h = sunHeight(phase);
  const t = Math.min(1, Math.max(0, (0.22 - h) / 0.4));
  return t * t * (3 - 2 * t);
}

/** Night proper: settlers are abed, creatures are out, pirates prowl. */
export const isNight = (phase: number): boolean => darkness(phase) > 0.5;

/** The hour on a 24-hour clock (fractional). Night hours pass quicker than daylight ones. */
export function hourOf(phase: number): number {
  const hour =
    phase < DAYLIGHT
      ? SUNRISE_HOUR + (phase / DAYLIGHT) * (SUNSET_HOUR - SUNRISE_HOUR)
      : SUNSET_HOUR + ((phase - DAYLIGHT) / (1 - DAYLIGHT)) * (24 - SUNSET_HOUR + SUNRISE_HOUR);
  return hour % 24;
}

/** The phase at which the clock reads `hour`. */
export function phaseOf(hour: number): number {
  const h = (((hour - SUNRISE_HOUR) % 24) + 24) % 24; // hours since sunrise
  const day = SUNSET_HOUR - SUNRISE_HOUR;
  return h <= day ? (h / day) * DAYLIGHT : DAYLIGHT + ((h - day) / (24 - day)) * (1 - DAYLIGHT);
}

/** "14:05". */
export function clockText(phase: number): string {
  const minutes = Math.floor(hourOf(phase) * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export type PartOfDay = 'dawn' | 'morning' | 'afternoon' | 'evening' | 'night';

export function partOfDay(phase: number): PartOfDay {
  const hour = hourOf(phase);
  if (isNight(phase)) return 'night';
  if (hour < 7.5) return 'dawn';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

/** When a sleeper wakes: morning (07:00), or dusk for anyone waiting for the dark. */
export const WAKE_AT = { morning: phaseOf(7), dusk: phaseOf(19.5) } as const;
