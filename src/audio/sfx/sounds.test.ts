import { describe, expect, it } from 'vitest';
import { filesFrom, LOOP_IDS, SOUND_IDS, SOUNDS } from './sounds';

describe('the catalogue', () => {
  it('every sound has a prompt, a length ElevenLabs takes, and at least one take', () => {
    for (const [name, s] of Object.entries(SOUNDS)) {
      expect(s.prompt.length, name).toBeGreaterThan(20);
      expect(s.seconds, name).toBeGreaterThanOrEqual(0.5);
      expect(s.seconds, name).toBeLessThanOrEqual(30);
      expect(s.takes, name).toBeGreaterThanOrEqual(1);
    }
  });

  it('footsteps share the step group with a cap of 2, and cannon is capped at 8', () => {
    for (const id of SOUND_IDS.filter((i) => i.startsWith('step-'))) {
      expect(SOUNDS[id].group).toBe('step');
      expect(SOUNDS[id].cap).toBe(2);
    }
    expect(SOUNDS.cannon.cap).toBe(8);
  });

  it('loops are heard everywhere, once, and unshifted', () => {
    for (const id of LOOP_IDS) expect(SOUNDS[id]).toMatchObject({ loop: true, reach: 0, cap: 1, pitch: 0, volume: 1 });
  });

  it('files are matched to sounds by name and ordered by take', () => {
    const m = filesFrom({
      '../../assets/sfx/hull-hit-2.mp3': '/b.mp3',
      '../../assets/sfx/hull-hit-1.mp3': '/a.mp3',
      '../../assets/sfx/waves-1.mp3': '/w.mp3',
      '../../assets/sfx/stray.mp3': '/x.mp3',
    });
    expect(m.get('hull-hit')).toEqual(['/a.mp3', '/b.mp3']);
    expect(m.get('waves')).toEqual(['/w.mp3']);
    expect([...m.keys()]).not.toContain('stray');
  });

  it('takes sort numerically', () => {
    const m = filesFrom({
      '../../assets/sfx/cannon-10.mp3': '/10',
      '../../assets/sfx/cannon-2.mp3': '/2',
      '../../assets/sfx/cannon-1.mp3': '/1',
    });
    expect(m.get('cannon')).toEqual(['/1', '/2', '/10']);
  });

  it('a cannon is heard over the splash of its shot', () => {
    expect(SOUNDS.cannon.volume).toBeGreaterThan(SOUNDS.splash.volume * 2);
  });
});
