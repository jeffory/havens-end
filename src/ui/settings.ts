import { DAY_MINUTE_CHOICES, DEFAULT_DAY_MINUTES } from '../core/clock';

/** The player's preferences: kept in this browser, the same for every saved game. */
export interface Settings {
  /** Real minutes a whole day and night take. */
  dayMinutes: number;
  /** The crew sings shanties while sailing (N at sea starts and stops them). */
  shanties: boolean;
  /** How loud the shanties are, 0 to 1. */
  musicVolume: number;
}

/** The volumes offered. */
export const VOLUME_CHOICES: readonly number[] = [0.25, 0.5, 0.75, 1];

const KEY = 'havens-end-settings';
const DEFAULTS: Settings = { dayMinutes: DEFAULT_DAY_MINUTES, shanties: false, musicVolume: 0.5 };

export function loadSettings(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    return {
      dayMinutes: DAY_MINUTE_CHOICES.includes(stored.dayMinutes ?? NaN) ? stored.dayMinutes! : DEFAULTS.dayMinutes,
      shanties: typeof stored.shanties === 'boolean' ? stored.shanties : DEFAULTS.shanties,
      musicVolume: VOLUME_CHOICES.includes(stored.musicVolume ?? NaN) ? stored.musicVolume! : DEFAULTS.musicVolume,
    };
  } catch {
    return { ...DEFAULTS }; // storage blocked (a private window): the defaults will do
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Nowhere to keep them: they last this session only.
  }
}
