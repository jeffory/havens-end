/**
 * On foot, a fight with bandits is framed much as one at sea is: the camera's focus shifts
 * SHARE of the way from the captain toward the nearest bandit fighting (halfway, so the two
 * of them sit either side of the middle), but never more than MAX_SHIFT, so the captain stays
 * well on screen; and the camera stands back to at least FIGHT_DISTANCE, so a bandit keeping
 * their distance (8 to 16 off) stays in view even on the side toward the camera, where less
 * of the ground is shown, and above the hotbar.
 */
const SHARE = 0.5;
const MAX_SHIFT = 8;
export const FIGHT_DISTANCE = 48;

interface Spot {
  x: number;
  z: number;
}

/** How far to shift the camera's focus off the captain to frame the nearest of `foes`: none, if there are none. */
export function fightShift(captain: Spot, foes: readonly Spot[]): Spot {
  let nearest: Spot | null = null;
  let best = Infinity;
  for (const f of foes) {
    const d = Math.hypot(f.x - captain.x, f.z - captain.z);
    if (d < best) [nearest, best] = [f, d];
  }
  if (!nearest || best === 0) return { x: 0, z: 0 };
  const share = Math.min(SHARE, MAX_SHIFT / best);
  return { x: (nearest.x - captain.x) * share, z: (nearest.z - captain.z) * share };
}

/** How far back the camera stands for a fight `weight` of the way framed (0 none, 1 all), from the distance it's zoomed to. */
export function fightDistance(zoomed: number, weight: number): number {
  return zoomed + weight * Math.max(0, FIGHT_DISTANCE - zoomed);
}
