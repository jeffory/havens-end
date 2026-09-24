import type { Duel, DuelIntent, Fighter } from './duel';
import { type MoveId, MOVES, PARRY_WINDOW } from './moves';
import { impactIn } from './timing';

/** How good an enemy captain is with a blade. */
export interface DuelSkill {
  name: string;
  /** Seconds before they notice an incoming swing. */
  reaction: number;
  /** Chance they try to parry a swing they've noticed. */
  parry: number;
  /** Chance they block it instead (if they don't parry). */
  block: number;
  /** Chance they roll away from it instead. */
  roll: number;
  /** Swings started per second when in range. */
  aggression: number;
  /** Chance they keep their guard up between their own attacks. */
  guard: number;
  /** Chance they get their guard up between the blows of a combo instead of eating the rest. */
  recover: number;
  hp: number;
  /** Damage multiplier. */
  power: number;
  /** Relative preference for each attack. */
  moves: Record<MoveId, number>;
}

export const DUEL_SKILLS = {
  merchant: {
    name: 'merchant', reaction: 0.4, parry: 0.05, block: 0.45, roll: 0.05, aggression: 0.6, guard: 0.25, recover: 0.15,
    hp: 80, power: 0.85, moves: { light: 6, heavy: 2, thrust: 0, kick: 0.5 },
  },
  pirate: {
    name: 'pirate', reaction: 0.28, parry: 0.2, block: 0.4, roll: 0.15, aggression: 1.2, guard: 0.35, recover: 0.4,
    hp: 110, power: 1, moves: { light: 6, heavy: 3, thrust: 1, kick: 2 },
  },
  imperial: {
    name: 'imperial', reaction: 0.18, parry: 0.5, block: 0.3, roll: 0.15, aggression: 1.1, guard: 0.6, recover: 0.7,
    hp: 150, power: 1.1, moves: { light: 5, heavy: 3, thrust: 2, kick: 1.5 },
  },
} satisfies Record<string, DuelSkill>;

const PREFERRED_RANGE = 1.6;

/** The enemy captain: reads your swings, defends by skill, attacks when you're open. */
export class DuelAi {
  private cooldown = 1;
  /** The player swing we've already decided how to meet. */
  private answered = -1;
  private plan: 'none' | 'parry' | 'block' | 'roll' | 'retreat' = 'none';
  private hold = 0;
  private guarding = false;
  private guardRoll = 0;
  private wasStunned = false;

  constructor(private readonly skill: DuelSkill) {}

  think(duel: Duel, dt: number): DuelIntent {
    const me = duel.enemy;
    const foe = duel.player;
    const intent: DuelIntent = { move: 0, block: false, attack: null, roll: false };
    this.cooldown -= dt;
    this.hold = Math.max(0, this.hold - dt);
    if (me.state === 'down' || me.state === 'hitstun' || me.state === 'stagger') {
      this.plan = 'none';
      this.wasStunned = true;
      return intent;
    }
    // Just shaken off a blow: a good fighter gets the guard up before the next one lands.
    if (this.wasStunned) {
      this.wasStunned = false;
      if (foe.state === 'attack' && duel.random() < this.skill.recover) {
        this.plan = 'block';
        this.answered = foe.swings;
      }
    }
    const gap = foe.x - me.x;
    const distance = Math.abs(gap);
    const toward = Math.sign(gap) || 1;

    // Defence: meet each of the player's swings once, after our reaction time.
    const impact = impactIn(foe);
    if (impact !== null && foe.swings !== this.answered && foe.t >= this.skill.reaction && distance < MOVES[foe.move!].reach + 1.2) {
      this.answered = foe.swings;
      this.plan = this.chooseDefence(duel, foe);
    }
    if (impact === null && this.hold <= 0 && this.plan !== 'retreat') this.plan = 'none';

    switch (this.plan) {
      case 'parry':
        // Raise the guard so the blow lands inside the parry window, then hold briefly.
        if (impact !== null && impact <= PARRY_WINDOW * 0.6) {
          intent.block = true;
          this.hold = 0.25;
        } else if (this.hold > 0) {
          intent.block = true;
        }
        return intent;
      case 'block':
        intent.block = true;
        this.hold = 0.2;
        return intent;
      case 'roll':
        intent.roll = true;
        intent.move = -toward;
        this.plan = 'none';
        return intent;
      case 'retreat':
        intent.move = -toward;
        if (distance > 3 || me.stamina > 45) this.plan = 'none';
        return intent;
    }

    // Winded: back off and get your breath.
    if (me.stamina < 20) {
      this.plan = 'retreat';
      intent.move = -toward;
      return intent;
    }

    // Between attacks, the careful ones keep their guard up (re-decided twice a second).
    this.guardRoll -= dt;
    if (this.guardRoll <= 0) {
      this.guardRoll = 0.5;
      this.guarding = duel.random() < this.skill.guard;
    }

    // Offence.
    const open = foe.state === 'stagger' || foe.state === 'hitstun' || (foe.state === 'attack' && impactIn(foe) === null);
    if (distance > PREFERRED_RANGE + 0.3) {
      intent.move = toward;
    } else if (distance < PREFERRED_RANGE - 0.7 && !open) {
      intent.move = -toward;
    }
    if (open && distance < MOVES.heavy.reach) {
      intent.attack = foe.state === 'stagger' ? 'heavy' : 'light';
      this.cooldown = 0.6;
    } else if (this.cooldown <= 0 && distance < MOVES.light.reach + 0.2) {
      intent.attack = this.pickMove(duel, foe);
      this.cooldown = (0.6 + duel.random() * 0.8) / this.skill.aggression;
    }
    // Keep a light combo going more often than not.
    if (me.state === 'attack' && me.move === 'light' && duel.random() < 0.08) intent.attack = 'light';
    if (!intent.attack && this.guarding && distance < 2.6) intent.block = true;
    return intent;
  }

  private chooseDefence(duel: Duel, foe: Fighter): DuelAi['plan'] {
    const spec = MOVES[foe.move!];
    if (spec.telegraph === 'red') return duel.random() < this.skill.roll + this.skill.parry ? 'roll' : 'retreat';
    if (spec.telegraph === 'none') return 'none'; // kicks: nothing to read in time
    const r = duel.random();
    if (r < this.skill.parry) return 'parry';
    if (r < this.skill.parry + this.skill.block) return 'block';
    if (r < this.skill.parry + this.skill.block + this.skill.roll && duel.enemy.stamina > 30) return 'roll';
    return 'none';
  }

  private pickMove(duel: Duel, foe: Fighter): MoveId {
    const weights = { ...this.skill.moves };
    // A player hiding behind their guard gets kicked.
    if (foe.state === 'block') weights.kick *= 4;
    if (duel.enemy.stamina < 40) weights.heavy = weights.thrust = 0;
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    let r = duel.random() * total;
    for (const [move, weight] of Object.entries(weights) as Array<[MoveId, number]>) {
      r -= weight;
      if (r <= 0) return move;
    }
    return 'light';
  }
}
