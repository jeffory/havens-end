import type { Fighter } from './duel';
import { COMBO, MOVES } from './moves';

/** Seconds from the start of this fighter's swing to impact. Combo follow-ups come out quicker. */
export function windup(f: Fighter): number {
  return f.move === 'light' && f.combo > 1 ? COMBO.windup : MOVES[f.move!].windup;
}

/** Seconds until this fighter's current swing lands, or null if they aren't winding one up. */
export function impactIn(f: Fighter): number | null {
  if (f.state !== 'attack' || !f.move) return null;
  const left = windup(f) - f.t;
  return left >= 0 ? left : null;
}
