import { playWhenAllowed, type Speaker, whenHidden } from './speaker';
import type { Track } from './tracks';

/** Seconds to fade in (a fight starts at once), and out. */
const FADE_IN = 1;
const FADE_OUT = 3;
/** Seconds the end of the track and its start overlap as it comes round. */
export const OVERLAP = 2;

/**
 * One tune round and round with no gap while it's wanted: the fight music. Two speakers
 * take turns, the next starting from the top as the last nears its end, so the loop
 * crossfades instead of stopping. It starts from the top each time it's wanted again
 * after falling silent.
 */
export class LoopPlayer {
  /** How loud, 0 to 1 (the player's setting). */
  volume = 0.5;
  /** Which speaker carries the tune; the other rings out the last time round. */
  private lead = 0;
  /** Where the fade stands: 0 silent, 1 full. */
  private level = 0;
  /** The crossfade as it comes round: 1 when it starts, 0 when done. */
  private crossfade = 0;
  private playing = false;
  /** The browser refused to play: wait for the player to press something. */
  private blocked = false;

  constructor(
    private readonly track: Track,
    private readonly speakers: readonly [Speaker, Speaker] = [new Audio(), new Audio()],
  ) {
    whenHidden(() => {
      if (this.playing) this.stop();
    });
  }

  /** Once a frame: `wanted` when the tune should be heard now. */
  update(wanted: boolean, dt: number): void {
    if (wanted) {
      if (!this.playing && !this.blocked) this.play(this.lead);
      this.level = Math.min(1, this.level + dt / FADE_IN);
      const lead = this.speakers[this.lead];
      if (this.playing && lead.currentTime >= lead.duration - OVERLAP) this.comeRound();
    } else {
      this.level = Math.max(0, this.level - dt / FADE_OUT);
      if (this.level === 0 && this.playing) this.stop();
    }
    const other = this.speakers[1 - this.lead];
    if (this.crossfade > 0) {
      this.crossfade = Math.max(0, this.crossfade - dt / OVERLAP);
      if (this.crossfade === 0) other.pause();
    }
    // Loudness is heard roughly as the square of the level.
    const loudness = this.volume * this.level * this.level;
    this.speakers[this.lead].volume = loudness * (1 - this.crossfade);
    other.volume = loudness * this.crossfade;
  }

  /** The other speaker takes it up from the top; the old end rings out under it. */
  private comeRound(): void {
    this.lead = 1 - this.lead;
    this.crossfade = 1;
    this.play(this.lead);
  }

  private play(which: number): void {
    const speaker = this.speakers[which];
    // Loaded on first play, not before: nobody downloads the fight music until a fight.
    if (!speaker.src) speaker.src = this.track.url;
    speaker.currentTime = 0;
    this.playing = true;
    playWhenAllowed(
      speaker,
      () => {
        this.playing = false;
        this.blocked = true;
      },
      () => (this.blocked = false),
    );
  }

  /** Silent: both speakers stopped, the next time from the top. */
  private stop(): void {
    for (const s of this.speakers) s.pause();
    this.playing = false;
    this.level = 0;
    this.crossfade = 0;
  }
}
