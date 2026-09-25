import { describe, expect, it } from 'vitest';
import { LoopPlayer, OVERLAP } from './LoopPlayer';
import { BETWEEN, Playlist } from './Playlist';
import type { Speaker } from './speaker';
import { LINGER, type Moment, Soundtrack } from './Soundtrack';
import { ASHORE, BROADSIDES, SHANTIES, titleOf } from './tracks';

/** An <audio> element that only remembers what it was told, and plays when told to. */
function speaker(refuse = false) {
  const log: string[] = [];
  const s: Speaker & { log: string[]; playing: boolean } = {
    src: '',
    volume: 1,
    currentTime: 0,
    duration: 100,
    onended: null,
    log,
    playing: false,
    play: () => {
      log.push(`play ${s.src}`);
      if (refuse) return Promise.reject(new Error('NotAllowedError'));
      s.playing = true;
      return Promise.resolve();
    },
    pause: () => {
      log.push('pause');
      s.playing = false;
    },
  };
  return s;
}

const TRACKS = [
  { url: 'a.mp3', title: 'A' },
  { url: 'b.mp3', title: 'B' },
  { url: 'c.mp3', title: 'C' },
];

describe('the music', () => {
  it('is the shanties in their folder, titled from their file names, and a tune each for land and fights', () => {
    expect(SHANTIES.map((t) => t.title)).toContain('Haul Away to Haven');
    expect(titleOf('../assets/music/shanties/03-the-drunken_sailor.mp3')).toBe('The Drunken Sailor');
    expect(titleOf('leave-her-johnny.MP3')).toBe('Leave Her Johnny');
    expect(ASHORE.url).toMatch(/ashore/);
    expect(BROADSIDES.url).toMatch(/broadsides/);
  });
});

