import type { Track } from './shanties';

/** What the player needs of an <audio> element (a fake one in tests). */
export interface Speaker {
  src: string;
  volume: number;
  play(): Promise<void>;
  pause(): void;
  onended: ((ev: Event) => void) | null;
}

/** Seconds to fade a shanty in, and out. */
const FADE_IN = 2;
const FADE_OUT = 1.5;
/** Seconds of quiet between one shanty and the next. */
export const BETWEEN = 12;

/**
 * Sea shanties while sailing, if the player wants them: a shuffled round of the tracks,
 * a pause between songs, fading out when you go ashore, duel or sleep and picking up
 * where it left off. Browsers won't play sound before the player has pressed or clicked
 * something; until then it waits, and tries again on the first press.
 */
export class ShantyPlayer {
  /** How loud, 0 to 1 (the player's setting). */
  volume = 0.5;
  /** Told when a shanty starts, to name it. */
  onTrack: ((track: Track) => void) | null = null;
  private readonly speaker: Speaker;
  private order: number[] = [];
  private current: Track | null = null;
  /** Where the fade stands: 0 silent, 1 full. */
  private level = 0;
  private playing = false;
  /** Seconds of quiet left before the next shanty (after one ends). */
  private gap = 0;
  /** The browser refused to play: wait for the player to press something. */
  private blocked = false;

  constructor(
    private readonly tracks: readonly Track[],
    speaker?: Speaker,
    private readonly random: () => number = Math.random,
  ) {
    this.speaker = speaker ?? new Audio();
    this.speaker.onended = () => {
      this.playing = false;
      this.current = null;
      this.gap = BETWEEN;
    };
    // A hidden tab stops the frames that would fade it out: hush at once.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden || !this.playing) return;
        this.speaker.pause();
        this.playing = false;
        this.level = 0;
      });
    }
  }

  /**
   * The crew strikes up: a fresh shanty from the start (the next in the round), not the
   * one they left off. (Hushed by going ashore, they pick up where they were instead.)
   */
  strikeUp(): void {
    if (this.playing) this.speaker.pause();
    this.playing = false;
    this.current = null;
    this.gap = 0;
    this.level = 0;
  }

  /** The shanty playing (or paused mid-song), if any. */
  get track(): Track | null {
    return this.current;
  }

  /** Once a frame: `wanted` when shanties should be heard now (on, and sailing). */
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

  /** Plays the current shanty (resuming it), or the next in the round. */
  private start(): void {
    if (!this.current) {
      this.current = this.tracks[this.next()];
      this.speaker.src = this.current.url;
      this.onTrack?.(this.current);
    }
    this.playing = true;
    this.speaker.play().catch(() => {
      // Not allowed yet (no press or click so far): try again after the next one.
      this.playing = false;
      this.blocked = true;
      if (typeof window === 'undefined') return;
      const retry = () => {
        this.blocked = false;
        window.removeEventListener('pointerdown', retry);
        window.removeEventListener('keydown', retry);
      };
      window.addEventListener('pointerdown', retry);
      window.addEventListener('keydown', retry);
    });
  }

  /** The next shanty: a shuffled round, never the same one twice running. */
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
