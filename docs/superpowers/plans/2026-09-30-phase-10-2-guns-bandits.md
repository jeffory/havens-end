# Phase 10.2: Guns, Hunting and Bandits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pistol and a rifle for the captain on foot, bought in port and firing cartridges; wild goats to hunt; bandit camps on wild islets that fight back; the captain's health; and a "come to" card for every way of going down.

**Architecture:** `land/firearms.ts` holds the pure maths of a shot: hit chance by range, picking a target, and cover by voxel raycast. `Land.fire` spends a cartridge, starts the reload and resolves the shot against creatures and bandits. Goats join the night's creatures as day game. `worldgen/bandits.ts` builds camps from the seed before the world tracks edits. `land/bandits.ts` keeps each camp's state (manned, cleared, re-manned, looted) and steps the bandits of the camp on the islet the captain walks. The captain has health on foot. Being brought down puts them aboard, with the pack left where they fell. `ui/comeTo.ts` words the card, and `ui/Fade.ts` (grown out of the sleep fade) shows it.

**Tech Stack:** TypeScript (strict), Vite, Vitest, vanilla Three.js (render only), React (port screens).

**Spec:** `docs/phase-10-deposits-guns-sound.md` (sections "10.2 Guns, hunting and bandits" and "The come to card")

## Global Constraints

- **No commits until the player says so.** 10.2 is one commit, made when the player says "commit" after the play-through in Task 12. Don't run `git commit` in any earlier task.
- **Existing tests must keep passing.** Run `npx vitest run` and `npx tsc --noEmit -p .` at the end of every task. Slow tests that build real worlds get a `20_000` ms timeout, as the others have.
- **World generation stays deterministic in `WORLD_SEED`.**
  - Bandit camps use their own stream per islet: `mulberry32((seed ^ 0xba4d ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0)`.
  - Which islets are held is chosen with `hash2`, not a draw from any stream.
  - Camps are placed after `placeDeposits` and before `reserveProps` / `world.trackEdits()`. Outcrops keep their ids and places.
- **`Land.random` is shared** by creatures, townsfolk, drops and settlers. New draws happen only on new paths: firing, goats by day, bandits. The night creatures' spawn must draw exactly as it does now.
- **Market line order is part of the save format.**
  - `cartridges` and `hides` go at the **end** of `GOODS` and at the **end** of `CAMP_GOODS`.
  - The forge's new recipe goes at the **end** of its `recipes`, since `Building.work.recipe` is a saved index.
- **Save version 6** (`SAVE_VERSION = 6`, `READABLE_VERSIONS = [1, 2, 3, 4, 5, 6]`). New snapshot fields are optional with `??` defaults, and older saves still load.
- **No new blocks.** Camps are built from existing ones: Embers, Stone, Wood, Planks, Canvas, Chest, Barrel.
- **Player-facing text** matches the codebase: British spelling, typographic apostrophes (’), and plain words ("cartridges", "loading", "the bandits' camp is cleared").
- **Hotbar keys** are 1–9, then 0 for a tenth slot.

## Review Focus

These are the cases the spec implies that players will hit first. Each has a test in the task that owns the code.

1. **An old save's camp sits within 60 of a new bandit camp.** The bandit camp must never be manned, and bandits must never walk into the player's camp. → Task 10 test "a camp whose ground a save's own camp already claims is left empty for good".
2. **Brought down with a full hold.** The pack must lie on the ground where the captain fell, not be stowed or lost, and the captain comes to aboard with full health. → Task 7 test "brought down with a full hold, the pack still lies where they fell".
3. **Pressing fire while loading, or with no cartridges.** No shot, no cartridge spent, and the reload doesn't restart. → Task 5 test "won't fire while loading, and doesn't spend a cartridge trying".
4. **Dusk and dawn.** Goats go at nightfall (unless fleeing), crabs and boar still go at dawn, and the night creatures' tests pass unchanged. → Task 4 test "goats are gone at night, as crabs and boar are gone by day".
5. **A save made mid-fight on a bandit islet.** On load, the camp's bandits come back at ease, as many as were left, and the captain's health is full. → Task 11 test "a save made mid-fight loads with the bandits at ease, as many as were left".

## Rulings (decided while planning; the player can overturn any)

- **Cartridges are carried.** With a gun, the captain takes a pouch of up to 24 cartridges from the hold when going ashore, so a fight far from the ship doesn't leave them empty-handed. Otherwise cartridges count from the pack, storehouses and the ship within 60, like seed.
- **Bandits flee at 2 hp, not 1.** The spec says 1 hp, but a 4 hp bandit hit by 2- and 4-damage guns never has exactly 1. A pistol-wounded bandit runs, and a rifle drops one outright. The numbers are starting points to tune.
- **A fallen bandit's gold goes straight to the purse.** Things on the ground can only be goods. The cartridges fall to the ground.
- **"One pile":** where the captain falls, each good in the pack lands as its own stack, all at that spot, and they last a full day.
- **The card names where the captain actually comes to.** For sinking and jail that's the last port, not always Haven as in the spec's examples.
- **The health bar shows only when the captain is hurt or in a fight**, so the on-foot HUD stays clear otherwise.
- **Guns go in the hotbar after the tools**, only once bought. With both guns there are ten slots, the tenth on 0.

---

## File map

| File | Change |
|---|---|
| `src/economy/goods.ts` | Goods `cartridges`, `hides` (at the end) |
| `src/economy/market.ts` | Their lines, at the end of `CAMP_GOODS` |
| `src/land/structures.ts` | Forge: a cartridges recipe (at the end) |
| `src/render/itemIcons.ts` | Icons: cartridges, hides; `GUN_ICONS` |
| `src/economy/arms.test.ts` (new) | Goods, markets, forge |
| `src/land/firearms.ts` (new) | Guns table, hit chance, aim, cover |
| `src/land/firearms.test.ts` (new) | Firearms maths |
| `src/economy/captain.ts` | `Captain.guns` |
| `src/combat/sea.ts` | Guns saved; the `respawn` event names the ship |
| `src/economy/economy.ts` | `sellsGuns`, `gunPrice`, `buyGun` |
| `src/economy/gunsmith.test.ts` (new) | Buying guns, keeping them |
| `src/ui/port/MarketTab.tsx` | The gunsmith's counter |
| `src/save/storage.ts` | Version 6 |
| `src/land/creatures.ts` | Goats; day and night kinds; herds; bolting; loot as cargo; `harm` |
| `src/land/creatures.test.ts` | Goat tests |
| `src/render/PeopleView.ts` | The goat; bandits with muskets |
| `src/land/Land.ts` | `Held` includes guns; `fire`; the cartridge pouch; health; being brought down; bandits wired in; the chest |
| `src/land/Land.test.ts` | Guns, health, being brought down |
| `src/land/drops.ts` | Each drop's own lifetime |
| `src/core/Controls.ts` | `item10` on 0 |
| `src/Shore.ts` | Guns in the hotbar; firing; the chest; health for the HUD |
| `src/ui/hudParts.ts`, `src/ui/hudParts.test.ts` | Gun icons and labels |
| `src/ui/FootHud.ts`, `src/style.css` | Reload shade on a gun's slot; the health bar; legend |
| `src/render/toolModels.ts` | Pistol, rifle, a levelled musket |
| `src/render/CharacterView.ts`, `src/render/LandView.ts` | The aiming pose |
| `src/render/Tracers.ts` (new) | The faint streak of a shot |
| `src/ui/comeTo.ts`, `src/ui/comeTo.test.ts` (new) | The card's words |
| `src/ui/Fade.ts` (new) | The fade, and its card |
| `src/Game.ts` | Camps placed; shots, going down and the card handled; the fade |
| `src/worldgen/bandits.ts`, `src/worldgen/bandits.test.ts` (new) | Where camps go, and building them |
| `src/land/bandits.ts`, `src/land/bandits.test.ts` (new) | Camps' state, and the bandits themselves |
| `src/treasure/Treasure.ts` | Chests keep clear of bandit camps |
| `docs/ARCHITECTURE.md` | What was built |

---

### Task 1: Cartridges and hides: goods, markets, the forge, icons

**Files:**
- Modify: `src/economy/goods.ts` (end of `GOODS`; `GOOD_INFO`)
- Modify: `src/economy/market.ts` (end of `CAMP_GOODS`)
- Modify: `src/land/structures.ts` (forge `recipes` and `detail`)
- Modify: `src/render/itemIcons.ts` (`ICONS`)
- Test: `src/economy/arms.test.ts` (new)

**Interfaces:**
- Produces: goods `'cartridges'` (label "Cartridges", price 2, kind `'arms'`) and `'hides'` (label "Hides", price 8, kind `'produce'`). The forge recipe `{ label: 'Cartridges', inputs: { iron: 1 }, outputs: { cartridges: 12 }, seconds: 20 }`, last in its list.

- [ ] **Step 1: Write the failing test**

```ts
// src/economy/arms.test.ts
import { describe, expect, it } from 'vitest';
import { STRUCTURES } from '../land/structures';
import { ICONS } from '../render/itemIcons';
import { mulberry32 } from '../worldgen/noise';
import { GOOD_INFO, GOODS } from './goods';
import { planMarkets } from './market';
import type { Port, PortFaction } from './ports';

const port = (id: number, faction: PortFaction): Port => ({ id, name: `Port ${id}`, faction, x: id * 500, z: 0, heading: 0, islandX: id * 500, islandZ: 0, pier: { x: id * 500, y: 13, z: 0 }, places: [], lamps: [] });
const PORTS = [port(0, 'merchant'), port(1, 'merchant'), port(2, 'pirate'), port(3, 'imperial'), port(4, 'imperial')];

describe('cartridges and hides', () => {
  it('are goods, last in the list: cartridges about 2 gold, hides about 8', () => {
    expect(GOODS.slice(-2)).toEqual(['cartridges', 'hides']);
    expect(GOOD_INFO.cartridges).toMatchObject({ label: 'Cartridges', price: 2, kind: 'arms' });
    expect(GOOD_INFO.hides).toMatchObject({ label: 'Hides', price: 8, kind: 'produce' });
  });

  it('are sold in every market, hides wanted in the free ports', () => {
    const markets = planMarkets(PORTS, mulberry32(1));
    for (const [i, market] of markets.entries()) expect(market.lines.map((l) => l.good).slice(-2), PORTS[i].name).toEqual(['cartridges', 'hides']);
    expect(markets[0].lines.find((l) => l.good === 'hides')!.role).toBe('demands');
    expect(markets[2].lines.find((l) => l.good === 'cartridges')!.role).toBe('trades');
  });

  it('come after every older line, so saves keep their stock by line', () => {
    const merchant = planMarkets(PORTS, mulberry32(1))[0].lines.map((l) => l.good);
    // Phase 10's ores were the last lines before these two.
    expect(merchant.slice(-5, -2)).toEqual(['copperOre', 'silverOre', 'goldOre']);
  });

  it('are made at the forge: twelve cartridges from one iron, last of its recipes', () => {
    expect(STRUCTURES.forge.recipes!.at(-1)).toMatchObject({ label: 'Cartridges', inputs: { iron: 1 }, outputs: { cartridges: 12 } });
  });

  it('have pictures for when they lie on the ground', () => {
    expect(ICONS.cartridges).toBeDefined();
    expect(ICONS.hides).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run src/economy/arms.test.ts`
Expected: FAIL, because `GOODS` doesn't end with the two new goods (and `tsc` reports `cartridges` isn't a `Good`).

- [ ] **Step 3: Add the goods**

In `src/economy/goods.ts`, end `GOODS` with the two new goods:

```ts
  'earth',
  'sand',
  'sapling',
  // Phase 10.2, last so nothing before them moves: shot for the captain's guns, and goat hides.
  'cartridges',
  'hides',
] as const;
```

and add to `GOOD_INFO`, after `sapling`:

```ts
  sapling: { label: 'Sapling', price: 2, kind: 'seed' },
  cartridges: { label: 'Cartridges', price: 2, kind: 'arms' },
  hides: { label: 'Hides', price: 8, kind: 'produce' },
};
```

- [ ] **Step 4: Add the market lines, at the end of `CAMP_GOODS`**

In `src/economy/market.ts`:

```ts
  goldOre: { merchant: 'trades', pirate: 'demands', imperial: 'demands' },
  // Phase 10.2, last so older saves' lines keep their places: cartridges sold
  // everywhere (the Crown keeps the guns, not the shot), hides wanted by the Guild's tanners.
  cartridges: { merchant: 'trades', pirate: 'trades', imperial: 'trades' },
  hides: { merchant: 'demands', pirate: 'trades', imperial: 'trades' },
};
```

- [ ] **Step 5: Add the forge recipe, last**

In `src/land/structures.ts`, change the forge's `detail`, and add the recipe at the end of its `recipes`:

```ts
    detail: 'Smelts ore into iron, and makes cutlasses, muskets, and cartridges for your guns.',
```

```ts
      { label: 'Muskets', inputs: { iron: 2, planks: 1 }, outputs: { muskets: 1 }, seconds: 30 },
      { label: 'Cartridges', inputs: { iron: 1 }, outputs: { cartridges: 12 }, seconds: 20 },
    ],
```

- [ ] **Step 6: Add the icons**

In `src/render/itemIcons.ts`, add to `ICONS`, before its closing brace. Every row is exactly 12 characters.

```ts
  cartridges: {
    colors: { a: 0x6b5a3e, b: 0xe8dcc0, c: 0x5a5f66, d: 0xa89878 },
    rows: ['............', '..ccc..ccc..', '..aba..aba..', '..aba..aba..', '..aba..aba..', '.ddddddddd..', '..aba..aba..', '..aba..aba..', '..aba..aba..', '..aaa..aaa..', '............', '............'],
  },
  hides: {
    colors: { a: 0x5e4128, b: 0xa8784a, c: 0xc8966a },
    rows: ['............', '.a.......a..', '..abbbbbba..', '.abbcccbbba.', '.abcccccbba.', '..bcccccba..', '..bcccccba..', '.abcccccbba.', '.abbcccbbba.', '..abbbbbba..', '.a.......a..', '............'],
  },
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `npx vitest run src/economy src/render/itemIcons.test.ts src/ui/hudParts.test.ts`
Expected: PASS. `itemIcons.test.ts` checks every icon is 12 × 12 with every colour defined.

- [ ] **Step 8: Typecheck and run the whole suite**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: no type errors, and all tests pass. If `Record<Good, …>` tables elsewhere now fail to compile, add their two entries, keeping each table's pattern (for example `ICONS` is `Partial`, so it's fine).

---

### Task 2: Firearms: the maths of a shot

**Files:**
- Create: `src/land/firearms.ts`
- Test: `src/land/firearms.test.ts`

**Interfaces:**
- Produces:
  - `type Gun = 'pistol' | 'rifle'`, `GUN_LIST: readonly Gun[]`, `isGun(held: string): held is Gun`.
  - `interface GunSpec { label: string; detail: string; price: number; range: number; damage: number; reload: number }`, `GUNS: Record<Gun, GunSpec>`.
  - `MUSKET = { range: 24, damage: 2, reload: 6 }` (the bandits').
  - `hitChance(gun: Gun | 'musket', distance: number): number`.
  - `AIM_CONE` (radians).
  - `interface Shootable { kind: 'creature' | 'bandit'; id: number; x: number; y: number; z: number }` (y at the feet), `aimPoint(t: Shootable): Point3`.
  - `pickTarget(from: { x: number; z: number; facing: number }, targets: readonly Shootable[], range: number, toward?: { x: number; z: number } | null): Shootable | null`.
  - `interface ShotResult { hit: Shootable | null; end: Point3; blocked: boolean }`.
  - `resolveShot(world: VoxelReader, from: Point3, to: Point3, range: number, target: Shootable | null, chance: number, roll: number): ShotResult`.
  - `clearLine(world: VoxelReader, from: Point3, to: Point3): boolean`.
  - `interface Point3 { x: number; y: number; z: number }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/land/firearms.test.ts
import { describe, expect, it } from 'vitest';
import { Block } from '../voxel/blocks';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { clearLine, GUNS, hitChance, isGun, MUSKET, pickTarget, resolveShot, type Shootable } from './firearms';

const target = (x: number, z: number, kind: Shootable['kind'] = 'bandit', id = 1): Shootable => ({ kind, id, x, y: 10, z });
const FROM = { x: 0.5, y: 11.3, z: 0.5 };
const TO = { x: 0.5, y: 11.2, z: 8.5 };

