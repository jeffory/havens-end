export type NavDirection = 'up' | 'down' | 'left' | 'right';

const FOCUSABLE = 'button:not([disabled]), [data-nav]';

/** Everything the player could land on inside `root`, in document order. */
function targets(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
}

/**
 * Spatial navigation for controller and arrow keys: moves focus to the nearest
 * focusable element in a direction, preferring ones lined up with the current one.
 * With nothing focused yet, focuses the first (or `data-autofocus`) element.
 */
export function moveFocus(root: HTMLElement, direction: NavDirection, last?: DOMRect): void {
  const all = targets(root);
  if (all.length === 0) return;
  const current = document.activeElement instanceof HTMLElement && root.contains(document.activeElement) ? document.activeElement : null;
  if (!current || !all.includes(current)) {
    recoverFocus(root, last);
    return;
  }
  const from = current.getBoundingClientRect();
  const fx = from.left + from.width / 2;
  const fy = from.top + from.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of all) {
    if (el === current) continue;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    // Distance along the direction of travel, and how far off the line it is.
    const along = direction === 'up' ? fy - y : direction === 'down' ? y - fy : direction === 'left' ? fx - x : x - fx;
    const across = direction === 'up' || direction === 'down' ? Math.abs(x - fx) : Math.abs(y - fy);
    // Rows are what matter vertically: anything overlapping the current row isn't "below" it.
    const overlapsRow = direction === 'up' || direction === 'down' ? r.bottom > from.top + 2 && r.top < from.bottom - 2 : false;
    if (along <= 2 || overlapsRow) continue;
    const score = along + across * (direction === 'up' || direction === 'down' ? 0.35 : 3);
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (best) focus(best);
}

/**
 * Focus was lost (the focused button was disabled or removed): lands on whatever is
 * now nearest to where it was, rather than jumping back to the top of the screen.
 */
export function recoverFocus(root: HTMLElement, last?: DOMRect): void {
  if (!last) {
    focusFirst(root);
    return;
  }
  const cx = last.left + last.width / 2;
  const cy = last.top + last.height / 2;
  let best: HTMLElement | null = null;
  let bestDistance = Infinity;
  for (const el of targets(root)) {
    const r = el.getBoundingClientRect();
    const d = Math.hypot(r.left + r.width / 2 - cx, (r.top + r.height / 2 - cy) * 2);
    if (d < bestDistance) {
      bestDistance = d;
      best = el;
    }
  }
  if (best) focus(best);
  else focusFirst(root);
}

export function focusFirst(root: HTMLElement): void {
  const preferred = root.querySelector<HTMLElement>('[data-autofocus]:not([disabled])');
  const first = preferred ?? targets(root)[0];
  if (first) focus(first);
}

function focus(el: HTMLElement): void {
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest' });
}
