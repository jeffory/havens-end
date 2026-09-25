/** What the music needs of an <audio> element (a fake one in tests). */
export interface Speaker {
  src: string;
  volume: number;
  /** Seconds into the track. */
  currentTime: number;
  /** The track's length in seconds (NaN until it's known). */
  readonly duration: number;
  play(): Promise<void>;
  pause(): void;
  onended: ((ev: Event) => void) | null;
}

/**
 * Plays. Browsers won't play sound before the player has pressed or clicked something:
 * then `refused` is called at once, and `allowed` after the next press or click.
 */
export function playWhenAllowed(speaker: Speaker, refused: () => void, allowed: () => void): void {
  speaker.play().catch(() => {
    refused();
    if (typeof window === 'undefined') return;
    const retry = () => {
      allowed();
      window.removeEventListener('pointerdown', retry);
      window.removeEventListener('keydown', retry);
    };
    window.addEventListener('pointerdown', retry);
    window.addEventListener('keydown', retry);
  });
}

/** Calls `hush` when the tab is hidden: its frames stop, so nothing could fade out. */
export function whenHidden(hush: () => void): void {
  if (typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hush();
  });
}
