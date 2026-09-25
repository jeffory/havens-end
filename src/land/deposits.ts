import type { Good } from '../economy/goods';
import { Block, type BlockId } from '../voxel/blocks';
import type { VoxelWorld } from '../voxel/VoxelWorld';
import type { Footprint } from '../worldgen/buildings';

export type DepositKind = 'stone' | 'iron' | 'copper' | 'silver' | 'gold';

export interface DepositSpec {
  /** What the camp screen and hints call it. */
  label: string;
  /** The block its ore shows as (a stone outcrop is all boulder). */
  ore: BlockId;
  /** Pickaxe blows it stands before breaking up. */
  blows: number;
  good: Good;
  /** How much it gives, least and most. */
  yield: readonly [number, number];
}

/** The five kinds of outcrop: stone everywhere, gold rare and far out. */
export const DEPOSITS: Record<DepositKind, DepositSpec> = {
  stone: { label: 'boulder', ore: Block.Boulder, blows: 3, good: 'stone', yield: [3, 4] },
  iron: { label: 'iron ore', ore: Block.IronOre, blows: 4, good: 'ore', yield: [2, 3] },
  copper: { label: 'copper ore', ore: Block.CopperOre, blows: 4, good: 'copperOre', yield: [2, 3] },
  silver: { label: 'silver ore', ore: Block.SilverOre, blows: 5, good: 'silverOre', yield: [1, 2] },
  gold: { label: 'gold ore', ore: Block.GoldOre, blows: 6, good: 'goldOre', yield: [1, 1] },
};

/** Days (on the sea's clock) a worked-out outcrop takes to grow back. */
export const REGROW_DAYS = 3;

/** An outcrop: the corner of its 2 × 2 footprint, and its blocks as they stand (x, y, z, block). */
export interface Deposit {
  id: number;
  kind: DepositKind;
  x: number;
  z: number;
  cells: ReadonlyArray<readonly [number, number, number, BlockId]>;
}

/** The middle of an outcrop's footprint: where a miner heads for. */
export const depositCentre = (d: Deposit): { x: number; z: number } => ({ x: d.x + 1, z: d.z + 1 });

export interface DepositsSnapshot {
  /** Worked-out outcrops, and the day (with its fraction) each was worked out. */
  worked: Array<{ id: number; at: number }>;
  /** Outcrops a save's own edits wiped out: they never grow back. */
  gone?: number[];
}

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

/**
 * Every outcrop in the world, placed when it was generated, and what's happened to
 * each: blows taken (not saved, like a tree's), worked out and when, growing back.
 */
export class Deposits {
  private readonly byCell = new Map<string, Deposit>();
  private readonly ids = new Map<number, Deposit>();
  private readonly blows = new Map<number, number>();
  private readonly worked = new Map<number, number>();
  private readonly gone = new Set<number>();

  constructor(readonly list: readonly Deposit[] = []) {
    for (const d of list) {
      this.ids.set(d.id, d);
      for (const [x, y, z] of d.cells) this.byCell.set(key(x, y, z), d);
    }
  }

  /** The standing outcrop with a block at (x, y, z), if any. */
  at(x: number, y: number, z: number): Deposit | null {
    const d = this.byCell.get(key(x, y, z));
    return d && this.standing(d) ? d : null;
  }

  byId(id: number): Deposit | undefined {
    return this.ids.get(id);
  }

  standing(d: Deposit): boolean {
    return !this.worked.has(d.id) && !this.gone.has(d.id);
  }

  /** One more blow on an outcrop; returns how many it has taken. */
  blow(d: Deposit): number {
    const n = (this.blows.get(d.id) ?? 0) + 1;
    this.blows.set(d.id, n);
    return n;
  }

  /** The outcrop is worked out: its blocks go, and it starts growing back. Returns where its blocks were. */
  workOut(world: VoxelWorld, d: Deposit, day: number): Array<[number, number, number]> {
    for (const [x, y, z] of d.cells) world.setVoxel(x, y, z, Block.Air);
    this.worked.set(d.id, day);
    this.blows.delete(d.id);
    return d.cells.map(([x, y, z]) => [x, y, z]);
  }