describe('firearms', () => {
  it('the pistol is good close in, the rifle clumsy close in and deadly far out', () => {
    expect(hitChance('pistol', 2)).toBeGreaterThan(hitChance('rifle', 2));
    expect(hitChance('rifle', 20)).toBeGreaterThan(0.7);
    expect(hitChance('rifle', 20)).toBeGreaterThan(hitChance('pistol', 11));
    expect(hitChance('pistol', 11)).toBeLessThan(hitChance('pistol', 3));
    expect(hitChance('musket', 16)).toBeLessThan(hitChance('musket', 8));
  });

  it('can’t hit beyond a gun’s range', () => {
    expect(hitChance('pistol', GUNS.pistol.range + 1)).toBe(0);
    expect(hitChance('rifle', GUNS.rifle.range + 1)).toBe(0);
    expect(hitChance('musket', MUSKET.range + 1)).toBe(0);
  });

  it('knows a gun from a tool or a good', () => {
    expect(isGun('pistol')).toBe(true);
    expect(isGun('rifle')).toBe(true);
    expect(isGun('axe')).toBe(false);
    expect(isGun('timber')).toBe(false);
  });

  it('with keys or a pad, aims at the nearest target within the cone ahead', () => {
    const got = pickTarget({ x: 0, z: 0, facing: 0 }, [target(0, 9, 'bandit', 1), target(0, 5, 'creature', 2), target(5, 0, 'creature', 3), target(0, -3, 'creature', 4)], 12);
    expect(got?.id).toBe(2);
    expect(pickTarget({ x: 0, z: 0, facing: 0 }, [target(6, 1)], 12), 'off to the side').toBeNull();
    expect(pickTarget({ x: 0, z: 0, facing: 0 }, [target(0, 20)], 12), 'out of range').toBeNull();
  });

  it('with the mouse, aims at whatever is at the cursor', () => {
    const got = pickTarget({ x: 0, z: 0, facing: 0 }, [target(8, 0, 'creature', 7), target(0, 4, 'creature', 8)], 12, { x: 8.4, z: 0.6 });
    expect(got?.id).toBe(7);
    expect(pickTarget({ x: 0, z: 0, facing: 0 }, [target(8, 0)], 12, { x: -8, z: 0 })).toBeNull();
  });

  it('hits or misses on the roll, against the chance', () => {
    const world = new VoxelWorld();
    const t = target(0, 8);
    expect(resolveShot(world, FROM, TO, 12, t, 0.6, 0.59).hit).toBe(t);
    const miss = resolveShot(world, FROM, TO, 12, t, 0.6, 0.61);
    expect(miss.hit).toBeNull();
    expect(miss.blocked).toBe(false);
  });

  it('is stopped by rock, trees and walls in the way', () => {
    const world = new VoxelWorld();
    for (let y = 8; y < 14; y++) world.setVoxel(0, y, 4, Block.Stone);
    const shot = resolveShot(world, FROM, TO, 12, target(0, 8), 1, 0);
    expect(shot.hit).toBeNull();
    expect(shot.blocked).toBe(true);
    expect(shot.end.z).toBeCloseTo(4, 0);
  });

  it('a miss flies on to the end of the gun’s reach', () => {
    const shot = resolveShot(new VoxelWorld(), FROM, TO, 12, null, 0, 1);
    expect(Math.hypot(shot.end.x - FROM.x, shot.end.y - FROM.y, shot.end.z - FROM.z)).toBeCloseTo(12, 1);
  });

  it('sees along a clear line, but not through a wall', () => {
    const world = new VoxelWorld();
    expect(clearLine(world, FROM, TO)).toBe(true);
    for (let y = 8; y < 14; y++) world.setVoxel(0, y, 4, Block.Stone);
    expect(clearLine(world, FROM, TO)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run src/land/firearms.test.ts`
Expected: FAIL: "Failed to resolve import './firearms'".

- [ ] **Step 3: Write the module**

```ts
// src/land/firearms.ts
import { raycastVoxels, type VoxelReader } from '../voxel/raycast';

export type Gun = 'pistol' | 'rifle';
export const GUN_LIST: readonly Gun[] = ['pistol', 'rifle'];

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface GunSpec {
  label: string;
  /** What the gunsmith says of it. */
  detail: string;
  /** Gold at the gunsmith's counter, before the house's price for your name. */
  price: number;
  /** Blocks: no hope of a hit beyond this. */
  range: number;
  /** Health a hit takes: a bandit has 4, a boar 3, a goat 2, a crab 1. */
  damage: number;
  /** Seconds to load again after a shot. */
  reload: number;
}

/** The captain's guns: the pistol quick and good close in, the rifle slow and deadly far out. */
export const GUNS: Record<Gun, GunSpec> = {
  pistol: { label: 'Pistol', detail: 'Quick to load and good close in: two shots bring a bandit down.', price: 120, range: 12, damage: 2, reload: 2.5 },
  rifle: { label: 'Rifle', detail: 'Slow to load and clumsy close in, but deadly far out: one shot brings a bandit down.', price: 350, range: 30, damage: 4, reload: 5 },
};

/** The bandits' muskets: fair at 8 blocks, poor at 24. */
export const MUSKET = { range: 24, damage: 2, reload: 6 } as const;

export const isGun = (held: string): held is Gun => (GUN_LIST as readonly string[]).includes(held);

/** The chance a shot at this distance hits. */
export function hitChance(gun: Gun | 'musket', distance: number): number {
  const d = Math.max(0, distance);
  switch (gun) {
    case 'pistol':
      return d > GUNS.pistol.range ? 0 : 0.9 - 0.55 * (d / GUNS.pistol.range);
    case 'rifle': {
      const range = GUNS.rifle.range;
      if (d > range) return 0;
      // A long barrel is slow to bring round on something right in front of you.
      return d < 5 ? 0.45 + 0.08 * d : 0.85 - 0.15 * ((d - 5) / (range - 5));
    }
    case 'musket':
      return d > MUSKET.range ? 0 : 0.75 - 0.45 * (d / MUSKET.range);
  }
}

/** With keys or a pad, a gun aims at the nearest target within this of straight ahead. */
export const AIM_CONE = Math.PI / 5;
/** With the mouse, something this close to the cursor is what it's aimed at. */
const CURSOR_SLACK = 1.5;

/** Something a shot can hit: a creature or a bandit, by its feet. */
export interface Shootable {
  kind: 'creature' | 'bandit';
  id: number;
  x: number;
  y: number;
  z: number;
}

/** Where a shot at it is aimed: a bandit's chest, a beast's flank. */
export function aimPoint(t: Shootable): Point3 {
  return { x: t.x, y: t.y + (t.kind === 'bandit' ? 1.2 : 0.4), z: t.z };
}

/**
 * What a shot is aimed at. With the mouse (`toward`): whatever is at the cursor. With keys
 * or a pad: the nearest target within range and within `AIM_CONE` of the way the shooter faces.
 */
export function pickTarget(from: { x: number; z: number; facing: number }, targets: readonly Shootable[], range: number, toward: { x: number; z: number } | null = null): Shootable | null {
  let best: Shootable | null = null;
  let score = Infinity;
  for (const t of targets) {
    if (toward) {
      const off = Math.hypot(t.x - toward.x, t.z - toward.z);
      if (off <= CURSOR_SLACK && off < score) [best, score] = [t, off];
      continue;
    }
    const dx = t.x - from.x;
    const dz = t.z - from.z;
    const d = Math.hypot(dx, dz);
    if (d > range || d >= score) continue;
    const bearing = Math.atan2(dx, dz) - from.facing;
    if (Math.abs(Math.atan2(Math.sin(bearing), Math.cos(bearing))) > AIM_CONE) continue;
    [best, score] = [t, d];
  }
  return best;
}

export interface ShotResult {
  /** What it hit, if anything. */
  hit: Shootable | null;
  /** Where the shot ended: at what it hit, at cover, in the ground, or spent at the end of its reach. */
  end: Point3;
  /** Stopped by rock, a tree or a wall before it got there. */
  blocked: boolean;
}

/**
 * A shot from `from` at `to` (the target's aim point, or wherever it's fired): an instant
 * line, stopped by the first solid block, and otherwise a hit on the roll if `roll` is
 * under `chance`. A miss flies on to the end of the gun's `range`, or into what it meets.
 */
export function resolveShot(world: VoxelReader, from: Point3, to: Point3, range: number, target: Shootable | null, chance: number, roll: number): ShotResult {
  const length = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) || 1;
  const ux = (to.x - from.x) / length;
  const uy = (to.y - from.y) / length;
  const uz = (to.z - from.z) / length;
  const along = (d: number): Point3 => ({ x: from.x + ux * d, y: from.y + uy * d, z: from.z + uz * d });
  const cover = raycastVoxels(world, from.x, from.y, from.z, ux, uy, uz, target ? Math.min(length, range) : range);
  if (cover) return { hit: null, end: along(cover.distance), blocked: true };
  if (target && length <= range && roll < chance) return { hit: target, end: { ...to }, blocked: false };
  const beyond = raycastVoxels(world, from.x, from.y, from.z, ux, uy, uz, range);
  return { hit: null, end: along(beyond ? beyond.distance : range), blocked: false };
}

/** Can one see (or shoot) from `from` to `to`, with nothing solid between? */
export function clearLine(world: VoxelReader, from: Point3, to: Point3): boolean {
  const length = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  if (length < 0.01) return true;
  return raycastVoxels(world, from.x, from.y, from.z, (to.x - from.x) / length, (to.y - from.y) / length, (to.z - from.z) / length, length) === null;
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run src/land/firearms.test.ts`
Expected: PASS (9 tests). If "is stopped by rock" is off by a block, check that `VoxelHit.distance` is the distance to where the ray enters the block (see `src/voxel/raycast.ts`). If it's to the block's middle, use it all the same and loosen the expectation to `toBeCloseTo(4.5, 0)`.

- [ ] **Step 5: Typecheck and run the whole suite**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: all pass.

---

### Task 3: The captain's guns: bought in port, kept, saved

**Files:**
- Modify: `src/economy/captain.ts` (`Captain.guns`, `createCaptain`)
- Modify: `src/combat/sea.ts` (`SeaSnapshot.captain.guns?`, `snapshot`, `restore`)
- Modify: `src/economy/economy.ts` (`sellsGuns`, `gunPrice`, `buyGun`)
- Modify: `src/ui/port/MarketTab.tsx` (the gunsmith's counter)
- Modify: `src/save/storage.ts` (version 6)
- Test: `src/economy/gunsmith.test.ts` (new)

**Interfaces:**
- Consumes: `Gun`, `GUN_LIST`, `GUNS` (Task 2).
- Produces:
  - `Captain.guns: Gun[]`.
  - `sellsGuns(port: Port): boolean`, exported from `economy.ts`.
  - `Economy.gunPrice(port: Port, gun: Gun): number` and `Economy.buyGun(port: Port, gun: Gun): Outcome`.
  - `SAVE_VERSION = 6`.

- [ ] **Step 1: Write the failing test**

```ts
// src/economy/gunsmith.test.ts
import { describe, expect, it } from 'vitest';
import { Sea } from '../combat/sea';
import { shipClass } from '../combat/vessel';
import { footprintSamples } from '../sailing/hull';
import { BRIG, MERCHANT_BRIG, MERCHANT_SLOOP, SLOOP } from '../sailing/ships';
import { Weather } from '../sailing/weather';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { Economy, sellsGuns } from './economy';
import type { Port, PortFaction } from './ports';

const CLASSES = new Map(
  [SLOOP, BRIG, MERCHANT_SLOOP, MERCHANT_BRIG].map((type) => {
    const cells: Array<[number, number]> = [];
    for (let x = 0; x < 5; x++) for (let z = 0; z < 15; z++) cells.push([x - 2.5, z - 7.5]);
    return [type, shipClass(type, footprintSamples(cells), 2.5, 16)] as const;
  }),
);
const port = (faction: PortFaction): Port => ({ id: 0, name: 'Port', faction, x: 0, z: 0, heading: 0, islandX: 0, islandZ: 0, pier: { x: 0, y: 13, z: 0 }, places: [], lamps: [] });

function setup(faction: PortFaction) {
  const ports = [port(faction)];
  const sea = new Sea(new VoxelWorld(), new Weather({ cells: [] }), CLASSES, SLOOP, ports, 1, false);
  const economy = new Economy(sea, ports, 1);
  sea.captain.gold = 1000;
  return { sea, economy, port: ports[0] };
}

describe('the gunsmith', () => {
  it('keeps a counter in free ports and the pirate haven, not in the Crown’s', () => {
    expect(sellsGuns(port('merchant'))).toBe(true);
    expect(sellsGuns(port('pirate'))).toBe(true);
    expect(sellsGuns(port('imperial'))).toBe(false);
  });

  it('sells each gun once, at about its price, and the captain keeps it', () => {
    const { sea, economy, port: here } = setup('merchant');
    const price = economy.gunPrice(here, 'pistol');
    expect(price).toBeGreaterThan(90);
    expect(price).toBeLessThan(160);
    expect(economy.buyGun(here, 'pistol').ok).toBe(true);
    expect(sea.captain.guns).toEqual(['pistol']);
    expect(sea.captain.gold).toBe(1000 - price);
    expect(economy.buyGun(here, 'pistol').ok).toBe(false);
    expect(sea.captain.guns).toEqual(['pistol']);
  });

  it('won’t sell what the purse can’t pay for', () => {
    const { sea, economy, port: here } = setup('pirate');
    sea.captain.gold = 100;
    expect(economy.buyGun(here, 'rifle').ok).toBe(false);
    expect(sea.captain.guns).toEqual([]);
    expect(sea.captain.gold).toBe(100);
  });

  it('won’t sell in an Imperial port', () => {
    const { sea, economy, port: here } = setup('imperial');
    expect(economy.buyGun(here, 'pistol').ok).toBe(false);
    expect(sea.captain.guns).toEqual([]);
  });

  it('the guns are kept through a save, and an older save has none', () => {
    const { sea, economy, port: here } = setup('pirate');
    economy.buyGun(here, 'rifle');
    const saved = JSON.parse(JSON.stringify(sea.snapshot()));
    sea.captain.guns = [];
    sea.restore(saved);
    expect(sea.captain.guns).toEqual(['rifle']);
    delete saved.captain.guns;
    sea.restore(saved);
    expect(sea.captain.guns).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run src/economy/gunsmith.test.ts`
Expected: FAIL: `sellsGuns` is not exported.

- [ ] **Step 3: The captain keeps guns**

In `src/economy/captain.ts`, import the type and add the field (after `letter`):

```ts
import type { Gun } from '../land/firearms';
```

```ts
  /** The sealed letter from Blackwood's hoard. */
  letter: boolean;
  /** Guns bought at a gunsmith's counter: kept for good, whatever becomes of the ship. */
  guns: Gun[];
}
```

```ts
export function createCaptain(home: Port): Captain {
  return { gold: STARTING_GOLD, lastPort: home, standing: startingStanding(), contracts: [], logbook: {}, pack: {}, passengers: 0, maps: [], relics: [], pieces: 0, letter: false, guns: [] };
}
```

- [ ] **Step 4: Save them with the captain**

In `src/combat/sea.ts`:
- Import `import type { Gun } from '../land/firearms';`.
- Add `guns?: Gun[];` to `SeaSnapshot.captain`, after `letter?: boolean;`, with a comment `/** Version 6. */`.
- In `snapshot()`, add `guns: [...c.guns],` after `letter: c.letter,`.
- In `restore()`, add `guns: [...(c.guns ?? [])],` after `letter: c.letter ?? false,`.

- [ ] **Step 5: The gunsmith's trade**

In `src/economy/economy.ts`, import `import { GUNS, type Gun } from '../land/firearms';` and add this near the other exported helpers (before `export class Economy`):

```ts
/** Arms are the Crown's monopoly: free ports and the pirate haven keep a gunsmith's counter; Imperial ports don't. */
export const sellsGuns = (port: Port): boolean => port.faction !== 'imperial';
```

In the class, after `sell(...)`:

```ts
  // ---- The gunsmith ----

  /** What a gun costs here, by the house's price for your name. */
  gunPrice(port: Port, gun: Gun): number {
    return Math.round(GUNS[gun].price * this.factor(port));
  }

  /** Buys a gun: the captain keeps it for good. */
  buyGun(port: Port, gun: Gun): Outcome {
    const label = GUNS[gun].label.toLowerCase();
    if (!sellsGuns(port)) return fail('Arms are the Crown’s monopoly: no gunsmith here will sell you a gun.');
    if (this.captain.guns.includes(gun)) return fail(`You already have a ${label}.`);
    const price = this.gunPrice(port, gun);
    if (price > this.captain.gold) return fail(`A ${label} costs ${price} gold.`);
    this.captain.gold -= price;
    this.captain.guns.push(gun);
    return done(`Bought a ${label} for ${price} gold. Take it up from the hotbar ashore; it fires cartridges.`);
  }
```

- [ ] **Step 6: Run the test to see it pass**

Run: `npx vitest run src/economy/gunsmith.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: The counter in the market**

In `src/ui/port/MarketTab.tsx`:
- Import `sellsGuns` from `'../../economy/economy'`.
- Import `GUN_LIST, GUNS` from `'../../land/firearms'`.
- Replace the closing `</table>` and hint paragraph with:

```tsx
      </table>
      {sellsGuns(port) ? (
        <>
          <h3>The gunsmith’s counter</h3>
          <div className="yard-list">
            {GUN_LIST.map((gun) => {
              const has = sea.captain.guns.includes(gun);
              const price = economy.gunPrice(port, gun);
              return (
                <div key={gun} className={`yard-item${has ? ' owned' : ''}`}>
                  <div>
                    <b>{GUNS[gun].label}</b>
                    <small>{GUNS[gun].detail}</small>
                  </div>
                  <button type="button" disabled={has || price > sea.captain.gold} onClick={() => act(economy.buyGun(port, gun))}>
                    {has ? 'Yours' : <Gold amount={price} />}
                  </button>
                </div>
              );
            })}
          </div>
          <p className="hint">Guns fire cartridges, sold above with the arms. A forge makes twelve from one iron.</p>
        </>
      ) : (
        <p className="hint">Arms are the Crown’s monopoly here: no gunsmith will sell you a gun. Cartridges are another matter.</p>
      )}
      <p className="hint">Prices climb as you buy and fall as you sell, and recover over a few minutes. Your price book fills in as you visit ports and hear tavern gossip.</p>
```

- [ ] **Step 8: Save version 6**

In `src/save/storage.ts`:

```ts
/**
 * Bumped when the format changes. Version 2 (Phase 6) added the clock, settlers and
 * workshops; version 3 (Phase 7) treasure maps and finds; version 4 (Phase 8) the
 * story; version 5 (Phase 10) worked-out outcrops; version 6 (Phase 10.2) the
 * captain's guns, bandit camps, and piles that lie a day. Older saves still load.
 */
export const SAVE_VERSION = 6;
export const READABLE_VERSIONS: readonly number[] = [1, 2, 3, 4, 5, 6];
```

- [ ] **Step 9: Typecheck and run the whole suite**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: all pass. If a test elsewhere builds a `Captain` literal, add `guns: []` to it. If `save.test.ts` checks the version, it reads `SAVE_VERSION` and still passes.

---

### Task 4: Wild goats, and loot as cargo

**Files:**
- Modify: `src/land/creatures.ts`
- Modify: `src/land/Land.ts` (`hit` drops cargo)
- Modify: `src/render/PeopleView.ts` (the goat's shape)
- Test: `src/land/creatures.test.ts`

**Interfaces:**
- Produces:
  - `CreatureKind = 'crab' | 'boar' | 'goat'`.
  - `CREATURES[kind]` gains `when: 'night' | 'day'`, `loot: Cargo` (replacing `loot`/`amount`), and optional `herd: readonly [number, number]`, `shy: number` and `upland: number`.
  - `harm(c: Creature, damage: number, fromX: number, fromZ: number): Cargo | null` (exported).
  - `strike(c, tool, fromX, fromZ): Cargo | null`.
  - `Land.landed(c: Creature, caught: Cargo | null, verb: string): Outcome` (private), which Task 5 uses for shots.

- [ ] **Step 1: Write the failing tests**

Add to `src/land/creatures.test.ts` (it already has `CLASSES`, `FAR_PORT` and the `night()` fixture):

```ts
import { harm } from './creatures';

/** A grassy upland plateau (ground top at SEA_LEVEL + 6), sand round its edge, the captain in the middle at noon. */
function upland() {
  const world = new VoxelWorld();
  for (let x = -40; x < 40; x++) {
    for (let z = -40; z < 40; z++) {
      const edge = Math.max(Math.abs(x), Math.abs(z)) > 34;
      const top = edge ? SEA_LEVEL : SEA_LEVEL + 6;
      for (let y = 0; y <= top; y++) world.setVoxel(x, y, z, y === top ? (edge ? Block.Sand : Block.Grass) : Block.Dirt);
    }
  }
  const sea = new Sea(world, new Weather({ cells: [] }), CLASSES, SLOOP, [FAR_PORT], 1, false);
  Object.assign(sea.player.ship, { x: 50, z: 0, heading: 0, surge: 0 });
  sea.clock.phase = phaseOf(12);
  const land = new Land(world, sea, 3);
  land.goAshore();
  Object.assign(land.walker!, { x: 0.5, z: 0.5, y: SEA_LEVEL + 7 });
  return { world, sea, land };
}

const goats = (land: Land) => land.creatures.filter((c) => c.kind === 'goat');

describe('wild goats', () => {
  it('graze by day in herds of two to four, on upland grass', () => {
    const { land } = upland();
    for (let t = 0; t < 60; t += 1 / 20) land.step(1 / 20);
    const herd = goats(land);
    expect(herd.length).toBeGreaterThanOrEqual(2);
    expect(herd.length).toBeLessThanOrEqual(4);
    for (const g of herd) expect(g.walker.y).toBeGreaterThanOrEqual(SEA_LEVEL + 5);
    expect(land.creatures.filter((c) => c.kind !== 'goat')).toHaveLength(0);
  });

  it('keep away from camps and firelight', () => {
    const { land, sea } = upland();
    sea.player.cargo.timber = 50;
    land.build('campfire', 0, 3, 0);
    for (let t = 0; t < 60; t += 1 / 20) land.step(1 / 20);
    for (const g of goats(land)) expect(land.claimed(g.walker.x, g.walker.z)).toBe(false);
  });

  it('bolt when the captain comes within about eight blocks, the herd with them', () => {
    const { land } = upland();
    push(land, 'goat', 6.5, 0.5);
    push(land, 'goat', 9.5, 2.5);
    land.creatures.forEach((c) => (c.walker.y = SEA_LEVEL + 7));
    for (let t = 0; t < 0.6; t += 1 / 20) land.step(1 / 20);
    for (const g of goats(land).slice(0, 2)) expect(g.fleeing).toBeGreaterThan(0);
  });

  it('are gone at night, as crabs and boar are gone by day', () => {
    const { land, sea } = upland();
    push(land, 'goat', 20.5, 0.5);
    sea.clock.phase = phaseOf(23);
    land.step(1 / 20);
    expect(goats(land)).toHaveLength(0);
    sea.clock.phase = phaseOf(12);
    push(land, 'boar', 20.5, 0.5);
    land.step(1 / 20);
    expect(land.creatures.filter((c) => c.kind === 'boar')).toHaveLength(0);
  });

  it('take two blows, and give two meat and a hide', () => {
    const { land } = upland();
    push(land, 'goat', 20.5, 0.5);
    const goat = land.creatures[0];
    expect(harm(goat, 1, 0, 0)).toBeNull();
    expect(goat.fleeing).toBeGreaterThan(0);
    expect(harm(goat, 1, 0, 0)).toEqual({ meat: 2, hides: 1 });
    expect(CREATURES.goat.hp).toBe(2);
  });
});
```

The existing `push(land, kind, x, z)` helper (line ~51) builds a creature with `hp: CREATURES[kind].hp` and puts its walker at `SEA_LEVEL + 1`. The goat tests raise the walker where it matters.

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/land/creatures.test.ts`
Expected: FAIL. `'goat'` isn't a `CreatureKind`, and `harm` isn't exported.

- [ ] **Step 3: Kinds, loot and `harm`**

In `src/land/creatures.ts`:
- Import `import type { Cargo } from '../economy/goods';` (keep the `Good` import only if still used).
- Import `import { SEA_LEVEL } from '../config';`.
- Replace the kind, the table and `strike`:

```ts
export type CreatureKind = 'crab' | 'boar' | 'goat';

interface CreatureSpec {
  label: string;
  speed: number;
  hp: number;
  /** How far off it smells a ripe crop (0: it doesn't raid fields). */
  smell: number;
  /** At most this many about at once. */
  most: number;
  /** What it gives when it's brought down. */
  loot: Cargo;
  ground: number[];
  /** When it's about: the night's raiders, or the day's game. */
  when: 'night' | 'day';
  /** It comes out in herds of this many, least and most. */
  herd?: readonly [number, number];
  /** It bolts when the captain comes this close. */
  shy?: number;
  /** It keeps to ground at least this high above the sea. */
  upland?: number;
}

/**
 * Night creatures (crabs up from the beach, boar out of the woods, both after your crops)
 * and the day's game (wild goats on the uplands, shy of people).
 */
export const CREATURES: Record<CreatureKind, CreatureSpec> = {
  crab: { label: 'land crab', speed: 1.5, hp: 1, smell: 12, most: 4, loot: { fish: 1 }, ground: [Block.Sand], when: 'night' },
  boar: { label: 'wild boar', speed: 3.4, hp: 3, smell: 18, most: 2, loot: { meat: 3 }, ground: [Block.Grass, Block.Dirt], when: 'night' },
  goat: { label: 'wild goat', speed: 4.2, hp: 2, smell: 0, most: 4, loot: { meat: 2, hides: 1 }, ground: [Block.Grass], when: 'day', herd: [2, 4], shy: 8, upland: 4 },
};
```

```ts
/**
 * Something hurts a creature (a blow, a shot): it bolts, and enough brings it down.
 * Returns what it gives, if it's down.
 */
export function harm(c: Creature, damage: number, fromX: number, fromZ: number): Cargo | null {
  c.hp -= damage;
  scare(c, fromX, fromZ, 4);
  return c.hp > 0 ? null : { ...CREATURES[c.kind].loot };
}

/** The captain takes a swing at a creature with a tool. */
export function strike(c: Creature, tool: Tool, fromX: number, fromZ: number): Cargo | null {
  return harm(c, TOOL_DAMAGE[tool], fromX, fromZ);
}
```

- [ ] **Step 4: Day and night in `stepCreatures`, and herds**

Replace `stepCreatures` and add `spawnHerd`, `grazing` and `newCreature`. `spawn` (the night's) keeps its draws exactly, and only its push becomes `newCreature`.

```ts
/**
 * One step of the wildlife around the captain. By night crabs and boar come out of the
 * dark for crops that aren't fenced in or lit, and slink off at dawn. By day wild goats
 * graze the uplands in herds, and are gone by nightfall.
 */
export function stepCreatures(land: Land, dt: number, random: () => number): void {
  const w = land.walker;
  const night = darkness(land.sea.clock.phase) > 0.6;
  const list = land.creatures;
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i];
    const far = !w || Math.hypot(c.walker.x - w.x, c.walker.z - w.z) > GONE_BEYOND;
    const itsTime = (CREATURES[c.kind].when === 'night') === night;
    if (far || (!itsTime && c.fleeing <= 0)) list.splice(i, 1);
  }
  if (!w) return;

  land.spawnIn -= dt;
  if (land.spawnIn <= 0) {
    land.spawnIn = SPAWN_EVERY;
    if (night) spawn(land, w, random);
    else spawnHerd(land, w, random);
  }
  const reader = fenced(land.world);
  const lights = land.lights();
  for (const c of list) stepCreature(land, c, dt, reader, lights, random);
}

function newCreature(land: Land, kind: CreatureKind, x: number, y: number, z: number, random: () => number): Creature {
  return { id: land.nextCreature++, kind, walker: createWalker(x, y, z, random() * Math.PI * 2), hp: CREATURES[kind].hp, target: null, eating: 0, fleeing: 0, flee: { x: 0, z: 0 }, think: 0 };
}
```

In `spawn`, replace the object literal pushed with `return void land.creatures.push(newCreature(land, kind, x, y, z, random));`. It makes the same single `random()` draw for facing, so the night's numbers don't change.

```ts
/** A herd of goats comes over the brow of a hill, somewhere out of sight of the captain. */
function spawnHerd(land: Land, w: Walker, random: () => number): void {
  const spec = CREATURES.goat;
  const [least, most] = spec.herd!;
  const have = land.creatures.filter((c) => c.kind === 'goat').length;
  if (spec.most - have < least) return;
  const lights = land.lights();
  for (let i = 0; i < SPAWN_TRIES; i++) {
    const angle = random() * Math.PI * 2;
    const distance = SPAWN_NEAR + random() * (SPAWN_FAR - SPAWN_NEAR);
    const cx = Math.floor(w.x + Math.sin(angle) * distance) + 0.5;
    const cz = Math.floor(w.z + Math.cos(angle) * distance) + 0.5;
    if (grazing(land, cx, cz, lights) === null) continue;
    const size = Math.min(least + Math.floor(random() * (most - least + 1)), spec.most - have);
    for (let n = 0; n < size; n++) {
      const x = Math.floor(cx + (random() - 0.5) * 4) + 0.5;
      const z = Math.floor(cz + (random() - 0.5) * 4) + 0.5;
      const y = grazing(land, x, z, lights);
      if (y !== null) land.creatures.push(newCreature(land, 'goat', x, y, z, random));
    }
    return;
  }
}

/** Where a goat can graze: upland grass, off town and camp land, out of firelight. Its footing's height, or null. */
function grazing(land: Land, x: number, z: number, lights: ReadonlyArray<{ x: number; z: number }>): number | null {
  if (land.inTown(x, z) || land.claimed(x, z)) return null;
  if (lights.some((l) => Math.hypot(l.x - x, l.z - z) < LIGHT_RADIUS * 3)) return null;
  const y = standable(land.world, x, z, groundHeight(land.world, Math.floor(x), Math.floor(z)) + 1);
  if (y === null || y - 1 < SEA_LEVEL + CREATURES.goat.upland!) return null;
  return land.world.getVoxel(Math.floor(x), y - 1, Math.floor(z)) === Block.Grass ? y : null;
}
```

- [ ] **Step 5: Goats graze slowly, and bolt from the captain**

In `stepCreature`, keep the fleeing branch as it is. In the `think` branch, check a shy creature before the light and crop checks:

```ts
  if (c.think <= 0) {
    c.think = THINK_SECONDS;
    const captain = land.walker;
    if (spec.shy && captain && Math.hypot(captain.x - w.x, captain.z - w.z) < spec.shy) {
      // One sees you, and the herd goes with it.
      for (const o of land.creatures) if (o.kind === c.kind && Math.hypot(o.walker.x - w.x, o.walker.z - w.z) < 8) scare(o, captain.x, captain.z, 5);
      return;
    }
    const light = lights.find((l) => Math.hypot(l.x - w.x, l.z - w.z) < LIGHT_RADIUS);
```

Grazing is slow: where the creature steps toward its target (the last `stepWalker` call in `stepCreature`), use `const pace = spec.when === 'day' ? spec.speed * 0.25 : spec.speed;` and pass `pace` for `spec.speed`. The fleeing branch keeps `spec.speed * 1.4`.

- [ ] **Step 6: `Land.hit` drops cargo**

In `src/land/Land.ts`, replace `hit` with this and a shared `landed`:

```ts
  private hit(c: Creature, tool: Tool): Outcome {
    const w = this.walker!;
    return this.landed(c, strike(c, tool, w.x, w.z), 'Caught');
  }

  /** A blow or a shot landed on a creature: it bolts, or it's down and what it gives falls where it lay. */
  private landed(c: Creature, caught: Cargo | null, verb: string): Outcome {
    const label = CREATURES[c.kind].label;
    if (!caught) return done(`The ${label} bolts!`);
    this.creatures.splice(this.creatures.indexOf(c), 1);
    const { x, y, z } = c.walker;
    const goods = Object.entries(caught) as Array<[Good, number]>;
    for (const [good, n] of goods) for (let i = 0; i < n; i++) this.drop(good, x, y + 0.3, z);
    this.events.push({ kind: 'work', action: 'catch', x, y, z, good: goods[0]?.[0], amount: cargoCount(caught) });
    return done(`${verb} a ${label}!`);
  }
```

- [ ] **Step 7: The goat, drawn**

In `src/render/PeopleView.ts`, add `goat: creatureShape('goat')` to `shapes`, and a goat branch in `creatureShape`. The crab keeps its `if`, and the boar becomes `else if (kind === 'boar')`.

```ts
  } else {
    // A goat: pale coat, dark horns, a beard.
    palette.set([214, 204, 186, 255], 4);
    palette.set([150, 138, 120, 255], 8);
    palette.set([70, 60, 50, 255], 12);
    palette.set([30, 30, 30, 255], 16);
    box(-2, 2, 4, 7, -4, 3, 1); // body
    box(-1, 1, 6, 9, 4, 6, 1); // neck and head
    box(-1, -1, 10, 11, 4, 4, 3); // horns
    box(1, 1, 10, 11, 4, 4, 3);
    box(0, 0, 5, 5, 6, 6, 2); // beard
    box(-1, -1, 8, 8, 6, 6, 4); // eyes
    box(1, 1, 8, 8, 6, 6, 4);
    for (const x of [-2, 2]) for (const z of [-3, 2]) box(x, x, 0, 3, z, z, 2); // legs
    box(0, 0, 7, 8, -5, -5, 1); // tail
  }
```

- [ ] **Step 8: Run the tests**

Run: `npx vitest run src/land/creatures.test.ts src/land/Land.test.ts`
Expected: PASS, the new goat tests with the existing crab and boar ones. If "graze by day in herds" finds no goats, the plateau is the problem: goats need grass with its top at least `SEA_LEVEL + 4`. Check `grazing` against the fixture first, then the spawn ring.

- [ ] **Step 9: Typecheck and run the whole suite**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: all pass.

---

### Task 5: Firing on foot

**Files:**
- Modify: `src/land/Land.ts`
- Modify: `src/core/Controls.ts` (`item10`)
- Modify: `src/Shore.ts`
- Modify: `src/render/itemIcons.ts` (`GUN_ICONS`)
- Modify: `src/ui/hudParts.ts`, `src/ui/hudParts.test.ts`
- Modify: `src/ui/FootHud.ts`, `src/style.css` (the reload shade; the legend)
- Test: `src/land/Land.test.ts`

**Interfaces:**
- Consumes: Task 2 (`GUNS`, `GUN_LIST`, `isGun`, `hitChance`, `pickTarget`, `resolveShot`, `aimPoint`, `Shootable`); Task 3 (`Captain.guns`); Task 4 (`harm`, `Land.landed`).
- Produces:
  - `Held = Tool | Gun | Good`.
  - `POUCH = 24` (exported).
  - `Land.fire(gun: Gun, toward?: Point3 | null): Outcome`, `Land.gunTarget(gun: Gun, toward: Point3 | null): Shootable | null`, `Land.reloadLeft(gun: Gun): number` (0 to 1 of the reload still to go).
  - `Land.shootables(): Shootable[]` (private; Task 11 adds bandits).
  - `Land.wound(t: Shootable, damage: number): Outcome` (private; Task 11 adds bandits).
  - `LandEvent` `{ kind: 'shot'; gun: Gun | 'musket'; from: Point3; to: Point3; hit: 'creature' | 'bandit' | 'captain' | null }`.
  - `Slot.reload?: number`.
  - `GUN_ICONS: Record<Gun, Icon>`.

- [ ] **Step 1: Write the failing tests**

Add to `src/land/Land.test.ts`. Also import `phaseOf` from `'../core/clock'`, `GUNS, type Gun` from `'./firearms'`, and `POUCH` from `'./Land'`.

```ts
describe('guns', () => {
  /** The captain ashore with a gun and 30 cartridges in the hold, at night (so beasts stay about). */
  function armed(gun: Gun = 'pistol') {
    const { world, sea, land } = setup();
    sea.clock.phase = phaseOf(23);
    sea.captain.guns.push(gun);
    sea.player.cargo.cartridges = 30;
    land.goAshore();
    walkTo(land, 0.5, 0.5, 0);
    return { world, sea, land };
  }
  const boar = (land: Land, x: number, z: number) =>
    land.creatures.push({ id: land.nextCreature++, kind: 'boar', walker: createWalker(x, SEA_LEVEL + 1, z), hp: 3, target: null, eating: 0, fleeing: 0, flee: { x: 0, z: 0 }, think: 0 });
  const reload = (land: Land, gun: Gun) => {
    for (let t = 0; t < GUNS[gun].reload + 0.1; t += 1 / 60) land.step(1 / 60);
  };

  it('takes a pouch of cartridges ashore from the hold', () => {
    const { land, sea } = armed();
    expect(land.pack.cartridges).toBe(POUCH);
    expect(sea.player.cargo.cartridges).toBe(30 - POUCH);
  });

  it('takes no cartridges ashore without a gun', () => {
    const { land, sea } = setup();
    sea.player.cargo.cartridges = 30;
    land.goAshore();
    expect(land.pack.cartridges).toBeUndefined();
  });

  it('spends a cartridge a shot, and loads before it fires again', () => {
    const { land } = armed();
    expect(land.fire('pistol').ok).toBe(true);
    expect(land.available('cartridges')).toBe(29);
    expect(land.reloadLeft('pistol')).toBeCloseTo(1, 5);
    reload(land, 'pistol');
    expect(land.reloadLeft('pistol')).toBe(0);
    expect(land.fire('pistol').ok).toBe(true);
    expect(land.available('cartridges')).toBe(28);
  });

  it('won’t fire while loading, and doesn’t spend a cartridge trying', () => {
    const { land } = armed();
    land.fire('pistol');
    land.step(1);
    const left = land.reloadLeft('pistol');
    const again = land.fire('pistol');
    expect(again.ok).toBe(false);
    expect(again.message).toBe('Still loading.');
    expect(land.available('cartridges')).toBe(29);
    expect(land.reloadLeft('pistol')).toBeCloseTo(left, 5);
  });

  it('won’t fire without cartridges, or without the gun', () => {
    const { land, sea } = armed();
    delete land.pack.cartridges;
    delete sea.player.cargo.cartridges;
    expect(land.fire('pistol').ok).toBe(false);
    expect(land.reloadLeft('pistol')).toBe(0);
    expect(land.fire('rifle').ok).toBe(false);
  });

  it('shoots a boar ahead, and it falls and gives its meat', () => {
    const { land } = armed('rifle');
    boar(land, 0.5, 6.5);
    for (let i = 0; i < 10 && land.creatures.some((c) => c.kind === 'boar' && c.walker.z < 10); i++) {
      land.fire('rifle');
      reload(land, 'rifle');
    }
    expect(land.creatures.filter((c) => c.kind === 'boar' && c.walker.z < 10)).toHaveLength(0);
    expect(land.drops.some((d) => d.good === 'meat')).toBe(true);
  });

  it('with the mouse, fires toward the cursor; a wall in the way takes the shot', () => {
    const { world, land } = armed('rifle');
    boar(land, 8.5, 0.5);
    for (let y = SEA_LEVEL + 1; y < SEA_LEVEL + 5; y++) for (let z = -2; z <= 2; z++) world.setVoxel(4, y, z, Block.Stone);
    land.takeEvents();
    land.fire('rifle', { x: 8.5, y: SEA_LEVEL + 1.4, z: 0.5 });
    const shot = land.takeEvents().find((e) => e.kind === 'shot');
    expect(shot).toMatchObject({ kind: 'shot', gun: 'rifle', hit: null });
    expect(land.creatures.find((c) => c.kind === 'boar')!.hp).toBe(3);
    expect(land.walker!.facing).toBeCloseTo(Math.PI / 2, 1);
  });
});
```

`createWalker` is exported from `./walker`. Add it to the imports if `Land.test.ts` doesn't have it.

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/land/Land.test.ts -t guns`
Expected: FAIL. `land.fire` doesn't exist, and `POUCH` isn't exported.

- [ ] **Step 3: `Land`: guns in hand, the pouch, firing, loading**

In `src/land/Land.ts`:
- Imports:

```ts
import { aimPoint, GUN_LIST, GUNS, type Gun, hitChance, isGun, pickTarget, type Point3, resolveShot, type Shootable } from './firearms';
import { type Creature, CREATURES, harm, stepCreatures, strike } from './creatures';
```

- `Held` and the pouch:

```ts
/** What's in the captain's hands: a tool, a gun, or a seed to plant. */
export type Held = Tool | Gun | Good;
/** Cartridges the captain takes ashore from the hold, with a gun to fire them. */
export const POUCH = 24;
/** A gun is fired from the chest. */
const MUZZLE = 1.3;
```

- Add a `LandEvent` member: `| { kind: 'shot'; gun: Gun | 'musket'; from: Point3; to: Point3; hit: 'creature' | 'bandit' | 'captain' | null }`.
- Add a field: `/** Seconds each gun has left to load (not saved: loaded again by the time a save is loaded). */ private readonly loading: Partial<Record<Gun, number>> = {};`
- In `step(dt)`, after `this.work(dt);`: `for (const gun of GUN_LIST) if (this.loading[gun]) this.loading[gun] = Math.max(0, this.loading[gun]! - dt);`
- In `goAshore()`, after the walker is made, call `this.fillPouch();`. Do the same in `landAtPort()`.
- New methods, placed after `goAboard()`:

```ts
  /** With a gun, the captain takes a pouch of cartridges ashore from the hold. */
  private fillPouch(): void {
    if (this.sea.captain.guns.length === 0) return;
    const want = POUCH - (this.pack.cartridges ?? 0);
    if (want > 0) Land.transfer(this.sea.player.cargo, this.pack, 'cartridges', want, this.packRoom());
  }

  // ---- Guns ----

  /** How much of a gun's loading is still to go: 1 just fired, 0 ready. */
  reloadLeft(gun: Gun): number {
    return (this.loading[gun] ?? 0) / GUNS[gun].reload;
  }

  /** What a shot would be aimed at: at the cursor (`toward`), or else the nearest target ahead. */
  gunTarget(gun: Gun, toward: Point3 | null): Shootable | null {
    const w = this.walker;
    return w ? pickTarget(w, this.shootables(), GUNS[gun].range, toward) : null;
  }

  /**
   * Fires a gun: at what's under the mouse (`toward`), or else the nearest target within
   * the cone ahead, or straight ahead. It costs a cartridge, and the gun loads again by itself.
   */
  fire(gun: Gun, toward: Point3 | null = null): Outcome {
    const w = this.walker;
    if (!w) return fail('You’re aboard ship.');
    const spec = GUNS[gun];
    if (!this.sea.captain.guns.includes(gun)) return fail(`You have no ${spec.label.toLowerCase()}.`);
    if ((this.loading[gun] ?? 0) > 0) return fail('Still loading.');
    if (this.available('cartridges') < 1) return fail('No cartridges to hand: buy some in port, or make them at a forge.');
    this.spend({ cartridges: 1 });
    this.loading[gun] = spec.reload;
    const target = pickTarget(w, this.shootables(), spec.range, toward);
    const from = { x: w.x, y: w.y + MUZZLE, z: w.z };
    const at = target ? aimPoint(target) : (toward ?? { x: w.x + Math.sin(w.facing) * spec.range, y: from.y, z: w.z + Math.cos(w.facing) * spec.range });
    w.facing = Math.atan2(at.x - w.x, at.z - w.z);
    const distance = Math.hypot(at.x - from.x, at.z - from.z);
    const shot = resolveShot(this.world, from, at, spec.range, target, target ? hitChance(gun, distance) : 0, this.random());
    this.events.push({ kind: 'shot', gun, from, to: shot.end, hit: shot.hit ? shot.hit.kind : null });
    return shot.hit ? this.wound(shot.hit, spec.damage) : done('');
  }

  /** What a shot could hit round the captain. */
  private shootables(): Shootable[] {
    return this.creatures.map((c) => ({ kind: 'creature' as const, id: c.id, x: c.walker.x, y: c.walker.y, z: c.walker.z }));
  }

  /** A shot lands on something. */
  private wound(t: Shootable, damage: number): Outcome {
    const c = this.creatures.find((o) => o.id === t.id);
    const w = this.walker!;
    return c ? this.landed(c, harm(c, damage, w.x, w.z), 'Shot') : done('');
  }
```

- At the top of `use(held, target)`, after the `if (!target)` line: `if (isGun(held)) return this.fire(held);`
- At the top of `aim(held, t)`: `if (isGun(held)) return { ok: false, reason: 'Fire it with Space or a click.' };`

- [ ] **Step 4: Run the Land tests**

Run: `npx vitest run src/land/Land.test.ts`
Expected: PASS. If "shoots a boar ahead" fails because the boar bolts out of range between shots, fire with the mouse (`land.fire('rifle', { x: boar.walker.x, y: boar.walker.y + 0.4, z: boar.walker.z })`) at wherever it is now.

- [ ] **Step 5: A tenth hotbar key**

In `src/core/Controls.ts`, add `| 'item10'` after `| 'item9'` in the action union, and `['Digit0', 'item10'],` after `['Digit9', 'item9'],` in the on-foot keys.

- [ ] **Step 6: Gun icons, labels and slots**

In `src/render/itemIcons.ts`, import `import type { Gun } from '../land/firearms';` and add:

```ts
/** The guns as the hotbar shows them: iron barrels on walnut stocks, pointing right. */
export const GUN_ICONS: Record<Gun, Icon> = {
  pistol: {
    colors: TOOL_COLORS,
    rows: ['............', '............', '............', '..ddddddddd.', '.hhSsssssssd', '.hhhhdddddd.', '.hhhe.......', '.hhhe.......', '..hhe.......', '..hee.......', '............', '............'],
  },
  rifle: {
    colors: TOOL_COLORS,
    rows: ['............', '............', '............', '............', '....dddddddd', 'hhhhSssssssd', 'ehhhhhdddddd', 'ehhh.e......', 'ee..........', '............', '............', '............'],
  },
};
```

In `src/ui/hudParts.ts`:
- Import `GUN_ICONS` and `GUNS, type Gun, isGun`.
- In `heldIcon`: `return isTool(item) ? TOOL_ICONS[item] : isGun(item) ? GUN_ICONS[item] : (ICONS[item as Good] ?? SACK);`
- Add the guns' labels to `BY_LABEL`: `...(Object.keys(GUNS) as Gun[]).map((gun) => [GUNS[gun].label.toLowerCase(), gun] as const),`

In `src/ui/hudParts.test.ts`, extend `HOTBAR` to `['axe', 'pickaxe', 'hoe', 'pistol', 'rifle', 'caneCuttings', 'tobaccoSeed', 'pepperSeed', 'maize', 'sapling']`, and include `GUN_ICONS` in the "every icon square" loop: `[...Object.entries(TOOL_ICONS), ...Object.entries(GUN_ICONS), ...Object.entries(ICONS)]`.

- [ ] **Step 7: The shade over a loading gun's slot, and the legend**

In `src/ui/FootHud.ts`:
- `Slot` gains `/** A gun's loading still to go, 0 to 1 (a shade over its slot). */ reload?: number;`
- The legend rows become `['1–0', 'tools, guns and seeds']` (keys) and `['LB RB', 'tools, guns and seeds']` (pad).
- In `slotElement`, when `s.reload !== undefined`, append `const shade = document.createElement('i'); shade.className = 'foot-reload'; el.append(shade);`.
- In `update(r)`, after the slots are (re)built, set the shades each frame without rebuilding (the signature string leaves `reload` out):

```ts
    r.slots.forEach((s, i) => {
      if (s.reload === undefined) return;
      const shade = this.slots.children[i]?.querySelector<HTMLElement>('.foot-reload');
      if (shade) shade.style.transform = `scaleY(${s.reload.toFixed(3)})`;
    });
```

In `src/style.css`, beside the other `.foot-slot` rules:

```css
/* A gun loading: a shade over its slot that drains away as it loads. */
.foot-slot .foot-reload {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: rgb(20 14 8 / 0.5);
  transform-origin: bottom;
  pointer-events: none;
}
```

(`.foot-slot` already has `position: relative` for its key and count. If not, add it.)

- [ ] **Step 8: `Shore`: guns in the hotbar, firing, the target marked**

In `src/Shore.ts`:
- Import `GUN_LIST, GUNS, isGun, type Point3` from `'./land/firearms'`.
- `items()`:

```ts
  /** The hotbar: the tools, the guns the captain owns, each kind of seed, and saplings. */
  items(): Held[] {
    const guns = GUN_LIST.filter((g) => this.land.sea.captain.guns.includes(g));
    return [...TOOL_LIST, ...guns, ...PLANTABLE, 'sapling'];
  }
```

- In `use(atCursor)`, before `const target = ...`:

```ts
    const held = this.held;
    if (isGun(held)) {
      this.digging = null;
      this.swing = null;
      this.aiming = AIM_SECONDS;
      this.report(this.land.fire(held, this.aimAt(atCursor)));
      return;
    }
```

- A field `private aiming = 0;` and a constant `const AIM_SECONDS = 0.6;`. In `update(dt)`, add `this.aiming = Math.max(0, this.aiming - dt);` at the top. Task 6 draws the pose with it.
- The point under the mouse, at any distance:

```ts
  /** Where the mouse is aiming a gun: the top of the block under it, at any distance, if the mouse is in use. */
  private aimAt(clicked = false): Point3 | null {
    const h = this.hover;
    if (!h || !(clicked || this.mouseActive())) return null;
    return { x: h.x + 0.5, y: h.y + 1, z: h.z + 0.5 };
  }
```

- In `render`, in the not-placing branch, mark a gun's target instead of a cell:

```ts
      const held = this.held;
      if (isGun(held)) {
        const t = this.land.gunTarget(held, this.aimAt());
        this.view.mark(t ? { x: Math.floor(t.x), y: Math.floor(t.y), z: Math.floor(t.z), ok: true } : null);
      } else {
        const target = this.cursor() ?? this.land.front();
        const aim = this.digging ? this.land.digAim() : target && !this.land.inTown(target.x, target.z) ? this.land.aim(held, target) : null;
        this.view.mark(aim && aim.x !== undefined ? { x: aim.x, y: aim.y!, z: aim.z!, ok: aim.ok } : null);
      }
```

- The slots:

```ts
      slots: this.items().map((held, i) => ({
        key: i === 9 ? '0' : `${i + 1}`,
        item: held,
        label: isTool(held) ? TOOL_LABELS[held] : isGun(held) ? GUNS[held].label : GOOD_INFO[held].label,
        count: isTool(held) ? undefined : this.land.available(isGun(held) ? 'cartridges' : held),
        reload: isGun(held) ? this.land.reloadLeft(held) : undefined,
        active: i === this.item,
      })),
```

`isTool` in `Shore.ts` narrows to `Tool`, and `isGun` to `Gun`, so `GOOD_INFO[held]` sees a `Good`.

- [ ] **Step 9: Typecheck and run the whole suite**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: all pass. Anywhere else `Held` is switched over (for example `hudParts.heldByLabel` callers, or `LandView`), a gun is now a possible value. `heldCells` draws it as a seed sack until Task 6.

---

### Task 6: How a shot looks: the guns in hand, the aim, the smoke and the streak

**Files:**
- Modify: `src/render/toolModels.ts` (pistol, rifle, `musketLevelled`)
- Modify: `src/render/CharacterView.ts` (`Stride.aiming`)
- Modify: `src/render/LandView.ts` (`aiming` passed through)
- Modify: `src/Shore.ts` (passes `aiming`)
- Create: `src/render/Tracers.ts`
- Modify: `src/Game.ts` (tracers in the scene; `shot` events as smoke, streak and dust)

**Interfaces:**
- Consumes: the `shot` event (Task 5).
- Produces: `HeldModel` gains `'musketLevelled'`; `Stride.aiming?: boolean`; `LandView.update(w, alpha, held, swing, dt, time, aiming = false)`; `class Tracers { group; add(from: Point3, to: Point3): void; update(dt: number): void }`.

This task is drawing only; it's checked in the browser (Step 6).

- [ ] **Step 1: The guns and the levelled musket, in hand**

In `src/render/toolModels.ts`:
- `export type HeldModel = Held | 'spade' | 'rod' | 'hammer' | 'musketLevelled';`
- Before the final seed-sack `else`, add:

```ts
  } else if (held === 'pistol') {
    // A pistol: the grip down from the hand, a short barrel out along −x.
    for (let y = 0; y >= -3; y--) put(1, y, 0, 1);
    put(2, -3, 0, 1);
    for (let x = 1; x >= -3; x--) put(x, 1, 0, 1);
    for (let x = 0; x >= -7; x--) put(x, 2, 0, x === -7 ? 3 : 2);
    put(0, 3, 0, 3); // the lock
  } else if (held === 'rifle' || held === 'musketLevelled') {
    // A long gun at the shoulder: the stock back from the hand, the barrel out along −x.
    for (let x = 6; x >= -4; x--) put(x, 0, 0, 1);
    for (let y = -1; y >= -2; y--) put(6, y, 0, 1); // the butt
    const muzzle = held === 'rifle' ? -18 : -16;
    for (let x = -2; x >= muzzle; x--) put(x, 1, 0, x <= muzzle + 1 ? 3 : 2);
    put(0, 2, 0, 3); // the lock
    if (held === 'musketLevelled') for (let x = muzzle - 1; x >= muzzle - 4; x--) put(x, 1, 0, 3); // the bayonet
```

- [ ] **Step 2: The aim**

In `src/render/CharacterView.ts`, add to `Stride`: `/** A gun levelled at something. */ aiming?: boolean;`. In `walk`, after the `fishing` block:

```ts
    if (stride.aiming) {
      // The gun levelled at the shoulder, straight out ahead.
      t.armR.set(-0.05, 0.02, 1).normalize();
      t.blade.set(0, 0.03, 1).normalize();
      t.lean = 0.05;
    }
```

In `src/render/LandView.ts`, `update(w, alpha, held, swing, dt, time, aiming = false)` passes `aiming` into `this.captain.walk({ speed, swing, aiming }, dt, time)`. In `Shore.render`, call `this.view.update(w, alpha, this.digging ? 'spade' : this.held, this.swing, frameSeconds, time, this.aiming > 0);`.

- [ ] **Step 3: The streak**

```ts
// src/render/Tracers.ts
import { BufferAttribute, BufferGeometry, Group, Line, LineBasicMaterial } from 'three';
import type { Point3 } from '../land/firearms';

/** A streak shows this long. */
const LIFE = 0.16;
const OPACITY = 0.8;

/** The faint streak of a shot, from the muzzle to where it ended, gone in a blink. Presentation only. */
export class Tracers {
  readonly group = new Group();
  private readonly live: Array<{ line: Line; age: number }> = [];

  constructor() {
    this.group.name = 'tracers';
  }

  add(from: Point3, to: Point3): void {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([from.x, from.y, from.z, to.x, to.y, to.z]), 3));
    const line = new Line(geometry, new LineBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: OPACITY, depthWrite: false }));
    this.group.add(line);
    this.live.push({ line, age: 0 });
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const t = this.live[i];
      t.age += dt;
      const material = t.line.material as LineBasicMaterial;
      material.opacity = OPACITY * Math.max(0, 1 - t.age / LIFE);
      if (t.age < LIFE) continue;
      this.group.remove(t.line);
      t.line.geometry.dispose();
      material.dispose();
      this.live.splice(i, 1);
    }
  }
}
```

- [ ] **Step 4: Shots in the game: smoke at the muzzle, the streak, and dust or a wound where it ends**

In `src/Game.ts`:
- Import `Tracers`.
- Add a field `private readonly tracers = new Tracers();` and put `this.scene.add(this.tracers.group);` where the other render groups are added.
- In `render`, call `this.tracers.update(frameSeconds);` next to the effects' update.
- In `handleLand`, add:

```ts
      if (e.kind === 'shot' && near(e.from.x, e.from.z)) {
        const dx = e.to.x - e.from.x;
        const dz = e.to.z - e.from.z;
        const d = Math.hypot(dx, dz) || 1;
        this.effects.emit('smoke', e.from.x + (dx / d) * 0.8, e.from.y, e.from.z + (dz / d) * 0.8, dx / d, dz / d, 0.35);
        this.tracers.add(e.from, e.to);
        this.effects.emit(e.hit ? 'wound' : 'dust', e.to.x, e.to.y, e.to.z, 0, 0, e.hit ? 0.6 : 0.35);
      }
```

- [ ] **Step 5: Typecheck and run the whole suite**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: all pass.

- [ ] **Step 6: Look in the browser**

With the dev server running (`http://localhost:5173`), in Playwright:
1. Continue a save, go ashore anywhere, and in the console: `game.sea.captain.guns.push('pistol','rifle'); game.sea.player.cargo.cartridges = 40;`. Go back aboard and ashore again, so the pouch fills.
2. Select slot 4 (pistol): the captain holds a pistol; the slot shows the cartridge count.
3. Press Space: the captain levels the gun, smoke puffs at the muzzle, a streak flashes, dust kicks up where it lands, and the slot's shade drains over 2.5 s.
4. At night, near a boar: the marker sits on it; fire; it bolts or falls and drops meat.

Take screenshots into `.playwright-mcp/`. Check the console has no errors.

---

### Task 7: The captain's health, and being brought down

**Files:**
- Modify: `src/land/drops.ts` (each drop's own lifetime)
- Modify: `src/land/Land.ts` (health, `hurt`, `underFire`, healing, `bringDown`, `drop` with a lifetime, snapshot of `life`)
- Modify: `src/Shore.ts`, `src/ui/FootHud.ts`, `src/style.css` (the health bar)
- Test: `src/land/Land.test.ts`

**Interfaces:**
- Produces:
  - `HEALTH_MAX = 10` (exported), `Land.health: number`.
  - `Land.hurt(amount: number): void`, `Land.underFire(): void`.
  - `LandEvent` `{ kind: 'hurt'; x: number; y: number; z: number }` and `{ kind: 'downed'; toll: number; pack: boolean }`.
  - `Drop.life: number`, `dropItem(land, good, amount, x, y, z, random, life = DROP_SECONDS)`, `Land.drop(good, x, y, z, amount = 1, life = DROP_SECONDS)`.
  - `FootReadout.health: { now: number; most: number } | null`.

- [ ] **Step 1: Write the failing tests**

Add to `src/land/Land.test.ts`, and import `HEALTH_MAX`:

```ts
describe('the captain’s health', () => {
  it('bandits’ shots wear it down, and it mends once they’ve stopped firing a while', () => {
    const { land } = setup();
    land.goAshore();
    land.underFire();
    land.hurt(2);
    land.hurt(2);
    expect(land.health).toBe(HEALTH_MAX - 4);
    for (let t = 0; t < 14; t += 1 / 20) land.step(1 / 20);
    expect(land.health).toBe(HEALTH_MAX - 4);
    for (let t = 0; t < 7; t += 1 / 20) land.step(1 / 20);
    expect(land.health).toBe(HEALTH_MAX - 3);
    for (let t = 0; t < 30; t += 1 / 20) land.step(1 / 20);
    expect(land.health).toBe(HEALTH_MAX);
  });

  it('is whole again aboard', () => {
    const { land } = setup();
    land.goAshore();
    land.hurt(6);
    land.goAboard();
    expect(land.health).toBe(HEALTH_MAX);
  });

  it('brought down: the bandits take a tenth of the gold, the pack lies where they fell, and they come to aboard', () => {
    const { land, sea } = setup();
    land.goAshore();
    walkTo(land, 0.5, 0.5);
    sea.captain.gold = 450;
    Object.assign(land.pack, { stone: 5, fish: 3 });
    const ship = { x: sea.player.ship.x, z: sea.player.ship.z };
    land.takeEvents();
    land.hurt(HEALTH_MAX);
    expect(land.walker).toBeNull();
    expect(sea.ashore).toBe(false);
    expect(sea.player.ship).toMatchObject(ship);
    expect(sea.captain.gold).toBe(405);
    expect(land.pack).toEqual({});
    expect(land.health).toBe(HEALTH_MAX);
    const lying = (good: string) => land.drops.filter((d) => d.good === good).reduce((n, d) => n + d.amount, 0);
    expect(lying('stone')).toBe(5);
    expect(lying('fish')).toBe(3);
    for (const d of land.drops) expect(Math.hypot(d.x - 0.5, d.z - 0.5)).toBeLessThan(4);
    expect(land.takeEvents().find((e) => e.kind === 'downed')).toEqual({ kind: 'downed', toll: 45, pack: true });
  });

  it('brought down with a full hold, the pack still lies where they fell', () => {
    const { land, sea } = setup();
    land.goAshore();
    sea.player.cargo = { timber: sea.player.cls.type.hold };
    land.pack.stone = 5;
    land.hurt(HEALTH_MAX);
    expect(sea.player.cargo).toEqual({ timber: sea.player.cls.type.hold });
    expect(land.drops.filter((d) => d.good === 'stone').reduce((n, d) => n + d.amount, 0)).toBe(5);
  });

  it('the pile lies a full day, where anything else is gone in ten minutes, and a save keeps that', () => {
    const { land, sea } = setup();
    land.goAshore();
    land.pack.stone = 5;
    land.hurt(HEALTH_MAX);
    land.drop('timber', 0.5, SEA_LEVEL + 2, 0.5);
    for (let t = 0; t < DROP_SECONDS + 5; t += 1) land.step(1);
    expect(land.drops.some((d) => d.good === 'timber')).toBe(false);
    expect(land.drops.some((d) => d.good === 'stone')).toBe(true);
    const saved = JSON.parse(JSON.stringify(land.snapshot()));
    land.restore(saved);
    expect(land.drops.find((d) => d.good === 'stone')!.life).toBe(sea.clock.length);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/land/Land.test.ts -t health`
Expected: FAIL. `land.hurt` doesn't exist.

- [ ] **Step 3: Each drop's own lifetime**

In `src/land/drops.ts`:
- `Drop` gains `/** Seconds it lies before it's gone (usually DROP_SECONDS). */ life: number;`.
- `dropItem(land, good, amount, x, y, z, random, life = DROP_SECONDS)` sets `life` in the pushed object.
- `stepDrops` uses `if (d.age > d.life)`.
- Where `settle()` merges a drop into a pile, also `pile.life = Math.max(pile.life, d.life);`.

In `src/land/Land.ts`:
- `drop(good, x, y, z, amount = 1, life = DROP_SECONDS)` passes `life` to `dropItem` (import `DROP_SECONDS` from `./drops`).
- `LandSnapshot.drops` items gain `life?: number`.
- `snapshot()` maps `({ good, amount, x, y, z, age, life })`.
- `restore()` builds each with `life: d.life ?? DROP_SECONDS`.

- [ ] **Step 4: Health, hurting, healing, and being brought down**

In `src/land/Land.ts`:

```ts
/** The captain's health on foot. Only bandits' shots hurt; beasts don't bite. */
export const HEALTH_MAX = 10;
/** Wounds start to mend once no bandit has fired for this long, a point every HEAL_EVERY seconds. */
const HEAL_AFTER = 15;
const HEAL_EVERY = 6;
/** Brought down, the captain loses this share of their gold, as a guardian takes. */
const DOWNED_TOLL = 0.1;
```

Add `LandEvent` members `| { kind: 'hurt'; x: number; y: number; z: number }` and `| { kind: 'downed'; toll: number; pack: boolean }`.

Fields:

```ts
  /** The captain's health on foot (full again aboard; not saved). */
  health = HEALTH_MAX;
  /** Seconds since a bandit last fired. */
  private quiet = 0;
  private healIn = HEAL_EVERY;
```

In `step(dt)`, after the guns' loading:

```ts
    if (this.walker && this.health < HEALTH_MAX) {
      this.quiet += dt;
      if (this.quiet >= HEAL_AFTER && (this.healIn -= dt) <= 0) {
        this.health += 1;
        this.healIn = HEAL_EVERY;
      }
    } else this.healIn = HEAL_EVERY;
```

Methods, in a `// ---- The captain's health ----` section:

```ts
  /** A bandit fired: wounds don't mend while they're under fire. */
  underFire(): void {
    this.quiet = 0;
  }

  /** The captain is hit. At no health left, they're brought down. */
  hurt(amount: number): void {
    const w = this.walker;
    if (!w) return;
    this.health = Math.max(0, this.health - amount);
    this.events.push({ kind: 'hurt', x: w.x, y: w.y + 1.2, z: w.z });
    if (this.health <= 0) this.bringDown();
  }

  /**
   * Brought down by bandits: they take a share of the gold, the pack's goods lie where the
   * captain fell (a full day, not the usual ten minutes), and the crew carry them back
   * aboard. The ship is where she lay at anchor.
   */
  private bringDown(): void {
    const w = this.walker!;
    const captain = this.sea.captain;
    const toll = Math.round(captain.gold * DOWNED_TOLL);
    captain.gold -= toll;
    const goods = Object.entries(this.pack) as Array<[Good, number]>;
    for (const [good, n] of goods) this.drop(good, w.x, w.y + 0.5, w.z, n, this.sea.clock.length);
    for (const [good] of goods) delete this.pack[good];
    this.goAboard();
    this.events.push({ kind: 'downed', toll, pack: goods.length > 0 });
  }
```

In `goAboard()`, before `this.walker = null;`: `this.health = HEALTH_MAX; this.quiet = 0;`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/land/Land.test.ts src/land/drops.test.ts`
Expected: PASS (if there's no `drops.test.ts`, run just `Land.test.ts`).

- [ ] **Step 6: The health bar**

In `src/ui/FootHud.ts`:
- `FootReadout` gains `/** The captain's health, shown when hurt or in a fight. */ health: { now: number; most: number } | null;`.
- A `private readonly health = document.createElement('div');` with `className = 'foot-health'`, appended first in `this.root.append(...)`.
- In `update`:

```ts
    const pips = r.health ? `${r.health.now}/${r.health.most}` : '';
    if (pips !== this.shownHealth) {
      this.shownHealth = pips;
      this.health.hidden = !r.health;
      if (r.health) {
        this.health.title = `Health ${r.health.now} of ${r.health.most}`;
        this.health.replaceChildren(
          ...Array.from({ length: r.health.most }, (_, i) => {
            const pip = document.createElement('span');
            pip.className = i < r.health!.now ? 'pip on' : 'pip';
            return pip;
          }),
        );
      }
    }
```

(with a field `private shownHealth = '';`).

In `src/style.css`:

```css
/* The captain's health on foot: a row of pips, shown when hurt or in a fight. */
.foot-health {
  display: flex;
  gap: 3px;
  justify-content: center;
}
.foot-health .pip {
  width: 14px;
  height: 10px;
  border: 1px solid rgb(0 0 0 / 0.4);
  border-radius: 2px;
  background: rgb(60 20 16 / 0.55);
}
.foot-health .pip.on {
  background: #d9483a;
}
```

In `Shore.render`, pass `health: this.land.health < HEALTH_MAX ? { now: this.land.health, most: HEALTH_MAX } : null,` (import `HEALTH_MAX`). Task 11 adds "or in a fight".

- [ ] **Step 7: Typecheck and run the whole suite**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: all pass. `Game.handleLand` doesn't handle `downed` yet; Task 8 does. Until then, being brought down puts the captain aboard without the card.

---

### Task 8: The "come to" card

**Files:**
- Create: `src/ui/comeTo.ts`, `src/ui/comeTo.test.ts`
- Create: `src/ui/Fade.ts`
- Modify: `src/style.css` (the card's title and line)
- Modify: `src/combat/sea.ts` (the `respawn` event names the ship that went down)
- Modify: `src/Game.ts` (the fade replaces `sleepFade`; the card for sinking, jail, a guardian and bandits)

**Interfaces:**
- Consumes: the `downed` event (Task 7).
- Produces:
  - `type ComeTo = { kind: 'sunk'; ship: string; goods: number; port: string } | { kind: 'jailed'; fine: number; goods: number; port: string } | { kind: 'bandits'; toll: number; pack: boolean } | { kind: 'guardian'; toll: number }`.
  - `interface Card { title?: string; line: string }`.
  - `comeToCard(c: ComeTo): Required<Card>`.
  - `class Fade { active; fadingIn; run(card: Card, work: () => void, hold?: number, done?: () => void): void }`.
  - `SeaEvent` `respawn` gains `ship: string`.

- [ ] **Step 1: Write the failing test**

```ts
// src/ui/comeTo.test.ts
import { describe, expect, it } from 'vitest';
import { comeToCard } from './comeTo';

describe('the come-to card', () => {
  it('lost at sea', () => {
    expect(comeToCard({ kind: 'sunk', ship: 'sloop', goods: 12, port: 'Haven' })).toEqual({
      title: 'Lost at sea',
      line: 'Your sloop went down, and 12 goods with her. You wash ashore at Haven, where the harbourmaster finds you another.',
    });
    expect(comeToCard({ kind: 'sunk', ship: 'brig', goods: 0, port: 'Port Royal' }).line).toBe('Your brig went down. You wash ashore at Port Royal, where the harbourmaster finds you another.');
  });

  it('in irons', () => {
    expect(comeToCard({ kind: 'jailed', fine: 300, goods: 12, port: 'Haven' })).toEqual({
      title: 'In irons',
      line: 'Your freedom costs 300 gold, and your 12 goods are seized. You’re released at Haven with a fresh sloop.',
    });
    expect(comeToCard({ kind: 'jailed', fine: 0, goods: 0, port: 'Haven' }).line).toBe('Your freedom costs 0 gold. You’re released at Haven with a fresh sloop.');
  });

  it('left for dead', () => {
    expect(comeToCard({ kind: 'bandits', toll: 45, pack: true })).toEqual({
      title: 'Left for dead',
      line: 'Your crew carries you back aboard. The bandits took 45 gold, and your pack lies where you fell.',
    });
    expect(comeToCard({ kind: 'bandits', toll: 45, pack: false }).line).toBe('Your crew carries you back aboard. The bandits took 45 gold.');
  });

  it('the dead keep their gold', () => {
    expect(comeToCard({ kind: 'guardian', toll: 80 })).toEqual({
      title: 'The dead keep their gold',
      line: 'You come to at dawn beside the hole, 80 gold lighter. The hoard, and its guardian, are still there.',
    });
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run src/ui/comeTo.test.ts`
Expected: FAIL: "Failed to resolve import './comeTo'".

- [ ] **Step 3: The words**

```ts
// src/ui/comeTo.ts

/** Each way of going down, and what the card needs to tell of it. */
export type ComeTo =
  | { kind: 'sunk'; ship: string; goods: number; port: string }
  | { kind: 'jailed'; fine: number; goods: number; port: string }
  | { kind: 'bandits'; toll: number; pack: boolean }
  | { kind: 'guardian'; toll: number };

/** What the fade shows: a title (the card has one; sleep doesn't), and a line. */
export interface Card {
  title?: string;
  line: string;
}

/** The card for going down: a title, and a line of what happened and where you came to. */
export function comeToCard(c: ComeTo): Required<Card> {
  switch (c.kind) {
    case 'sunk':
      return { title: 'Lost at sea', line: `Your ${c.ship} went down${c.goods > 0 ? `, and ${c.goods} goods with her` : ''}. You wash ashore at ${c.port}, where the harbourmaster finds you another.` };
    case 'jailed':
      return { title: 'In irons', line: `Your freedom costs ${c.fine} gold${c.goods > 0 ? `, and your ${c.goods} goods are seized` : ''}. You’re released at ${c.port} with a fresh sloop.` };
    case 'bandits':
      return { title: 'Left for dead', line: `Your crew carries you back aboard. The bandits took ${c.toll} gold${c.pack ? ', and your pack lies where you fell' : ''}.` };
    case 'guardian':
      return { title: 'The dead keep their gold', line: `You come to at dawn beside the hole, ${c.toll} gold lighter. The hoard, and its guardian, are still there.` };
  }
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run src/ui/comeTo.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: The fade, grown out of the sleep fade**

```ts
// src/ui/Fade.ts
import type { Card } from './comeTo';

/** The fade to black and back, in ms (the `.sleep-fade` transition in style.css). */
const FADE_MS = 600;

/**
 * The screen fading to black and back: for sleep (a line while time passes) and for going
 * down (a card, held a few seconds; a key or a click skips it). What `work` does happens
 * in the dark, so the world can change unseen.
 */
export class Fade {
  private readonly el = document.createElement('div');
  private readonly title = document.createElement('h2');
  private readonly line = document.createElement('p');
  private phase: 'idle' | 'in' | 'dark' | 'out' = 'idle';

  constructor(parent: HTMLElement) {
    this.el.className = 'sleep-fade';
    this.el.append(this.title, this.line);
    parent.append(this.el);
  }

  /** Anywhere from starting to fade to having faded back in. */
  get active(): boolean {
    return this.phase !== 'idle';
  }

  /** Still going dark: nothing has changed yet. */
  get fadingIn(): boolean {
    return this.phase === 'in';
  }

  /**
   * Fades to black showing `card`, runs `work` in the dark, holds `hold` seconds (a key or a
   * click cuts it short), fades back in, and then calls `done`.
   */
  run(card: Card, work: () => void, hold = 0, done: () => void = () => {}): void {
    if (this.active) return;
    this.title.textContent = card.title ?? '';
    this.title.hidden = !card.title;
    this.line.textContent = card.line;
    this.el.classList.add('shown');
    this.phase = 'in';
    window.setTimeout(() => {
      this.phase = 'dark';
      work();
      let timer = 0;
      const out = () => {
        window.clearTimeout(timer);
        window.removeEventListener('keydown', out);
        window.removeEventListener('pointerdown', out);
        this.phase = 'out';
        this.el.classList.remove('shown');
        window.setTimeout(() => {
          this.phase = 'idle';
          done();
        }, FADE_MS);
      };
      if (hold <= 0) return out();
      timer = window.setTimeout(out, hold * 1000);
      window.addEventListener('keydown', out);
      window.addEventListener('pointerdown', out);
    }, FADE_MS + 100);
  }
}
```

In `src/style.css`, beside `.sleep-fade`, turn it into a column that can hold a title and a line:

```css
.sleep-fade {
  /* (keep the existing rules; change display:grid/place-items to this) */
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  text-align: center;
}
.sleep-fade h2 {
  margin: 0;
  font: 700 38px Georgia, serif;
  letter-spacing: 0.02em;
  color: #f1e3c0;
}
.sleep-fade p {
  max-width: min(640px, 86vw);
  margin: 0;
  font: 500 19px/1.5 var(--ui-font);
  color: #dfe6ff;
}
```

- [ ] **Step 6: The ship's name for the card**

In `src/combat/sea.ts`, `respawn` event becomes `{ kind: 'respawn'; goods: number; port: string; ship: string }`. In `respawn()`, record the lost ship's kind before `newShip()` replaces her:

```ts
  private respawn(): void {
    const goods = cargoCount(this.player.cargo);
    const ship = this.player.cls.design.name;
    this.newShip();
    this.emit({ kind: 'respawn', goods, port: this.captain.lastPort.name, ship });
  }
```

- [ ] **Step 7: The game uses the fade**

In `src/Game.ts`:
- Import `Fade`, and `comeToCard, type ComeTo, type Card`.
- Replace the `sleepFade` and `sleeping` fields with `private readonly fade: Fade;`, created in the constructor where `sleepFade` was: `this.fade = new Fade(container);`.
- Add a constant: `/** A card for going down holds this long (a key or a click skips it). */ const CARD_SECONDS = 3;`
- Replace every `this.sleeping` with `this.fade.active`: in `update()`, in `render()`'s `paused`, and in the music's `where`.
- In `render`, hold the camera still while the screen is going dark, so a respawn far away doesn't swoop past: `if (!this.fade.fadingIn) rig.update(this.cameraTarget, frameSeconds);`.
- `sleep`:

```ts
  /**
   * Sleeps until morning (or until dusk, waiting for the dark): the screen goes black,
   * time passes in big steps while the sea waits, and the game saves on waking. With a
   * `card` (a guardian's won), that card shows while the night passes.
   */
  private sleep(until: 'morning' | 'dusk', card: Card | null = null): void {
    if (this.overlay.kind) this.closeMenu();
    const seconds = secondsUntil(this.sea.clock, WAKE_AT[until]);
    const line = until === 'morning' ? 'You sleep through the night…' : 'You doze until dusk…';
    this.fade.run(
      card ?? { line },
      () => {
        for (let t = 0; t < seconds; t += SLEEP_STEP) {
          const dt = Math.min(SLEEP_STEP, seconds - t);
          this.sea.pass(dt);
          this.economy.step(dt);
          this.land.step(dt, false);
        }
        this.handleLand(this.sea.time);
        this.notify(this.economy.takeNotices());
      },
      card ? CARD_SECONDS : 0,
      () => {
        this.autosave();
        this.controls.setMode(this.land.walker ? 'foot' : 'sea');
        if (card) return;
        const clock = this.sea.clock;
        this.hud.toast(until === 'morning' ? `Morning, day ${clock.day}. The game is saved.` : `Dusk falls (${clockText(clock.phase)}). The game is saved.`, 'good');
      },
    );
  }

  /** Going down: black, a card of what happened, and the view comes up wherever the captain came to. */
  private comeTo(c: ComeTo): void {
    if (this.overlay.kind) this.closeMenu();
    this.fade.run(
      comeToCard(c),
      () => {
        const w = this.land.walker;
        this.rig.snapTo(this.cameraTarget.set(w?.x ?? this.ship.x, w ? w.y + 1.2 : WATER_LEVEL, w?.z ?? this.ship.z));
      },
      CARD_SECONDS,
      () => this.controls.setMode(this.land.walker ? 'foot' : 'sea'),
    );
  }
```

- In `handleEvents`, replace the `jailed` and `respawn` toasts and their camera snaps:

```ts
        case 'jailed':
          this.comeTo({ kind: 'jailed', fine: e.fine, goods: e.goods, port: e.port });
          break;
```

```ts
        case 'respawn':
          this.comeTo({ kind: 'sunk', ship: e.ship, goods: e.goods, port: e.port });
          break;
```

- In `endDuel`'s guardian branch, when lost:

```ts
        const toll = this.treasure.guardianWon();
        this.sleep('morning', comeToCard({ kind: 'guardian', toll }));
```

- In `handleLand`, add:

```ts
      if (e.kind === 'downed') {
        this.toSea('');
        this.comeTo({ kind: 'bandits', toll: e.toll, pack: e.pack });
      }
      if (e.kind === 'hurt') this.effects.emit('wound', e.x, e.y, e.z, 0, 0, 0.5);
```

- [ ] **Step 8: Typecheck and run the whole suite**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: all pass.

- [ ] **Step 9: Look in the browser**

In Playwright, on a loaded save:
1. Sink: `game.sea.player.hull = 0` at sea. After about 5 s the screen goes black, the card "Lost at sea" shows, and it fades up at the last port. A key press skips the hold.
2. On foot: `game.land.hurt(10)`. The card "Left for dead" shows, and the captain is aboard off the island.
3. A guardian loss can't easily be staged; check that `endDuel` compiles and reads right.

Take screenshots of both cards. Check the console has no errors.

---

### Task 9: Bandit camps in the world

**Files:**
- Create: `src/worldgen/bandits.ts`, `src/worldgen/bandits.test.ts`
- Modify: `src/Game.ts` (place the camps; hand them over in Task 10)

**Interfaces:**
- Produces:
  - `interface BanditCamp { id: number; x: number; y: number; z: number; islandX: number; islandZ: number; islandRadius: number; tier: 0 | 1 | 2; size: number; chest: { x: number; y: number; z: number } }`, where `id` is the islet's index and `y` is the ground height at the fire (the Embers' cell).
  - `placeBanditCamps(world: VoxelWorld, islands: readonly IslandPlan[], seed: number, tierOf: (x: number, z: number) => 0 | 1 | 2, avoid: (x: number, z: number) => boolean): BanditCamp[]`.

- [ ] **Step 1: Write the failing test**

```ts
// src/worldgen/bandits.test.ts
import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../config';
import { Block } from '../voxel/blocks';
import { VoxelWorld } from '../voxel/VoxelWorld';
import type { IslandPlan } from './archipelago';
import { placeBanditCamps } from './bandits';

const TOP = SEA_LEVEL + 4;
/** A flat grassy disc of an island with a sandy rim. */
function disc(world: VoxelWorld, cx: number, cz: number, radius: number): void {
  for (let x = cx - radius; x <= cx + radius; x++) {
    for (let z = cz - radius; z <= cz + radius; z++) {
      const d = Math.hypot(x - cx, z - cz);
      if (d > radius) continue;
      const top = d > radius - 3 ? SEA_LEVEL + 1 : TOP;
      for (let y = 0; y <= top; y++) world.setVoxel(x, y, z, y === top ? (d > radius - 3 ? Block.Sand : Block.Grass) : Block.Dirt);
    }
  }
}

const plan = (i: number, x: number, extra: Partial<IslandPlan> = {}): IslandPlan => ({ seed: 100 + i, centerX: x, centerZ: 0, radius: 20, peak: 4, port: null, ...extra });

/** A port island, a cursed isle, and six wild islets in a row. */
function archipelago() {
  const world = new VoxelWorld();
  const islands = [
    plan(0, 0, { port: { name: 'Haven', faction: 'merchant' } }),
    plan(1, 100, { cursed: true }),
    ...[2, 3, 4, 5, 6, 7].map((i) => plan(i, i * 100)),
  ];
  for (const island of islands) disc(world, island.centerX, 0, island.radius);
  return { world, islands };
}
const tierOf = (x: number): 0 | 1 | 2 => (x < 400 ? 0 : x < 600 ? 1 : 2);

describe('bandit camps', () => {
  it('hold about a third of the wild islets, never a port’s island or a cursed isle', () => {
    const { world, islands } = archipelago();
    const camps = placeBanditCamps(world, islands, 1717, tierOf, () => false);
    expect(camps).toHaveLength(2);
    for (const c of camps) {
      expect(islands[c.id].port).toBeNull();
      expect(islands[c.id].cursed).toBeFalsy();
      expect(Math.hypot(c.x - c.islandX, c.z - c.islandZ)).toBeLessThan(c.islandRadius);
    }
  });

  it('are built from blocks: a fire, a lean-to, a chest', () => {
    const { world, islands } = archipelago();
    for (const c of placeBanditCamps(world, islands, 1717, tierOf, () => false)) {
      expect(world.getVoxel(c.x, c.y, c.z)).toBe(Block.Embers);
      expect(world.getVoxel(c.chest.x, c.chest.y, c.chest.z)).toBe(Block.Chest);
      let planks = 0;
      for (let x = c.x - 4; x <= c.x + 4; x++) for (let z = c.z - 4; z <= c.z + 4; z++) for (let y = c.y - 1; y <= c.y + 4; y++) if (world.getVoxel(x, y, z) === Block.Planks) planks++;
      expect(planks).toBeGreaterThanOrEqual(6);
    }
  });

  it('are more, and hold more bandits, further from Haven', () => {
    const { world, islands } = archipelago();
    for (const c of placeBanditCamps(world, islands, 1717, tierOf, () => false)) {
      expect(c.tier).toBe(tierOf(c.islandX));
      expect(c.size).toBe(2 + c.tier);
    }
  });

  it('come out the same from the same seed', () => {
    const a = placeBanditCamps(archipelago().world, archipelago().islands, 1717, tierOf, () => false);
    const b = placeBanditCamps(archipelago().world, archipelago().islands, 1717, tierOf, () => false);
    expect(a).toEqual(b);
  });

  it('keep clear of what they’re told to avoid', () => {
    const { world, islands } = archipelago();
    expect(placeBanditCamps(world, islands, 1717, tierOf, () => true)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run src/worldgen/bandits.test.ts`
Expected: FAIL: "Failed to resolve import './bandits'".

- [ ] **Step 3: Placing and building the camps**

```ts
// src/worldgen/bandits.ts
import { SEA_LEVEL } from '../config';
import { hash2 } from '../util/hash';
import { Block } from '../voxel/blocks';
import type { VoxelWorld } from '../voxel/VoxelWorld';
import type { IslandPlan } from './archipelago';
import { groundHeight, TREE_BLOCKS } from './buildings';
import { mulberry32 } from './noise';

/** A bandit camp as the world was made with it (its state as the game goes on is `land/bandits.ts`). */
export interface BanditCamp {
  /** The islet's index in the archipelago plan. */
  id: number;
  /** The middle of its fire, and the height of the ground there (the embers' cell). */
  x: number;
  y: number;
  z: number;
  /** The islet it holds. */
  islandX: number;
  islandZ: number;
  islandRadius: number;
  /** How far out it is: 0 home waters, 1 contested, 2 Imperial. More bandits, and better loot, further out. */
  tier: 0 | 1 | 2;
  /** How many bandits hold it. */
  size: number;
  chest: { x: number; y: number; z: number };
}

/** About a third of the wild islets are held. */
const SHARE = 1 / 3;
/** A camp's clearing reaches this far each way from its fire. */
const HALF = 4;
const TRIES = 80;

/**
 * Places bandit camps on about a third of the wild islets (never a port's island, never a
 * cursed isle), and builds them: a fire ringed with stones, a plank lean-to on two posts
 * with a bedroll under it, a chest and a keg. Each on level dry ground clear of trees and
 * of whatever `avoid` says (town land, outcrops). Deterministic in `seed`, and drawing
 * nothing from any other stream.
 */
export function placeBanditCamps(world: VoxelWorld, islands: readonly IslandPlan[], seed: number, tierOf: (x: number, z: number) => 0 | 1 | 2, avoid: (x: number, z: number) => boolean): BanditCamp[] {
  const wild = islands.map((plan, index) => ({ plan, index })).filter(({ plan }) => !plan.port && !plan.cursed);
  const held = [...wild].sort((a, b) => hash2(a.plan.seed, 23, seed) - hash2(b.plan.seed, 23, seed)).slice(0, Math.round(wild.length * SHARE));
  held.sort((a, b) => a.index - b.index);
  const camps: BanditCamp[] = [];
  for (const { plan, index } of held) {
    const random = mulberry32((seed ^ 0xba4d ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);
    for (let attempt = 0; attempt < TRIES; attempt++) {
      const angle = random() * Math.PI * 2;
      const r = Math.sqrt(random()) * plan.radius * 0.55;
      const x = Math.round(plan.centerX + Math.sin(angle) * r);
      const z = Math.round(plan.centerZ + Math.cos(angle) * r);
      const y = clearing(world, x, z, avoid);
      if (y === null) continue;
      const tier = tierOf(plan.centerX, plan.centerZ);
      const chest = raiseCamp(world, x, y, z);
      camps.push({ id: index, x, y, z, islandX: plan.centerX, islandZ: plan.centerZ, islandRadius: plan.radius, tier, size: 2 + tier, chest });
      break;
    }
  }
  return camps;
}

/** The ground height at (x, z) if all round it is level, dry, clear of trees and not to be avoided; else null. */
function clearing(world: VoxelWorld, x: number, z: number, avoid: (x: number, z: number) => boolean): number | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let dx = -HALF; dx <= HALF; dx++) {
    for (let dz = -HALF; dz <= HALF; dz++) {
      const cx = x + dx;
      const cz = z + dz;
      if (avoid(cx, cz)) return null;
      const top = groundHeight(world, cx, cz);
      if (top < SEA_LEVEL + 2) return null;
      for (let y = top; y < top + 10; y++) if (TREE_BLOCKS.has(world.getVoxel(cx, y, cz))) return null;
      lo = Math.min(lo, top);
      hi = Math.max(hi, top);
    }
  }
  return hi - lo <= 1 ? groundHeight(world, x, z) : null;
}

/** Builds a camp round its fire at (x, y, z); returns where its chest stands. */
function raiseCamp(world: VoxelWorld, x: number, y: number, z: number): { x: number; y: number; z: number } {
  const at = (cx: number, cz: number) => groundHeight(world, cx, cz);
  // The fire: embers in a ring of stones.
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) world.setVoxel(x + dx, at(x + dx, z + dz), z + dz, dx === 0 && dz === 0 ? Block.Embers : (dx + dz) % 2 === 0 ? Block.Stone : Block.Air);
  }
  // The lean-to: two posts at its open front, its roof sloping down to the ground behind.
  const base = at(x - 2, z + 3);
  for (const px of [x - 3, x - 1]) for (let py = base; py < base + 2; py++) world.setVoxel(px, py, z + 2, Block.Wood);
  for (let px = x - 3; px <= x - 1; px++) {
    world.setVoxel(px, base + 2, z + 2, Block.Planks);
    world.setVoxel(px, base + 1, z + 3, Block.Planks);
    world.setVoxel(px, base, z + 4, Block.Planks);
  }
  world.setVoxel(x - 2, base, z + 3, Block.Canvas); // a bedroll
  const chest = { x: x + 2, y: at(x + 2, z + 2), z: z + 2 };
  world.setVoxel(chest.x, chest.y, chest.z, Block.Chest);
  world.setVoxel(x + 2, at(x + 2, z + 3), z + 3, Block.Barrel);
  return chest;
}
```

`groundHeight(world, x, z)` returns the first empty height above the ground (where something standing on it stands). Blocks are set at that height, on the ground.

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run src/worldgen/bandits.test.ts`
Expected: PASS (5 tests). If a camp's embers sit in the air or in the ground, check what `groundHeight` returns in `src/worldgen/buildings.ts`. The fire's `y` must be the cell above the ground's top block. If it's off by one, adjust `at` by it.

- [ ] **Step 5: The game places them**

In `src/Game.ts`, after `placeDeposits(...)` and before `reserveProps(...)`:

```ts
    // Bandit camps on about a third of the wild islets, clear of the outcrops.
    const nearOutcrop = (x: number, z: number) => deposits.some((d) => Math.abs(d.x + 1 - x) <= 3 && Math.abs(d.z + 1 - z) <= 3);
    const camps = placeBanditCamps(this.world, this.islands, WORLD_SEED, regionTier, (x, z) => inTown(x, z) || nearOutcrop(x, z));
```

Keep `camps` in a local for Task 10. Until then, add `void camps;` with a comment that Task 10 hands them to `Land`, so the build stays clean.

- [ ] **Step 6: The real archipelago**

Add to `src/worldgen/bandits.test.ts`:

```ts
import { buildArchipelago, planArchipelago } from './archipelago';

it('on the real archipelago, hold some wild islets and leave outcrops alone', () => {
  const world = new VoxelWorld();
  const islands = planArchipelago(1717);
  buildArchipelago(world, islands);
  const camps = placeBanditCamps(world, islands, 1717, (x, z) => { const d = Math.hypot(x, z); return d < 700 ? 0 : d < 1500 ? 1 : 2; }, () => false);
  expect(camps.length).toBeGreaterThanOrEqual(3);
  for (const c of camps) expect(islands[c.id].port === null && !islands[c.id].cursed).toBe(true);
}, 20_000);
```

Run: `npx vitest run src/worldgen/bandits.test.ts`
Expected: PASS. Seed 1717 has 11 wild islets, so `round(11 / 3) = 4` are held. If fewer than 3 find a clearing, widen the search (`TRIES`, or `r` up to `radius * 0.65`) rather than lowering the test's bar.

- [ ] **Step 7: Typecheck and run the whole suite**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: all pass. Outcrop tests are unaffected, since camps are placed after them and draw nothing from their stream.

---

### Task 10: Bandits' camps: manned, cleared, back again; the chest; their ground

**Files:**
- Create: `src/land/bandits.ts`
- Test: `src/land/bandits.test.ts`
- Modify: `src/land/Land.ts` (`bandits`; campfires refused on their ground; re-manning; the chest; saving)
- Modify: `src/Shore.ts` (the chest's prompt and opening)
- Modify: `src/treasure/Treasure.ts` (chests keep clear of camps)
- Modify: `src/Game.ts` (hands the camps to `Land`)

**Interfaces:**
- Consumes: `BanditCamp` (Task 9).
- Produces:
  - Constants: `HOLD_RADIUS = 60`, `CAMP_BACK_DAYS = 5`.
  - `interface CampState { left: number; cleared: number | null; looted: boolean; gone: boolean }`.
  - `interface BanditsSnapshot { camps: Array<{ id: number; left: number; cleared: number | null; looted: boolean; gone: boolean }> }`.
  - `class Bandits`:
    - `constructor(camps: readonly BanditCamp[] = [])`; fields `camps`, `live: Bandit[]`, `liveCamp: number | null`, `nextBandit`.
    - `state(id)`, `manned(camp)`, `campFor(x, z)`, `near(x, z, r)`, `holds(x, z)`.
    - `lose(camp, day): boolean` (true when the camp is cleared).
    - `reman(day, claimNear)`, `chestAt(x, z)`, `loot(camp, random): { gold: number; goods: Cargo }`.
    - `reconcile(world, claimNear)`, `snapshot()`, `restore(s)`, `fighting()`.
    - (Task 11 adds `alertAll()`, `heard(x, z)`, and the `Bandit` type.)
  - `Interaction` `{ kind: 'chest'; camp: number }`; `Land.openChest(id: number): Outcome`; `LandSnapshot.bandits?: BanditsSnapshot`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/land/bandits.test.ts
import { describe, expect, it } from 'vitest';
import { Sea } from '../combat/sea';
import { shipClass } from '../combat/vessel';
import { SEA_LEVEL } from '../config';
import type { Port } from '../economy/ports';
import { footprintSamples } from '../sailing/hull';
import { BRIG, MERCHANT_BRIG, MERCHANT_SLOOP, SLOOP } from '../sailing/ships';
import { Weather } from '../sailing/weather';
import { Block } from '../voxel/blocks';
import { VoxelWorld } from '../voxel/VoxelWorld';
import type { BanditCamp } from '../worldgen/bandits';
import { Bandits, CAMP_BACK_DAYS, HOLD_RADIUS } from './bandits';
import { Land } from './Land';

const CLASSES = new Map(
  [SLOOP, BRIG, MERCHANT_SLOOP, MERCHANT_BRIG].map((type) => {
    const cells: Array<[number, number]> = [];
    for (let x = 0; x < 5; x++) for (let z = 0; z < 15; z++) cells.push([x - 2.5, z - 7.5]);
    return [type, shipClass(type, footprintSamples(cells), 2.5, 16)] as const;
  }),
);
const FAR_PORT: Port = { id: 0, name: 'Haven', faction: 'merchant', x: 3000, z: 0, heading: 0, islandX: 3000, islandZ: 0, pier: { x: 3000, y: 13, z: 0 }, places: [], lamps: [] };
const GROUND = SEA_LEVEL + 1;

/** A camp at the middle of a flat grassy islet 80 across, three bandits strong, its fire and chest in place. */
export function banditIslet(size = 3) {
  const world = new VoxelWorld();
  for (let x = -40; x < 40; x++) for (let z = -40; z < 40; z++) for (let y = 0; y <= SEA_LEVEL; y++) world.setVoxel(x, y, z, y === SEA_LEVEL ? Block.Grass : Block.Dirt);
  const camp: BanditCamp = { id: 7, x: 0, y: GROUND, z: 0, islandX: 0, islandZ: 0, islandRadius: 36, tier: 1, size, chest: { x: 2, y: GROUND, z: 2 } };
  world.setVoxel(0, GROUND, 0, Block.Embers);
  world.setVoxel(2, GROUND, 2, Block.Chest);
  const sea = new Sea(world, new Weather({ cells: [] }), CLASSES, SLOOP, [FAR_PORT], 1, false);
  Object.assign(sea.player.ship, { x: 50, z: 0, heading: 0, surge: 0 });
  const land = new Land(world, sea, 5);
  land.bandits = new Bandits([camp]);
  return { world, sea, land, camp };
}

describe('bandits’ camps', () => {
  it('are manned at first, as many as the camp holds', () => {
    const { land, camp } = banditIslet();
    expect(land.bandits.manned(camp)).toBe(true);
    expect(land.bandits.state(camp.id)).toMatchObject({ left: 3, cleared: null, looted: false, gone: false });
  });

  it('hold their ground: no campfire within 60 of a manned camp, but one is fine once it’s cleared', () => {
    const { land, sea, camp } = banditIslet();
    sea.player.cargo.timber = 50;
    land.goAshore();
    expect(land.placement('campfire', 20, 0, 0)).toMatchObject({ ok: false, reason: 'Bandits hold this ground: clear their camp first.' });
    for (let i = 0; i < 3; i++) land.bandits.lose(camp, land.day());
    expect(land.placement('campfire', 20, 0, 0).ok).toBe(true);
  });

  it('are manned again five days after they’re cleared', () => {
    const { land, sea, camp } = banditIslet();
    for (let i = 0; i < 3; i++) land.bandits.lose(camp, land.day());
    expect(land.bandits.manned(camp)).toBe(false);
    sea.clock.day += CAMP_BACK_DAYS - 1;
    land.step(1.1);
    expect(land.bandits.manned(camp)).toBe(false);
    sea.clock.day += 1;
    land.step(1.1);
    expect(land.bandits.manned(camp)).toBe(true);
    expect(land.bandits.state(camp.id)).toMatchObject({ left: 3, looted: false });
  });

  it('stay empty for good once the captain’s camp claims ground near a cleared one', () => {
    const { land, sea, camp } = banditIslet();
    sea.player.cargo.timber = 50;
    land.goAshore();
    for (let i = 0; i < 3; i++) land.bandits.lose(camp, land.day());
    expect(land.build('campfire', 30, 0, 0).ok).toBe(true);
    sea.clock.day += CAMP_BACK_DAYS + 1;
    land.step(1.1);
    expect(land.bandits.manned(camp)).toBe(false);
    expect(land.bandits.state(camp.id).gone).toBe(true);
  });

  it('keep a chest: E opens it once, for gold and goods, and it’s full again when they’re back', () => {
    const { land, sea, camp } = banditIslet();
    land.goAshore();
    Object.assign(land.walker!, { x: 2.5, z: 1.2, y: GROUND });
    expect(land.interaction()).toEqual({ kind: 'chest', camp: camp.id });
    const gold = sea.captain.gold;
    expect(land.openChest(camp.id).ok).toBe(true);
    expect(sea.captain.gold - gold).toBeGreaterThanOrEqual(90);
    expect(sea.captain.gold - gold).toBeLessThanOrEqual(180);
    expect(land.drops.length).toBeGreaterThan(0);
    expect(land.interaction()?.kind).not.toBe('chest');
    expect(land.openChest(camp.id).ok).toBe(false);
    for (let i = 0; i < 3; i++) land.bandits.lose(camp, land.day());
    sea.clock.day += CAMP_BACK_DAYS;
    land.step(1.1);
    expect(land.bandits.state(camp.id).looted).toBe(false);
  });

  it('are saved, and an older save finds them all manned', () => {
    const { land, camp } = banditIslet();
    land.bandits.lose(camp, land.day());
    const saved = JSON.parse(JSON.stringify(land.snapshot()));
    const fresh = banditIslet().land;
    fresh.restore(saved);
    expect(fresh.bandits.state(camp.id).left).toBe(2);
    delete saved.bandits;
    const older = banditIslet().land;
    older.restore(saved);
    expect(older.bandits.state(camp.id).left).toBe(3);
  });

  it('a camp whose ground a save’s own camp already claims is left empty for good', () => {
    const { world, land, camp } = banditIslet();
    // An older save: the player camped on this islet before there were bandits.
    const saved = JSON.parse(JSON.stringify(land.snapshot()));
    saved.buildings = [{ id: 1, kind: 'campfire', x0: 20, z0: 0, w: 3, d: 3, y: GROUND, rot: 0 }];
    world.setVoxel(21, GROUND, 1, Block.Embers);
    land.restore(saved);
    expect(land.bandits.manned(camp)).toBe(false);
    expect(land.bandits.state(camp.id).gone).toBe(true);
    expect(HOLD_RADIUS).toBe(60);
  });

  it('a camp an old save’s edits wiped out (its fire gone) is left empty for good', () => {
    const { world, land, camp } = banditIslet();
    world.setVoxel(0, GROUND, 0, Block.Air);
    land.restore(JSON.parse(JSON.stringify(land.snapshot())));
    expect(land.bandits.state(camp.id).gone).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/land/bandits.test.ts`
Expected: FAIL: "Failed to resolve import './bandits'".

- [ ] **Step 3: The registry**

```ts
// src/land/bandits.ts
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
```

(Task 11 replaces the placeholder `Bandit` with the full one; `fighting()` only reads `mode`.)

- [ ] **Step 4: `Land` wiring**

In `src/land/Land.ts`:
- Import `import { Bandits, type BanditsSnapshot } from './bandits';`.
- Add a field `/** The bandits' camps (the game hands over the ones it placed). */ bandits = new Bandits();`.
- `Interaction` gains `| { kind: 'chest'; camp: number }`.
- `LandSnapshot` gains `/** Bandits' camps (version 6). */ bandits?: BanditsSnapshot;`.
- In `snapshot()`, add `bandits: this.bandits.snapshot(),`.
- At the end of `restore()`: `if (s.bandits) this.bandits.restore(s.bandits); this.bandits.reconcile(this.world, (x, z, r) => this.claimNear(x, z, r));`.
- In `grow()`, add `this.bandits.reman(this.day(), (x, z, r) => this.claimNear(x, z, r));`.
- In `placement()`, right after the `inTown` check: `if (kind === 'campfire' && this.bandits.holds(cx, cz)) return verdict(false, 'Bandits hold this ground: clear their camp first.');`.
- In `closeInteraction()`, before the crop check:

```ts
    const chest = this.bandits.chestAt(w.x, w.z);
    if (chest) return { kind: 'chest', camp: chest.id };
```

- New methods:

```ts
  /** Is one of the captain's campfires within `r` of (x, z)? */
  private claimNear(x: number, z: number, r: number): boolean {
    return this.buildings.some((b) => b.kind === 'campfire' && Math.hypot(fireCentre(b).x - x, fireCentre(b).z - z) < r);
  }

  /** Opens a bandits' chest: its gold in the purse, its goods spilling out beside it. */
  openChest(id: number): Outcome {
    const camp = this.bandits.camps.find((c) => c.id === id);
    if (!camp || this.bandits.state(id).looted) return fail('It’s empty.');
    const { gold, goods } = this.bandits.loot(camp, this.random);
    this.sea.captain.gold += gold;
    for (const [good, n] of Object.entries(goods) as Array<[Good, number]>) this.drop(good, camp.chest.x + 0.5, camp.chest.y + 1.2, camp.chest.z + 0.5, n);
    return done(`The bandits’ chest: ${gold} gold${cargoCount(goods) > 0 ? ', and goods spill out' : ''}.`);
  }
```

(`fireCentre` is already imported from `./camps`.)

- [ ] **Step 5: `Shore`, `Treasure`, `Game`**

- In `src/Shore.ts`, `interact()` gets `case 'chest': this.report(this.land.openChest(what.camp)); break;`, and `promptFor` gets `case 'chest': return `${key}: open the chest`;`.
- In `src/treasure/Treasure.ts`, at the `planSite(...)` call, add `|| this.land.bandits.near(x, z, 12)` to the avoid predicate.
- In `src/Game.ts`, after `this.land.deposits = new Deposits(deposits);`: `this.land.bandits = new Bandits(camps);` (import `Bandits`; drop the `void camps` from Task 9).

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/land/bandits.test.ts src/land/Land.test.ts src/treasure`
Expected: PASS. If "stay empty for good" fails because `build('campfire', 30, 0, 0)` is refused, it's the ground check. The camp is cleared first, so `holds` is false; look at the reason `placement` gives.

- [ ] **Step 7: Typecheck and run the whole suite**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: all pass. `save.test.ts` round-trips a whole game, and `bandits` rides along as an optional field.

---

### Task 11: Bandits in action

**Files:**
- Modify: `src/land/bandits.ts` (the `Bandit`; `stepBandits`; alerting; musket fire; fleeing)
- Modify: `src/land/Land.ts` (bandits stepped; shots hit bandits; fallen bandits' loot; hearing shots)
- Modify: `src/render/PeopleView.ts` (bandits drawn, with muskets)
- Modify: `src/Shore.ts` (health shown in a fight)
- Test: `src/land/bandits.test.ts`

**Interfaces:**
- Consumes:
  - Task 2: `MUSKET`, `hitChance`, `clearLine`, `resolveShot`.
  - Task 5: `Land.fire`, `shootables`, `wound`.
  - Task 7: `Land.hurt`, `Land.underFire`.
  - Task 10: `Bandits`.
- Produces:
  - `interface Bandit { id; camp; look; dress: Dress; walker: Walker; hp; mode: 'ease' | 'fight' | 'flee'; loading; aiming; path: PathPoint[] | null; next; think; unseen }`.
  - `BANDIT_HP = 4`, `SIGHT = 18`, `HEARING = 30`, `KEEP_NEAR = 8`, `KEEP_FAR = 16`, `FLEE_AT = 2`.
  - `stepBandits(land: Land, dt: number, random: () => number): void`.
  - `Bandits.alertAll(): void`, `Bandits.heard(x: number, z: number): void`.
  - `Land.banditGone(b: Bandit, how: 'fell' | 'fled'): void` (public, so `stepBandits` can call it).

- [ ] **Step 1: Write the failing tests**

Add to `src/land/bandits.test.ts`:

```ts
import { phaseOf } from '../core/clock';
import { HEALTH_MAX } from './Land';

/** The captain ashore on the bandits' islet at (x, z), at noon, a rifle and cartridges to hand. */
function ashore(x: number, z: number, size = 3) {
  const setup = banditIslet(size);
  const { land, sea } = setup;
  sea.clock.phase = phaseOf(12);
  sea.captain.guns.push('pistol', 'rifle');
  sea.player.cargo.cartridges = 40;
  land.goAshore();
  Object.assign(land.walker!, { x, z, y: GROUND });
  return setup;
}
const run = (land: Land, seconds: number, keepAlive = true) => {
  for (let t = 0; t < seconds; t += 1 / 20) {
    land.step(1 / 20);
    if (keepAlive && land.walker) land.health = HEALTH_MAX;
  }
};
const shots = (land: Land) => land.takeEvents().filter((e) => e.kind === 'shot' && e.gun === 'musket');
/** A wall of stone across z = 10, x -40..40, ten high: out of sight to the south of it. */
const wall = (world: VoxelWorld) => {
  for (let x = -40; x < 40; x++) for (let y = GROUND; y < GROUND + 10; y++) world.setVoxel(x, y, 10, Block.Stone);
};

describe('bandits', () => {
  it('muster at their camp at ease, as many as it holds', () => {
    const { land } = ashore(0.5, 30.5);
    wall(land.world);
    run(land, 1);
    expect(land.bandits.live).toHaveLength(3);
    for (const b of land.bandits.live) expect(b.mode).toBe('ease');
  });

  it('see the captain within about 18 blocks by day, and the whole camp is alerted', () => {
    const { land } = ashore(0.5, 30.5);
    run(land, 2);
    expect(land.bandits.live.every((b) => b.mode === 'ease')).toBe(true);
    Object.assign(land.walker!, { x: 0.5, z: 12.5 });
    run(land, 1);
    expect(land.bandits.live.every((b) => b.mode === 'fight')).toBe(true);
  });

  it('at night see only half as far', () => {
    const { land, sea } = ashore(0.5, 13.5);
    sea.clock.phase = phaseOf(23);
    run(land, 1);
    expect(land.bandits.live.every((b) => b.mode === 'ease')).toBe(true);
  });

  it('hear a shot within about 30 blocks, out of sight', () => {
    const { land, world } = ashore(0.5, 25.5);
    wall(world);
    run(land, 1);
    expect(land.bandits.live.every((b) => b.mode === 'ease')).toBe(true);
    land.fire('pistol');
    run(land, 0.1);
    expect(land.bandits.live.every((b) => b.mode === 'fight')).toBe(true);
  });

  it('need a clear line to fire', () => {
    const { land, world } = ashore(0.5, 25.5);
    wall(world);
    land.bandits.alertAll();
    land.takeEvents();
    run(land, 12);
    expect(shots(land)).toHaveLength(0);
  });

  it('keep 8 to 16 off, and load between shots', () => {
    const { land } = ashore(0.5, 12.5);
    land.bandits.alertAll();
    land.takeEvents();
    run(land, 20);
    const fired = shots(land);
    // Three muskets, six seconds to load: no more than four shots each in 20 s.
    expect(fired.length).toBeGreaterThan(0);
    expect(fired.length).toBeLessThanOrEqual(12);
    const w = land.walker!;
    const off = land.bandits.live.map((b) => Math.hypot(b.walker.x - w.x, b.walker.z - w.z));
    expect(off.filter((d) => d >= 6 && d <= 18).length).toBeGreaterThanOrEqual(2);
  });

  it('wear the captain down, and bring them down', () => {
    const { land } = ashore(0.5, 12.5, 4);
    land.bandits.alertAll();
    for (let t = 0; t < 120 && land.walker; t += 1 / 20) land.step(1 / 20);
    expect(land.walker).toBeNull();
    expect(land.takeEvents().some((e) => e.kind === 'downed')).toBe(true);
  });

  it('a wounded bandit breaks and runs, and is gone once out of sight', () => {
    const { land, camp } = ashore(0.5, 12.5);
    run(land, 0.5);
    const b = land.bandits.live[0];
    b.hp = 3;
    land.fire('pistol', { x: b.walker.x, y: b.walker.y + 1.2, z: b.walker.z });
    // A hit leaves 1 hp; a miss leaves them fighting. Try again until they're hit.
    for (let i = 0; i < 12 && b.mode !== 'flee' && land.bandits.live.includes(b); i++) {
      run(land, 2.6);
      land.fire('pistol', { x: b.walker.x, y: b.walker.y + 1.2, z: b.walker.z });
    }
    expect(b.mode === 'flee' || !land.bandits.live.includes(b)).toBe(true);
    run(land, 30);
    expect(land.bandits.live).not.toContain(b);
    expect(land.bandits.state(camp.id).left).toBeLessThan(3);
  });

  it('a fallen bandit leaves cartridges and a few gold, and the last one gone clears the camp', () => {
    const { land, sea, camp } = ashore(0.5, 12.5, 2);
    run(land, 0.5);
    const gold = sea.captain.gold;
    for (const b of [...land.bandits.live]) land.banditGone(b, 'fell');
    expect(land.bandits.manned(camp)).toBe(false);
    expect(land.bandits.state(camp.id).cleared).not.toBeNull();
    expect(land.takeEvents().some((e) => e.kind === 'notice')).toBe(true);
    // (banditGone doesn't pay: the shot that fells them does. See Land.wound.)
    expect(sea.captain.gold).toBe(gold);
  });

  it('a rifle shot fells a bandit; they drop cartridges and pay a few gold', () => {
    const { land, sea } = ashore(0.5, 12.5);
    run(land, 0.5);
    const gold = sea.captain.gold;
    const b = land.bandits.live[0];
    for (let i = 0; i < 12 && land.bandits.live.includes(b); i++) {
      land.fire('rifle', { x: b.walker.x, y: b.walker.y + 1.2, z: b.walker.z });
      run(land, 5.1);
    }
    expect(land.bandits.live).not.toContain(b);
    expect(sea.captain.gold).toBeGreaterThan(gold);
    expect(land.drops.some((d) => d.good === 'cartridges')).toBe(true);
  });

  it('a save made mid-fight loads with the bandits at ease, as many as were left', () => {
    const { land, camp } = ashore(0.5, 12.5);
    run(land, 0.5);
    land.bandits.alertAll();
    land.hurt(4);
    land.banditGone(land.bandits.live[0], 'fell');
    const saved = JSON.parse(JSON.stringify(land.snapshot()));
    const loaded = banditIslet().land;
    loaded.restore(saved);
    expect(loaded.health).toBe(HEALTH_MAX);
    expect(loaded.bandits.live).toHaveLength(0);
    loaded.step(1 / 20);
    expect(loaded.bandits.live).toHaveLength(2);
    expect(loaded.bandits.live.every((b) => b.mode === 'ease')).toBe(true);
    expect(loaded.bandits.state(camp.id).left).toBe(2);
  });
});
```

Also import `type Land` for the helpers.

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/land/bandits.test.ts -t "^bandits "`
Expected: FAIL. `land.bandits.live` stays empty, since nothing steps them yet.

- [ ] **Step 3: The bandits**

In `src/land/bandits.ts`, replace the placeholder `Bandit` and add the step. New imports:

```ts
import { isNight } from '../core/clock';
import { type Dress, townDress } from '../duel/dress';
import { hash2 } from '../util/hash';
import { clearLine, hitChance, MUSKET, resolveShot } from './firearms';
import type { Land } from './Land';
import { findPath, type PathPoint } from './paths';
import { createWalker, standable, stepWalker, WALK_SPEED, type Walker } from './walker';
```

```ts
export const BANDIT_HP = 4;
/** They see the captain this far off by day (half that at night), and hear a shot this far. */
export const SIGHT = 18;
export const HEARING = 30;
/** In a fight they keep between these two distances from the captain. */
export const KEEP_NEAR = 8;
export const KEEP_FAR = 16;
/** Wounded to this, a bandit breaks and runs. */
export const FLEE_AT = 2;
/** A runaway is gone once this far off, or this far and out of sight. */
const FLEE_GONE = 40;
const FLEE_HIDDEN = 20;
/** Out of sight of the captain this long, a bandit goes back to their camp. */
const LOSE_SECONDS = 20;
const PATH_NODES = 1500;
/** At ease they amble; in a fight they move smartly. */
const EASE_PACE = 0.35;
const FIGHT_PACE = 0.8;
const ARRIVED = 0.4;

export interface Bandit {
  id: number;
  camp: number;
  look: number;
  dress: Dress;
  walker: Walker;
  hp: number;
  mode: 'ease' | 'fight' | 'flee';
  /** Seconds until the musket's loaded. */
  loading: number;
  /** Seconds left levelling the musket (for drawing). */
  aiming: number;
  path: PathPoint[] | null;
  next: number;
  /** Seconds until they next choose where to go. */
  think: number;
  /** Seconds they've had no sight of the captain, in a fight. */
  unseen: number;
}
```

In the class, add:

```ts
  /** Every bandit at ease takes up the fight, their muskets coming to bear one after another. */
  alertAll(): void {
    for (const b of this.live) if (b.mode === 'ease') Object.assign(b, { mode: 'fight', path: null, think: 0, unseen: 0, loading: 0.8 + (b.id % 3) * 0.9 });
  }

  /** A shot fired at (x, z): the camp hears it if a bandit is within earshot. */
  heard(x: number, z: number): void {
    if (this.live.some((b) => Math.hypot(b.walker.x - x, b.walker.z - z) < HEARING)) this.alertAll();
  }
```

And the step:

```ts
/**
 * One step of the camp on the islet the captain walks: its bandits muster at ease the
 * first time, loiter, see or hear the captain and fight, keeping their distance and
 * firing when loaded and in sight, and run when badly hurt. Other camps wait.
 */
export function stepBandits(land: Land, dt: number, random: () => number): void {
  const bandits = land.bandits;
  const w = land.walker;
  const camp = w ? bandits.campFor(w.x, w.z) : undefined;
  if (!w || !camp || !bandits.manned(camp)) {
    bandits.live = [];
    bandits.liveCamp = null;
    return;
  }
  if (bandits.liveCamp !== camp.id) {
    bandits.live = muster(land, camp, random);
    bandits.liveCamp = camp.id;
  }
  const night = isNight(land.sea.clock.phase);
  const captain = { x: w.x, y: w.y + 1.2, z: w.z };
  for (const b of [...bandits.live]) {
    b.aiming = Math.max(0, b.aiming - dt);
    if (b.mode === 'ease') ease(land, camp, b, captain, night, dt, random);
    else if (b.mode === 'fight') fight(land, b, captain, dt, random);
    else flee(land, b, captain, dt);
  }
}

/** A camp's bandits, gathered round the fire. */
function muster(land: Land, camp: BanditCamp, random: () => number): Bandit[] {
  const out: Bandit[] = [];
  const n = land.bandits.state(camp.id).left;
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2 + random();
    const x = camp.x + 0.5 + Math.sin(angle) * 3;
    const z = camp.z + 0.5 + Math.cos(angle) * 3;
    const look = Math.floor(hash2(camp.id, i, 0xba4d) * 1e6);
    out.push({
      id: land.bandits.nextBandit++,
      camp: camp.id,
      look,
      dress: { ...townDress('pirate', look), ragged: true },
      walker: createWalker(x, standable(land.world, x, z, camp.y + 4) ?? camp.y, z, angle + Math.PI),
      hp: BANDIT_HP,
      mode: 'ease',
      loading: 0,
      aiming: 0,
      path: null,
      next: 0,
      think: random() * 2,
      unseen: 0,
    });
  }
  return out;
}

const eyeOf = (b: Bandit) => ({ x: b.walker.x, y: b.walker.y + 1.5, z: b.walker.z });

function ease(land: Land, camp: BanditCamp, b: Bandit, captain: { x: number; y: number; z: number }, night: boolean, dt: number, random: () => number): void {
  const w = b.walker;
  const sight = night ? SIGHT / 2 : SIGHT;
  if (Math.hypot(captain.x - w.x, captain.z - w.z) < sight && clearLine(land.world, eyeOf(b), captain)) return land.bandits.alertAll();
  b.think -= dt;
  if (b.think <= 0 && !b.path) {
    b.think = 3 + random() * 5;
    // By day some wander the islet; at night they keep to the fire.
    const roam = !night && random() < 0.35;
    const [cx, cz] = roam ? [camp.islandX, camp.islandZ] : [camp.x + 0.5, camp.z + 0.5];
    const reach = roam ? camp.islandRadius * 0.7 : night ? 3 : 6;
    const angle = random() * Math.PI * 2;
    const r = (roam ? Math.sqrt(random()) : 0.5 + random() * 0.5) * reach;
    b.path = findPath(land.world, w, { x: cx + Math.sin(angle) * r, z: cz + Math.cos(angle) * r }, 0.8, PATH_NODES);
    b.next = 0;
  }
  walk(land, b, dt, EASE_PACE);
}

function fight(land: Land, b: Bandit, captain: { x: number; y: number; z: number }, dt: number, random: () => number): void {
  const w = b.walker;
  const eye = eyeOf(b);
  const d = Math.hypot(captain.x - w.x, captain.z - w.z);
  const sees = clearLine(land.world, eye, captain);
  b.unseen = sees ? 0 : b.unseen + dt;
  if (b.unseen > LOSE_SECONDS) {
    Object.assign(b, { mode: 'ease', path: null, think: 1 });
    return;
  }
  b.loading = Math.max(0, b.loading - dt);
  if (b.loading <= 0 && sees && d <= MUSKET.range) {
    w.facing = Math.atan2(captain.x - w.x, captain.z - w.z);
    b.loading = MUSKET.reload;
    b.aiming = 0.6;
    land.underFire();
    const hit = random() < hitChance('musket', d);
    const end = hit ? captain : resolveShot(land.world, eye, captain, MUSKET.range, null, 0, 1).end;
    land.emit({ kind: 'shot', gun: 'musket', from: eye, to: end, hit: hit ? 'captain' : null });
    if (hit) land.hurt(MUSKET.damage);
    // And off somewhere else before the next.
    b.path = null;
    b.think = 0;
    return;
  }
  b.think -= dt;
  if (!b.path && (b.think <= 0 || d < KEEP_NEAR || d > KEEP_FAR || !sees)) {
    b.think = 1.5 + random() * 2;
    const angle = Math.atan2(w.x - captain.x, w.z - captain.z) + (random() - 0.5) * 1.2;
    const r = KEEP_NEAR + random() * (KEEP_FAR - KEEP_NEAR);
    b.path = findPath(land.world, w, { x: captain.x + Math.sin(angle) * r, z: captain.z + Math.cos(angle) * r }, 1, PATH_NODES);
    b.next = 0;
  }
  walk(land, b, dt, FIGHT_PACE);
  if (!b.path) w.facing = Math.atan2(captain.x - w.x, captain.z - w.z);
}

function flee(land: Land, b: Bandit, captain: { x: number; y: number; z: number }, dt: number): void {
  const w = b.walker;
  const dx = w.x - captain.x;
  const dz = w.z - captain.z;
  const d = Math.hypot(dx, dz) || 1;
  stepWalker(w, dx / d, dz / d, land.world, dt, WALK_SPEED * 1.1);
  if (d > FLEE_GONE || (d > FLEE_HIDDEN && !clearLine(land.world, eyeOf(b), captain))) land.banditGone(b, 'fled');
}

/** Along their path, if they have one; standing their ground if not. */
function walk(land: Land, b: Bandit, dt: number, pace: number): void {
  const w = b.walker;
  const p = b.path?.[b.next];
  if (!p) {
    b.path = null;
    stepWalker(w, 0, 0, land.world, dt);
    return;
  }
  const dx = p.x - w.x;
  const dz = p.z - w.z;
  const d = Math.hypot(dx, dz);
  if (d < ARRIVED) {
    b.next++;
    return;
  }
  stepWalker(w, (dx / d) * pace, (dz / d) * pace, land.world, dt);
}
```

(`BanditCamp` is already imported as a type at the top of the file.)

- [ ] **Step 4: `Land`: bandits stepped, shot at, falling, fleeing, hearing**

In `src/land/Land.ts`:
- Import `stepBandits, type Bandit, FLEE_AT` from `./bandits`.
- In `step(dt, watched)`, after the creatures: `if (watched) stepBandits(this, dt, this.random); else this.bandits.live = [];`.
- In `fire(...)`, after pushing the `shot` event: `this.bandits.heard(from.x, from.z);`.
- `shootables()` adds the bandits:

```ts
  private shootables(): Shootable[] {
    const beasts = this.creatures.map((c) => ({ kind: 'creature' as const, id: c.id, x: c.walker.x, y: c.walker.y, z: c.walker.z }));
    const bandits = this.bandits.live.map((b) => ({ kind: 'bandit' as const, id: b.id, x: b.walker.x, y: b.walker.y, z: b.walker.z }));
    return [...beasts, ...bandits];
  }
```

- `wound(...)` handles bandits:

```ts
  private wound(t: Shootable, damage: number): Outcome {
    const w = this.walker!;
    if (t.kind === 'bandit') {
      const b = this.bandits.live.find((o) => o.id === t.id);
      return b ? this.shootBandit(b, damage) : done('');
    }
    const c = this.creatures.find((o) => o.id === t.id);
    return c ? this.landed(c, harm(c, damage, w.x, w.z), 'Shot') : done('');
  }

  /** A shot lands on a bandit: the camp takes up the fight; badly hurt they run; down, they leave cartridges and a few gold. */
  private shootBandit(b: Bandit, damage: number): Outcome {
    b.hp -= damage;
    this.bandits.alertAll();
    if (b.hp <= 0) {
      const camp = this.bandits.camps.find((c) => c.id === b.camp)!;
      const { x, y, z } = b.walker;
      this.banditGone(b, 'fell');
      const gold = 3 + Math.floor(this.random() * 6) + camp.tier * 3;
      this.sea.captain.gold += gold;
      this.drop('cartridges', x, y + 0.4, z, 2 + Math.floor(this.random() * 2));
      return done(`The bandit falls: ${gold} gold in their purse.`);
    }
    if (b.hp <= FLEE_AT) {
      Object.assign(b, { mode: 'flee', path: null });
      return done('The bandit breaks and runs!');
    }
    return done('A hit!');
  }

  /** A bandit is gone from their camp, fallen or fled: the last of them clears it. */
  banditGone(b: Bandit, how: 'fell' | 'fled'): void {
    this.bandits.live = this.bandits.live.filter((o) => o !== b);
    const camp = this.bandits.camps.find((c) => c.id === b.camp);
    if (camp && this.bandits.lose(camp, this.day())) {
      this.events.push({ kind: 'notice', text: `The bandits’ camp is cleared${how === 'fled' ? ', the last of them fled' : ''}. They’ll be back in five days, unless you claim the ground.`, tone: 'good' });
    }
  }
```

- In `restore()`, the captain's health is full: `this.health = HEALTH_MAX;`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/land/bandits.test.ts`
Expected: PASS. These tests step a small AI, so they can be sensitive to paths. When one fails, print the bandits' modes, positions and paths from inside the test, then fix the behaviour. Loosen a test's bar only if the behaviour is right and the bar was too tight.

- [ ] **Step 6: The bandits drawn**

In `src/render/PeopleView.ts`, after the townsfolk loop:

```ts
    // Bandits: ragged, muskets on their shoulders at ease, levelled when they fire.
    for (const b of land.bandits.live) {
      const w = b.walker;
      const x = w.prev.x + (w.x - w.prev.x) * alpha;
      const y = w.prev.y + (w.y - w.prev.y) * alpha;
      const z = w.prev.z + (w.z - w.prev.z) * alpha;
      if (Math.hypot(x - focus.x, z - focus.z) > DRAW_RANGE) continue;
      const key = -1_000_000 - b.id;
      seen.add(key);
      let figure = this.figures.get(key);
      if (!figure) {
        figure = { view: new CharacterView(buildSettlerModel(b.look, b.dress)), held: null };
        figure.view.lift(0.05);
        this.figures.set(key, figure);
        this.group.add(figure.view.root);
      }
      const held: InHand = b.aiming > 0 ? 'musketLevelled' : 'musket';
      if (held !== figure.held) {
        figure.held = held;
        figure.view.hold(held === 'musket' ? musketCells() : heldCells(held));
      }
      figure.view.root.position.set(x, y, z);
      figure.view.root.rotation.y = w.facing;
      figure.view.walk({ speed: Math.hypot(w.vx, w.vz), swing: null, aiming: b.aiming > 0 }, dt, time);
    }
```

- [ ] **Step 7: Health shown in a fight**

In `Shore.render`: `health: this.land.health < HEALTH_MAX || this.land.bandits.fighting() ? { now: this.land.health, most: HEALTH_MAX } : null,`.

- [ ] **Step 8: Typecheck and run the whole suite**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: all pass.

---

### Task 12: Docs, a play-through, and the commit when the player says

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/phase-10-deposits-guns-sound.md` (a line under 10.2: built, and the rulings)

- [ ] **Step 1: ARCHITECTURE**

Add a section after the outcrops' ("Guns, hunting and bandits (Phase 10.2)"):
- the guns (table: price, range, damage, reload, and how the chance to hit falls off);
- cartridges and the pouch;
- aiming with keys and pad against the mouse;
- cover;
- goats;
- health;
- bandit camps (where, what's in one, how the bandits behave, re-manning, holding ground, the chest);
- being brought down;
- the card.

Also:
- In the save history, add version 6.
- In the module map, add `land/firearms.ts`, `land/bandits.ts`, `worldgen/bandits.ts`, `ui/comeTo.ts`, `ui/Fade.ts` and `render/Tracers.ts`.
- In the roadmap under 10, mark 10.2 ✅, keeping 10 itself 🔄 until 10.3.

- [ ] **Step 2: Play it through in the browser**

In Playwright against `http://localhost:5173`, with screenshots into `.playwright-mcp/`:
1. **Buying guns.** In Haven's market, the gunsmith's counter shows. Buy a pistol, then buy cartridges.
2. **The Crown's market.** In an Imperial port's market, there's no counter, just the monopoly note.
3. **Firing.** Ashore, the pistol is in the hotbar with its cartridge count. Fire at nothing (smoke, streak, dust, the reload shade).
4. **Hunting goats.** On an upland by day, goats graze in a herd and bolt when approached. Shoot one; meat and a hide drop.
5. **A bandit fight.** Sail to a bandit islet (`game.land.bandits.camps` lists them). Go ashore: bandits by their fire. Get seen: the fight starts, muskets fire, the health bar shows and drops. Fell one with the rifle; wound one with the pistol and it runs. Clear the camp (the notice), and open the chest.
6. **Brought down.** On another camp's islet, let them win: the card "Left for dead" shows, the captain comes to aboard, and the pack lies ashore.
7. **Bandits' ground.** Try a campfire near a manned camp: refused with the reason.
8. **The other cards.** Sink at sea and watch "Lost at sea".

Check the console after each for errors.

- [ ] **Step 3: Run everything**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: no type errors, and all tests pass.

- [ ] **Step 4: Ask the player, then commit when they say**

Show the player the screenshots and the rulings list, and ask whether to commit. When they say so, stage by path (never the repo-root MP3s or `.opencode/`), check the diff for secrets and hostnames, and commit on `phase-10-deposits-guns-sound` with the message "Phase 10 (2/3): guns, hunting and bandits, and the come-to card". Merging and pushing wait for the player too.