describe('a playlist (the shanties, or the tune ashore)', () => {
  it('stays quiet until wanted, then fades in', () => {
    const s = speaker();
    const player = new Playlist(TRACKS, { speaker: s });
    player.update(false, 1);
    expect(s.log).toEqual([]);
    player.update(true, 0.5);
    expect(s.log).toHaveLength(1);
    const early = s.volume;
    player.update(true, 3);
    expect(s.volume).toBeGreaterThan(early);
    expect(s.volume).toBeCloseTo(player.volume);
  });

  it('fades out and pauses when no longer wanted, then picks up the same song again', () => {
    const s = speaker();
    const player = new Playlist(TRACKS, { speaker: s });
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

  it('goes round every song, never the same twice running, with a pause between', () => {
    const s = speaker();
    const player = new Playlist(TRACKS, { speaker: s, random: () => 0.3 });
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

  it('plays a single tune again after its own pause', () => {
    const s = speaker();
    const player = new Playlist([ASHORE], { speaker: s, between: 30 });
    player.update(true, 1);
    s.onended!(new Event('ended'));
    player.update(true, 20);
    expect(s.log.filter((l) => l.startsWith('play'))).toHaveLength(1);
    player.update(true, 11);
    expect(s.log.filter((l) => l.startsWith('play'))).toHaveLength(2);
  });

  it('starts a fresh song when restarted, not the one it stopped', () => {
    const s = speaker();
    const player = new Playlist(TRACKS, { speaker: s, random: () => 0.3 });
    const named: string[] = [];
    player.onTrack = (t) => named.push(t.title);
    player.update(true, 3);
    player.update(false, 2); // the crew falls quiet
    player.restart();
    player.update(true, 0.1);
    expect(named).toHaveLength(2);
    expect(named[1]).not.toBe(named[0]);
  });

  it('waits for a press when the browser won’t play yet', async () => {
    const s = speaker(true);
    const player = new Playlist(TRACKS, { speaker: s });
    player.update(true, 1);
    await Promise.resolve();
    player.update(true, 1);
    expect(s.log.filter((l) => l.startsWith('play'))).toHaveLength(1); // no retry until something is pressed
  });
});

describe('a loop (the fight music)', () => {
  it('starts from the top and fades in when wanted', () => {
    const [a, b] = [speaker(), speaker()];
    const loop = new LoopPlayer(BROADSIDES, [a, b]);
    loop.update(false, 1);
    expect(a.log).toEqual([]);
    loop.update(true, 0.1);
    expect(a.log).toEqual([`play ${BROADSIDES.url}`]);
    expect(a.currentTime).toBe(0);
    loop.update(true, 2);
    expect(a.volume).toBeCloseTo(loop.volume);
  });

  it('comes round without a gap: the other speaker takes it up from the top as the end nears', () => {
    const [a, b] = [speaker(), speaker()];
    const loop = new LoopPlayer(BROADSIDES, [a, b]);
    loop.update(true, 2);
    a.currentTime = a.duration - OVERLAP - 1;
    loop.update(true, 0.1);
    expect(b.playing).toBe(false);
    a.currentTime = a.duration - OVERLAP + 0.01;
    loop.update(true, 0.1);
    expect(b.playing).toBe(true);
    expect(b.currentTime).toBe(0);
    expect(a.playing).toBe(true); // the old end rings on under the new start
    loop.update(true, OVERLAP);
    expect(a.playing).toBe(false);
    expect(b.volume).toBeCloseTo(loop.volume);
    // And round again, back to the first.
    b.currentTime = b.duration - OVERLAP + 0.01;
    a.currentTime = 50;
    loop.update(true, 0.1);
    expect(a.playing).toBe(true);
    expect(a.currentTime).toBe(0);
  });

  it('fades out when no longer wanted, and starts from the top the next time', () => {
    const [a, b] = [speaker(), speaker()];
    const loop = new LoopPlayer(BROADSIDES, [a, b]);
    loop.update(true, 2);
    a.currentTime = 40;
    loop.update(false, 1);
    expect(a.playing).toBe(true); // still fading
    loop.update(false, 5);
    expect(a.playing).toBe(false);
    loop.update(true, 0.1);
    expect(a.playing).toBe(true);
    expect(a.currentTime).toBe(0);
  });
});

describe('the soundtrack', () => {
  function soundtrack() {
    const parts = { shanties: speaker(), ashore: speaker(), battle: speaker(), battle2: speaker() };
    const made: string[] = [];
    const track = new Soundtrack((part) => {
      const name = part === 'battle' && made.includes('battle') ? 'battle2' : part;
      made.push(part);
      return parts[name];
    });
    const heard = () =>
      Object.entries(parts)
        .filter(([, s]) => s.playing && s.volume > 0.01)
        .map(([name]) => (name === 'battle2' ? 'battle' : name));
    const at = (moment: Partial<Moment>, seconds: number) => {
      for (let t = 0; t < seconds; t += 0.1) track.update({ where: 'sea', fighting: false, singing: false, ...moment }, 0.1);
    };
    return { track, parts, heard, at };
  }

  it('plays the tune ashore on land, and nothing at sea until the crew sings', () => {
    const { heard, at } = soundtrack();
    at({ where: 'land' }, 3);
    expect(heard()).toEqual(['ashore']);
    at({ where: 'sea' }, 3);
    expect(heard()).toEqual([]);
    at({ where: 'sea', singing: true }, 3);
    expect(heard()).toEqual(['shanties']);
  });

  it('drowns out the shanties in a fight, and lets them pick up again a little after it', () => {
    const { heard, at } = soundtrack();
    at({ singing: true }, 3);
    at({ singing: true, fighting: true }, 4);
    expect(heard()).toEqual(['battle']);
    at({ singing: true }, LINGER - 1);
    expect(heard()).toEqual(['battle']); // it plays on a while after the last shot
    at({ singing: true }, 6);
    expect(heard()).toEqual(['shanties']);
  });

  it('plays the fight music in a duel ashore, and nothing at all asleep', () => {
    const { heard, at } = soundtrack();
    at({ where: 'land', fighting: true }, 4);
    expect(heard()).toEqual(['battle']);
    at({ where: null }, 5);
    expect(heard()).toEqual([]);
  });

  it('sets every part’s volume at once, and plays nothing at all when it’s off', () => {
    const { track, parts, heard, at } = soundtrack();
    track.volume = 0.75;
    at({ where: 'land' }, 3);
    expect(parts.ashore.volume).toBeCloseTo(0.75);
    track.volume = 0;
    at({ where: 'land' }, 3);
    expect(heard()).toEqual([]);
    expect(parts.ashore.playing).toBe(false);
    at({ where: 'sea', fighting: true, singing: true }, 3);
    expect(parts.battle.log).toEqual([]); // not even fetched
  });
});