  /**
   * Outcrops due back by `day` grow back if every block of theirs is `clear`, and each
   * rests on `firm` ground (or on another block of its own): none hangs over a hole.
   * Returns those that did.
   */
  regrow(
    world: VoxelWorld,
    day: number,
    clear: (x: number, y: number, z: number) => boolean,
    firm: (x: number, y: number, z: number) => boolean = () => true,
  ): Deposit[] {
    const back: Deposit[] = [];
    for (const [id, at] of this.worked) {
      const d = this.ids.get(id);
      if (!d || day < at + REGROW_DAYS || !d.cells.every(([x, y, z]) => clear(x, y, z))) continue;
      const own = (x: number, y: number, z: number) => d.cells.some((c) => c[0] === x && c[1] === y && c[2] === z);
      if (!d.cells.every(([x, y, z]) => own(x, y - 1, z) || firm(x, y - 1, z))) continue;
      for (const [x, y, z, block] of d.cells) world.setVoxel(x, y, z, block);
      this.worked.delete(id);
      back.push(d);
    }
    return back;
  }

  /** Standing outcrops whose middle is within `r` of (x, z). */
  within(x: number, z: number, r: number): Deposit[] {
    return this.list.filter((d) => this.standing(d) && distance(d, x, z) <= r);
  }

  /** Days until the first worked-out outcrop within `r` of (x, z) is due back; null if none is. */
  dueIn(x: number, z: number, r: number, day: number): number | null {
    let soonest: number | null = null;
    for (const [id, at] of this.worked) {
      const d = this.ids.get(id);
      if (!d || distance(d, x, z) > r) continue;
      const left = Math.max(0, at + REGROW_DAYS - day);
      if (soonest === null || left < soonest) soonest = left;
    }
    return soonest;
  }

  /** Is any outcrop, standing or worked out, within `r` of (x, z)? Treasure is buried clear of them. */
  near(x: number, z: number, r: number): boolean {
    return this.list.some((d) => !this.gone.has(d.id) && distance(d, x, z) <= r);
  }

  /** A standing outcrop with a block inside the plot grown by `margin` each way, if any. */
  inPlot(plot: Footprint, margin: number): Deposit | null {
    const x0 = plot.x0 - margin;
    const z0 = plot.z0 - margin;
    const x1 = plot.x0 + plot.w + margin;
    const z1 = plot.z0 + plot.d + margin;
    return this.list.find((d) => this.standing(d) && d.cells.some(([x, , z]) => x >= x0 && x < x1 && z >= z0 && z < z1)) ?? null;
  }

  /**
   * After a load, squares the record with the world. An outcrop the save calls worked
   * out whose blocks all stand counts as standing. One that should be standing but has
   * no block left was wiped out by the save's own edits (made before outcrops existed):
   * on a camp's claim it's retired for good, so it can't grow up in the middle of the
   * camp; anywhere else it counts as worked out `day`, and grows back in time.
   */
  reconcile(world: VoxelWorld, day: number, claimed: (x: number, z: number) => boolean): void {
    const is = (d: Deposit, all: boolean) => d.cells.every(([x, y, z, block]) => (world.getVoxel(x, y, z) === block) === all);
    for (const d of this.list) {
      if (this.gone.has(d.id)) continue;
      if (this.worked.has(d.id)) {
        if (is(d, true)) this.worked.delete(d.id);
        continue;
      }
      if (!is(d, false)) continue;
      const c = depositCentre(d);
      if (claimed(c.x, c.z)) this.gone.add(d.id);
      else this.worked.set(d.id, day);
    }
  }

  snapshot(): DepositsSnapshot {
    return { worked: [...this.worked].map(([id, at]) => ({ id, at })), gone: [...this.gone] };
  }

  restore(s: DepositsSnapshot): void {
    this.worked.clear();
    this.blows.clear();
    this.gone.clear();
    for (const { id, at } of s.worked) if (this.ids.has(id)) this.worked.set(id, at);
    for (const id of s.gone ?? []) if (this.ids.has(id)) this.gone.add(id);
  }
}

function distance(d: Deposit, x: number, z: number): number {
  const c = depositCentre(d);
  return Math.hypot(c.x - x, c.z - z);
}
