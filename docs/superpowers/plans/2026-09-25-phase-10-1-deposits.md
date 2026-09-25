# Phase 10.1: Deposits & Ores Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Outcrops of stone, iron, copper, silver and gold on the islands, worked with the pickaxe (and by settler miners), that grow back three days after they're worked out; three new ore goods sold in the markets.

**Architecture:** `land/deposits.ts` holds the five kinds and a `Deposits` registry: which outcrop owns which block, blows, worked-out days, growing back, saving. `worldgen/deposits.ts` places the outcrops, from the seed, after the archipelago is built and before the world starts tracking edits. `Land` routes pickaxe blows to the registry and steps the growing back. The settlers get a `miner` job. Everything is pure simulation with no three.js, apart from the settler figure's tool in `PeopleView`.

**Tech Stack:** TypeScript (strict), Vite, Vitest, vanilla Three.js (render only).

**Spec:** `docs/phase-10-deposits-guns-sound.md` (section 10.1)

## Global Constraints

- **No commits until the player says so.** 10.1 is one commit, made when the player says "commit" after the browser check (Task 7). Don't run `git commit` in any earlier task.
- **Existing tests must keep passing.** Run `npx vitest run` and `npx tsc --noEmit -p .` at the end of every task.
- **World generation stays deterministic in `WORLD_SEED`.** Outcrops use their own RNG, `mulberry32(seed ^ 0xde90)`, and are placed after `buildArchipelago` and before `world.trackEdits()`.
- **Market line order is part of the save format** (`Economy.restore` matches stock by line index). The new ore lines go at the **end** of `CAMP_GOODS`.
- **Save version 5** (`SAVE_VERSION = 5`, `READABLE_VERSIONS = [1, 2, 3, 4, 5]`). Older saves still load.
- **Comments and player-facing text** match the codebase: short doc comments, British spelling, and plain words ("outcrop", "worked out", "grows back").
- **Existing ids stay put.** `Block.Copper` (28) is the distillery's copper still. The new blocks take ids 37–40.

## Review Focus

These are the cases the spec implies that users will hit first. Each has a test in the task that owns the code.

1. **An old save's own edits wipe out an outcrop.** Its chunk was saved before outcrops existed, so loading it replaces the outcrop's blocks. That outcrop must never grow back into the player's camp. → Task 4 test "an outcrop a save's own edits wiped out never grows back".
2. **Someone stands where an outcrop grows back.** It must wait until the spot is clear, not grow up around the captain, a settler or a beast. → Task 4 test "grows back after three days, but not into someone standing there".
3. **A building over a worked-out outcrop's spot.** The outcrop never grows back into it. → Task 4 test "a building on a worked-out outcrop's spot keeps it from growing back".
4. **The captain mines an outcrop a miner is walking to.** The miner finds it gone, takes nothing, and picks something else. → Task 6 test "a miner who finds the outcrop gone takes nothing, and finds other work".
5. **A full storehouse.** A miner doesn't break an outcrop they can't store. → Task 6 test "a miner with a full storehouse leaves the outcrop standing".

---

## File map

| File | Change |
|---|---|
| `src/voxel/blocks.ts` | Four blocks: `Boulder`, `CopperOre`, `SilverOre`, `GoldOre` |
| `src/economy/goods.ts` | Goods `copperOre`, `silverOre`, `goldOre` |
| `src/economy/market.ts` | Their market roles, appended to `CAMP_GOODS` |
| `src/render/itemIcons.ts` | Their icons |
| `src/land/deposits.ts` (new) | Kinds table, `Deposits` registry |
| `src/land/deposits.test.ts` (new) | Registry tests |
| `src/worldgen/deposits.ts` (new) | `placeDeposits`: where outcrops go, and raising them |
| `src/worldgen/deposits.test.ts` (new) | Placement tests |
| `src/worldgen/island.ts` | Iron veins removed |
| `src/land/Land.ts` | Pickaxe on outcrops only, blows and yield, growing back, buildings refused over outcrops, snapshot/restore, `day()`, `mineDeposit()` |
| `src/land/Land.test.ts` | Mining, growing back, saving; the reach tests moved onto outcrops |
| `src/treasure/Treasure.ts` | Chest sites keep clear of outcrops |
| `src/land/settlers.ts` | `miner` job and `mine` task |
| `src/land/settlers.test.ts` | Miner tests |
| `src/render/PeopleView.ts` | Miners carry a pickaxe, and swing it |
| `src/ui/CampScreen.tsx` | "Miner" in the job list |
| `src/save/storage.ts` | Version 5 |
| `src/Game.ts` | Places outcrops, hands them to `Land` |
| `docs/ARCHITECTURE.md`, `README.md` | What was built |

---

### Task 1: Blocks, goods, markets and icons

**Files:**
- Modify: `src/voxel/blocks.ts`
- Modify: `src/economy/goods.ts`
- Modify: `src/economy/market.ts` (the `CAMP_GOODS` table)
- Modify: `src/render/itemIcons.ts`
- Test: `src/economy/economy.test.ts`

**Interfaces:**
- Produces: `Block.Boulder` (37), `Block.CopperOre` (38), `Block.SilverOre` (39), `Block.GoldOre` (40); goods `'copperOre' | 'silverOre' | 'goldOre'` in `Good`.

- [ ] **Step 1: Write the failing test** (append to the `describe('camp goods', …)` block in `src/economy/economy.test.ts`)

```ts
  it('deal in the new ores: the Guild's foundries want copper, the Crown's mint silver and gold, the Brethren gold', () => {
    const { economy } = setup();
    const role = (port: Port, good: string) => economy.lines(port).find((l) => l.good === good)?.role;
    const free = economy.ports.find((p) => p.faction === 'merchant')!;
    const nest = economy.ports.find((p) => p.faction === 'pirate')!;
    const crown = economy.ports.find((p) => p.faction === 'imperial')!;
    expect(role(free, 'copperOre')).toBe('demands');
    expect(role(crown, 'silverOre')).toBe('demands');
    expect(role(crown, 'goldOre')).toBe('demands');
    expect(role(nest, 'goldOre')).toBe('demands');
    // They come after every older line, so earlier saves' stocks still line up.
    const lines = economy.lines(free).map((l) => l.good);
    expect(lines.slice(-3)).toEqual(['copperOre', 'silverOre', 'goldOre']);
    expect(GOOD_INFO.goldOre.price).toBeGreaterThan(GOOD_INFO.silverOre.price);
    expect(GOOD_INFO.silverOre.price).toBeGreaterThan(GOOD_INFO.copperOre.price);
  });
```

Add `GOOD_INFO` to the test file's imports from `./goods` if it isn't imported yet.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/economy/economy.test.ts -t "new ores"`
Expected: FAIL (type error or `undefined` role for `copperOre`).

- [ ] **Step 3: Add the blocks** (`src/voxel/blocks.ts`)

In `Block`, after `Cairn: 36,`:

```ts
  // Phase 10: outcrops of stone and ore
  Boulder: 37,
  CopperOre: 38,
  SilverOre: 39,
  GoldOre: 40,
```

In `DEFS`, after the `Cairn` entry:

```ts
  [Block.Boulder]: { name: 'boulder', color: 0xa8a49a },
  [Block.CopperOre]: { name: 'copper ore', color: 0x3f9a7d },
  [Block.SilverOre]: { name: 'silver ore', color: 0xc9d1d8 },
  [Block.GoldOre]: { name: 'gold ore', color: 0xe0b83a },
```

- [ ] **Step 4: Add the goods** (`src/economy/goods.ts`)

In `GOODS`, after `'ore',` add `'copperOre', 'silverOre', 'goldOre',`. In `GOOD_INFO`, after the `ore` entry:

```ts
  copperOre: { label: 'Copper ore', price: 10, kind: 'produce' },
  silverOre: { label: 'Silver ore', price: 28, kind: 'produce' },
  goldOre: { label: 'Gold ore', price: 60, kind: 'produce' },
```

- [ ] **Step 5: Give them market roles** (`src/economy/market.ts`, the **end** of `CAMP_GOODS`, after `provisions`)

```ts
  // Phase 10's ores, last so older saves' lines keep their places: the Guild's
  // foundries want copper, the Crown's mint silver and gold, the Brethren gold.
  copperOre: { merchant: 'demands', pirate: 'trades', imperial: 'trades' },
  silverOre: { merchant: 'trades', pirate: 'trades', imperial: 'demands' },
  goldOre: { merchant: 'trades', pirate: 'demands', imperial: 'demands' },
