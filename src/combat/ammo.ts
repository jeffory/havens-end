export type Ammo = 'round' | 'chain' | 'grape';

export const AMMO_TYPES: readonly Ammo[] = ['round', 'chain', 'grape'];

export interface AmmoSpec {
  label: string;
  /** Nominal reach in voxels: where a shot fired from the waterline comes down. */
  range: number;
  /** Projectiles per gun. */
  pellets: number;
  /** Random scatter, radians. */
  spread: number;
  /** Damage per projectile that hits. */
  hull: number;
  sails: number;
  crew: number;
}

export const GRAVITY = 15;
/** Every gun fires at the same fixed elevation: range comes from the charge (ammo type), not aiming. */
export const ELEVATION = (12 * Math.PI) / 180;

/**
 * Round shot smashes hulls from long range; chain shot shreds canvas (the target slows);
 * grapeshot sweeps the decks at close range (fewer hands: fewer guns manned, slower reloads).
 */
export const AMMO: Record<Ammo, AmmoSpec> = {
  round: { label: 'Round shot', range: 48, pellets: 1, spread: 0.035, hull: 8, sails: 1, crew: 0.4 },
  chain: { label: 'Chain shot', range: 36, pellets: 1, spread: 0.05, hull: 2, sails: 9, crew: 0.2 },
  grape: { label: 'Grapeshot', range: 24, pellets: 4, spread: 0.13, hull: 0.5, sails: 0.5, crew: 0.6 },
};

export function muzzleSpeed(ammo: Ammo): number {
  return Math.sqrt((AMMO[ammo].range * GRAVITY) / Math.sin(2 * ELEVATION));
}

/** How far a shot flies before hitting the water when fired from `height` above it. */
export function landingDistance(ammo: Ammo, height: number): number {
  const v = muzzleSpeed(ammo);
  const up = v * Math.sin(ELEVATION);
  const flight = (up + Math.sqrt(up * up + 2 * GRAVITY * height)) / GRAVITY;
  return v * Math.cos(ELEVATION) * flight;
}
