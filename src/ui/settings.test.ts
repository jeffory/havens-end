import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSettings } from './settings';

/** A localStorage holding the given settings. */
function stored(settings: object): void {
  const items = new Map<string, string>([['havens-end-settings', JSON.stringify(settings)]]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the settings', () => {
  it('loadSettings keeps a stored effectsVolume from the choices and defaults to 0.75 otherwise', () => {
    stored({ effectsVolume: 0.25 });
    expect(loadSettings().effectsVolume).toBe(0.25);
    stored({ effectsVolume: 0 });
    expect(loadSettings().effectsVolume).toBe(0);
    stored({ effectsVolume: 0.3 });
    expect(loadSettings().effectsVolume).toBe(0.75);
    stored({});
    expect(loadSettings().effectsVolume).toBe(0.75);
  });
});
