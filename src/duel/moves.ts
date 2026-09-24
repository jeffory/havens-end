export type MoveId = 'light' | 'heavy' | 'thrust' | 'kick';

/**
 * How an attack warns you. White can be blocked or parried; red can only be dodged.
 * Kicks give no warning: they're the answer to someone hiding behind their guard.
 */
export type Telegraph = 'white' | 'red' | 'none';

export interface MoveSpec {
  /** Seconds from starting the swing to the blow landing. The parry indicator counts this down. */
  windup: number;
  /** Seconds during which the blow can connect. */
  active: number;
  /** Seconds of follow-through afterwards, open to punishment. */
  recovery: number;
  damage: number;
  /** How far in front of the attacker the blow reaches. */
  reach: number;
  stamina: number;
  telegraph: Telegraph;
  blockable: boolean;
  parryable: boolean;
  /** Distance the attacker steps in during the swing. */
  lunge: number;
  /** Distance a clean hit shoves the target back. */
  knockback: number;
  /** Seconds the target reels on a clean hit. */
  hitstun: number;
  /** Fraction of damage that gets through a block. */
  chip: number;
  /** Stamina a block of this costs the defender. */
  blockCost: number;
}

export const MOVES: Record<MoveId, MoveSpec> = {
  light: {
    windup: 0.3, active: 0.1, recovery: 0.3, damage: 9, reach: 1.9, stamina: 8, telegraph: 'white',
    blockable: true, parryable: true, lunge: 0.35, knockback: 0.25, hitstun: 0.26, chip: 0.15, blockCost: 10,
  },
  heavy: {
    windup: 0.65, active: 0.12, recovery: 0.55, damage: 22, reach: 2.1, stamina: 18, telegraph: 'white',
    blockable: true, parryable: true, lunge: 0.6, knockback: 0.7, hitstun: 0.55, chip: 0.2, blockCost: 28,
  },
  thrust: {
    windup: 0.75, active: 0.12, recovery: 0.65, damage: 26, reach: 2.6, stamina: 20, telegraph: 'red',
    blockable: false, parryable: false, lunge: 1, knockback: 0.8, hitstun: 0.6, chip: 0, blockCost: 0,
  },
  kick: {
    windup: 0.3, active: 0.1, recovery: 0.4, damage: 4, reach: 1.5, stamina: 10, telegraph: 'none',
    blockable: false, parryable: false, lunge: 0.2, knockback: 0.6, hitstun: 0.3, chip: 0, blockCost: 0,
  },
};

/** Light attacks chain: pressing again in the follow-through starts the next, quicker swing. */
export const COMBO = { length: 3, windup: 0.22, finisherDamage: 13, finisherKnockback: 0.6 };

export const PARRY_WINDOW = 0.2;
/** A failed parry leaves you unable to try again for a moment: no mashing. */
export const PARRY_COOLDOWN = 0.45;
export const PARRY_STAGGER = 0.85;
/** After a parry, your next blow hits this much harder for a moment. */
export const RIPOSTE = { seconds: 1, multiplier: 1.6 };
export const GUARD_BREAK_STAGGER = 1;

export const ROLL = { seconds: 0.45, distance: 2.6, stamina: 22, iframes: [0.04, 0.32] as const };
export const WALK_SPEED = 2.4;
export const BLOCK_WALK_SPEED = 1;
/** Fighters can't stand closer than this, except by rolling through. */
export const PERSONAL_SPACE = 1.1;

export const STAMINA = { max: 100, regen: 32, blockingRegen: 10, delay: 0.7, winded: 15 };
