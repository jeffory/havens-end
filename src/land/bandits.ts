import type { Cargo } from '../economy/goods';
import { Block } from '../voxel/blocks';
import type { VoxelReader } from '../voxel/raycast';
import type { BanditCamp } from '../worldgen/bandits';

/** No campfire within this of a manned camp; a claim within this keeps a cleared camp empty for good. */
export const HOLD_RADIUS = 60;
/** A cleared camp is manned again after this many days (sea clock). */
export const CAMP_BACK_DAYS = 5;
/** The captain is on a camp's islet within this of its shore. */
const ISLET_MARGIN = 25;
/** The chest opens from this close. */
const CHEST_REACH = 2.2;
/** What a chest holds, by how far out the camp is. */
const CHEST_GOLD: Record<0 | 1 | 2, readonly [number, number]> = { 0: [40, 100], 1: [90, 180], 2: [160, 300] };
const CHEST_GOODS: Record<0 | 1 | 2, Cargo> = {
  0: { rum: 3, cartridges: 6 },
  1: { rum: 3, tobacco: 2, cartridges: 8 },
  2: { spice: 2, muskets: 1, cartridges: 10 },
};

/** How a camp stands. */
export interface CampState {
  /** Bandits holding it (fallen and fled ones are gone). */
  left: number;
  /** The day (with its fraction) the last of them went, or null while it's manned. */
  cleared: number | null;
  looted: boolean;
  /** Never manned again: someone's camp claims its ground, or an old save's edits wiped it out. */
  gone: boolean;
}

export interface BanditsSnapshot {
  camps: Array<{ id: number } & CampState>;
}

/**
 * The bandits' camps and how each stands: manned, cleared and when, looted, back again
 * five days on, or gone for good. The bandits themselves are stepped only for the camp on
 * the islet the captain walks (`stepBandits`); they aren't saved.
 */
export class Bandits {
  /** The bandits of the camp the captain's islet holds, while they're there to be met. */
  live: Bandit[] = [];
  liveCamp: number | null = null;
  nextBandit = 1;
  private readonly states = new Map<number, CampState>();

  constructor(readonly camps: readonly BanditCamp[] = []) {
    for (const c of camps) this.states.set(c.id, { left: c.size, cleared: null, looted: false, gone: false });
  }

  state(id: number): CampState {
    return this.states.get(id)!;
  }

  manned(camp: BanditCamp): boolean {
    const s = this.state(camp.id);
    return !s.gone && s.left > 0;
  }

  /** The camp holding the islet at (x, z), if any. */
  campFor(x: number, z: number): BanditCamp | undefined {
    return this.camps.find((c) => !this.state(c.id).gone && Math.hypot(c.islandX - x, c.islandZ - z) < c.islandRadius + ISLET_MARGIN);
  }

  /** Is a camp (manned or not, bar the gone) within `r` of (x, z)? Treasure is buried clear of them. */
  near(x: number, z: number, r: number): boolean {
    return this.camps.some((c) => !this.state(c.id).gone && Math.hypot(c.x - x, c.z - z) < r);
  }

  /** Does a manned camp hold the ground at (x, z)? No campfire goes there. */
  holds(x: number, z: number): boolean {
    return this.camps.some((c) => this.manned(c) && Math.hypot(c.x - x, c.z - z) < HOLD_RADIUS);
  }

  /** A bandit is gone (fallen, or fled): true when that was the last of them, and the camp is cleared. */
  lose(camp: BanditCamp, day: number): boolean {
    const s = this.state(camp.id);
    if (s.left <= 0) return false;
    s.left -= 1;
    if (s.left > 0) return false;
    s.cleared = day;
    return true;
  }

  /** Cleared camps are manned again `CAMP_BACK_DAYS` on, unless a camp of the captain's now claims ground near. */
  reman(day: number, claimNear: (x: number, z: number, r: number) => boolean): void {
    for (const c of this.camps) {
      const s = this.state(c.id);
      if (s.gone || s.left > 0 || s.cleared === null) continue;
      if (claimNear(c.x, c.z, HOLD_RADIUS)) s.gone = true;
      else if (day >= s.cleared + CAMP_BACK_DAYS) Object.assign(s, { left: c.size, cleared: null, looted: false });
    }
  }

  /** A camp whose unlooted chest is at hand from (x, z). */
  chestAt(x: number, z: number): BanditCamp | undefined {
    return this.camps.find((c) => {
      const s = this.state(c.id);
      return !s.gone && !s.looted && Math.hypot(c.chest.x + 0.5 - x, c.chest.z + 0.5 - z) < CHEST_REACH;
    });
  }

  /** Opens a camp's chest: gold and goods by how far out it is. */
  loot(camp: BanditCamp, random: () => number): { gold: number; goods: Cargo } {
    this.state(camp.id).looted = true;
    const [lo, hi] = CHEST_GOLD[camp.tier];
    return { gold: Math.round(lo + random() * (hi - lo)), goods: { ...CHEST_GOODS[camp.tier] } };
  }

  /**
   * After a load, squares the camps with the world: one whose fire an old save's own edits
   * wiped out, or whose ground a camp of the captain's already claims, is never manned.
   */
  reconcile(world: VoxelReader, claimNear: (x: number, z: number, r: number) => boolean): void {
    for (const c of this.camps) {
      if (world.getVoxel(c.x, c.y, c.z) !== Block.Embers || claimNear(c.x, c.z, HOLD_RADIUS)) this.state(c.id).gone = true;
    }
  }

  /** Is a fight on? */
  fighting(): boolean {
    return this.live.some((b) => b.mode === 'fight');
  }

  snapshot(): BanditsSnapshot {
    return { camps: [...this.states].map(([id, s]) => ({ id, ...s })) };
  }

  restore(s: BanditsSnapshot): void {
    for (const c of s.camps) {
      const state = this.states.get(c.id);
      if (state) Object.assign(state, { left: c.left, cleared: c.cleared, looted: c.looted, gone: c.gone });
    }
    this.live = [];
    this.liveCamp = null;
  }
}

/** A bandit: Task 11 fills this out (walker, health, what they're doing). */
export interface Bandit {
  id: number;
  mode: 'ease' | 'fight' | 'flee';
}
