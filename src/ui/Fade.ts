import type { Card } from './comeTo';

/** The fade to black and back, in ms (the `.sleep-fade` transition in style.css). */
const FADE_MS = 600;

/**
 * The screen fading to black and back: for sleep (a line while time passes) and for going
 * down (a card, held a few seconds; a key or a click skips it). What `work` does happens
 * in the dark, so the world can change unseen.
 */
export class Fade {
  private readonly el = document.createElement('div');
  private readonly title = document.createElement('h2');
  private readonly line = document.createElement('p');
  private phase: 'idle' | 'in' | 'dark' | 'out' = 'idle';

  constructor(parent: HTMLElement) {
    this.el.className = 'sleep-fade';
    this.el.append(this.title, this.line);
    parent.append(this.el);
  }

  /** Anywhere from starting to fade to having faded back in. */
  get active(): boolean {
    return this.phase !== 'idle';
  }

  /** Still going dark: nothing has changed yet. */
  get fadingIn(): boolean {
    return this.phase === 'in';
  }

  /**
   * Fades to black showing `card`, runs `work` in the dark, holds `hold` seconds (a key or a
   * click cuts it short), fades back in, and then calls `done`.
   */
  run(card: Card, work: () => void, hold = 0, done: () => void = () => {}): void {
    if (this.active) return;
    this.title.textContent = card.title ?? '';
    this.title.hidden = !card.title;
    this.line.textContent = card.line;
    this.el.classList.add('shown');
    this.phase = 'in';
    window.setTimeout(() => {
      this.phase = 'dark';
      work();
      let timer = 0;
      const out = () => {
        window.clearTimeout(timer);
        window.removeEventListener('keydown', out);
        window.removeEventListener('pointerdown', out);
        this.phase = 'out';
        this.el.classList.remove('shown');
        window.setTimeout(() => {
          this.phase = 'idle';
          done();
        }, FADE_MS);
      };
      if (hold <= 0) return out();
      timer = window.setTimeout(out, hold * 1000);
      window.addEventListener('keydown', out);
      window.addEventListener('pointerdown', out);
    }, FADE_MS + 100);
  }
}
