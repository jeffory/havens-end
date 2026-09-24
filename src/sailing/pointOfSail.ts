import type { Wind } from './weather';

/**
 * Angle between the bow and the direction the wind comes FROM: 0 is head to wind,
 * π/2 a beam reach, π dead downwind. (fx, fz) is the ship's unit forward vector.
 */
export function angleOffWind(fx: number, fz: number, wind: Wind): number {
  return Math.acos(Math.min(1, Math.max(-1, -(fx * wind.dirX + fz * wind.dirZ))));
}

// Fraction of full drive by angle off the wind (degrees). A square-rigger's curve:
// hopeless head to wind, best on a broad reach, a little slower dead downwind.
const POLAR: ReadonlyArray<readonly [number, number]> = [
  [0, 0.06],
  [30, 0.12],
  [45, 0.45],
  [60, 0.7],
  [90, 0.9],
  [125, 1],
  [150, 0.95],
  [180, 0.82],
];

export function sailEfficiency(angleOff: number): number {
  const deg = (angleOff * 180) / Math.PI;
  for (let i = 1; i < POLAR.length; i++) {
    const [d1, e1] = POLAR[i];
    if (deg <= d1) {
      const [d0, e0] = POLAR[i - 1];
      return e0 + ((deg - d0) / (d1 - d0)) * (e1 - e0);
    }
  }
  return POLAR[POLAR.length - 1][1];
}

export function pointOfSailName(angleOff: number): string {
  const deg = (angleOff * 180) / Math.PI;
  if (deg < 35) return 'In irons';
  if (deg < 65) return 'Close-hauled';
  if (deg < 110) return 'Beam reach';
  if (deg < 160) return 'Broad reach';
  return 'Running';
}
