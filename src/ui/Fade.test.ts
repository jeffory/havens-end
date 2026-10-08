import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Fade } from './Fade';

/** A key press as the window hears it; `repeat` when it's a key held down, repeating. */
const key = (repeat: boolean) => Object.assign(new Event('keydown'), { repeat });

describe('the come-to card', () => {
  let page: EventTarget;
  beforeEach(() => {
    vi.useFakeTimers();
    // Just enough of a page for the fade: elements to show the card in, and a window to listen on.
    const element = () => ({ className: '', hidden: false, textContent: '', classList: { add() {}, remove() {} }, append() {} });
    page = Object.assign(new EventTarget(), {
      setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
      clearTimeout: (t: number) => clearTimeout(t),
    });
    vi.stubGlobal('document', { createElement: element });
    vi.stubGlobal('window', page);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** A card held three seconds, up and dark; how many times it's finished. */
  function card() {
    const fade = new Fade({ append() {} } as unknown as HTMLElement);
    const done = vi.fn();
    fade.run({ title: 'Left for dead', line: 'Your crew carries you back aboard.' }, () => {}, 3, done);
    vi.advanceTimersByTime(1000); // faded to black: the card's up
    return { fade, done };
  }

  it('isn’t skipped by a key held down from before it came up', () => {
    const { fade, done } = card();
    for (let i = 0; i < 20; i++) page.dispatchEvent(key(true));
    vi.advanceTimersByTime(1500);
    expect(fade.active).toBe(true);
    expect(done).not.toHaveBeenCalled();
    // It holds its three seconds, then fades back in.
    vi.advanceTimersByTime(1500 + 700);
    expect(fade.active).toBe(false);
    expect(done).toHaveBeenCalledOnce();
  });

  it('is skipped by a fresh key press, and finishes just once', () => {
    const { fade, done } = card();
    page.dispatchEvent(key(false));
    vi.advanceTimersByTime(700);
    expect(fade.active).toBe(false);
    expect(done).toHaveBeenCalledOnce();
    // Neither another press nor the hold running out finishes it again.
    page.dispatchEvent(key(false));
    vi.advanceTimersByTime(5000);
    expect(done).toHaveBeenCalledOnce();
  });
});
