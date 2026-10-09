/** The mixing rules for sound effects: which take, how loud, where in the stereo field, how many at once. */

/** Most voices sounding at once; past this the oldest is cut. */
export const MAX_VOICES = 24;

/** Which of `count` takes to play: random, but never `last` again when there is a choice. -1 when there are none. */
export function pickVariant(count: number, last: number, random: () => number): number {
  if (count <= 0) return -1;
  if (count === 1) return 0;
  const n = Math.min(count - 2, Math.floor(random() * (count - 1)));
  return last >= 0 && last < count && n >= last ? n + 1 : n;
}

/** Loudness from 1 at the focus to 0 at `reach`, quadratic between. A reach of 0 is heard everywhere. */
export function falloff(distance: number, reach: number): number {
  if (reach <= 0) return 1;
  if (distance >= reach) return 0;
  const k = 1 - Math.max(0, distance) / reach;
  return k * k;
}

/** Stereo pan for a screen position (-1 left edge, 1 right edge), kept off the hard edges. */
export function panFor(ndcX: number): number {
  return Math.max(-1, Math.min(1, ndcX)) * 0.7;
}

/** A playback rate within 1 ± `spread`. */
export function pitchFor(spread: number, random: () => number): number {
  return 1 + (random() * 2 - 1) * spread;
}

/** The voices sounding now, oldest first, held to a cap per key and to `max` in all. */
export class VoicePool<V> {
  private readonly voices: { key: string; voice: V }[] = [];

  constructor(private readonly max = MAX_VOICES) {}

  /** Add a voice, returning those to cut to make room: the oldest of its key at the cap, then the oldest overall at the maximum. */
  admit(key: string, cap: number, voice: V): V[] {
    const cut: V[] = [];
    const take = (i: number) => cut.push(this.voices.splice(i, 1)[0].voice);
    if (this.voices.filter((v) => v.key === key).length >= cap) take(this.voices.findIndex((v) => v.key === key));
    if (this.voices.length >= this.max) take(0);
    this.voices.push({ key, voice });
    return cut;
  }

  /** The voice has finished (or been cut); free its slot. */
  release(voice: V): void {
    const i = this.voices.findIndex((v) => v.voice === voice);
    if (i >= 0) this.voices.splice(i, 1);
  }

  get size(): number {
    return this.voices.length;
  }
}
