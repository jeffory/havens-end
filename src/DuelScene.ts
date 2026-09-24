import { Vector3 } from 'three';
import type { Vessel } from './combat/vessel';
import type { CharacterModel } from './duel/characterModel';
import { Duel, type DuelEvent, type DuelIntent, type Side } from './duel/duel';
import { DUEL_SKILLS } from './duel/duelAi';
import { MOVES, PARRY_WINDOW } from './duel/moves';
import { impactIn, windup } from './duel/timing';
import type { CameraRig } from './render/CameraRig';
import { DuelView } from './render/DuelView';
import type { Effects } from './render/Effects';
import type { ShipView } from './render/ShipView';
import type { DuelHud, PopTone } from './ui/DuelHud';

/** Heights on a captain, in world units above the deck. */
const CHEST = 1.2;
const HAND = 1.35;
const HEAD = 2.1;
/** Real seconds the verdict stays up before play returns to the sea. */
const VERDICT_SECONDS = 2.8;

export interface DuelCast {
  player: CharacterModel;
  enemy: CharacterModel;
}

/**
 * A captains' duel from boarding to verdict: owns the duel simulation and everything
 * about showing it (stage, camera, cue, sparks, slow motion). The Game hands it inputs
 * and asks each frame whether it's over.
 */
export class DuelScene {
  readonly duel: Duel;
  private readonly view: DuelView;
  private timeScale = 1;
  private slowFor = 0;
  private shake = 0;
  private verdictIn: number | null = null;
  private readonly cameraPosition = new Vector3();
  private readonly cameraTarget = new Vector3();
  private readonly point = new Vector3();

  constructor(
    player: Vessel,
    readonly enemy: Vessel,
    enemyShip: ShipView,
    /** Which side of the prize the player's ship lies (ship-local x sign). */
    playerSide: number,
    cast: DuelCast,
    seed: number,
    private readonly hud: DuelHud,
    private readonly effects: Effects,
    private readonly rig: CameraRig,
    private readonly container: HTMLElement,
  ) {
    const skill = DUEL_SKILLS[enemy.faction === 'imperial' ? 'imperial' : enemy.faction === 'merchant' ? 'merchant' : 'pirate'];
    // The crews fight around the captains: the bigger crew gives its captain an edge.
    const advantage = Math.max(-1, Math.min(1, (player.crew - enemy.crew) / Math.max(1, player.crew + enemy.crew)));
    this.view = new DuelView(enemyShip.body, enemyShip.model, cast.player, cast.enemy, playerSide);
    this.duel = new Duel({
      halfLength: this.view.halfLength,
      playerHp: Math.round(100 * (1 + 0.25 * advantage)),
      playerPower: 1 + 0.15 * advantage,
      enemyHp: Math.round(skill.hp * (1 - 0.25 * advantage)),
      enemyPower: skill.power * (1 - 0.15 * advantage),
      enemySkill: skill,
      seed,
    });
    const odds = advantage > 0.15 ? 'your crew has the upper hand' : advantage < -0.15 ? 'her crew outnumbers yours' : 'the crews are evenly matched';
    const title = { imperial: 'Imperial officer', merchant: 'Merchant captain', pirate: 'Pirate captain', player: 'Captain' }[enemy.faction];
    this.hud.show(title, `aboard the ${enemy.name} · ${odds}`);
  }

  /** Where the action is, for the shadow camera. */
  get focus(): Vector3 {
    return this.cameraTarget;
  }

  /** One sim step. Slow motion is applied here, so it's part of the (deterministic) duel. */
  step(dt: number, intent: DuelIntent): void {
    if (this.duel.winner) return;
    this.duel.step(dt * this.timeScale, intent);
  }

