import { describe, expect, it } from 'vitest';
import { SHANTIES, titleOf } from './shanties';
import { BETWEEN, ShantyPlayer, type Speaker } from './ShantyPlayer';

/** An <audio> element that only remembers what it was told. */
function speaker(refuse = false) {
  const log: string[] = [];
  const s: Speaker & { log: string[] } = {
    src: '',
    volume: 1,
    onended: null,
    log,
    play: () => {
      log.push(`play ${s.src}`);
      return refuse ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve();
    },
    pause: () => void log.push('pause'),
  };
  return s;
}

const TRACKS = [
  { url: 'a.mp3', title: 'A' },
  { url: 'b.mp3', title: 'B' },
  { url: 'c.mp3', title: 'C' },
];

describe('sea shanties', () => {
  it('are found in the shanties folder, titled from their file names', () => {
    expect(SHANTIES.map((t) => t.title)).toContain('Haul Away to Haven');
    expect(titleOf('../assets/music/shanties/03-the-drunken_sailor.mp3')).toBe('The Drunken Sailor');
    expect(titleOf('leave-her-johnny.MP3')).toBe('Leave Her Johnny');
  });

  it('stay quiet until wanted, then fade in', () => {
    const s = speaker();
    const player = new ShantyPlayer(TRACKS, s);
    player.update(false, 1);
    expect(s.log).toEqual([]);
    player.update(true, 0.5);
    expect(s.log).toHaveLength(1);
    const early = s.volume;
    player.update(true, 3);
    expect(s.volume).toBeGreaterThan(early);
    expect(s.volume).toBeCloseTo(player.volume);
  });

  it('fade out and pause ashore, then pick up the same song again', () => {
    const s = speaker();
    const player = new ShantyPlayer(TRACKS, s);
    const named: string[] = [];
    player.onTrack = (t) => named.push(t.title);
    player.update(true, 3);
    const song = player.track;
    player.update(false, 1);
    expect(s.log).not.toContain('pause'); // still fading
    player.update(false, 1);
    expect(s.log).toContain('pause');
    player.update(true, 0.1);
    expect(player.track).toBe(song);
    expect(s.log.at(-1)).toBe(`play ${song!.url}`);
    expect(named).toHaveLength(1); // named once, not again on resuming
  });

  it('go round every song, never the same twice running, with a pause between', () => {
    const s = speaker();
    const player = new ShantyPlayer(TRACKS, s, () => 0.3);
    const played: string[] = [];
    player.onTrack = (t) => played.push(t.title);
    player.update(true, 1);
    for (let i = 0; i < 8; i++) {
      s.onended!(new Event('ended'));
      player.update(true, BETWEEN / 2);
      expect(played).toHaveLength(i + 1); // still quiet between songs
      player.update(true, BETWEEN / 2 + 0.1);
    }
    expect(new Set(played.slice(0, 3)).size).toBe(3);
    for (let i = 1; i < played.length; i++) expect(played[i]).not.toBe(played[i - 1]);
  });

  it('start a fresh song when the crew strikes up again, not the one they stopped', () => {
    const s = speaker();
    const player = new ShantyPlayer(TRACKS, s, () => 0.3);
    const named: string[] = [];
    player.onTrack = (t) => named.push(t.title);
    player.update(true, 3);
    player.update(false, 2); // they fall quiet
    player.strikeUp();
    player.update(true, 0.1);
    expect(named).toHaveLength(2);
    expect(named[1]).not.toBe(named[0]);
  });

  it('wait for a press when the browser won’t play yet', async () => {
    const s = speaker(true);
    const player = new ShantyPlayer(TRACKS, s);
    player.update(true, 1);
    await Promise.resolve();
    player.update(true, 1);
    expect(s.log.filter((l) => l.startsWith('play'))).toHaveLength(1); // no retry until something is pressed
  });
});
