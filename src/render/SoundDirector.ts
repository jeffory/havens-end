/**
 * Turns what happens (the sea's, the land's, the treasure's and the duel's events, the sail
 * order, the captain's footfalls and the menus) into sound effects, and the surroundings
 * into the ambience. Free of three.js: where a sound is comes from the injected `place`.
 */
import { ambience, type Surroundings } from '../audio/sfx/ambience';
import type { Ground } from '../audio/sfx/ground';
import type { Placement, PlayOptions } from '../audio/sfx/Sfx';
import type { LoopId, SoundId } from '../audio/sfx/sounds';
import type { SeaEvent } from '../combat/sea';
import type { DuelEvent } from '../duel/duel';
import type { Action, LandEvent } from '../land/Land';
import { WATER_LEVEL } from '../ocean/waves';
import type { TreasureEvent } from '../treasure/Treasure';

/** Where the sounds go (the Sfx engine, or a fake in tests). */
export interface SoundSink {
  play(id: SoundId, options?: PlayOptions): void;
  setLoops(levels: Readonly<Record<LoopId, number>>): void;
}

/** The sound of each kind of work, and how loud. */
const WORK: Readonly<Record<Action, readonly [SoundId, number?]>> = {
  fell: ['tree-fall'],
  chop: ['axe-chop'],
  mine: ['pickaxe'],
  break: ['outcrop-break'],
  dig: ['dig'],
  till: ['dig'],
  plant: ['dig', 0.5],
  harvest: ['pickup'],
  unbuild: ['axe-chop'],
  fish: ['splash', 0.3],
  catch: ['splash', 0.3],
};

/** The workshops whose making is heard. */
const MAKING: Readonly<Record<string, SoundId>> = { sawpit: 'saw', forge: 'forge-hammer' };

/** A rise in the sail order this big in one frame is heard as setting sail. */
const SAIL_RISE = 0.5;

export class SoundDirector {
  private lastSails = 0;
  private lastFootfalls: number | null = null;

  constructor(
    private readonly sink: SoundSink,
    private readonly place: (x: number, y: number, z: number) => Placement,
  ) {}

  private at(id: SoundId, x: number, y: number, z: number, gain?: number): void {
    const options: PlayOptions = { at: this.place(x, y, z) };
    if (gain !== undefined) options.gain = gain;
    this.sink.play(id, options);
  }

  sea(events: readonly SeaEvent[], vesselAt: (id: number) => { x: number; z: number } | null): void {
    for (const e of events) {
      switch (e.kind) {
        case 'fire':
          this.at('cannon', e.x, e.y, e.z);
          break;
        case 'hit':
          this.at('hull-hit', e.x, e.y, e.z, e.ammo === 'grape' ? 0.5 : undefined);
          if (e.ammo === 'chain') this.at('sail-tear', e.x, e.y, e.z);
          break;
        case 'splash':
          this.at('splash', e.x, WATER_LEVEL, e.z, e.ammo === 'grape' ? 0.5 : undefined);
          break;
        case 'thud':
          this.at('hull-hit', e.x, e.y, e.z, 0.5);
          break;
        case 'barrel':
          this.at('splash', e.x, WATER_LEVEL, e.z, 0.4);
          break;
        case 'explosion':
          this.at('barrel-blast', e.x, WATER_LEVEL, e.z);
          break;
        case 'sinking': {
          const where = vesselAt(e.vessel);
          if (where) this.at('sinking', where.x, WATER_LEVEL, where.z);
          else this.sink.play('sinking');
          break;
        }
      }
    }
  }

  land(events: readonly LandEvent[], buildingKind: (id: number) => string | undefined): void {
    for (const e of events) {
      switch (e.kind) {
        case 'work': {
          const [id, gain] = WORK[e.action];
          this.at(id, e.x, e.y, e.z, gain);
          break;
        }
        case 'pickup':
          this.sink.play('pickup');
          break;
        case 'built':
        case 'razed':
          this.at('axe-chop', e.x, e.y, e.z, 0.7);
          break;
        case 'made': {
          const kind = buildingKind(e.building);
          const id = kind === undefined ? undefined : MAKING[kind];
          if (id) this.at(id, e.x, e.y, e.z);
          break;
        }
        case 'shot':
          this.at(e.gun, e.from.x, e.from.y, e.from.z);
          this.at('bullet-hit', e.to.x, e.to.y, e.to.z, e.hit === null ? 0.4 : 1);
          break;
        case 'hurt':
          this.at('captain-hurt', e.x, e.y, e.z);
          break;
        case 'alarm':
          this.at('bandit-shout', e.x, e.y, e.z);
          break;
        case 'bolt':
          if (e.creature !== 'crab') this.at(e.creature, e.x, e.y, e.z);
          break;
        case 'loaded':
          this.sink.play('reload');
          break;
      }
    }
  }

  treasure(events: readonly TreasureEvent[]): void {
    for (const e of events) this.at(e.kind === 'found' ? 'chest-found' : 'guardian-wail', e.x, e.y, e.z);
  }

  /** The duel is fought up close, so its sounds are centred. */
  duel(e: DuelEvent): void {
    switch (e.kind) {
      case 'swing':
        if (e.move !== 'kick') this.sink.play('swing');
        break;
      case 'hit':
        this.sink.play(e.move === 'kick' ? 'kick' : 'grunt');
        break;
      case 'blocked':
        this.sink.play('block');
        break;
      case 'parried':
        this.sink.play('parry');
        break;
      case 'guardBreak':
        this.sink.play('blade-clash');
        break;
      case 'defeated':
        this.sink.play('grunt');
        break;
    }
  }

  /** The player's sail order, each frame: heard as the sails go up from furled, or by a big step at once. */
  sails(level: number, x: number, z: number): void {
    const last = this.lastSails;
    this.lastSails = level;
    if (level > last && (last === 0 || level - last >= SAIL_RISE)) this.at('sails-set', x, WATER_LEVEL, z);
  }

  /** The captain's footfall count: one step whenever it changes, however far it jumped. The first call only sets it. */
  footfall(count: number, ground: Ground, x: number, y: number, z: number): void {
    const last = this.lastFootfalls;
    this.lastFootfalls = count;
    if (last !== null && count !== last) this.at(`step-${ground}`, x, y, z);
  }

  ui(id: 'click' | 'coins' | 'page' | 'cant'): void {
    this.sink.play(id);
  }

  surroundings(s: Surroundings): void {
    this.sink.setLoops(ambience(s));
  }
}