```

- [ ] **Step 6: Icons** (`src/render/itemIcons.ts`, in `ICONS`, after `ore`)

```ts
  copperOre: {
    colors: { ...STONE_COLORS, o: 0x3f9a7d },
    rows: ['............', '............', '....aaaa....', '..aabbobaa..', '.abbcbbbooa.', '.aoccbbbdba.', 'abobbbbddbba', 'abbbdboobbba', '.abbbbbobda.', '..aaaaaaaa..', '............', '............'],
  },
  silverOre: {
    colors: { ...STONE_COLORS, o: 0xe8eef2 },
    rows: ['............', '............', '....aaaa....', '..aabbobaa..', '.abbcbbbooa.', '.aoccbbbdba.', 'abobbbbddbba', 'abbbdboobbba', '.abbbbbobda.', '..aaaaaaaa..', '............', '............'],
  },
  goldOre: {
    colors: { ...STONE_COLORS, o: 0xf2c94c },
    rows: ['............', '............', '....aaaa....', '..aabbobaa..', '.abbcbbbooa.', '.aoccbbbdba.', 'abobbbbddbba', 'abbbdboobbba', '.abbbbbobda.', '..aaaaaaaa..', '............', '............'],
  },
```

- [ ] **Step 7: Run the tests and typecheck**

Run: `npx vitest run && npx tsc --noEmit -p .`
Expected: all pass. (The existing test "leave the older lines as they were" must still pass.)

---

### Task 2: The `Deposits` registry

**Files:**
- Create: `src/land/deposits.ts`
- Test: `src/land/deposits.test.ts`

**Interfaces:**
- Consumes: `Block.*` and goods from Task 1.
- Produces (exact exports of `src/land/deposits.ts`):
  - `type DepositKind = 'stone' | 'iron' | 'copper' | 'silver' | 'gold'`
  - `interface DepositSpec { label: string; ore: BlockId; blows: number; good: Good; yield: readonly [number, number] }`
  - `const DEPOSITS: Record<DepositKind, DepositSpec>`
  - `const REGROW_DAYS = 3`
  - `interface Deposit { id: number; kind: DepositKind; x: number; z: number; cells: ReadonlyArray<readonly [number, number, number, BlockId]> }`: `(x, z)` is the corner of its 2 × 2 footprint; cells are `[x, y, z, block]`.
  - `const depositCentre = (d: Deposit) => ({ x: d.x + 1, z: d.z + 1 })`
  - `interface DepositsSnapshot { worked: Array<{ id: number; at: number }>; gone?: number[] }`
  - `class Deposits` with `list`, `at(x,y,z)`, `byId(id)`, `standing(d)`, `blow(d)`, `workOut(world, d, day)`, `regrow(world, day, clear)`, `within(x, z, r)`, `dueIn(x, z, r, day)`, `near(x, z, r)`, `inPlot(plot, margin)`, `reconcile(world)`, `snapshot()`, `restore(s)`, all with the signatures in Step 3.

- [ ] **Step 1: Write the failing tests** (`src/land/deposits.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { Block } from '../voxel/blocks';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { type Deposit, DEPOSITS, Deposits, REGROW_DAYS } from './deposits';

/** A copper outcrop on flat ground at y = 10: four blocks and one on top. */
function copper(id = 1, x = 0, z = 0): Deposit {
  const o = Block.CopperOre;
  return { id, kind: 'copper', x, z, cells: [[x, 10, z, o], [x + 1, 10, z, o], [x, 10, z + 1, Block.Boulder], [x + 1, 10, z + 1, o], [x, 11, z, o]] };
}

function standing(world: VoxelWorld, d: Deposit): void {
  for (const [x, y, z, b] of d.cells) world.setVoxel(x, y, z, b);
}

