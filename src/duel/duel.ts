import { mulberry32 } from '../worldgen/noise';
import { type DuelSkill, DuelAi } from './duelAi';
import { windup } from './timing';
import {
  BLOCK_WALK_SPEED,
  COMBO,
  GUARD_BREAK_STAGGER,
  type MoveId,
  MOVES,
  PARRY_COOLDOWN,
  PARRY_STAGGER,
  PARRY_WINDOW,
  PERSONAL_SPACE,
  RIPOSTE,
  ROLL,
  STAMINA,
  WALK_SPEED,
} from './moves';

export type FighterState = 'idle' | 'walk' | 'attack' | 'block' | 'roll' | 'hitstun' | 'stagger' | 'down';
export type Side = 'player' | 'enemy';

export interface Fighter {
  side: Side;
  /** Position along the deck; +x is to the right on screen. */
  x: number;
  facing: 1 | -1;
  hp: number;
  maxHp: number;
  stamina: number;
  /** Multiplies the damage this fighter deals (crew advantage, captain skill). */
  power: number;
  state: FighterState;
  /** Seconds in the current state. */
  t: number;
  move: MoveId | null;
  /** 1..3 within a chain of light attacks. */
  combo: number;
  /** A combo follow-up asked for during this swing. */
  queued: boolean;
  /** This swing has already connected (or been parried/blocked). */
  landed: boolean;
  /** Counts every swing started, so observers can tell one attack from the next. */
  swings: number;
  parryWindow: number;
  parryCooldown: number;
  blockHeld: boolean;
  rollDir: 1 | -1;
  /** Seconds before stamina starts coming back. */
  rest: number;
  /** Length of the current hitstun / stagger. */
  stun: number;
  /** Seconds left of the post-parry damage bonus. */
  riposte: number;
  /** Knockback speed, decaying. */
  shove: number;
}

/** What a fighter wants to do this tick: from the keyboard/pad, or from the AI. */
export interface DuelIntent {
  /** -1, 0 or 1 along the deck. */
  move: number;
  block: boolean;
  /** Attack pressed this tick. */
  attack: MoveId | null;
  roll: boolean;
}

export const IDLE: DuelIntent = { move: 0, block: false, attack: null, roll: false };

export type DuelEvent =
  | { kind: 'swing'; side: Side; move: MoveId }
  | { kind: 'hit'; side: Side; move: MoveId; damage: number; x: number; riposte: boolean }
  | { kind: 'blocked'; side: Side; x: number }
  | { kind: 'parried'; side: Side; x: number }
  | { kind: 'guardBreak'; side: Side; x: number }
  | { kind: 'dodged'; side: Side }
  | { kind: 'roll'; side: Side }
  | { kind: 'defeated'; side: Side };

export interface DuelConfig {
  /** Half the length of deck the captains can fight along. */
  halfLength: number;
  playerHp: number;
  playerPower: number;
  enemyHp: number;
  enemyPower: number;
  enemySkill: DuelSkill;
  seed: number;
}

/**
 * A captains' duel on deck, seen from the side: two fighters on a line. Pure and
 * deterministic (seeded), stepped at the sim rate like everything else.
 */
export class Duel {
  readonly player: Fighter;
  readonly enemy: Fighter;
  readonly random: () => number;
  time = 0;
  winner: Side | null = null;
  private events: DuelEvent[] = [];
  private readonly ai: DuelAi;

  constructor(readonly config: DuelConfig) {
    this.random = mulberry32(config.seed);
    this.player = fighter('player', -2, config.playerHp, config.playerPower);
    this.enemy = fighter('enemy', 2, config.enemyHp, config.enemyPower);
    this.ai = new DuelAi(config.enemySkill);
  }

  takeEvents(): DuelEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  step(dt: number, playerIntent: DuelIntent, enemyIntent: DuelIntent = this.ai.think(this, dt)): void {
    if (this.winner) return;
    this.time += dt;
    const { player, enemy } = this;
    this.act(player, enemy, playerIntent, dt);
    this.act(enemy, player, enemyIntent, dt);
    this.advance(player, dt);
    this.advance(enemy, dt);
    this.strike(player, enemy);
    this.strike(enemy, player);
    this.place(dt);
  }

