import { DAY_MINUTE_CHOICES, DEFAULT_DAY_MINUTES } from '../core/clock';

/** The player's preferences: kept in this browser, the same for every saved game. */
export interface Settings {
  /** Real minutes a whole day and night take. */
  dayMinutes: number;
}

const KEY = 'havens-end-settings';
const DEFAULTS: Settings = { dayMinutes: DEFAULT_DAY_MINUTES };

export function loadSettings(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    const dayMinutes = DAY_MINUTE_CHOICES.includes(stored.dayMinutes ?? NaN) ? stored.dayMinutes! : DEFAULTS.dayMinutes;
    return { dayMinutes };
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