describe('deposits', () => {
  it('know which outcrop a block belongs to, while it stands', () => {
    const world = new VoxelWorld();
    const d = copper();
    standing(world, d);
    const deposits = new Deposits([d]);
    expect(deposits.at(1, 10, 1)).toBe(d);
    expect(deposits.at(0, 11, 0)).toBe(d);
    expect(deposits.at(1, 11, 1)).toBeNull();
    deposits.workOut(world, d, 4.5);
    expect(deposits.at(1, 10, 1)).toBeNull();
    expect(world.getVoxel(0, 11, 0)).toBe(Block.Air);
  });

  it('count blows, and forget them once the outcrop is worked out', () => {
    const world = new VoxelWorld();
    const d = copper();
    standing(world, d);
    const deposits = new Deposits([d]);
    expect(deposits.blow(d)).toBe(1);
    expect(deposits.blow(d)).toBe(2);
    deposits.workOut(world, d, 1);
    expect(deposits.regrow(world, 1 + REGROW_DAYS, () => true)).toEqual([d]);
    expect(deposits.blow(d)).toBe(1);
  });

  it('grow back after three days, where nothing is in the way', () => {
    const world = new VoxelWorld();
    const d = copper();
    standing(world, d);
    const deposits = new Deposits([d]);
    deposits.workOut(world, d, 2.25);
    expect(deposits.regrow(world, 2.25 + REGROW_DAYS - 0.01, () => true)).toEqual([]);
    expect(deposits.dueIn(1, 1, 5, 3.25)).toBeCloseTo(2);
    // Something standing in one of its blocks: it waits.
    expect(deposits.regrow(world, 6, (x, y, z) => !(x === 1 && y === 10 && z === 1))).toEqual([]);
    expect(deposits.regrow(world, 6, () => true)).toEqual([d]);
    for (const [x, y, z, b] of d.cells) expect(world.getVoxel(x, y, z)).toBe(b);
    expect(deposits.at(1, 10, 1)).toBe(d);
  });

  it('find standing outcrops near a spot, and anything in a plot', () => {
    const world = new VoxelWorld();
    const a = copper(1, 0, 0);
    const b = copper(2, 30, 0);
    standing(world, a);
    standing(world, b);
    const deposits = new Deposits([a, b]);
    expect(deposits.within(0, 0, 10)).toEqual([a]);
    expect(deposits.near(3, 3, 3)).toBe(true);
    expect(deposits.near(10, 10, 3)).toBe(false);
    expect(deposits.inPlot({ x0: -3, z0: -3, w: 3, d: 3 }, 0)).toBe(a);
    expect(deposits.inPlot({ x0: -4, z0: -4, w: 3, d: 3 }, 0)).toBeNull();
    expect(deposits.inPlot({ x0: -4, z0: -4, w: 3, d: 3 }, 1)).toBe(a);
    deposits.workOut(world, a, 1);
    expect(deposits.within(0, 0, 10)).toEqual([]);
    expect(deposits.inPlot({ x0: -3, z0: -3, w: 3, d: 3 }, 0)).toBeNull();
    expect(deposits.near(3, 3, 3)).toBe(true); // worked out or not, treasure keeps clear
  });

  it('save which outcrops are worked out, and when', () => {
    const world = new VoxelWorld();
    const d = copper();
    standing(world, d);
    const deposits = new Deposits([d]);
    deposits.workOut(world, d, 7.5);
    const saved = JSON.parse(JSON.stringify(deposits.snapshot()));
    const again = new Deposits([d]);
    again.restore(saved);
    expect(again.at(1, 10, 1)).toBeNull();
    expect(again.regrow(world, 7.5 + REGROW_DAYS, () => true)).toEqual([d]);
  });

  it('retire outcrops a save's own edits wiped out, for good; one only worked out is kept', () => {
    const world = new VoxelWorld();
    const wiped = copper(1, 0, 0);
    const mined = copper(2, 30, 0);
    const deposits = new Deposits([wiped, mined]);
    deposits.restore({ worked: [{ id: 2, at: 3 }] });
    // Neither has blocks in the world: one was mined (and saved as such), the other wiped by old edits.
    deposits.reconcile(world);
    expect(deposits.regrow(world, 100, () => true)).toEqual([mined]);
    expect(deposits.at(0, 10, 0)).toBeNull();
    expect(deposits.snapshot().gone).toEqual([1]);
  });

  it('have kinds that grow harder and scarcer to win toward gold', () => {
    expect(DEPOSITS.stone.blows).toBeLessThan(DEPOSITS.gold.blows);
    expect(DEPOSITS.gold.yield[1]).toBeLessThan(DEPOSITS.stone.yield[0]);
    expect(DEPOSITS.iron.good).toBe('ore');
    expect(DEPOSITS.copper.good).toBe('copperOre');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/land/deposits.test.ts`
Expected: FAIL, "Cannot find module './deposits'".

- [ ] **Step 3: Write `src/land/deposits.ts`**

```ts
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

  /** Outcrops due back by `day` grow back if every block of theirs is `clear`. Returns those that did. */
  regrow(world: VoxelWorld, day: number, clear: (x: number, y: number, z: number) => boolean): Deposit[] {
    const back: Deposit[] = [];
    for (const [id, at] of this.worked) {
      const d = this.ids.get(id);
      if (!d || day < at + REGROW_DAYS || !d.cells.every(([x, y, z]) => clear(x, y, z))) continue;
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
   * After a load: an outcrop that should be standing but has no block left in the world
   * was wiped out by the save's own edits (made before outcrops existed). It's retired
   * for good, so it can't grow up in the middle of someone's camp.
   */
  reconcile(world: VoxelWorld): void {
    for (const d of this.list) {
      if (!this.standing(d)) continue;
      if (d.cells.every(([x, y, z, block]) => world.getVoxel(x, y, z) !== block)) this.gone.add(d.id);
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
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/land/deposits.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Full run and typecheck**

Run: `npx vitest run && npx tsc --noEmit -p .`
Expected: all pass.

---

### Task 3: Placing outcrops in the world, and no more iron veins

**Files:**
- Create: `src/worldgen/deposits.ts`
- Test: `src/worldgen/deposits.test.ts`
- Modify: `src/worldgen/island.ts` (remove the vein lines)
- Test: `src/worldgen/island.test.ts` (one new test)

**Interfaces:**
- Consumes: `Deposit`, `DepositKind`, `DEPOSITS` from Task 2; `IslandPlan` from `./archipelago`; `groundHeight`, `TREE_BLOCKS` from `./buildings`.
- Produces: `placeDeposits(world: VoxelWorld, islands: readonly IslandPlan[], seed: number, tierOf: (x: number, z: number) => 0 | 1 | 2, avoid: (x: number, z: number) => boolean): Deposit[]`. It writes the outcrops' blocks into the world, and ids start at 1 in placement order.

- [ ] **Step 1: Write the failing tests** (`src/worldgen/deposits.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../config';
import { Block } from '../voxel/blocks';
import { VoxelWorld } from '../voxel/VoxelWorld';
import type { IslandPlan } from './archipelago';
import { placeDeposits } from './deposits';

const TOP = SEA_LEVEL + 4;

/** A flat grassy disc of an island, a ring of beach round it, and whatever else the test adds. */
function island(radius = 40): { world: VoxelWorld; plan: IslandPlan } {
  const world = new VoxelWorld();
  for (let x = -radius - 4; x <= radius + 4; x++) {
    for (let z = -radius - 4; z <= radius + 4; z++) {
      const r = Math.hypot(x, z);
      if (r > radius + 4) continue;
      const beach = r > radius;
      const top = beach ? SEA_LEVEL + 1 : TOP;
      for (let y = 0; y < top; y++) world.setVoxel(x, y, z, y === top - 1 ? (beach ? Block.Sand : Block.Grass) : Block.Dirt);
    }
  }
  return { world, plan: { seed: 3, centerX: 0, centerZ: 0, radius, peak: 6, port: null } };
}

const home = () => 0 as const;
const far = () => 2 as const;
const nowhere = () => false;

describe('placing outcrops', () => {
  it('puts a few on an island, on open grass, apart, standing on the ground', () => {
    const { world, plan } = island();
    const deposits = placeDeposits(world, [plan], 1, home, nowhere);
    expect(deposits.length).toBeGreaterThanOrEqual(5);
    expect(deposits.map((d) => d.id)).toEqual(deposits.map((_, i) => i + 1));
    for (const d of deposits) {
      expect(d.cells.length).toBeGreaterThanOrEqual(3);
      expect(d.cells.length).toBeLessThanOrEqual(5);
      for (const [x, y, z, block] of d.cells) {
        expect(world.getVoxel(x, y, z)).toBe(block);
        expect(Math.hypot(x, z)).toBeLessThan(plan.radius);
        const under = world.getVoxel(x, y - 1, z);
        expect([Block.Grass, block, ...d.cells.map((c) => c[3])]).toContain(under);
      }
      for (const o of deposits) if (o !== d) expect(Math.max(Math.abs(o.x - d.x), Math.abs(o.z - d.z))).toBeGreaterThanOrEqual(7);
    }
  });

  it('is the same every time for the same seed', () => {
    const a = placeDeposits(island().world, [island().plan], 5, home, nowhere);
    const b = placeDeposits(island().world, [island().plan], 5, home, nowhere);
    expect(a).toEqual(b);
  });

  it('keeps off the beach, out of where it’s told to avoid, and away from trees', () => {
    const { world, plan } = island();
    for (let y = TOP; y < TOP + 5; y++) world.setVoxel(10, y, 10, Block.Wood);
    world.setVoxel(10, TOP + 5, 10, Block.Leaves);
    const deposits = placeDeposits(world, [plan], 2, home, (x) => x < 0);
    for (const d of deposits) {
      expect(d.x).toBeGreaterThanOrEqual(0);
      for (const [x, y, z] of d.cells) {
        expect(world.getVoxel(x, y - 1, z)).not.toBe(Block.Sand);
        expect(Math.max(Math.abs(x - 10), Math.abs(z - 10))).toBeGreaterThan(1);
      }
    }
  });

  it('has no silver or gold in home waters, and some of both far out', () => {
    const kinds = (tierOf: () => 0 | 1 | 2) => {
      const found = new Set<string>();
      for (let seed = 1; seed <= 12; seed++) for (const d of placeDeposits(island(60).world, [island(60).plan], seed, tierOf, nowhere)) found.add(d.kind);
      return found;
    };
    const near = kinds(home);
    expect(near.has('silver') || near.has('gold')).toBe(false);
    expect(near.has('stone') && near.has('iron') && near.has('copper')).toBe(true);
    const out = kinds(far);
    expect(out.has('silver') && out.has('gold')).toBe(true);
  });

  it('shows ore in every ore outcrop, and a stone outcrop is all boulder', () => {
    for (const d of placeDeposits(island(60).world, [island(60).plan], 9, far, nowhere)) {
      const blocks = d.cells.map((c) => c[3]);
      if (d.kind === 'stone') expect(blocks.every((b) => b === Block.Boulder)).toBe(true);
      else expect(blocks.some((b) => b !== Block.Boulder)).toBe(true);
    }
  });
});
```

Add to `src/worldgen/island.test.ts` (inside its top-level `describe`, using that file's existing imports; add `Block` and `VoxelWorld` imports if missing):

```ts
  it('has no iron veins in the rock: iron comes from outcrops now', () => {
    const world = new VoxelWorld();
    const plan = { seed: 11, centerX: 0, centerZ: 0, radius: 40, peak: 20 };
    generateIsland(world, plan);
    for (let x = -64; x <= 64; x++) for (let z = -64; z <= 64; z++) for (let y = 0; y < 60; y++) expect(world.getVoxel(x, y, z)).not.toBe(Block.IronOre);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/worldgen/deposits.test.ts src/worldgen/island.test.ts`
Expected: FAIL. The deposits module is missing, and the island test finds `IronOre`.

- [ ] **Step 3: Write `src/worldgen/deposits.ts`**

```ts
import { SEA_LEVEL } from '../config';
import { type Deposit, type DepositKind, DEPOSITS } from '../land/deposits';
import { Block, type BlockId } from '../voxel/blocks';
import type { VoxelWorld } from '../voxel/VoxelWorld';
import type { IslandPlan } from './archipelago';
import { groundHeight, TREE_BLOCKS } from './buildings';
import { mulberry32 } from './noise';

/** An island gets an outcrop for about every this many square voxels of it. */
const AREA_PER_DEPOSIT = 700;
/** Outcrops keep at least this far apart (either way). */
const SPACING = 7;
/** Spots tried per outcrop wanted. */
const TRIES = 60;
/** How many blocks of an ore outcrop show ore (the rest are boulder). */
const ORE_SHARE = 0.6;
/** The mix of kinds by region: home waters, contested waters, Imperial waters. */
const MIX: Record<0 | 1 | 2, Record<DepositKind, number>> = {
  0: { stone: 0.55, iron: 0.25, copper: 0.2, silver: 0, gold: 0 },
  1: { stone: 0.45, iron: 0.2, copper: 0.2, silver: 0.12, gold: 0.03 },
  2: { stone: 0.4, iron: 0.15, copper: 0.15, silver: 0.18, gold: 0.12 },
};

/**
 * Raises the islands' outcrops of stone and ore, and returns them. Deterministic in
 * `seed` and the world as generated: run it after the archipelago is built and before
 * the world starts tracking edits. `tierOf` says how far out an island lies (it picks
 * the mix); `avoid` rules spots out (town land).
 */
export function placeDeposits(
  world: VoxelWorld,
  islands: readonly IslandPlan[],
  seed: number,
  tierOf: (x: number, z: number) => 0 | 1 | 2,
  avoid: (x: number, z: number) => boolean,
): Deposit[] {
  const random = mulberry32(seed ^ 0xde90);
  const out: Deposit[] = [];
  for (const plan of islands) {
    const mix = MIX[tierOf(plan.centerX, plan.centerZ)];
    const wanted = Math.max(1, Math.round((Math.PI * plan.radius ** 2) / AREA_PER_DEPOSIT));
    let placed = 0;
    for (let attempt = 0; attempt < wanted * TRIES && placed < wanted; attempt++) {
      const angle = random() * Math.PI * 2;
      const r = Math.sqrt(random()) * plan.radius * 0.85;
      const x = Math.round(plan.centerX + Math.sin(angle) * r);
      const z = Math.round(plan.centerZ + Math.cos(angle) * r);
      if (avoid(x, z) || out.some((d) => Math.max(Math.abs(d.x - x), Math.abs(d.z - z)) < SPACING) || !footing(world, x, z)) continue;
      out.push(raise(world, out.length + 1, pick(mix, random()), x, z, random));
      placed++;
    }
  }
  return out;
}

/** Can an outcrop stand at (x, z) (its 2 × 2 footprint)? Dry grass, earth or rock, near level, no tree on or beside it. */
function footing(world: VoxelWorld, x: number, z: number): boolean {
  let lo = Infinity;
  let hi = -Infinity;
  for (let dx = -1; dx <= 2; dx++) {
    for (let dz = -1; dz <= 2; dz++) {
      const top = groundHeight(world, x + dx, z + dz);
      for (let y = top; y < top + 8; y++) if (TREE_BLOCKS.has(world.getVoxel(x + dx, y, z + dz))) return false;
      if (dx < 0 || dx > 1 || dz < 0 || dz > 1) continue;
      const ground = world.getVoxel(x + dx, top - 1, z + dz);
      if (top < SEA_LEVEL + 3 || world.getVoxel(x + dx, top, z + dz) !== Block.Air) return false;
      if (ground !== Block.Grass && ground !== Block.Dirt && ground !== Block.Stone) return false;
      lo = Math.min(lo, top);
      hi = Math.max(hi, top);
    }
  }
  return hi - lo <= 1;
}

/** A kind, by weight. */
function pick(mix: Record<DepositKind, number>, roll: number): DepositKind {
  const kinds = Object.keys(mix) as DepositKind[];
  const total = kinds.reduce((n, k) => n + mix[k], 0);
  let left = roll * total;
  for (const k of kinds) {
    left -= mix[k];
    if (left < 0 && mix[k] > 0) return k;
  }
  return 'stone';
}

/** Builds an outcrop into the world: three or four blocks on the ground, sometimes one on top. */
function raise(world: VoxelWorld, id: number, kind: DepositKind, x: number, z: number, random: () => number): Deposit {
  const ore = DEPOSITS[kind].ore;
  const columns: Array<[number, number]> = [[0, 0], [1, 0], [0, 1], [1, 1]];
  const dropped = random() < 0.3 ? Math.floor(random() * 4) : -1;
  const cells: Array<[number, number, number, BlockId]> = [];
  columns.forEach(([dx, dz], i) => {
    if (i !== dropped) cells.push([x + dx, groundHeight(world, x + dx, z + dz), z + dz, ore]);
  });
  if (random() < 0.7) {
    const [cx, cy, cz] = cells[Math.floor(random() * cells.length)];
    cells.push([cx, cy + 1, cz, ore]);
  }
  // Ore shows in most of an ore outcrop's blocks, always its last (the top, when it has one).
  cells.forEach((c, i) => {
    if (kind !== 'stone' && i < cells.length - 1 && random() >= ORE_SHARE) c[3] = Block.Boulder;
  });
  for (const [cx, cy, cz, block] of cells) world.setVoxel(cx, cy, cz, block);
  return { id, kind, x, z, cells };
}
```

Two details to get right here:
- For a stone outcrop, `DEPOSITS.stone.ore` is already `Block.Boulder`, so it comes out all boulder.
- The top block sits on the cell it was stacked on. That cell was pushed before it, so `groundHeight` is never read for a column that already has a block.

- [ ] **Step 4: Remove the iron veins** (`src/worldgen/island.ts`)
  - Delete `ORE_SCALE`, `ORE_THRESHOLD` and their doc comment.
  - Delete the line `const oreNoise = seededNoise2D(random);`. `random` isn't used after it; trees use `hash2`, so the rest of the island is unchanged.
  - Delete the `vein` line and the `if (vein …) id = Block.IronOre;` line.
  - Remove `hash3` from the `../util/hash` import if nothing else in the file uses it. Check with `grep -n hash3 src/worldgen/island.ts`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/worldgen`
Expected: PASS.

- [ ] **Step 6: Full run and typecheck**

Run: `npx vitest run && npx tsc --noEmit -p .`
Expected: all pass.

---

### Task 4: The pickaxe works outcrops, which grow back; buildings, treasure and saves respect them

**Files:**
- Modify: `src/land/Land.ts`
- Modify: `src/treasure/Treasure.ts:339` (the `planSite` avoid callback)
- Modify: `src/save/storage.ts` (version 5)
- Test: `src/land/Land.test.ts`, `src/treasure/treasure.test.ts`

**Interfaces:**
- Consumes: `Deposits`, `DEPOSITS`, `Deposit`, `DepositsSnapshot` (Task 2).
- Produces on `Land`:
  - `deposits: Deposits`: a public field, default `new Deposits()`, which the game replaces.
  - `day(): number`: `sea.clock.day + sea.clock.phase`.
  - `mineDeposit(id: number): { good: Good; amount: number; x: number; y: number; z: number } | null`: a miner's whole outcrop. Null if it's worked out or unknown.
  - `Action` gains `'break'`: the blow that breaks an outcrop up. Every earlier blow is `'mine'`.
  - `LandSnapshot.deposits?: DepositsSnapshot`.

- [ ] **Step 1: Write the failing Land tests** (`src/land/Land.test.ts`)

Add imports: `import { type Deposit, type DepositKind, DEPOSITS, Deposits, REGROW_DAYS } from './deposits';`

Add this helper under `gather`:

```ts
/** An outcrop of `kind` on the flat grass, footprint (x0..x0+1, z0..z0+1): four blocks and one on top. */
function outcrop(land: Land, kind: DepositKind, x0 = -20, z0 = -20, id = 1): Deposit {
  const y = SEA_LEVEL + 1;
  const ore = DEPOSITS[kind].ore;
  const cells: Array<[number, number, number, number]> = [[x0, y, z0, ore], [x0 + 1, y, z0, ore], [x0, y, z0 + 1, ore], [x0 + 1, y, z0 + 1, ore], [x0, y + 1, z0, ore]];
  for (const [x, cy, z, b] of cells) land.world.setVoxel(x, cy, z, b);
  const d: Deposit = { id, kind, x: x0, z: z0, cells };
  land.deposits = new Deposits([...land.deposits.list, d]);
  return d;
}
```

Replace the pickaxe half of "fells trees and breaks rock anywhere…". It currently reads:

```ts
    walkTo(land, 20.5, 4);
    expect(land.use('pickaxe').ok).toBe(true);
    gather(land);
    expect(land.pack.stone).toBe(1);
```

Replace it with:

```ts
    outcrop(land, 'stone', 20, 5);
    walkTo(land, 20.5, 3.8); // facing the boulder
    for (let i = 0; i < DEPOSITS.stone.blows; i++) expect(land.use('pickaxe').ok).toBe(true);
    gather(land);
    expect(land.pack.stone).toBeGreaterThanOrEqual(DEPOSITS.stone.yield[0]);
```

Also rename that test to `'fells trees and breaks outcrops: timber, saplings and stone to pick up'`.

Replace the three `describe('reach', …)` tests that use the pickaxe on bare `Block.Stone`, so they use outcrops. The whole new `describe('reach', …)` block:

```ts
describe('reach', () => {
  it('works an outcrop under a canopy, not the air beneath the leaves', () => {
    const { world, land } = setup();
    land.goAshore();
    const d = outcrop(land, 'stone', 0, 1);
    walkTo(land, 0.5, 0.5);
    const feet = SEA_LEVEL + 1;
    world.setVoxel(0, feet + 3, 1, Block.Leaves);
    expect(land.aim('pickaxe', { x: 0, z: 1 })).toMatchObject({ ok: true, action: 'mine', y: feet });
    expect(d.cells.length).toBe(5);
  });

  it('reaches an outcrop block picked with the mouse, if it’s in reach', () => {
    const { land } = setup();
    land.goAshore();
    outcrop(land, 'iron', 0, 1);
    walkTo(land, 0.5, 0.5);
    const feet = SEA_LEVEL + 1;
    expect(land.aim('pickaxe', { x: 0, y: feet + 1, z: 1 })).toMatchObject({ ok: true, action: 'mine', y: feet + 1 });
    expect(land.aim('hoe', { x: 0, z: 1 }).ok).toBe(false);
  });

  it('reaches only a couple of blocks down', () => {
    const { world, land } = setup();
    land.goAshore();
    walkTo(land, 0.5, 0.5);
    for (let y = 0; y <= SEA_LEVEL; y++) world.setVoxel(0, y, 1, y < SEA_LEVEL - 3 ? Block.Dirt : Block.Air);
    const aim = land.aim('pickaxe', { x: 0, z: 1 });
    expect(aim.ok).toBe(false);
    expect(aim.x).toBeUndefined(); // nothing to mark
  });
});
```

Add a new block:

```ts
describe('outcrops', () => {
  it('stand so many blows, then break up into what they hold', () => {
    const { world, land } = setup();
    land.goAshore();
    const d = outcrop(land, 'copper');
    walkTo(land, -19.5, -21.2); // facing its near side
    for (let i = 1; i < DEPOSITS.copper.blows; i++) expect(land.use('pickaxe').ok).toBe(true);
    for (const [x, y, z, b] of d.cells) expect(world.getVoxel(x, y, z)).toBe(b);
    expect(land.drops).toHaveLength(0);
    expect(land.use('pickaxe').ok).toBe(true);
    for (const [x, y, z] of d.cells) expect(world.getVoxel(x, y, z)).toBe(Block.Air);
    const won = land.drops.filter((drop) => drop.good === 'copperOre').reduce((n, drop) => n + drop.amount, 0);
    expect(won).toBeGreaterThanOrEqual(DEPOSITS.copper.yield[0]);
    expect(won).toBeLessThanOrEqual(DEPOSITS.copper.yield[1]);
    const actions = land.takeEvents().flatMap((e) => (e.kind === 'work' ? [e.action] : []));
    expect(actions).toEqual([...Array(DEPOSITS.copper.blows - 1).fill('mine'), 'break']);
  });

  it('are all the pickaxe breaks: the island’s own rock stays', () => {
    const { world, land } = setup();
    land.goAshore();
    world.setVoxel(0, SEA_LEVEL + 1, 1, Block.Stone);
    walkTo(land, 0.5, 0.5);
    expect(land.use('pickaxe').message).toMatch(/Only outcrops/);
    expect(world.getVoxel(0, SEA_LEVEL + 1, 1)).toBe(Block.Stone);
  });

  it('grow back after three days, but not into someone standing there', () => {
    const { world, sea, land } = setup();
    land.goAshore();
    const d = outcrop(land, 'stone');
    walkTo(land, -19.5, -21.2);
    for (let i = 0; i < DEPOSITS.stone.blows; i++) land.use('pickaxe');
    sea.clock.day += REGROW_DAYS - 1;
    land.step(1.1);
    expect(world.getVoxel(-20, SEA_LEVEL + 1, -20)).toBe(Block.Air);
    sea.clock.day += 1;
    walkTo(land, -19.5, -19.5); // standing in it
    land.step(1.1);
    expect(world.getVoxel(-20, SEA_LEVEL + 1, -20)).toBe(Block.Air);
    walkTo(land, -10.5, -10.5);
    land.step(1.1);
    for (const [x, y, z, b] of d.cells) expect(world.getVoxel(x, y, z)).toBe(b);
  });

  it('a building on a worked-out outcrop's spot keeps it from growing back', () => {
    const { world, sea, land } = setup();
    land.goAshore();
    outcrop(land, 'stone', -12, -12);
    land.pack.timber = 20;
    walkTo(land, -11.5, -13.2);
    for (let i = 0; i < DEPOSITS.stone.blows; i++) land.use('pickaxe');
    expect(land.build('campfire', -4, -4, 0).ok).toBe(true);
    expect(land.build('fence', -12, -12, 0).ok).toBe(true);
    sea.clock.day += REGROW_DAYS + 1;
    walkTo(land, -4.5, -8.5);
    land.step(1.1);
    expect(world.getVoxel(-11, SEA_LEVEL + 1, -11)).toBe(Block.Air);
  });

  it('can’t be built over while they stand', () => {
    const { land } = setup();
    land.goAshore();
    outcrop(land, 'iron', -12, -12);
    land.pack.timber = 20;
    land.pack.stone = 20;
    walkTo(land, -4.5, -8.5);
    expect(land.build('campfire', -4, -4, 0).ok).toBe(true);
    expect(land.placement('hut', -12, -12, 0).reason).toMatch(/outcrop/);
  });

  it('are saved worked out, and grow back on time after a load', () => {
    const { world, sea, land } = setup();
    land.goAshore();
    const d = outcrop(land, 'stone');
    walkTo(land, -19.5, -21.2);
    for (let i = 0; i < DEPOSITS.stone.blows; i++) land.use('pickaxe');
    const saved = JSON.parse(JSON.stringify(land.snapshot()));
    const again = new Land(world, sea);
    again.deposits = new Deposits([d]);
    again.restore(saved);
    expect(again.deposits.at(-20, SEA_LEVEL + 1, -20)).toBeNull();
    sea.clock.day += REGROW_DAYS;
    again.step(1.1);
    expect(world.getVoxel(-20, SEA_LEVEL + 1, -20)).toBe(DEPOSITS.stone.ore);
  });

  it('an outcrop a save's own edits wiped out never grows back', () => {
    const { world, sea, land } = setup();
    const d = outcrop(land, 'stone');
    const saved = JSON.parse(JSON.stringify(land.snapshot()));
    for (const [x, y, z] of d.cells) world.setVoxel(x, y, z, Block.Air); // an older save's chunk, loaded over it
    delete saved.deposits; // and that save knew nothing of outcrops
    const again = new Land(world, sea);
    again.deposits = new Deposits([d]);
    again.restore(saved);
    sea.clock.day += 30;
    again.step(1.1);
    expect(world.getVoxel(-20, SEA_LEVEL + 1, -20)).toBe(Block.Air);
  });

  it('a miner’s whole outcrop at once, for the camp’s stores', () => {
    const { world, land } = setup();
    const d = outcrop(land, 'silver');
    const got = land.mineDeposit(d.id);
    expect(got?.good).toBe('silverOre');
    expect(got!.amount).toBeGreaterThanOrEqual(DEPOSITS.silver.yield[0]);
    expect(world.getVoxel(-20, SEA_LEVEL + 1, -20)).toBe(Block.Air);
    expect(land.mineDeposit(d.id)).toBeNull();
  });
});
```

Note on `walkTo(land, -19.5, -21.2)`: facing 0 is +z, and `front()` is `floor(z + 1.25)`, which is -20: the outcrop's near row. So the column in front holds the outcrop.

- [ ] **Step 2: Write the failing treasure test** (append to `describe('digging for treasure', …)` in `src/treasure/treasure.test.ts`)

```ts
  it('buries chests clear of outcrops', () => {
    const covered = setup();
    // Outcrops (registered, no blocks needed) every 4 blocks across Gull Cay, the only near islet.
    const list: Deposit[] = [];
    for (let x = 385; x <= 415; x += 4) for (let z = -15; z <= 15; z += 4) list.push({ id: list.length + 1, kind: 'stone', x, z, cells: [] });
    covered.land.deposits = new Deposits(list);
    night(covered.sea);
    let near = false;
    for (let n = 0; n < 40; n++) {
      covered.sea.clock.day = 100 + n;
      if (covered.treasure.offersFor(PIRATE_PORT).some((o) => o.map.tier === 'near')) near = true;
    }
    expect(near).toBe(false);
  });
```

Add `import { type Deposit, Deposits } from '../land/deposits';` to the test file.

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run src/land/Land.test.ts src/treasure/treasure.test.ts`
Expected: FAIL. `land.deposits` and `mineDeposit` don't exist, and treasure is still offered on Gull Cay.

- [ ] **Step 4: Implement in `src/land/Land.ts`**

1. Imports:

```ts
import { DEPOSITS, Deposits, type DepositsSnapshot } from './deposits';
import { HALF_WIDTH, HEIGHT } from './walker'; // add to the existing './walker' import instead of a second line
```

2. `Action` gains `'break'`:

```ts
export type Action = 'fell' | 'chop' | 'mine' | 'break' | 'dig' | 'till' | 'plant' | 'harvest' | 'unbuild' | 'fish' | 'catch';
```

3. `ROCK` becomes the blocks that aren't worth a blow unless they're part of an outcrop:

```ts
/** Rock the pickaxe can only break as part of an outcrop. */
const ROCK: readonly number[] = [Block.Stone, Block.IronOre, Block.Boulder, Block.CopperOre, Block.SilverOre, Block.GoldOre];
```

4. `LandSnapshot` gains:

```ts
  /** Worked-out outcrops (version 5). */
  deposits?: DepositsSnapshot;
```

5. A field on the class, after `buried`:

```ts
  /** The islands' outcrops of stone and ore (the game hands over the ones it placed). */
  deposits = new Deposits();
```

6. `snapshot()` adds `deposits: this.deposits.snapshot(),`. `restore(s)` adds this at its end:

```ts
    if (s.deposits) this.deposits.restore(s.deposits);
    this.deposits.reconcile(this.world);
```

7. A public method near `front()`:

```ts
  /** The sea clock's day with its fraction: what outcrops time their growing back by. */
  day(): number {
    return this.sea.clock.day + this.sea.clock.phase;
  }
```

8. In `aim()`, the axe/pickaxe block becomes:

```ts
    if (held === 'axe' || held === 'pickaxe') {
      // A tree, an outcrop or a fence: the block picked, or the first in the column from the ground in front up.
      const feet = Math.round(w.y);
      const column = t.y !== undefined && this.reaches(x, t.y, z) ? [t.y] : Array.from({ length: REACH_UP + 2 }, (_, i) => feet - 1 + i);
      for (const y of column) {
        const mine = this.buildingAt(x, y, z);
        if (mine) return STRUCTURES[mine.kind].freeform ? { ok: true, action: 'unbuild', x, y, z } : cell('Take buildings down from the build menu (B).', y);
        if (held === 'axe' && TREE_BLOCKS.has(this.world.getVoxel(x, y, z))) return { ok: true, action: 'fell', x, y, z };
        if (held === 'pickaxe' && this.deposits.at(x, y, z)) return { ok: true, action: 'mine', x, y, z };
      }
      if (held === 'axe') return cell('No tree there to fell.');
      if (!ground) return cell('Nothing within reach to break.');
      if (ROCK.includes(block)) return cell('Only outcrops can be broken: look for stone and ore.');
      return cell('No outcrop there to break.');
    }
```

9. In `use()`, the `'mine'` case becomes:

```ts
      case 'mine':
        return this.quarry(x, y, z);
```

   Delete the old body: the `drop(… 'ore' : 'stone' …)` and `setVoxel(Air)` lines.

10. New private methods, next to `chop()`:

```ts
  /** A pickaxe blow on an outcrop: it takes the blow, and breaks up with the last one it can stand. */
  private quarry(x: number, y: number, z: number): Outcome {
    const d = this.deposits.at(x, y, z);
    if (!d) return fail('No outcrop there to break.');
    const spec = DEPOSITS[d.kind];
    if (this.deposits.blow(d) < spec.blows) {
      this.events.push({ kind: 'work', action: 'mine', x, y, z });
      return done('');
    }
    const cells = this.deposits.workOut(this.world, d, this.day());
    const amount = spec.yield[0] + Math.floor(this.random() * (spec.yield[1] - spec.yield[0] + 1));
    for (let i = 0; i < amount; i++) {
      const [cx, cy, cz] = cells[i % cells.length];
      this.drop(spec.good, cx + 0.5, cy + 0.5, cz + 0.5);
    }
    this.events.push({ kind: 'work', action: 'break', x, y, z });
    return done('');
  }

  /** A miner's work: the whole outcrop broken up at once, its yield for the camp's stores. Null if it's gone. */
  mineDeposit(id: number): { good: Good; amount: number; x: number; y: number; z: number } | null {
    const d = this.deposits.byId(id);
    if (!d || !this.deposits.standing(d)) return null;
    const spec = DEPOSITS[d.kind];
    const [[x, y, z]] = this.deposits.workOut(this.world, d, this.day());
    const amount = spec.yield[0] + Math.floor(this.random() * (spec.yield[1] - spec.yield[0] + 1));
    return { good: spec.good, amount, x, y, z };
  }

  /** Is anyone (the captain, a settler, a beast) in the way of this cell? */
  private bodyIn(x: number, y: number, z: number): boolean {
    const walkers = [this.walker, ...this.settlers.map((s) => s.walker), ...this.creatures.map((c) => c.walker)];
    return walkers.some(
      (w) => !!w && w.x + HALF_WIDTH > x && w.x - HALF_WIDTH < x + 1 && w.z + HALF_WIDTH > z && w.z - HALF_WIDTH < z + 1 && w.y + HEIGHT > y && w.y < y + 1,
    );
  }
```

11. Growing back, in the private `grow()` method (it runs once a second from `step`). Add at its end:

```ts
    // Outcrops due back grow where nothing stands in the way.
    const clear = (x: number, y: number, z: number) => this.world.getVoxel(x, y, z) === Block.Air && !this.buildingAt(x, y, z) && !this.bodyIn(x, y, z);
    this.deposits.regrow(this.world, this.day(), clear);
```

    If `grow()` returns early anywhere, put the two lines before any early `return`.

12. In `placement()`, after the "Too close to another building." check:

```ts
    if (this.deposits.inPlot(plot, spec.freeform ? 0 : 1)) return verdict(false, 'An outcrop is in the way: mine it first.');
```

- [ ] **Step 5: Treasure keeps clear** (`src/treasure/Treasure.ts`, the `planSite` call)

```ts
      const site = planSite(this.world, this.islands, i, legs, this.random, (x, z) => this.land.claimed(x, z) || this.land.inTown(x, z) || this.land.deposits.near(x, z, 3));
```

- [ ] **Step 6: Save version 5** (`src/save/storage.ts`)

```ts
/**
 * Bumped when the format changes. Version 2 (Phase 6) added the clock, settlers and
 * workshops; version 3 (Phase 7) treasure maps and finds; version 4 (Phase 8) the
 * story; version 5 (Phase 10) worked-out outcrops. Older saves still load.
 */
export const SAVE_VERSION = 5;
export const READABLE_VERSIONS: readonly number[] = [1, 2, 3, 4, 5];
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/land src/treasure src/save`
Expected: PASS. If the outcrop test's facing puts `front()` on the wrong row, fix the test's `walkTo` coordinates, not the code: `front()` is `floor(w.z + cos(facing) * 1.25)`.

- [ ] **Step 8: Full run and typecheck**

Run: `npx vitest run && npx tsc --noEmit -p .`
Expected: all pass.

---

### Task 5: The game places outcrops and hands them to `Land`

**Files:**
- Modify: `src/Game.ts:226-235`

**Interfaces:**
- Consumes: `placeDeposits` (Task 3), `Deposits` (Task 2), `regionTier` from `./combat/encounters`, and `TOWN_RADIUS` from `./land/Land`.

- [ ] **Step 1: Wire it up** (`src/Game.ts`)

Imports:

```ts
import { Deposits } from './land/deposits';
import { placeDeposits } from './worldgen/deposits';
```

Make sure `regionTier` is imported from `./combat/encounters` (it already is, for `summary()`) and `TOWN_RADIUS` from `./land/Land`.

Replace:

```ts
    this.islands = planArchipelago(WORLD_SEED);
    this.ports = buildArchipelago(this.world, this.islands);
    this.world.trackEdits(); // from here on, changes are what a save stores
```

with:

```ts
    this.islands = planArchipelago(WORLD_SEED);
    this.ports = buildArchipelago(this.world, this.islands);
    // Outcrops keep off town land (and a little beyond, so none sits at a town's edge).
    const inTown = (x: number, z: number) => this.ports.some((p) => Math.hypot(p.x - x, p.z - z) < TOWN_RADIUS + 8);
    const deposits = placeDeposits(this.world, this.islands, WORLD_SEED, regionTier, inTown);
    this.world.trackEdits(); // from here on, changes are what a save stores
```

After `this.land = new Land(this.world, this.sea, WORLD_SEED);` add:

```ts
    this.land.deposits = new Deposits(deposits);
```

- [ ] **Step 2: Typecheck and run everything**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: all pass.

- [ ] **Step 3: See it in the game.** The dev server runs on port 5173 (`npx vite`, if it isn't already up). Use Playwright; screenshots go in `.playwright-mcp/`.
  1. Load and Continue. Take the ship to (92, 367), then call `game.land.goAshore()` and `game.toFoot('')`.
  2. Find the nearest outcrop:

     ```js
     const w = game.land.walker;
     game.land.deposits.within(w.x, w.z, 60)
     ```

     Walk to it by setting `w.x`/`w.z` beside it, facing it.
  3. Screenshot it. It should read as a lump of rock, with ore colour in it for anything but stone.
  4. Press Space as many times as its kind's blows. Check it breaks up, drops its goods, and that the drops fly to hand.
  5. Hit the bare rock of a hillside and check the hint says "Only outcrops can be broken…".
  6. Check the console has no errors.

---

### Task 6: Miners

**Files:**
- Modify: `src/land/settlers.ts`
- Modify: `src/render/PeopleView.ts:19` and the `busy` line
- Modify: `src/ui/CampScreen.tsx:81`
- Test: `src/land/settlers.test.ts`

**Interfaces:**
- Consumes: `land.deposits.within`, `land.deposits.dueIn`, `land.day()`, `land.mineDeposit(id)` (Task 4); `depositCentre`, `DEPOSITS` (Task 2).
- Produces: `Job` gains `'miner'` (label "Miner"); `Task` gains `{ kind: 'mine'; deposit: number; x: number; z: number; left: number }`.

- [ ] **Step 1: Write the failing tests** (add to `describe('settlers', …)` in `src/land/settlers.test.ts`)

Imports to add: `import { type Deposit, DEPOSITS, Deposits } from './deposits';`

Helper, under `run`:

```ts
/** An outcrop on the camp island's grass: four blocks and one on top. */
function outcropAt(land: Land, kind: Deposit['kind'], x0: number, z0: number, id: number): Deposit {
  const y = SEA_LEVEL + 1;
  const ore = DEPOSITS[kind].ore;
  const cells: Array<[number, number, number, number]> = [[x0, y, z0, ore], [x0 + 1, y, z0, ore], [x0, y, z0 + 1, ore], [x0 + 1, y, z0 + 1, ore], [x0, y + 1, z0, ore]];
  for (const [x, cy, z, b] of cells) land.world.setVoxel(x, cy, z, b);
  const d: Deposit = { id, kind, x: x0, z: z0, cells };
  land.deposits = new Deposits([...land.deposits.list, d]);
  return d;
}
```

Tests:

```ts
  it('miners break up outcrops near the camp into the storehouse', () => {
    const { sea, land, world, fire, store } = camp();
    const d = outcropAt(land, 'iron', 0, -16, 1);
    store.store!.maize = 5;
    sea.captain.passengers = 1;
    land.settle(fire, 1);
    land.assign(land.settlers[0].id, 'miner');
    run(sea, land, 45);
    expect(store.store!.ore ?? 0).toBeGreaterThanOrEqual(DEPOSITS.iron.yield[0]);
    for (const [x, y, z] of d.cells) expect(world.getVoxel(x, y, z)).toBe(Block.Air);
  });

  it('with no ore about, a miner cuts wood until it grows back', () => {
    const { sea, land, world, fire, store } = camp();
    const d = outcropAt(land, 'stone', 0, -16, 1);
    land.mineDeposit(d.id); // worked out a moment ago
    for (let y = SEA_LEVEL + 1; y < SEA_LEVEL + 5; y++) world.setVoxel(6, y, -15, Block.Wood);
    store.store!.maize = 5;
    sea.captain.passengers = 1;
    land.settle(fire, 1);
    land.assign(land.settlers[0].id, 'miner');
    run(sea, land, 2);
    expect(land.settlers[0].doing).toMatch(/No ore near the camp: cutting wood until it grows back \(3 days\)/);
    run(sea, land, 30);
    expect(store.store!.timber ?? 0).toBeGreaterThan(0);
  });

  it('a miner who finds the outcrop gone takes nothing, and finds other work', () => {
    const { sea, land, fire, store } = camp();
    const d = outcropAt(land, 'copper', 0, -16, 1);
    store.store!.maize = 5;
    sea.captain.passengers = 1;
    land.settle(fire, 1);
    land.assign(land.settlers[0].id, 'miner');
    run(sea, land, 1);
    expect(land.settlers[0].task.kind === 'walk' || land.settlers[0].task.kind === 'mine').toBe(true);
    land.mineDeposit(d.id); // the captain got there first
    run(sea, land, 40);
    expect(store.store!.copperOre ?? 0).toBe(0);
    expect(land.settlers[0].doing).toMatch(/cutting wood|No trees/);
  });

  it('a miner with a full storehouse leaves the outcrop standing', () => {
    const { sea, land, world, fire, store } = camp();
    outcropAt(land, 'stone', 0, -16, 1);
    store.store!.maize = 5;
    store.store!.stone = STORE_SIZE - 5 - 1; // one free slot (no breakfast before tomorrow's dawn)
    sea.captain.passengers = 1;
    land.settle(fire, 1);
    land.assign(land.settlers[0].id, 'miner');
    run(sea, land, 45);
    expect(world.getVoxel(0, SEA_LEVEL + 1, -16)).toBe(DEPOSITS.stone.ore);
    expect(land.settlers[0].doing).toMatch(/storehouse is full/);
  });
```

The full-storehouse test fills the store to one free slot, so `storeRoom < 3` is true and the miner wanders with "The storehouse is full". Add `STORE_SIZE` to the test's `./structures` import (`import { type Building, STORE_SIZE } from './structures';`).

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/land/settlers.test.ts -t "miner"`
Expected: FAIL (`'miner'` isn't a `Job`).

- [ ] **Step 3: Implement in `src/land/settlers.ts`**

1. Imports: add `CLAIM_RADIUS` to the `./camps` import, and add:

```ts
import { DEPOSITS, depositCentre } from './deposits';
```

2. Jobs and tasks:

```ts
export type Job = 'idle' | 'farmer' | 'woodcutter' | 'miner' | 'fisher' | 'worker';
export const JOB_LABELS: Record<Job, string> = { idle: 'Idle', farmer: 'Farmer', woodcutter: 'Woodcutter', miner: 'Miner', fisher: 'Fisher', worker: 'Workshop hand' };
```

   In `Task`, after the `fell` member:

```ts
  | { kind: 'mine'; deposit: number; x: number; z: number; left: number }
```

3. Timing and reach:

```ts
const SECONDS = { harvest: 2, plant: 1.5, fell: 14, mine: 20, fish: 24, idle: 4 } as const;
/** Miners look this far past the edge of the claim for outcrops: they're sparser than trees. */
const MINE_MARGIN = 16;
```

4. `think()` gains a case, after `woodcutter`:

```ts
    case 'miner':
      return mine(land, s, fire);
```

5. `spoken()` also counts miners:

```ts
    return (t.kind === 'harvest' || t.kind === 'plant' || t.kind === 'fell' || t.kind === 'mine') && t.x === x && t.z === z;
```

6. `cutWood` takes what to say while felling:

```ts
function cutWood(land: Land, s: Settler, fire: Building, felling = 'Felling a tree'): void {
  if (storeRoom(campStores(land.buildings, fire)) < 3) return wander(land, s, fire, 'The storehouse is full');
  const tree = nearest(
    s,
    land.trees(fire).filter((t) => !spoken(land, s, t.x, t.z)),
  );
  if (!tree) return wander(land, s, fire, 'No trees left near the camp: saplings are growing');
  go(land, s, { x: tree.x + 0.5, z: tree.z + 0.5 }, { kind: 'fell', x: tree.x, y: tree.y, z: tree.z, left: SECONDS.fell }, felling, 1.5);
}
```

7. The miner's day, after `cutWood`:

```ts
/** A miner works the nearest outcrop near the camp; with none standing, they cut wood until one grows back. */
function mine(land: Land, s: Settler, fire: Building): void {
  const stores = campStores(land.buildings, fire);
  if (storeRoom(stores) < 3) return wander(land, s, fire, 'The storehouse is full');
  const c = fireCentre(fire);
  const reach = CLAIM_RADIUS + MINE_MARGIN;
  const outcrops = land.deposits
    .within(c.x, c.z, reach)
    .filter((d) => storeRoom(stores) >= DEPOSITS[d.kind].yield[1])
    .map((d) => ({ d, ...depositCentre(d) }))
    .filter((o) => !spoken(land, s, o.x, o.z));
  const outcrop = nearest(s, outcrops);
  if (outcrop) {
    const task = { kind: 'mine' as const, deposit: outcrop.d.id, x: outcrop.x, z: outcrop.z, left: SECONDS.mine };
    go(land, s, { x: outcrop.x, z: outcrop.z }, task, `Mining ${DEPOSITS[outcrop.d.kind].label}`, 1.8);
    return;
  }
  const due = land.deposits.dueIn(c.x, c.z, reach, land.day());
  cutWood(land, s, fire, `No ore near the camp: cutting wood until it grows back${due === null ? '' : ` (${days(due)})`}`);
}

/** "1 day", "3 days": how long, rounded up. */
const days = (n: number): string => {
  const d = Math.max(1, Math.ceil(n - 1e-6));
  return d === 1 ? '1 day' : `${d} days`;
};
```

   The second test expects "(3 days)". The outcrop was worked out at day `d + phase` and it's still that day, so `dueIn` is about 3 minus a moment, which rounds up to 3.

8. `finish()` gains a case, after `fell`:

```ts
    case 'mine': {
      const d = land.deposits.byId(task.deposit);
      if (!d || !land.deposits.standing(d)) break;
      if (storeRoom(stores) < DEPOSITS[d.kind].yield[1]) return rest(s, 'The storehouse is full');
      const won = land.mineDeposit(task.deposit);
      if (!won) break;
      put(stores, won.good, won.amount);
      land.emit({ kind: 'work', action: 'break', x: won.x, y: won.y, z: won.z, good: won.good, amount: won.amount, settler: s.id });
      break;
    }
```

9. Nothing else to add in `settlers.ts`: `stepSettler`'s `default` case already counts down any task with a `left` and calls `finish`, and `go()` has set what they're doing.

- [ ] **Step 4: The figure and the camp screen**

   `src/render/PeopleView.ts`:

```ts
const TOOL: Record<Settler['job'], HeldModel | null> = { idle: null, farmer: 'hoe', woodcutter: 'axe', miner: 'pickaxe', fisher: 'rod', worker: 'hammer' };
```

   and the swing:

```ts
      const busy = t.kind === 'harvest' || t.kind === 'plant' || t.kind === 'fell' || t.kind === 'mine' || t.kind === 'work';
      const rate = t.kind === 'fell' || t.kind === 'mine' ? 1.3 : t.kind === 'work' ? 1.1 : 1.6;
```

   A miner cutting wood carries the pickaxe, not the axe. That's accepted: the camp screen says what they're doing.

   `src/ui/CampScreen.tsx:81`:

```ts
    ...(['idle', 'farmer', 'woodcutter', 'miner', 'fisher'] as const).map((job) => ({ job, post: null, label: JOB_LABELS[job] })),
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/land/settlers.test.ts`
Expected: PASS.

- [ ] **Step 6: Full run and typecheck**

Run: `npx vitest run && npx tsc --noEmit -p .`
Expected: all pass.

---

### Task 7: Docs, a last look in the game, and the commit when the player says

**Files:**
- Modify: `docs/ARCHITECTURE.md` (§9 tools, a new subsection for outcrops, the module map, the roadmap line for Phase 10)
- Modify: `README.md` (the on-foot paragraph)
- Add to the commit: `docs/phase-10-deposits-guns-sound.md` and this plan

- [ ] **Step 1: ARCHITECTURE.md**
  - In §9's tool list, replace "**Pickaxe:** breaks natural stone and iron ore, one block at a time." with:

    ```markdown
    - **Pickaxe:** breaks outcrops (below), and nothing else: the island's own rock stays.
    ```

  - Add a subsection after §9's tools:

    ```markdown
    **Outcrops** (`land/deposits.ts`, placed by `worldgen/deposits.ts`). Small lumps of
    stone and ore, 3–5 blocks on a 2 × 2 footprint, placed from the seed after the
    archipelago is built: about one per 700 square voxels of island, 7 apart, on dry
    grass, earth or rock clear of trees, beaches and town land.
    - **Kinds** (blows, yield): stone 3, 3–4 stone (all `Boulder`); iron 4, 2–3 ore;
      copper 4, 2–3; silver 5, 1–2; gold 6, 1. Home waters have no silver or gold; the
      mix gets richer further out. Iron veins in the terrain are gone.
    - **Mining.** Blows count per outcrop (not saved); the last breaks it up into
      dropped items. Events: `mine` for each blow, `break` for the last.
    - **Growing back.** 3 days on the sea clock after it was worked out, once no block,
      building or body is in the way. Saved (version 5); an outcrop a save's own edits
      wiped out (an older save) is retired for good (`Deposits.reconcile`).
    - **Around them.** Buildings can't go over a standing outcrop; treasure is buried 3
      clear of any.
    - **Miners** (a settler job) work the nearest outcrop within the claim plus 16,
      20 s each, the yield straight to the stores; with none standing, they cut wood,
      and the camp screen says when the next grows back.
    ```

  - Add `copperOre`, `silverOre`, `goldOre` wherever the economy section lists goods and who deals in them. Find it with `grep -n "Iron ore\|'ore'" docs/ARCHITECTURE.md`.
  - Module map: add `deposits.ts` under `land/` and under `worldgen/`.
  - Roadmap: Phase 10 line → `10. 🔄 **Deposits, guns & sound** …` (keep the text, add the 🔄 marker).

- [ ] **Step 2: README.md.** In the on-foot paragraph, change "the pickaxe breaks stone" to "the pickaxe breaks outcrops of stone and ore (copper, silver and gold further out), which grow back after a few days". Mention miners where settler jobs are listed. Find it with `grep -n "woodcutter\|Woodcutter" README.md`.

- [ ] **Step 3: Last full check**

Run: `npx vitest run && npx tsc --noEmit -p . && npm run build`
Expected: all pass; build succeeds.

- [ ] **Step 4: Last look in the game** (Playwright, as in Task 5)
  1. At the camp islet, build a campfire, storehouse and hut near an outcrop.
  2. Put maize in the store, set `game.sea.captain.passengers = 1`, settle a settler, and make them a miner.
  3. Watch them walk to the outcrop and swing the pickaxe. Check the ore reaches the store.
  4. Jump the clock three days (`game.sea.clock.day += 3`) and check the outcrop grows back.
  5. Screenshot each step.

- [ ] **Step 5: Stop and report to the player.** Say what's done, with the test count and screenshots. **Commit only when they say "commit"**, as one commit: `Phase 10 (1/3): outcrops of stone and ore, miners`, with a bullet body in the style of `git log -3`, staging these files by path:
  - the source and test files above;
  - `docs/phase-10-deposits-guns-sound.md`;
  - this plan;
  - `docs/ARCHITECTURE.md` and `README.md`.

  Never stage the repo-root MP3s.