  private act(f: Fighter, foe: Fighter, intent: DuelIntent, dt: number): void {
    const free = f.state === 'idle' || f.state === 'walk' || f.state === 'block';
    const winded = f.stamina < STAMINA.winded && f.rest > 0;

    // Block: the moment it's raised is the parry window.
    if (intent.block && !f.blockHeld && f.parryCooldown <= 0 && (free || f.state === 'block')) {
      f.parryWindow = PARRY_WINDOW;
      f.parryCooldown = PARRY_COOLDOWN;
    }
    f.blockHeld = intent.block;

    if (intent.roll && f.stamina >= ROLL.stamina * 0.5 && (free || inRecovery(f))) {
      f.state = 'roll';
      f.t = 0;
      f.rollDir = intent.move !== 0 ? (Math.sign(intent.move) as 1 | -1) : (-f.facing as 1 | -1);
      this.spend(f, ROLL.stamina);
      this.emit({ kind: 'roll', side: f.side });
      return;
    }

    if (intent.attack) {
      if (f.state === 'attack' && f.move === 'light' && intent.attack === 'light' && f.combo < COMBO.length) {
        f.queued = true;
      } else if (free && !winded && f.stamina > 0) {
        this.startSwing(f, intent.attack, 1);
        return;
      }
    }

    if (free) {
      if (f.blockHeld) {
        f.state = 'block';
      } else if (intent.move !== 0) {
        f.state = 'walk';
      } else {
        f.state = 'idle';
      }
      if (intent.move !== 0) f.x += Math.sign(intent.move) * (f.blockHeld ? BLOCK_WALK_SPEED : WALK_SPEED) * dt;
      if (f.state !== 'block') f.facing = foe.x >= f.x ? 1 : -1;
    }
  }

  private startSwing(f: Fighter, move: MoveId, combo: number): void {
    f.state = 'attack';
    f.move = move;
    f.t = 0;
    f.combo = combo;
    f.queued = false;
    f.landed = false;
    f.swings++;
    this.spend(f, MOVES[move].stamina);
    this.emit({ kind: 'swing', side: f.side, move });
  }

  private advance(f: Fighter, dt: number): void {
    f.t += dt;
    f.parryWindow = Math.max(0, f.parryWindow - dt);
    f.parryCooldown = Math.max(0, f.parryCooldown - dt);
    f.riposte = Math.max(0, f.riposte - dt);
    f.rest = Math.max(0, f.rest - dt);
    if (f.rest <= 0 && f.state !== 'attack' && f.state !== 'roll') {
      const regen = f.state === 'block' ? STAMINA.blockingRegen : STAMINA.regen;
      f.stamina = Math.min(STAMINA.max, f.stamina + regen * dt);
    }

    switch (f.state) {
      case 'attack': {
        const spec = MOVES[f.move!];
        const w = windup(f);
        // Step in over the end of the windup and the blow itself.
        if (f.t > w * 0.6 && f.t < w + spec.active) f.x += (f.facing * spec.lunge * dt) / (w * 0.4 + spec.active);
        if (f.t >= w + spec.active + spec.recovery) {
          f.state = 'idle';
          f.move = null;
        } else if (f.queued && f.t >= w + spec.active) {
          this.startSwing(f, 'light', f.combo + 1);
        }
        break;
      }
      case 'roll': {
        // Fast out, easing to a stop.
        const k = f.t / ROLL.seconds;
        f.x += f.rollDir * ROLL.distance * (2 * (1 - k)) * (dt / ROLL.seconds);
        if (f.t >= ROLL.seconds) f.state = 'idle';
        break;
      }
      case 'hitstun':
      case 'stagger':
        if (f.t >= f.stun) f.state = 'idle';
        break;
    }
  }