  /** Draws the frame; returns the verdict once it has been on screen long enough. */
  render(frameSeconds: number, time: number): 'won' | 'lost' | null {
    const { duel } = this;
    for (const e of duel.takeEvents()) this.react(e);

    this.slowFor = Math.max(0, this.slowFor - frameSeconds);
    if (this.slowFor <= 0 && !duel.winner) this.timeScale = 1;
    this.view.update(duel, frameSeconds * this.timeScale, time);

    this.view.cameraFor(duel, this.cameraPosition, this.cameraTarget);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - frameSeconds);
      const s = this.shake * 0.6;
      this.cameraPosition.x += (Math.random() - 0.5) * s;
      this.cameraPosition.y += (Math.random() - 0.5) * s;
    }
    this.rig.frame(this.cameraPosition, this.cameraTarget, frameSeconds);

    this.hud.update(duel, this.parryCue());
    if (this.verdictIn !== null) {
      this.verdictIn -= frameSeconds;
      if (this.verdictIn <= 0) return duel.winner === 'player' ? 'won' : 'lost';
    }
    return null;
  }

  dispose(): void {
    this.view.dispose();
    this.hud.hide();
    this.rig.release();
  }

  /** The ring on the enemy's blade while a readable swing winds up. */
  private parryCue() {
    const foe = this.duel.enemy;
    const impact = impactIn(foe);
    if (impact === null || !foe.move || MOVES[foe.move].telegraph === 'none') return null;
    const screen = this.screen(this.view.anchor(foe, HAND, this.point));
    return {
      ...screen,
      remaining: impact / windup(foe),
      telegraph: MOVES[foe.move].telegraph as 'white' | 'red',
      now: impact <= PARRY_WINDOW,
    };
  }

  private react(e: DuelEvent): void {
    const { duel } = this;
    const who = (side: Side) => (side === 'player' ? duel.player : duel.enemy);
    const other = (side: Side) => (side === 'player' ? duel.enemy : duel.player);
    const tone = (good: boolean): PopTone => (good ? 'good' : 'bad');
    switch (e.kind) {
      case 'hit': {
        const target = other(e.side);
        const at = this.view.anchor(target, CHEST, this.point);
        this.effects.emit('wound', at.x, at.y, at.z, 0, 0, e.move === 'heavy' || e.move === 'thrust' ? 1.6 : 1);
        this.pop(e.riposte ? `RIPOSTE -${Math.round(e.damage)}` : `-${Math.round(e.damage)}`, target, HEAD, e.riposte ? 'gold' : tone(e.side === 'player'));
        if (e.move === 'heavy' || e.move === 'thrust' || e.riposte) this.shake = 0.25;
        break;
      }
      case 'blocked': {
        const defender = who(e.side);
        const at = this.view.anchor(defender, HAND, this.point);
        this.effects.emit('sparks', at.x, at.y, at.z);
        this.pop('BLOCK', defender, HEAD, 'info');
        break;
      }
      case 'parried': {
        const defender = who(e.side);
        const at = this.view.anchor(defender, HAND, this.point);
        this.effects.emit('parrySparks', at.x, at.y, at.z);
        this.pop('PARRY!', defender, HEAD, e.side === 'player' ? 'gold' : 'bad');
        this.slow(0.35, 0.3);
        break;
      }
      case 'guardBreak':
        this.pop('GUARD BREAK', who(e.side), HEAD, tone(e.side !== 'player'));
        this.shake = 0.3;
        break;
      case 'dodged':
        this.pop('DODGE', who(e.side), HEAD, e.side === 'player' ? 'good' : 'info');
        break;
      case 'defeated': {
        const won = e.side === 'enemy';
        this.slow(1.4, 0.25);
        this.verdictIn = VERDICT_SECONDS;
        this.hud.result(won, won ? `The ${this.enemy.name} is yours.` : 'You are overpowered and clapped in irons.');
        break;
      }
    }
  }

  private slow(seconds: number, scale: number): void {
    this.slowFor = Math.max(this.slowFor, seconds);
    this.timeScale = Math.min(this.timeScale, scale);
  }

  private pop(text: string, f: Parameters<DuelView['anchor']>[0], height: number, tone: PopTone): void {
    const { x, y } = this.screen(this.view.anchor(f, height, this.point));
    this.hud.pop(text, x, y, tone);
  }

  private screen(world: Vector3): { x: number; y: number } {
    const p = world.clone().project(this.rig.camera);
    return { x: ((p.x + 1) / 2) * this.container.clientWidth, y: ((1 - p.y) / 2) * this.container.clientHeight };
  }
}
