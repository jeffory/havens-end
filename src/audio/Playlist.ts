import { playWhenAllowed, type Speaker, whenHidden } from './speaker';
import type { Track } from './tracks';

/** Seconds to fade a song in, and out. */
const FADE_IN = 2;
const FADE_OUT = 1.5;
/** Seconds of quiet between one song and the next, unless told otherwise. */
export const BETWEEN = 12;

export interface PlaylistOptions {
  speaker?: Speaker;
  random?: () => number;
  /** Seconds of quiet between songs. */
  between?: number;
}

/**
 * Songs while they're wanted: a shuffled round of the tracks (or one tune, over and
 * over), a pause between them, fading out when no longer wanted and picking up where it
 * left off. The shanties at sea, and the tune ashore. Until the browser allows sound (the
 * player's first press or click), it waits.
 */
export class Playlist {
  /** How loud, 0 to 1 (the player's setting). */
  volume = 0.5;
  /** Told when a song starts, to name it. */
  onTrack: ((track: Track) => void) | null = null;
  private readonly speaker: Speaker;
  private readonly random: () => number;
  private readonly between: number;
  private order: number[] = [];
  private current: Track | null = null;
  /** Where the fade stands: 0 silent, 1 full. */
  private level = 0;
  private playing = false;
  /** Seconds of quiet left before the next song (after one ends). */
  private gap = 0;
  /** The browser refused to play: wait for the player to press something. */
  private blocked = false;

  constructor(private readonly tracks: readonly Track[], options: PlaylistOptions = {}) {
    this.speaker = options.speaker ?? new Audio();
    this.random = options.random ?? Math.random;
    this.between = options.between ?? BETWEEN;
    this.speaker.onended = () => {
      this.playing = false;
      this.current = null;
      this.gap = this.between;
    };
    whenHidden(() => {
      if (!this.playing) return;
      this.speaker.pause();
      this.playing = false;
      this.level = 0;
    });
  }

  /**
   * A fresh song from the start (the next in the round), not the one left off. (When
   * it's only no longer wanted, it picks up where it was instead.)
   */
  restart(): void {
    if (this.playing) this.speaker.pause();
    this.playing = false;
    this.current = null;
    this.gap = 0;
    this.level = 0;
  }

  /** The song playing (or paused mid-song), if any. */
  get track(): Track | null {
    return this.current;
  }

  /** Once a frame: `wanted` when the songs should be heard now. */
  update(wanted: boolean, dt: number): void {
    const on = wanted && this.tracks.length > 0;
    if (on) {
      if (this.gap > 0) this.gap -= dt;
      if (this.gap <= 0 && !this.playing && !this.blocked) this.start();
      this.level = Math.min(1, this.level + dt / FADE_IN);
    } else {
      this.level = Math.max(0, this.level - dt / FADE_OUT);
      if (this.level === 0 && this.playing) {
        this.speaker.pause();
        this.playing = false;
      }
    }
    // Loudness is heard roughly as the square of the level.
    this.speaker.volume = this.volume * this.level * this.level;
  }

  /** Plays the current song (resuming it), or the next in the round. */
  private start(): void {
    if (!this.current) {
      this.current = this.tracks[this.next()];
      this.speaker.src = this.current.url;
      this.onTrack?.(this.current);
    }
    this.playing = true;
    playWhenAllowed(
      this.speaker,
      () => {
        this.playing = false;
        this.blocked = true;
      },
      () => (this.blocked = false),
    );
  }

  /** The next song: a shuffled round, never the same one twice running. */
  private next(): number {
    if (this.order.length === 0) {
      const last = this.current ? this.tracks.indexOf(this.current) : -1;
      this.order = shuffle(this.tracks.map((_, i) => i), this.random);
      if (this.order.length > 1 && this.order[0] === last) this.order.push(this.order.shift()!);
    }
    return this.order.shift()!;
  }
}

function shuffle<T>(list: T[], random: () => number): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