  /** Resolves a swing in its active frames: parried, blocked, dodged, or a clean hit. */
  private strike(a: Fighter, d: Fighter): void {
    if (a.state !== 'attack' || !a.move || a.landed) return;
    const spec = MOVES[a.move];
    const w = windup(a);
    if (a.t < w || a.t >= w + spec.active) return;
    const ahead = (d.x - a.x) * a.facing;
    if (ahead < -0.2 || ahead > spec.reach || d.state === 'down') return;

    if (d.state === 'roll' && d.t >= ROLL.iframes[0] && d.t <= ROLL.iframes[1]) {
      a.landed = true;
      this.emit({ kind: 'dodged', side: d.side });
      return;
    }
    const facingAttacker = d.facing === -a.facing;
    a.landed = true;

    if (spec.parryable && d.parryWindow > 0 && facingAttacker && d.state !== 'hitstun' && d.state !== 'stagger') {
      this.stagger(a, PARRY_STAGGER);
      d.riposte = RIPOSTE.seconds;
      d.stamina = Math.min(STAMINA.max, d.stamina + 15);
      d.parryWindow = 0;
      d.parryCooldown = 0; // a good parry lets you parry the next blow straight away
      this.emit({ kind: 'parried', side: d.side, x: (a.x + d.x) / 2 });
      return;
    }

    if (a.move === 'kick' && d.state === 'block') {
      this.stagger(d, GUARD_BREAK_STAGGER);
      d.shove = a.facing * spec.knockback * 3;
      this.emit({ kind: 'guardBreak', side: d.side, x: d.x });
      return;
    }

    if (spec.blockable && d.state === 'block' && facingAttacker) {
      this.hurt(a, d, damage(a) * spec.chip);
      d.stamina -= spec.blockCost;
      d.rest = STAMINA.delay;
      d.shove = a.facing * spec.knockback * 1.5;
      if (d.stamina <= 0) {
        d.stamina = 0;
        this.stagger(d, GUARD_BREAK_STAGGER);
        this.emit({ kind: 'guardBreak', side: d.side, x: d.x });
      } else {
        this.emit({ kind: 'blocked', side: d.side, x: (a.x + d.x) / 2 });
      }
      return;
    }

    const riposte = a.riposte > 0;
    const dealt = damage(a) * (riposte ? RIPOSTE.multiplier : 1);
    a.riposte = 0;
    const finisher = a.move === 'light' && a.combo >= COMBO.length;
    if (!this.hurt(a, d, dealt)) {
      d.state = 'hitstun';
      d.t = 0;
      d.stun = spec.hitstun;
      d.move = null;
    }
    d.shove = a.facing * (finisher ? COMBO.finisherKnockback : spec.knockback) * 3;
    this.emit({ kind: 'hit', side: a.side, move: a.move, damage: dealt, x: d.x, riposte });
  }

  /** Returns true if this blow put the fighter down. */
  private hurt(a: Fighter, d: Fighter, amount: number): boolean {
    d.hp = Math.max(0, d.hp - amount);
    if (d.hp > 0 || d.state === 'down') return false;
    d.state = 'down';
    d.t = 0;
    this.winner = a.side;
    this.emit({ kind: 'defeated', side: d.side });
    return true;
  }

  private stagger(f: Fighter, seconds: number): void {
    f.state = 'stagger';
    f.t = 0;
    f.stun = seconds;
    f.move = null;
    f.queued = false;
  }

  private spend(f: Fighter, stamina: number): void {
    f.stamina = Math.max(0, f.stamina - stamina);
    f.rest = STAMINA.delay;
  }

  /** Knockback, personal space (rolls pass through), the ends of the deck. */
  private place(dt: number): void {
    const { player, enemy } = this;
    for (const f of [player, enemy]) {
      f.x += f.shove * dt;
      f.shove *= Math.exp(-8 * dt);
    }
    const passing = player.state === 'roll' || enemy.state === 'roll';
    const gap = enemy.x - player.x;
    if (!passing && Math.abs(gap) < PERSONAL_SPACE) {
      const push = (PERSONAL_SPACE - Math.abs(gap)) / 2;
      const dir = gap === 0 ? 1 : Math.sign(gap);
      player.x -= dir * push;
      enemy.x += dir * push;
    }
    const limit = this.config.halfLength;
    for (const f of [player, enemy]) f.x = Math.max(-limit, Math.min(limit, f.x));
  }

  private emit(event: DuelEvent): void {
    this.events.push(event);
  }
}

function fighter(side: Side, x: number, hp: number, power: number): Fighter {
  return {
    side, x, facing: side === 'player' ? 1 : -1, hp, maxHp: hp, stamina: STAMINA.max, power,
    state: 'idle', t: 0, move: null, combo: 0, queued: false, landed: false, swings: 0,
    parryWindow: 0, parryCooldown: 0, blockHeld: false, rollDir: 1, rest: 0, stun: 0, riposte: 0, shove: 0,
  };
}

function damage(f: Fighter): number {
  const base = f.move === 'light' && f.combo >= COMBO.length ? COMBO.finisherDamage : MOVES[f.move!].damage;
  return base * f.power;
}

function inRecovery(f: Fighter): boolean {
  if (f.state !== 'attack' || !f.move) return false;
  return f.t >= windup(f) + MOVES[f.move].active;
}
