import { LoopPlayer } from './LoopPlayer';
import { Playlist } from './Playlist';
import type { Speaker } from './speaker';
import { ASHORE, BROADSIDES, SHANTIES } from './tracks';

/** Seconds the fight music plays on after the fight, so a lull doesn't cut it off. */
export const LINGER = 8;
/** Seconds of quiet between one play of the tune ashore and the next. */
const ASHORE_BETWEEN = 30;

/** Where the captain is, as far as the music goes. */
export interface Moment {
  /** Sailing, on foot, or neither (asleep, sunk, the tab hidden): then all is quiet. */
  where: 'sea' | 'land' | null;
  /** A fight: a ship close by fighting her or running from her guns, or a duel. */
  fighting: boolean;
  /** The crew is singing (N at sea). */
  singing: boolean;
}

/**
 * Which music is heard when: Broadsides in a fight, the shanties at sea while the crew
 * sings, and Ashore on land. Each fades out as the next fades in.
 */
export class Soundtrack {
  /** The crew's shanties, at sea. */
  readonly shanties: Playlist;
  private readonly ashore: Playlist;
  private readonly battle: LoopPlayer;
  /** Seconds of the fight music left to play. */
  private fight = 0;
  /** Off: nothing plays (or downloads) at all. */
  private off = false;

  constructor(speaker: (part: 'shanties' | 'ashore' | 'battle') => Speaker = () => new Audio()) {
    this.shanties = new Playlist(SHANTIES, { speaker: speaker('shanties') });
    this.ashore = new Playlist([ASHORE], { speaker: speaker('ashore'), between: ASHORE_BETWEEN });
    this.battle = new LoopPlayer(BROADSIDES, [speaker('battle'), speaker('battle')]);
  }

  /** How loud, 0 (off) to 1 (the player's setting). */
  set volume(volume: number) {
    this.off = volume === 0;
    this.shanties.volume = volume;
    this.ashore.volume = volume;
    this.battle.volume = volume;
  }

  /** Once a frame. */
  update(now: Moment, dt: number): void {
    this.fight = now.fighting ? LINGER : Math.max(0, this.fight - dt);
    const where = this.off ? null : now.where;
    const fighting = where !== null && this.fight > 0;
    this.battle.update(fighting, dt);
    this.shanties.update(where === 'sea' && now.singing && !fighting, dt);
    this.ashore.update(where === 'land' && !fighting, dt);
  }
}
