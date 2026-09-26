# Stairs, Slabs and Fine-Voxel Props Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stairs and slabs the captain, settlers and creatures walk up in half-steps and players build in their camps; and quarter-voxel props in the towns (lanterns, signboards and signposts, a clock, porches, and the sloop on the stocks).

**Architecture:** Stairs and slabs are ordinary block ids. A shape table on the terrain palette gives their boxes; the mesher draws the boxes, and the walker, pathfinding and dropped items read heights from them in half-block steps. Props are small voxel models meshed with the ships' `meshCells`, placed by the town builder as `PropPlacement`s (`Port.decor`), and drawn as one `InstancedMesh` per kind. A shader test shared with the terrain (`render/lifts.ts`) lifts a prop with the wall it hangs on. An invisible `Block.Blocker` keeps people out of the few props that need it.

**Tech Stack:** TypeScript (strict, `verbatimModuleSyntax`: type-only imports use `import type`), Three.js r186 (`MeshLambertMaterial` + `onBeforeCompile`, `InstancedMesh`), Vitest, Vite.

**Spec:** `docs/superpowers/specs/2026-09-25-block-shapes-and-props-design.md`

## Global Constraints

- New block ids 60–74: gravel, stone and planks, each a slab and then four stairs (south, east, north, west), plus `Blocker` at 75. Ids stay under 256 (one byte a voxel).
- No save format change. Stairs and slabs are ordinary ids in chunks. Props aren't saved: they come from the seed with the town.
- Stair facing uses a building's `rot` quarter turns: 0 +z (south), 1 +x (east), 2 −z (north), 3 −x (west). North is −z.
- Heights on foot come in half-block steps. `STEP_UP` stays 2.
- Props are for looks and don't collide, except cells filled with `Block.Blocker`.
- Prop scale: 0.25 world units a voxel by default. Lanterns are 0.125. The ship on the stocks is 1.
- Players build plank stairs and plank slabs (1 timber each), and stone stairs and stone slabs (1 stone each). Props aren't buildable.
- Frame time in Haven at night: CPU and GPU each within +0.5 ms of `main`.
- House style: comments in full sentences, UK English, `/** */` on exported things, no new dependencies.
- Checks: `npx vitest run` and `npx tsc --noEmit`, both clean at the end of every task. Commit after every task. Don't push.

## Refinements to the spec made while planning

These are already applied to the spec in this plan's commit:
1. **Where the stairs go.** A street's stair replaces the *higher* cell's paving, climbing away from the lower cell. The spec had it on top of the lower cell. On a run of rises (the ramp from the pier) that would make 1.5-block steps. Replacing the higher cell turns any run of 1-block rises into half-steps.
2. **No doorstep stairs.** Doors stand level with the street by them, so they need none. The half-step up to the tavern's and office's doors is the porch deck.
3. **Field names.** Placements are `Town.decor` and `Port.decor`, because `TownLayout.props` already names the square's block-built dressing. A placement records the block it hangs on (`anchor`) instead of a building id. A null anchor means it never lifts.
4. **One mesh per kind.** `PropsView` draws one `InstancedMesh` per kind for all towns at once, about ten draw calls in total. A per-town split isn't worth the extra meshes.
5. **Signs.** The tavern and office hang a signboard on a bracket beside the door. The market's open hall and the shipyard's shed have no wall beside their way in, so they get a signpost, which reserves its cells with the blocker.
6. **Where the ship's cells get reserved.** The town builder never sees ship models, so the game reserves the cells the sloop on the stocks fills right after generating the world, before edits are tracked (`props/reserve.ts`). The stocks are laid for `HULL_ON_STOCKS_LENGTH` (18), which a test checks against the sloop's file.
7. **Door lanterns give light.** They join `Port.lamps`, so the nearest get a point light, a halo and a streak on the water.
8. **Half-steps are one-tick moves.** Nothing smooths the captain's height on screen today, so a half-step is drawn the way a whole step is now, only half as high.

## Review Focus

1. Walking across a stair at a slant (both axes at once) climbs it rather than catching on it. Test in Task 3.
2. Falling onto a stair lands on whichever half is underneath: 0.5 or 1 up. Test in Task 3.
3. Building a stair or slab on top of another stair or slab is refused with "Stairs and slabs go on solid ground." Test in Task 5.
4. A slab on a chunk border (x = 31 against x = 32) hides and keeps the right faces in both chunks. Test in Task 2.
5. Townsfolk spots and the door places on a porch stand at the deck's height, not half a block inside it. Test in Task 10.

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `src/voxel/palette.ts` | modify | `Box` type; `VoxelPalette.shapes` and `.hidden` |
| `src/voxel/blocks.ts` | modify | the 15 shaped ids and the blocker; the shape table; `FACING_DIRS`, `shapeOf`, `baseOf`, `stairFacing`, `slabOf`, `stairOf`, `isPickable` |
| `src/voxel/shapes.ts` | create | walking geometry: `topIn`, `boxBlocked`, `pointBlocked` |
| `src/voxel/VoxelWorld.ts` | modify | `surfaceHeight` skips the blocker |
| `src/voxel/raycast.ts` | modify | rays pass through the blocker |
| `src/voxel/mesher.ts` | modify | draws boxes; never draws the blocker |
| `src/land/walker.ts` | modify | half-step collisions, climbing, landing and ground |
| `src/land/paths.ts` | modify | half-step climbing |
| `src/land/drops.ts` | modify | items rest on half-height tops |
| `src/worldgen/town.ts` | modify | stairs on streets; lanterns, signs, clock, porches, the ship on the stocks |
| `src/worldgen/harbour.ts` | modify | pier lanterns; passes `decor` on; door places at porch height |
| `src/worldgen/buildings.ts` | modify | `Door.outY` |
| `src/economy/ports.ts` | modify | `Port.decor` |
| `src/land/structures.ts` | modify | four buildable pieces, `PIECES` |
| `src/land/Land.ts` | modify | placement rule for stairs and slabs |
| `src/Shore.ts`, `src/ui/BuildMenu.tsx` | modify | turning stairs, the ghost, and the hint text |
| `src/render/lifts.ts` | create | `Lifts` (shared uniforms), `LIFT_GLSL` |
| `src/render/ChunkRenderer.ts` | modify | uses `Lifts` |
| `src/props/types.ts` | create | `PropKind`, `PropPlacement`, `PropModel`, `PROP_KINDS` |
| `src/props/sketch.ts` | create | `Sketch`: builds a model voxel by voxel |
| `src/props/models.ts` | create | the code-built models |
| `src/props/catalog.ts` | create | `propCatalog`, `hullOnStocks`, `propFromVox` |
| `src/props/place.ts` | create | `toWorld`, `placementMatrix` (one transform for drawing and reserving) |
| `src/props/reserve.ts` | create | `reserveProps` |
| `src/render/PropsView.ts` | create | draws the props |
| `src/Game.ts` | modify | builds the catalog, reserves, draws, sets the glow |
| `docs/ARCHITECTURE.md` | modify | voxel pipeline, towns, on foot, building, module map, roadmap |

---

### Task 1: Stair, slab and blocker blocks

**Files:**
- Modify: `src/voxel/palette.ts`, `src/voxel/blocks.ts`, `src/voxel/VoxelWorld.ts` (`surfaceHeight`), `src/voxel/raycast.ts`
- Create: `src/voxel/shapes.ts`
- Test: `src/voxel/shapes.test.ts`

**Interfaces:**
- Produces:
  - `palette.ts`: `interface Box { x0; y0; z0; x1; y1; z1: number }`, and `VoxelPalette.shapes?: ReadonlyArray<readonly Box[] | null>`, `VoxelPalette.hidden?: Uint8Array`.
  - `blocks.ts`: `Block.GravelSlab` (60) … `Block.PlanksStairW` (74), `Block.Blocker` (75); `FACING_DIRS: ReadonlyArray<readonly [number, number]>`; `shapeOf(id): readonly Box[] | null`; `baseOf(id): BlockId`; `stairFacing(id): number` (−1 if not a stair); `slabOf(material): BlockId` (throws unless gravel, stone or planks); `stairOf(material, facing): BlockId`; `isPickable(id): boolean`. `BLOCK_PALETTE` gains `shapes` and `hidden`.
  - `shapes.ts`: `topIn(id, fx, fz): number`; `boxBlocked(world, x0, y0, z0, x1, y1, z1): boolean`; `pointBlocked(world, x, y, z): boolean`.

- [ ] **Step 1: Write the failing tests** in `src/voxel/shapes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../config';
import { baseOf, Block, BLOCK_PALETTE, blocksWalker, FACING_DIRS, isPickable, isSolid, shapeOf, slabOf, stairFacing, stairOf } from './blocks';
import { FLAG_CUTAWAY } from './palette';
import { raycastVoxels } from './raycast';
import { boxBlocked, pointBlocked, topIn } from './shapes';
import { VoxelWorld } from './VoxelWorld';

describe('stairs and slabs', () => {
  it('come in gravel, stone and planks: a slab and four stairs each', () => {
    for (const material of [Block.Gravel, Block.Stone, Block.Planks]) {
      const slab = slabOf(material);
      expect(shapeOf(slab)).toHaveLength(1);
      expect(baseOf(slab)).toBe(material);
      expect(stairFacing(slab)).toBe(-1);
      for (let facing = 0; facing < 4; facing++) {
        const stair = stairOf(material, facing);
        expect(shapeOf(stair)).toHaveLength(2);
        expect(baseOf(stair)).toBe(material);
        expect(stairFacing(stair)).toBe(facing);
        expect(isSolid(stair)).toBe(true);
        expect(blocksWalker(stair)).toBe(true);
      }
    }
    expect(stairOf(Block.Gravel, 0)).toBe(Block.GravelStairS);
    expect(stairOf(Block.Planks, 3)).toBe(Block.PlanksStairW);
    expect(shapeOf(Block.Stone)).toBeNull();
    expect(baseOf(Block.Sand)).toBe(Block.Sand);
    expect(() => slabOf(Block.Sand)).toThrow();
  });

  it('take their colour and flags from what they are cut from', () => {
    expect(BLOCK_PALETTE.flags![Block.PlanksStairN] & FLAG_CUTAWAY).toBe(FLAG_CUTAWAY);
    for (let c = 0; c < 3; c++) expect(BLOCK_PALETTE.colors[Block.StoneSlab * 3 + c]).toBe(BLOCK_PALETTE.colors[Block.Stone * 3 + c]);
  });

  it('stand half a block high, or a whole one on a stair’s upper half', () => {
    expect(topIn(Block.Stone, 0.5, 0.5)).toBe(1);
    expect(topIn(Block.GravelSlab, 0.2, 0.8)).toBe(0.5);
    // Climbing south (+z): the low step on the north half, the top on the south half.
    expect(topIn(Block.StoneStairS, 0.5, 0.25)).toBe(0.5);
    expect(topIn(Block.StoneStairS, 0.5, 0.75)).toBe(1);
    // Every stair climbs the way FACING_DIRS says.
    for (let facing = 0; facing < 4; facing++) {
      const [dx, dz] = FACING_DIRS[facing];
      const stair = stairOf(Block.Planks, facing);
      expect(topIn(stair, 0.5 + dx * 0.25, 0.5 + dz * 0.25)).toBe(1);
      expect(topIn(stair, 0.5 - dx * 0.25, 0.5 - dz * 0.25)).toBe(0.5);
    }
  });

  it('block only their own boxes, not their whole cell', () => {
    const world = new VoxelWorld();
    world.setVoxel(0, SEA_LEVEL, 0, Block.StoneSlab);
    expect(boxBlocked(world, 0.2, SEA_LEVEL + 0.51, 0.2, 0.8, SEA_LEVEL + 1.5, 0.8)).toBe(false);
    expect(boxBlocked(world, 0.2, SEA_LEVEL + 0.4, 0.2, 0.8, SEA_LEVEL + 1.5, 0.8)).toBe(true);
    expect(pointBlocked(world, 0.5, SEA_LEVEL + 0.25, 0.5)).toBe(true);
    expect(pointBlocked(world, 0.5, SEA_LEVEL + 0.75, 0.5)).toBe(false);
    world.setVoxel(2, SEA_LEVEL, 0, Block.Stone);
    expect(pointBlocked(world, 2.5, SEA_LEVEL + 0.75, 0.5)).toBe(true);
  });
});

describe('the blocker', () => {
  it('is solid underfoot and to ships, but never picked, and no part of the ground', () => {
    const world = new VoxelWorld();
    world.setVoxel(0, SEA_LEVEL - 1, 0, Block.Sand);
    world.setVoxel(0, SEA_LEVEL + 2, 0, Block.Blocker);
    expect(isSolid(Block.Blocker)).toBe(true);
    expect(blocksWalker(Block.Blocker)).toBe(true);
    expect(isPickable(Block.Blocker)).toBe(false);
    expect(isPickable(Block.Stone)).toBe(true);
    expect(world.surfaceHeight(0, 0)).toBe(SEA_LEVEL);
    // A ray straight down passes through it to the sand.
    expect(raycastVoxels(world, 0.5, SEA_LEVEL + 5, 0.5, 0, -1, 0, 20)?.y).toBe(SEA_LEVEL - 1);
  });
});
```

- [ ] **Step 2: Run the tests to check they fail**

Run: `npx vitest run src/voxel/shapes.test.ts`
Expected: FAIL, with `./shapes` not found and missing exports from `./blocks`.

- [ ] **Step 3: Add the box type and palette fields** to `src/voxel/palette.ts`. Put `Box` above `VoxelPalette`, and the two new fields at the end of `VoxelPalette`:

```ts
/** A box inside a cell, in cell units (0 to 1 on each axis): part of a block that isn't a whole cube. */
export interface Box {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
}
```

```ts
  /** Per id, the boxes of a block that isn't a whole cube: stairs and slabs (terrain only; null for a cube). */
  shapes?: ReadonlyArray<readonly Box[] | null>;
  /** 1 where a solid id is never drawn and hides nothing: the blocker a prop stands in (terrain only). */
  hidden?: Uint8Array;
```

- [ ] **Step 4: Add the blocks** to `src/voxel/blocks.ts`.

Change the import to `import { type Box, FLAG_CUTAWAY, FLAG_GLOW, srgbToLinear, type VoxelPalette } from './palette';`.

Add to `Block`, after `FlagGold: 59,`:

```ts
  // Stairs and slabs (see the shape table): gravel for streets, stone for steps, planks for floors and porches
  GravelSlab: 60,
  GravelStairS: 61,
  GravelStairE: 62,
  GravelStairN: 63,
  GravelStairW: 64,
  StoneSlab: 65,
  StoneStairS: 66,
  StoneStairE: 67,
  StoneStairN: 68,
  StoneStairW: 69,
  PlanksSlab: 70,
  PlanksStairS: 71,
  PlanksStairE: 72,
  PlanksStairN: 73,
  PlanksStairW: 74,
  // Taken by a prop that mustn't be walked through (the ship on the stocks): solid, never drawn, never picked
  Blocker: 75,
```

Between the end of `DEFS` and `const SOLID`, add:

```ts
/** The way a stair climbs (and a building's `rot`): 0 toward +z (south), 1 +x (east), 2 −z (north), 3 −x (west). */
export const FACING_DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

/** What's cut into stairs and slabs: the material, its slab (its four stairs follow, by facing), and what they're called. */
const CUT: ReadonlyArray<readonly [BlockId, BlockId, string]> = [
  [Block.Gravel, Block.GravelSlab, 'gravel'],
  [Block.Stone, Block.StoneSlab, 'stone'],
  [Block.Planks, Block.PlanksSlab, 'plank'],
];

const SLAB_BOXES: readonly Box[] = [{ x0: 0, y0: 0, z0: 0, x1: 1, y1: 0.5, z1: 1 }];

/** A stair climbing toward `facing`: a low step on the half you come from, the full height on the half you climb to. */
function stairBoxes(facing: number): Box[] {
  const [dx, dz] = FACING_DIRS[facing];
  const low: Box = { x0: 0, y0: 0, z0: 0, x1: 1, y1: 0.5, z1: 1 };
  const high: Box = { x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 };
  if (dx > 0) low.x1 = high.x0 = 0.5;
  else if (dx < 0) low.x0 = high.x1 = 0.5;
  else if (dz > 0) low.z1 = high.z0 = 0.5;
  else low.z0 = high.z1 = 0.5;
  return [low, high];
}

const SHAPES = new Array<readonly Box[] | null>(256).fill(null);
const BASE = Uint8Array.from({ length: 256 }, (_, id) => id);
const FACING = new Int8Array(256).fill(-1);
const SLABS = new Map<BlockId, BlockId>();
for (const [material, slab, name] of CUT) {
  const { color } = DEFS[material];
  SLABS.set(material, slab);
  DEFS[slab] = { name: `${name} slab`, color };
  SHAPES[slab] = SLAB_BOXES;
  BASE[slab] = material;
  for (let facing = 0; facing < 4; facing++) {
    const stair = slab + 1 + facing;
    DEFS[stair] = { name: `${name} stairs`, color };
    SHAPES[stair] = stairBoxes(facing);
    BASE[stair] = material;
    FACING[stair] = facing;
  }
}
DEFS[Block.Blocker] = { name: 'blocker', color: 0x000000 };

/** Solid but never drawn, and hiding nothing: the blocker a prop stands in. */
const HIDDEN = new Uint8Array(256);
HIDDEN[Block.Blocker] = 1;

/** The boxes a stair or slab is made of; null for a whole cube (or air). */
export const shapeOf = (id: BlockId): readonly Box[] | null => SHAPES[id];
/** What a stair or slab is cut from; any other block is its own. */
export const baseOf = (id: BlockId): BlockId => BASE[id];
/** Which way a stair climbs (see FACING_DIRS); -1 for anything else. */
export const stairFacing = (id: BlockId): number => FACING[id];

/** A material's slab. Only gravel, stone and planks are cut into slabs and stairs. */
export function slabOf(material: BlockId): BlockId {
  const slab = SLABS.get(material);
  if (slab === undefined) throw new Error(`slabOf: block ${material} isn't cut into slabs`);
  return slab;
}

/** A material's stair climbing toward `facing` (a quarter turn, as in FACING_DIRS). */
export const stairOf = (material: BlockId, facing: number): BlockId => slabOf(material) + 1 + (((facing % 4) + 4) % 4);
```

After the `isSolid` export, add:

```ts
/** Picked by the mouse and stopped by rays: drawn and solid (not the blocker a prop stands in). */
export const isPickable = (id: BlockId): boolean => SOLID[id] === 1 && HIDDEN[id] === 0;
```

After the glow loop (`for (const id of [Block.Embers, Block.Window, Block.Lantern]) FLAGS[id] |= FLAG_GLOW;`), add:

```ts
// Stairs and slabs are what they're cut from: plank ones lift with the building they're part of.
for (let id = 0; id < 256; id++) if (BASE[id] !== id) FLAGS[id] = FLAGS[BASE[id]];
```

Change the palette to:

```ts
export const BLOCK_PALETTE: VoxelPalette = { colors: BLOCK_COLORS, solid: SOLID, flags: FLAGS, shapes: SHAPES, hidden: HIDDEN };
```

- [ ] **Step 5: Create `src/voxel/shapes.ts`:**

```ts
import { blocksWalker, type BlockId, shapeOf } from './blocks';
import type { VoxelReader } from './raycast';

/**
 * How high a block's solid part stands at a point in its cell (fx, fz from 0 to 1): a
 * whole cube 1, a slab 0.5, a stair 0.5 on its low step and 1 on its top half (the
 * higher, on the line between them).
 */
export function topIn(id: BlockId, fx: number, fz: number): number {
  const boxes = shapeOf(id);
  if (!boxes) return 1;
  let top = 0;
  for (const b of boxes) if (fx >= b.x0 && fx <= b.x1 && fz >= b.z0 && fz <= b.z1) top = Math.max(top, b.y1);
  return top;
}

/**
 * Does anything someone on foot can't walk through fill part of this box (world units,
 * x0 < x1 and so on)? A whole block blocks its whole cell; a stair or slab only its own boxes.
 */
export function boxBlocked(world: VoxelReader, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
  for (let cy = Math.floor(y0); cy <= Math.floor(y1); cy++) {
    for (let cz = Math.floor(z0); cz <= Math.floor(z1); cz++) {
      for (let cx = Math.floor(x0); cx <= Math.floor(x1); cx++) {
        const id = world.getVoxel(cx, cy, cz);
        if (!blocksWalker(id)) continue;
        const boxes = shapeOf(id);
        if (!boxes) return true;
        for (const b of boxes) {
          if (x0 < cx + b.x1 && x1 > cx + b.x0 && y0 < cy + b.y1 && y1 > cy + b.y0 && z0 < cz + b.z1 && z1 > cz + b.z0) return true;
        }
      }
    }
  }
  return false;
}

/** Is this point inside something that stops someone on foot (for a stair or slab, inside one of its boxes)? */
export function pointBlocked(world: VoxelReader, x: number, y: number, z: number): boolean {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const cz = Math.floor(z);
  const id = world.getVoxel(cx, cy, cz);
  if (!blocksWalker(id)) return false;
  const boxes = shapeOf(id);
  if (!boxes) return true;
  const [fx, fy, fz] = [x - cx, y - cy, z - cz];
  return boxes.some((b) => fx >= b.x0 && fx < b.x1 && fy >= b.y0 && fy < b.y1 && fz >= b.z0 && fz < b.z1);
}
```

- [ ] **Step 6: Make `surfaceHeight` skip the blocker** in `src/voxel/VoxelWorld.ts`. Change the doc comment to `/** Height of the first empty cell above the highest solid voxel in a column (0 if the column is empty). The blocker a prop stands in is no part of the ground. */` and replace the line `if (chunk.data[Chunk.index(lx, y & CHUNK_MASK, lz)] !== Block.Air) return y + 1;` with:

```ts
      const id = chunk.data[Chunk.index(lx, y & CHUNK_MASK, lz)];
      if (id !== Block.Air && id !== Block.Blocker) return y + 1;
```

- [ ] **Step 7: Let rays through the blocker** in `src/voxel/raycast.ts`. Import `isPickable` instead of `isSolid`, and change the test in the loop to `if (isPickable(world.getVoxel(x, y, z))) return { x, y, z, nx, ny, nz, distance: t };`. Add a sentence to the function's doc comment: `It stops at what's drawn and solid (rays pass through the blocker a prop stands in).`

- [ ] **Step 8: Run the tests**

Run: `npx vitest run src/voxel/shapes.test.ts`, then `npx vitest run` and `npx tsc --noEmit`.
Expected: all pass, with no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/voxel/palette.ts src/voxel/blocks.ts src/voxel/shapes.ts src/voxel/shapes.test.ts src/voxel/VoxelWorld.ts src/voxel/raycast.ts
git commit -m "Stairs, slabs and the blocker as blocks: shape table and walking geometry"
```

---

### Task 2: The mesher draws stairs and slabs, and never the blocker

**Files:**
- Modify: `src/voxel/mesher.ts` (the `Face` interface, `FACES`, `meshPaddedVolume`)
- Test: `src/voxel/mesher.test.ts`

**Interfaces:**
- Consumes: `Box`, `VoxelPalette.shapes` and `.hidden` (Task 1), and `Block.StoneSlab`, `Block.StoneStairE`, `Block.Blocker`.
- Produces: `meshPaddedVolume`, with the same signature, now drawing shapes. Models' palettes have no `shapes`, so their colour indices are always cubes.

- [ ] **Step 1: Write the failing tests** by appending to `src/voxel/mesher.test.ts`:

```ts
describe('mesher: stairs, slabs and the blocker', () => {
  it('draws a slab as a half-height box', () => {
    const world = new VoxelWorld();
    world.setVoxel(5, 5, 5, Block.StoneSlab);
    const mesh = meshChunk(world, 0, 0, 0)!;
    expect(faceCount(mesh)).toBe(6);
    const ys = [...mesh.positions].filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys)).toBe(5.5);
    expect(Math.min(...ys)).toBe(5);
  });

  it('draws a stair as its two boxes, the top over the half it climbs to', () => {
    const world = new VoxelWorld();
    world.setVoxel(5, 5, 5, Block.StoneStairE);
    const mesh = meshChunk(world, 0, 0, 0)!;
    expect(faceCount(mesh)).toBe(12);
    const topXs: number[] = [];
    for (let v = 0; v < mesh.positions.length / 3; v++) if (mesh.positions[v * 3 + 1] === 6) topXs.push(mesh.positions[v * 3]);
    expect(Math.min(...topXs)).toBe(5.5);
    expect(Math.max(...topXs)).toBe(6);
  });

  it('hides a slab’s faces against whole cubes, but keeps the cubes’ faces against the slab', () => {
    const world = new VoxelWorld();
    world.setVoxel(5, 4, 5, Block.Stone); // under the slab
    world.setVoxel(5, 5, 5, Block.StoneSlab);
    world.setVoxel(6, 5, 5, Block.Stone); // beside it
    // Both stones keep all six faces (the slab hides none); the slab loses its bottom and its +x side.
    expect(faceCount(meshChunk(world, 0, 0, 0))).toBe(16);
  });

  it('culls a slab’s face against a cube in the next chunk, and keeps the cube’s', () => {
    const world = new VoxelWorld();
    world.setVoxel(31, 5, 5, Block.StoneSlab);
    world.setVoxel(32, 5, 5, Block.Stone);
    expect(faceCount(meshChunk(world, 0, 0, 0))).toBe(5);
    expect(faceCount(meshChunk(world, 1, 0, 0))).toBe(6);
  });

  it('never draws the blocker, and hides nothing behind it', () => {
    const world = new VoxelWorld();
    world.setVoxel(5, 5, 5, Block.Stone);
    world.setVoxel(6, 5, 5, Block.Blocker);
    expect(faceCount(meshChunk(world, 0, 0, 0))).toBe(6);
  });

  it('meshes a model’s colour indices as cubes, whatever terrain block shares the number', () => {
    const world = new VoxelWorld();
    world.setVoxel(5, 5, 5, Block.StoneStairE);
    const rgba = new Uint8Array(256 * 4).fill(255);
    const mesh = meshPaddedVolume(buildPaddedVolume(world, 0, 0, 0, undefined, false), 0, 0, 0, paletteFromRgba(rgba))!;
    expect(mesh.indices.length / 6).toBe(6);
  });
});
```

- [ ] **Step 2: Run the tests to check they fail**

Run: `npx vitest run src/voxel/mesher.test.ts`
Expected: the new tests FAIL. A slab is drawn as a whole cube (6 faces, but max y 6), the stair gets 6 faces instead of 12, and the blocker gets drawn.

- [ ] **Step 3: Implement.** In `src/voxel/mesher.ts`:

Change the palette import to `import { type Box, FLAG_CUTAWAY, type VoxelPalette } from './palette';`.

Extend `Face` and fill the new fields in the `FACES` loop:

```ts
interface Face {
  normal: [number, number, number];
  /** The axis the face is square to (0 x, 1 y, 2 z), and the two it lies along. */
  axis: number;
  plane: [number, number];
  /** Padded-index delta to the voxel this face looks into. */
  neighbor: number;
  corners: Corner[];
}
```

The `FACES.push` line becomes `FACES.push({ normal, axis, plane: [u, v], neighbor, corners });`.

After `COLOR_JITTER`, add:

```ts
/** A whole cube as a box: how every block but a stair or slab is drawn. */
const WHOLE: readonly Box[] = [{ x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 }];
const low = (b: Box, axis: number) => (axis === 0 ? b.x0 : axis === 1 ? b.y0 : b.z0);
const high = (b: Box, axis: number) => (axis === 0 ? b.x1 : axis === 1 ? b.y1 : b.z1);

/** The cube face's corner shading, blended to a point on it (a stair's or slab's corner, in cell units). */
function blend(face: Face, shading: readonly number[], at: readonly number[]): number {
  let lit = 0;
  for (let k = 0; k < 4; k++) {
    const corner = face.corners[k];
    const offset = [corner.x, corner.y, corner.z];
    let weight = 1;
    for (const a of face.plane) weight *= offset[a] ? at[a] : 1 - at[a];
    lit += weight * shading[k];
  }
  return lit;
}
```

Replace the body of `meshPaddedVolume` (keep its doc comment, adding the sentence `Stairs and slabs are drawn as their boxes; the blocker a prop stands in isn't drawn at all.`) with:

```ts
  const { colors: rgb, solid, flags, shapes, hidden } = palette;
  /** Drawn and whole: it hides the face of whatever is against it. */
  const whole = (v: number) => solid[v] === 1 && !shapes?.[v] && !hidden?.[v];
  const marks: number[] = [];
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  /** The cube face's brightness at its four corners, and each drawn corner's. */
  const shading = [0, 0, 0, 0];
  const lit = [0, 0, 0, 0];
  const at = [0, 0, 0];

  for (let py = 1; py <= CHUNK_SIZE; py++) {
    for (let pz = 1; pz <= CHUNK_SIZE; pz++) {
      for (let px = 1; px <= CHUNK_SIZE; px++) {
        const i = px + pz * P + py * P2;
        const id = vol[i];
        if (!solid[id] || hidden?.[id]) continue;

        const x = px - 1;
        const y = py - 1;
        const z = pz - 1;
        const shade = 1 + (hash3(originX + x, originY + y, originZ + z) * 2 - 1) * COLOR_JITTER;
        const r = rgb[id * 3] * shade;
        const g = rgb[id * 3 + 1] * shade;
        const b = rgb[id * 3 + 2] * shade;
        const boxes = shapes?.[id] ?? WHOLE;

        for (const face of FACES) {
          const next = vol[i + face.neighbor];
          // Faces against what may be lifted away on foot are kept, hidden till it goes:
          // inside a tree or a building, a top face under more of it; and the ground's
          // face against a tree or a building (a roof's eave against a terrace wall).
          const inner = whole(next);
          const liftable = !!flags && (flags[next] & FLAG_CUTAWAY) !== 0;
          const mine = !!flags && (flags[id] & FLAG_CUTAWAY) !== 0;
          const covered = inner && !(liftable && (!mine || face.normal[1] === 1));
          // An inner face is lit as though what's against it had gone. The blocker casts no shade.
          const blocks = (v: number) => solid[v] === 1 && !hidden?.[v] && !(inner && flags && flags[v] & FLAG_CUTAWAY);
          for (let c = 0; c < 4; c++) {
            const corner = face.corners[c];
            const s1 = +blocks(vol[i + corner.side1]);
            const s2 = +blocks(vol[i + corner.side2]);
            const d = +blocks(vol[i + corner.diagonal]);
            shading[c] = AO_CURVE[s1 && s2 ? 0 : 3 - (s1 + s2 + d)];
          }
          // A cube is one box, a stair or slab two or one. A box's face on the cell's side is
          // covered as a cube's would be; one inside the cell (a stair's riser) always shows.
          for (const box of boxes) {
            const onSide = face.normal[face.axis] > 0 ? high(box, face.axis) === 1 : low(box, face.axis) === 0;
            if (onSide && covered) continue;
            const base = positions.length / 3;
            for (let c = 0; c < 4; c++) {
              const corner = face.corners[c];
              at[0] = corner.x ? box.x1 : box.x0;
              at[1] = corner.y ? box.y1 : box.y0;
              at[2] = corner.z ? box.z1 : box.z0;
              lit[c] = box === WHOLE[0] ? shading[c] : blend(face, shading, at);
              positions.push(x + at[0], y + at[1], z + at[2]);
              normals.push(face.normal[0], face.normal[1], face.normal[2]);
              colors.push(r * lit[c], g * lit[c], b * lit[c]);
              if (flags) marks.push(flags[id]);
            }
            // Split the quad along the diagonal with the brighter ends, so occlusion
            // shades one corner instead of smearing across the whole face.
            if (lit[0] + lit[2] > lit[1] + lit[3]) {
              indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
            } else {
              indices.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
            }
          }
        }
      }
    }
  }

  if (indices.length === 0) return null;
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
    ...(flags ? { flags: new Float32Array(marks) } : {}),
  };
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/voxel/mesher.test.ts`, then `npx vitest run` and `npx tsc --noEmit`.
Expected: all pass. The existing cube tests (face counts, winding, AO, lift faces) are unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/voxel/mesher.ts src/voxel/mesher.test.ts
git commit -m "Mesher: stairs and slabs drawn as their boxes, the blocker never"
```

---

### Task 3: Walking on half-heights

**Files:**
- Modify: `src/land/walker.ts`, `src/land/paths.ts`, `src/land/drops.ts`
- Test: `src/land/walker.test.ts`, `src/land/paths.test.ts`, `src/land/Land.test.ts`

**Interfaces:**
- Consumes: `topIn`, `boxBlocked`, `pointBlocked` (Task 1).
- Produces: `HALF_STEP = 0.5` (exported from `walker.ts`). `collides`, `groundBelow` and `standable` keep their signatures but are now shape-aware. `groundBelow` can return half-block heights.

- [ ] **Step 1: Write the failing tests.** Append to the `describe('stepWalker', …)` block in `src/land/walker.test.ts`:

```ts
  it('walks up a stair a half-step at a time, with no scramble', () => {
    const world = beach();
    // A stair climbing east onto a step a block up.
    for (let z = -20; z < 20; z++) {
      world.setVoxel(3, SEA_LEVEL, z, Block.StoneStairE);
      for (let x = 4; x < 20; x++) world.setVoxel(x, SEA_LEVEL, z, Block.Stone);
    }
    const w = createWalker(0.5, SEA_LEVEL, 0.5);
    let biggest = 0;
    for (let t = 0; t < 2; t += 1 / 60) {
      const before = w.y;
      stepWalker(w, 1, 0, world, 1 / 60);
      biggest = Math.max(biggest, w.y - before);
    }
    expect(w.x).toBeGreaterThan(6);
    expect(w.y).toBe(SEA_LEVEL + 1);
    expect(biggest).toBeLessThanOrEqual(0.5);
  });

  it('climbs a stair walking across it at a slant', () => {
    const world = beach();
    for (let z = -20; z < 20; z++) {
      world.setVoxel(3, SEA_LEVEL, z, Block.StoneStairE);
      for (let x = 4; x < 20; x++) world.setVoxel(x, SEA_LEVEL, z, Block.Stone);
    }
    const w = walk(createWalker(0.5, SEA_LEVEL, -5.5), world, 1, 1, 2);
    expect(w.x).toBeGreaterThan(5);
    expect(w.y).toBe(SEA_LEVEL + 1);
  });

  it('stands on a slab half a block up, and lands on one from above', () => {
    const world = beach();
    for (let x = 3; x < 6; x++) for (let z = -20; z < 20; z++) world.setVoxel(x, SEA_LEVEL, z, Block.PlanksSlab);
    const w = walk(createWalker(0.5, SEA_LEVEL, 0.5), world, 1, 0, 0.9);
    expect(w.x).toBeGreaterThan(3.5);
    expect(w.x).toBeLessThan(5.5);
    expect(w.y).toBe(SEA_LEVEL + 0.5);
    expect(walk(createWalker(4.5, SEA_LEVEL + 3, 0.5), world, 0, 0, 1).y).toBe(SEA_LEVEL + 0.5);
    expect(standable(world, 4.5, 0.5)).toBe(SEA_LEVEL + 0.5);
  });

  it('lands on whichever half of a stair it falls onto', () => {
    const world = beach();
    world.setVoxel(3, SEA_LEVEL, 0, Block.StoneStairE);
    expect(walk(createWalker(3.2, SEA_LEVEL + 3, 0.5), world, 0, 0, 1).y).toBe(SEA_LEVEL + 0.5);
    expect(walk(createWalker(3.8, SEA_LEVEL + 3, 0.5), world, 0, 0, 1).y).toBe(SEA_LEVEL + 1);
  });
```

Append to the `describe('findPath', …)` block in `src/land/paths.test.ts`:

```ts
  it('takes a flight of stairs up onto a terrace too high to scramble', () => {
    const world = beach();
    // A terrace three blocks up from x = 6; along z = 0, a flight of three stairs climbing east.
    for (let z = -20; z < 20; z++) for (let x = 6; x < 20; x++) for (let y = SEA_LEVEL; y < SEA_LEVEL + 3; y++) world.setVoxel(x, y, z, Block.Stone);
    for (let step = 0; step < 3; step++) {
      for (let y = SEA_LEVEL; y < SEA_LEVEL + step; y++) world.setVoxel(3 + step, y, 0, Block.Stone);
      world.setVoxel(3 + step, SEA_LEVEL + step, 0, Block.StoneStairE);
    }
    const path = findPath(world, { x: 0.5, y: SEA_LEVEL, z: 0.5 }, { x: 10, z: 0 })!;
    expect(path).not.toBeNull();
    for (const x of [3.5, 4.5, 5.5]) expect(path.some((p) => p.x === x && p.z === 0.5)).toBe(true);
    expect(path.at(-1)!.y).toBe(SEA_LEVEL + 3);
  });
```

Append to the `describe('things lying about', …)` block in `src/land/Land.test.ts`:

```ts
  it('come to rest on a slab, half a block up', () => {
    const { world, land } = setup();
    for (let x = 2; x <= 9; x++) for (let z = 2; z <= 9; z++) world.setVoxel(x, SEA_LEVEL + 1, z, Block.StoneSlab);
    land.drop('stone', 5.5, SEA_LEVEL + 4, 5.5);
    for (let i = 0; i < 180; i++) land.step(1 / 60);
    expect(land.drops[0].still).toBe(true);
    expect(land.drops[0].y).toBe(SEA_LEVEL + 1.5);
  });
```

- [ ] **Step 2: Run the tests to check they fail**

Run: `npx vitest run src/land/walker.test.ts src/land/paths.test.ts src/land/Land.test.ts`
Expected: the new tests FAIL. Stairs and slabs are whole cells today: the walker jumps a whole block, stands at `SEA_LEVEL + 1` on a slab, and the drop rests at `SEA_LEVEL + 2`.

- [ ] **Step 3: Implement the walker** (`src/land/walker.ts`).

Add the import `import { boxBlocked, topIn } from '../voxel/shapes';`.

After `EPSILON`, add:

```ts
/** Stairs and slabs are half a block: heights on foot come in steps of this. */
export const HALF_STEP = 0.5;

/** The next half-block height above `y`: the tops of blocks, stairs and slabs all fall on these. */
const nextHalf = (y: number) => Math.floor(y * 2 + EPSILON) / 2 + HALF_STEP;
```

In `stepWalker`, replace everything from `w.vy = Math.max(` to the end of the function with:

```ts
  w.vy = Math.max(-MAX_FALL, w.vy - GRAVITY * dt);
  const y = w.y + w.vy * dt;
  if (collides(world, w.x, y, w.z)) {
    if (w.vy < 0) {
      w.y = settle(world, w.x, y, w.z); // onto the top of what we hit: a block, a slab or a stair
      w.onGround = true;
    }
    w.vy = 0;
  } else {
    w.y = y;
    w.onGround = false;
  }
  // Something appeared around us (a block placed, a wall built): climb out, half a block at a time.
  for (let i = 0; i < 8 && collides(world, w.x, w.y, w.z); i++) w.y = nextHalf(w.y);
}

/** Where the walker comes to rest falling into something at `y`: the lowest half-block height above it that's clear. */
function settle(world: VoxelReader, x: number, y: number, z: number): number {
  let h = nextHalf(y);
  for (let i = 0; i < 4 && collides(world, x, h, z); i++) h += HALF_STEP;
  return h;
}
```

In `moveAxis`, replace the climbing block (from the comment `// A step, or a scramble…` to the end of `if (w.onGround) { … }`) with:

```ts
  // A step, or a scramble up a ledge of up to `stepUp`, if there's headroom: tried half a
  // block at a time, so a stair or a slab is climbed as the half-step it is.
  if (w.onGround) {
    for (let up = nextHalf(w.y); up <= w.y + stepUp + EPSILON; up += HALF_STEP) {
      if (collides(world, w.x, up, w.z)) break; // no headroom to climb higher
      if (!collides(world, x, up, z)) {
        w.x = x;
        w.z = z;
        w.y = up;
        return;
      }
    }
  }
```

Replace `collides` and `groundBelow` with:

```ts
/** Does the walker's box at these feet overlap anything they can't walk through (a stair or slab by its own boxes)? */
export function collides(world: VoxelReader, x: number, y: number, z: number): boolean {
  return boxBlocked(world, x - HALF_WIDTH + EPSILON, y + EPSILON, z - HALF_WIDTH + EPSILON, x + HALF_WIDTH - EPSILON, y + HEIGHT - EPSILON, z + HALF_WIDTH - EPSILON);
}

/** Top of the ground under a point, looking down from `fromY` (0 if there's none): half a block up on a slab, or on a stair's low step. */
export function groundBelow(world: VoxelReader, x: number, z: number, fromY: number): number {
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  for (let y = Math.floor(fromY); y >= 0; y--) {
    const id = world.getVoxel(cx, y, cz);
    if (blocksWalker(id)) return y + topIn(id, x - cx, z - cz);
  }
  return 0;
}
```

- [ ] **Step 4: Implement paths** (`src/land/paths.ts`). Import `HALF_STEP` from `./walker`. In `stepTo`, change the climbing loop to `for (let up = y + HALF_STEP; up <= y + STEP_UP; up += HALF_STEP) {` and its doc comment's "scramble up the lowest ledge with room" to "scramble up the lowest ledge with room, half a block at a time". In `findPath`, change the start node's height to `y: Math.round(from.y * 2) / 2`.

- [ ] **Step 5: Implement drops** (`src/land/drops.ts`). Replace the `blocksWalker` import with `import { pointBlocked, topIn } from '../voxel/shapes';`, and replace `solidAt` with:

```ts
/** Is this point inside something solid? Half a slab is air. */
const solidAt = (world: VoxelReader, x: number, y: number, z: number) => pointBlocked(world, x, y, z);
/** The top of what's solid under a point, in its own cell: a whole block's, or a slab's or stair's. */
const topAt = (world: VoxelReader, x: number, y: number, z: number) =>
  Math.floor(y) + topIn(world.getVoxel(Math.floor(x), Math.floor(y), Math.floor(z)), x - Math.floor(x), z - Math.floor(z));
```

In `fall`, change `d.y = Math.floor(d.y + 0.05) + 1;` to `d.y = topAt(world, d.x, d.y + 0.05, d.z);`, and `ny = Math.floor(ny) + 1;` to `ny = topAt(world, d.x, ny, d.z);`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run`, then `npx tsc --noEmit`.
Expected: all pass. That includes the archipelago test, where every place is walkable from the pier; it now goes through the shape-aware `standable` and `collides`.

- [ ] **Step 7: Commit**

```bash
git add src/land/walker.ts src/land/paths.ts src/land/drops.ts src/land/walker.test.ts src/land/paths.test.ts src/land/Land.test.ts
git commit -m "On foot: half-step climbing, landing and ground on stairs and slabs; drops rest on them"
```

---

### Task 4: The towns' streets climb by stairs

**Files:**
- Modify: `src/worldgen/town.ts` (`buildTown`, and a new `laySteps`)
- Test: `src/worldgen/town.test.ts`

**Interfaces:**
- Consumes: `baseOf`, `stairOf`, `stairFacing`, `FACING_DIRS` (Task 1).
- Produces: nothing new. Street cells whose paving rises a block from exactly one paved neighbour hold a gravel stair.

- [ ] **Step 1: Write the failing test and update the paving test** in `src/worldgen/town.test.ts`. Add `baseOf`, `FACING_DIRS`, `stairFacing` and `stairOf` to the `../voxel/blocks` import. In the test `'pave a flat square at the foot of the pier, and streets that never step more than a block'`, change `expect(world.getVoxel(x, h - 1, z), …).toBe(Block.Gravel);` to `expect(baseOf(world.getVoxel(x, h - 1, z)), `${name} paving at ${x},${z}`).toBe(Block.Gravel);`. Then add:

```ts
  it('climb the streets by stairs, wherever the paving rises a block from one neighbour', () => {
    let stairs = 0;
    for (const { name, world, harbour } of PORTS) {
      const { square, streets, well, props } = harbour.town;
      const paved = (x: number, z: number) => [square, ...streets].some((s) => inside(s, x, z)) && ![well, ...props].some((p) => inside(p, x, z));
      for (const street of [square, ...streets]) {
        for (const [x, z] of cells(street).filter(([x, z]) => paved(x, z))) {
          const h = groundHeight(world, x, z);
          // The ways this cell climbs from: paved neighbours a block below it.
          const from = FACING_DIRS.filter(([dx, dz]) => paved(x - dx, z - dz) && groundHeight(world, x - dx, z - dz) === h - 1);
          const id = world.getVoxel(x, h - 1, z);
          const label = `${name} at ${x},${z}`;
          if (from.length !== 1) {
            expect(stairFacing(id), label).toBe(-1);
            continue;
          }
          expect(id, label).toBe(stairOf(Block.Gravel, FACING_DIRS.indexOf(from[0])));
          stairs++;
        }
      }
    }
    expect(stairs).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run the test to check it fails**

Run: `npx vitest run src/worldgen/town.test.ts`
Expected: the new test FAILS, because there are no stairs yet.

- [ ] **Step 3: Implement.** In `src/worldgen/town.ts`, extend the blocks import to `import { baseOf, Block, type BlockId, FACING_DIRS, stairOf } from '../voxel/blocks';`. In `buildTown`, right after `retainingWalls(world, f, levelled);`, add:

```ts
  // Where a street climbs a block from one cell to the next, it climbs by a stair.
  const paved = new Set<string>();
  for (const r of [square, ...roads]) for (const [u, v] of cells(r)) paved.add(`${u},${v}`);
  laySteps(world, f, paved, levelled);
```

Add after `retainingWalls`'s definition:

```ts
/** The four ways across the grid, in town coordinates. */
const ACROSS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Paves the streets' climbs with stairs: where a paved cell stands a block above exactly
 * one of its paved neighbours (never at a corner or a crossing, where it's above two),
 * its paving becomes a stair climbing away from that neighbour. A run of rises (the ramp
 * up from the pier) becomes a flight of half-steps.
 */
function laySteps(world: VoxelWorld, f: Frame, paved: ReadonlySet<string>, levelled: ReadonlyMap<string, number>): void {
  for (const k of paved) {
    const h = levelled.get(k);
    if (h === undefined) continue;
    const [u, v] = k.split(',').map(Number);
    const below = ACROSS.filter(([du, dv]) => paved.has(`${u + du},${v + dv}`) && levelled.get(`${u + du},${v + dv}`) === h - 1);
    if (below.length !== 1) continue;
    const [du, dv] = below[0];
    const here = at(f, u, v);
    const up = at(f, u - du, v - dv);
    const facing = FACING_DIRS.findIndex(([dx, dz]) => dx === up.x - here.x && dz === up.z - here.z);
    if (baseOf(world.getVoxel(here.x, h - 1, here.z)) === Block.Gravel) world.setVoxel(here.x, h - 1, here.z, stairOf(Block.Gravel, facing));
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/worldgen src/land`, then `npx vitest run` and `npx tsc --noEmit`.
Expected: all pass, including the archipelago test (every place walkable from the pier).

- [ ] **Step 5: Commit**

```bash
git add src/worldgen/town.ts src/worldgen/town.test.ts
git commit -m "Towns: the streets climb by stairs"
```

---

### Task 5: Building stairs and slabs in camps

**Files:**
- Modify: `src/land/structures.ts`, `src/land/Land.ts` (`placement`), `src/Shore.ts` (the placing label and ghost), `src/ui/BuildMenu.tsx` (the hint)
- Test: `src/land/Land.test.ts`

**Interfaces:**
- Consumes: `slabOf`, `stairOf`, `shapeOf`, `blocksWalker` (Task 1).
- Produces: `Structure` gains `'plankStairs' | 'plankSlab' | 'stoneStairs' | 'stoneSlab'`, and a new export `PIECES: Partial<Record<Structure, { material: BlockId; stair: boolean }>>`.

- [ ] **Step 1: Write the failing tests.** Append to `describe('building', …)` in `src/land/Land.test.ts`:

```ts
  it('lays stairs and slabs, stairs climbing the way they’re turned, and takes them up again', () => {
    const { world, land } = setup();
    land.goAshore();
    land.pack.timber = 8;
    land.pack.stone = 2;
    land.build('campfire', 0, -6, 0);
    expect(land.build('plankStairs', 4, 4, 2).ok).toBe(true); // turned twice: climbs north
    expect(land.build('stoneSlab', 6, 4, 0).ok).toBe(true);
    expect(world.getVoxel(4, SEA_LEVEL + 1, 4)).toBe(Block.PlanksStairN);
    expect(world.getVoxel(6, SEA_LEVEL + 1, 4)).toBe(Block.StoneSlab);
    expect(land.pack.timber).toBe(2);
    expect(land.pack.stone).toBe(1);
    walkTo(land, 6.5, 3);
    expect(land.use('pickaxe').ok).toBe(true);
    expect(world.getVoxel(6, SEA_LEVEL + 1, 4)).toBe(Block.Air);
    expect(land.pack.stone).toBe(2);
  });

  it('stands stairs and slabs on solid ground, not on another stair or slab', () => {
    const { world, land } = setup();
    land.goAshore();
    land.pack.timber = 8;
    land.build('campfire', 0, -6, 0);
    world.setVoxel(4, SEA_LEVEL + 1, 4, Block.StoneSlab);
    const onSlab = land.build('plankStairs', 4, 4, 0);
    expect(onSlab.ok).toBe(false);
    expect(onSlab.message).toBe('Stairs and slabs go on solid ground.');
    world.setVoxel(6, SEA_LEVEL + 1, 4, Block.Stone);
    expect(land.build('plankStairs', 6, 4, 0).ok).toBe(true); // a flight can be built up a whole block
    expect(world.getVoxel(6, SEA_LEVEL + 2, 4)).toBe(Block.PlanksStairS);
  });
```

- [ ] **Step 2: Run the tests to check they fail**

Run: `npx vitest run src/land/Land.test.ts`
Expected: FAIL with a type error, or `STRUCTURES[kind]` undefined for `'plankStairs'`.

- [ ] **Step 3: Implement the pieces** (`src/land/structures.ts`).

Import `slabOf` and `stairOf` from `../voxel/blocks`. Add `| 'plankStairs' | 'plankSlab' | 'stoneStairs' | 'stoneSlab'` to `Structure`, and append the same four names to `STRUCTURE_LIST`.

Add to `STRUCTURES`:

```ts
  plankStairs: { label: 'Plank stairs', detail: 'Half a block a step. Turn them (Q / R) to climb the way you want.', cost: { timber: 1 }, w: 1, d: 1, freeform: true, height: 1, pad: 0 },
  plankSlab: { label: 'Plank slab', detail: 'Half a block high: a step, a landing or a porch floor.', cost: { timber: 1 }, w: 1, d: 1, freeform: true, height: 1, pad: 0 },
  stoneStairs: { label: 'Stone stairs', detail: 'Half a block a step, in stone. Turn them (Q / R) to climb the way you want.', cost: { stone: 1 }, w: 1, d: 1, freeform: true, height: 1, pad: 0 },
  stoneSlab: { label: 'Stone slab', detail: 'Half a block high, in stone.', cost: { stone: 1 }, w: 1, d: 1, freeform: true, height: 1, pad: 0 },
```

After `STRUCTURES`, add:

```ts
/** Stairs and slabs: what each is cut from, and whether it's a stair (which turns, to climb the way it faces). */
export const PIECES: Partial<Record<Structure, { material: BlockId; stair: boolean }>> = {
  plankStairs: { material: Block.Planks, stair: true },
  plankSlab: { material: Block.Planks, stair: false },
  stoneStairs: { material: Block.Stone, stair: true },
  stoneSlab: { material: Block.Stone, stair: false },
};
```

In `raise`, before `case 'fence':`, add:

```ts
    case 'plankStairs':
    case 'plankSlab':
    case 'stoneStairs':
    case 'stoneSlab': {
      const piece = PIECES[b.kind]!;
      world.setVoxel(x0, y, z0, piece.stair ? stairOf(piece.material, b.rot) : slabOf(piece.material));
      break;
    }
```

(`raze`'s default case already clears the piece, and `demolish` refunds free-form pieces in full.)

- [ ] **Step 4: Implement placement** (`src/land/Land.ts`). Import `PIECES` from `./structures` and `shapeOf` from `../voxel/blocks`. In `placement`'s `if (spec.freeform) {` branch, right after the `'Too wet.'` line, add:

```ts
      if (PIECES[kind] && (shapeOf(ground) !== null || !blocksWalker(ground))) return verdict(false, 'Stairs and slabs go on solid ground.', y);
```

- [ ] **Step 5: Turning, the ghost and the hint.** In `src/Shore.ts`, import `PIECES` with `STRUCTURES`, and add a module constant:

```ts
/** Which way a stair climbs, by its turn (as FACING_DIRS: north is −z). */
const COMPASS = ['south', 'east', 'north', 'west'];
```

In the `if (this.placing) {` block of the label code, replace the `const height = …` line and the `placing = …` line with:

```ts
      const piece = PIECES[this.placing.kind];
      const height = this.placing.kind === 'path' ? 0.15 : piece && !piece.stair ? 0.5 : spec.freeform ? 1 : 4;
```

```ts
      const turns = !spec.freeform || piece?.stair === true;
      const climbs = piece?.stair ? ` · climbs ${COMPASS[this.placing.rot % 4]}` : '';
      placing = `${spec.label} (${cost})${climbs} · Space / click to build${turns ? ' · Q R turn' : ''} · Esc done`;
```

In `src/ui/BuildMenu.tsx`, change the hint to:

```tsx
          Buildings sit on the grid (turn them with Q / R or LB / RB); fences, paths, torches, stairs and slabs go down one at a time until you
          press Esc, and stairs turn too, to climb the way you want. Take any of those up with the axe or pickaxe; farm plots are tilled with the
          hoe anywhere in your camp. Workshops need a settler to work them: give one the job at the campfire.
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run`, then `npx tsc --noEmit`.
Expected: all pass.

- [ ] **Step 7: Check it in the game.** Run `npx vite --port 5199 --strictPort` and open `http://127.0.0.1:5199/?new`. Skip the intro. Follow the camp recipe in `docs/ARCHITECTURE.md` (move the ship to (92, 367), then `game.land.goAshore()` and `game.toFoot('')`), and give yourself timber with `game.sea.player.cargo.timber = 20`. Build a campfire, then plank stairs. Check that:
- the label reads "climbs south" and turns with Q / R;
- the stair is drawn facing that way;
- the captain walks up it in half-steps.

Put screenshots in `.playwright-mcp/`.

- [ ] **Step 8: Commit**

```bash
git add src/land/structures.ts src/land/Land.ts src/Shore.ts src/ui/BuildMenu.tsx src/land/Land.test.ts
git commit -m "Build plank and stone stairs and slabs in camps"
```

---

### Task 6: A lift test shared by everything that lifts

**Files:**
- Create: `src/render/lifts.ts`
- Modify: `src/render/ChunkRenderer.ts`
- Test: `src/render/lifts.test.ts`

**Interfaces:**
- Consumes: `Lift`, `MAX_LIFTS` from `src/render/RoofLifter.ts`.
- Produces:
  - `class Lifts { readonly uniforms: { uLiftBox: { value: Vector4[] }; uLiftFrom: { value: number[] } }; set(lifts: ReadonlyArray<Lift>): void; holds(x: number, y: number, z: number): boolean }`
  - `LIFT_GLSL: string`, which declares both uniforms and `bool lifted(vec3 cell)`.
  - `ChunkRenderer.lifts: Lifts` (public, read-only). `setLifts` and `hides` keep their signatures.

- [ ] **Step 1: Write the failing test** in `src/render/lifts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Lifts } from './lifts';
import { MAX_LIFTS } from './RoofLifter';

describe('lifts', () => {
  it('hold the voxels in a lifted box above its height, and nothing else', () => {
    const lifts = new Lifts();
    expect(lifts.holds(5, 20, 5)).toBe(false);
    lifts.set([{ x0: 0, z0: 0, x1: 10, z1: 10, from: 14.5 }]);
    expect(lifts.holds(5, 15, 5)).toBe(true);
    expect(lifts.holds(5, 14, 5)).toBe(false); // below the cut
    expect(lifts.holds(10, 15, 5)).toBe(false); // x1 is outside
    expect(lifts.uniforms.uLiftBox.value[0].toArray()).toEqual([0, 0, 10, 10]);
    lifts.set([]);
    expect(lifts.holds(5, 15, 5)).toBe(false);
  });

  it('keep no more boxes than the shader has room for', () => {
    const lifts = new Lifts();
    lifts.set(Array.from({ length: MAX_LIFTS + 3 }, (_, k) => ({ x0: k * 10, z0: 0, x1: k * 10 + 5, z1: 5, from: 0 })));
    expect(lifts.uniforms.uLiftFrom.value).toHaveLength(MAX_LIFTS);
    expect(lifts.holds(MAX_LIFTS * 10 + 1, 1, 1)).toBe(false);
    expect(lifts.holds(1, 1, 1)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to check it fails**

Run: `npx vitest run src/render/lifts.test.ts`
Expected: FAIL, because `./lifts` doesn't exist yet.

- [ ] **Step 3: Create `src/render/lifts.ts`:**

```ts
import { Vector4 } from 'three';
import { type Lift, MAX_LIFTS } from './RoofLifter';

/** A lift not in use sits under a height nothing reaches. */
const NEVER = 1e6;

/** GLSL: the lifted boxes, and whether a voxel (by its centre) is lifted away. */
export const LIFT_GLSL = /* glsl */ `
uniform vec4 uLiftBox[${MAX_LIFTS}];
uniform float uLiftFrom[${MAX_LIFTS}];
bool lifted(vec3 cell) {
  for (int k = 0; k < ${MAX_LIFTS}; k++) {
    vec4 b = uLiftBox[k];
    if (cell.y > uLiftFrom[k] && cell.x > b.x && cell.x < b.z && cell.z > b.y && cell.z < b.w) return true;
  }
  return false;
}`;

/**
 * What's lifted away on foot, as shader uniforms shared by everything drawn that lifts:
 * the terrain, and props hung on buildings. Up to MAX_LIFTS boxes (x0, z0, x1, z1 on the
 * grid, x1 and z1 not included), each lifted above its own height.
 */
export class Lifts {
  readonly uniforms = {
    uLiftBox: { value: Array.from({ length: MAX_LIFTS }, () => new Vector4()) },
    uLiftFrom: { value: new Array<number>(MAX_LIFTS).fill(NEVER) },
  };

  set(lifts: ReadonlyArray<Lift>): void {
    for (let k = 0; k < MAX_LIFTS; k++) {
      const l = lifts[k];
      this.uniforms.uLiftBox.value[k].set(l?.x0 ?? 0, l?.z0 ?? 0, l?.x1 ?? 0, l?.z1 ?? 0);
      this.uniforms.uLiftFrom.value[k] = l ? l.from : NEVER;
    }
  }

  /** Is the voxel at (x, y, z) lifted away? The shader's test, at the voxel's centre. */
  holds(x: number, y: number, z: number): boolean {
    const boxes = this.uniforms.uLiftBox.value;
    for (let k = 0; k < MAX_LIFTS; k++) {
      const b = boxes[k];
      if (y + 0.5 > this.uniforms.uLiftFrom.value[k] && x + 0.5 > b.x && x + 0.5 < b.z && z + 0.5 > b.y && z + 0.5 < b.w) return true;
    }
    return false;
  }
}
```

- [ ] **Step 4: Use it in `ChunkRenderer`** (`src/render/ChunkRenderer.ts`):
- Remove the `MAX_LIFTS` import, the `LIFTS` and `NEVER` constants, and the `liftBoxes` and `liftFrom` fields and their doc comment.
- Add `import { LIFT_GLSL, Lifts } from './lifts';` and a field `/** What's lifted away on foot: shared with the props hung on buildings. */ readonly lifts = new Lifts();`.
- In `onBeforeCompile`, replace the two lines `shader.uniforms.uLiftBox = …` and `shader.uniforms.uLiftFrom = …` with `Object.assign(shader.uniforms, this.lifts.uniforms);`.
- In the fragment `#include <common>` replacement, replace the two lines `uniform vec4 uLiftBox[${LIFTS}];` and `uniform float uLiftFrom[${LIFTS}];` with `${LIFT_GLSL}`.
- In the `#include <clipping_planes_fragment>` replacement, keep the comment and replace the `if (vCutaway > 0.5) { … }` block with `if (vCutaway > 0.5 && lifted(floor(vCutWorld - vFace * 0.5) + 0.5)) discard;`.
- `setLifts` becomes `this.lifts.set(lifts);`.
- `hides` becomes `return ((BLOCK_PALETTE.flags?.[id] ?? 0) & FLAG_CUTAWAY) !== 0 && this.lifts.holds(x, y, z);`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run`, then `npx tsc --noEmit`.
Expected: all pass.

- [ ] **Step 6: Check it in the game.** Go ashore in Haven (`game.land.goAshore()` from the berth, then `game.toFoot('')`). Walk behind a house and check its roof still lifts, and that the browser console shows no shader errors.

- [ ] **Step 7: Commit**

```bash
git add src/render/lifts.ts src/render/lifts.test.ts src/render/ChunkRenderer.ts
git commit -m "Lifts: the roof lifter's shader test and uniforms, shared"
```

---

### Task 7: Prop models

**Files:**
- Create: `src/props/types.ts`, `src/props/sketch.ts`, `src/props/models.ts`, `src/props/catalog.ts`
- Test: `src/props/models.test.ts`

**Interfaces:**
- Consumes: `paletteFromRgba`, `srgbToLinear`, `FLAG_GLOW` (`voxel/palette`); `ShipModel` (`sailing/shipModel`); `VoxFile`, `instanceVoxels`, `mvToGame` (`vox/parseVox`).
- Produces:
  - `types.ts`:
    - `type PropKind = 'lantern' | 'wallLantern' | 'signTavern' | 'signOffice' | 'signpostMarket' | 'signpostShipyard' | 'clock' | 'porchPost' | 'porchRail' | 'hullOnStocks'`
    - `PROP_KINDS: readonly PropKind[]`
    - `interface Point { x; y; z: number }`
    - `interface PropPlacement { kind: PropKind; x: number; y: number; z: number; facing: number; anchor: Point | null }`
    - `interface PropModel { cells: Int32Array; palette: VoxelPalette; origin: Point; scale: number; reserve?: boolean }`
  - `sketch.ts`: `class Sketch` with `paint(name, hex, glow?)`, `put(x, y, z, name)`, `box(x0, y0, z0, x1, y1, z1, name)`, `rows(x0, y0, z, rows, key)`, `rowsZ(z0, y0, x, rows, key)`, `model(origin, scale?)`. Every method except `model` returns `this`.
  - `models.ts`: `lantern()`, `wallLantern()`, `signboard(place: 'tavern' | 'office')`, `signpost(place: 'market' | 'shipyard')`, `clock()`, `porchPost()`, `porchRail()`. Each returns a `PropModel`.
  - `catalog.ts`: `propCatalog(sloop: ShipModel): Record<PropKind, PropModel>`, `hullOnStocks(sloop: ShipModel): PropModel`, `propFromVox(file: VoxFile, scale?: number): PropModel`.

- [ ] **Step 1: Write the failing tests** in `src/props/models.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildShipModel, type ShipModel } from '../sailing/shipModel';
import { SLOOP } from '../sailing/ships';
import { FLAG_GLOW } from '../voxel/palette';
import { parseVox, type VoxFile } from '../vox/parseVox';
import { hullOnStocks, propCatalog, propFromVox } from './catalog';
import { clock, lantern, signboard } from './models';
import { PROP_KINDS, type PropModel } from './types';

function loadSloop(): ShipModel {
  const bytes = readFileSync(`public/${SLOOP.model}`);
  return buildShipModel(parseVox(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), SLOOP.draft);
}

function bounds(m: PropModel) {
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i < m.cells.length; i += 4) {
    b.minX = Math.min(b.minX, m.cells[i]);
    b.maxX = Math.max(b.maxX, m.cells[i]);
    b.minY = Math.min(b.minY, m.cells[i + 1]);
    b.maxY = Math.max(b.maxY, m.cells[i + 1]);
    b.minZ = Math.min(b.minZ, m.cells[i + 2]);
    b.maxZ = Math.max(b.maxZ, m.cells[i + 2]);
  }
  return b;
}

describe('prop models', () => {
  it('build every kind, each voxel in a colour of its own palette', () => {
    const catalog = propCatalog(loadSloop());
    for (const kind of PROP_KINDS) {
      const model = catalog[kind];
      expect(model.cells.length, kind).toBeGreaterThan(0);
      for (let i = 3; i < model.cells.length; i += 4) expect(model.palette.solid[model.cells[i]], kind).toBe(1);
      expect(model.palette.flags, kind).toBeDefined();
    }
  });

  it('are a quarter of a block a voxel; lanterns an eighth, and the ship a block', () => {
    const catalog = propCatalog(loadSloop());
    expect(catalog.signTavern.scale).toBe(0.25);
    expect(catalog.clock.scale).toBe(0.25);
    expect(catalog.lantern.scale).toBe(0.125);
    expect(catalog.wallLantern.scale).toBe(0.125);
    expect(catalog.hullOnStocks.scale).toBe(1);
  });

  it('light the lantern glass after dark, and nothing else', () => {
    const { cells, palette } = lantern();
    const glowing = new Set<number>();
    for (let i = 3; i < cells.length; i += 4) if (palette.flags![cells[i]] & FLAG_GLOW) glowing.add(cells[i]);
    expect(glowing.size).toBe(1);
    expect([...clock().palette.flags!].some((f) => (f & FLAG_GLOW) !== 0)).toBe(false);
  });

  it('stand a lantern on the middle of its foot', () => {
    const m = lantern();
    const b = bounds(m);
    expect((b.minX + b.maxX + 1) / 2).toBe(m.origin.x);
    expect((b.minZ + b.maxZ + 1) / 2).toBe(m.origin.z);
    expect(b.minY).toBe(m.origin.y);
  });

  it('hang signs and the clock out from the wall, not into it', () => {
    for (const m of [signboard('tavern'), clock()]) expect(bounds(m).minZ).toBeGreaterThanOrEqual(m.origin.z);
  });

  it('set the sloop on the stocks from her stern, on her keel, without sails or flag', () => {
    const sloop = loadSloop();
    const hull = hullOnStocks(sloop);
    expect(hull.reserve).toBe(true);
    expect(hull.cells).toBe(sloop.hull.cells);
    const b = bounds(hull);
    expect(hull.origin.z).toBe(b.minZ);
    expect(hull.origin.y).toBe(b.minY);
    expect(hull.origin.x).toBe((b.minX + b.maxX + 1) / 2);
  });

  it('make a prop of a MagicaVoxel file, standing on the middle of its foot', () => {
    const file: VoxFile = {
      models: [{ sizeX: 2, sizeY: 2, sizeZ: 3, voxels: Uint8Array.of(0, 0, 0, 5, 1, 1, 2, 5) }],
      instances: [{ name: '', model: 0, rotation: Int8Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1), translation: [0, 0, 0] }],
      palette: new Uint8Array(256 * 4).fill(200),
    };
    const m = propFromVox(file);
    expect(m.cells.length).toBe(8);
    expect(m.scale).toBe(0.25);
    const b = bounds(m);
    expect(m.origin.y).toBe(b.minY);
    expect(m.origin.x).toBe((b.minX + b.maxX + 1) / 2);
  });
});
```

- [ ] **Step 2: Run the tests to check they fail**

Run: `npx vitest run src/props/models.test.ts`
Expected: FAIL, because the modules don't exist yet.

- [ ] **Step 3: Create `src/props/types.ts`:**

```ts
import type { VoxelPalette } from '../voxel/palette';

/** Every kind of prop the towns use. */
export type PropKind =
  | 'lantern'
  | 'wallLantern'
  | 'signTavern'
  | 'signOffice'
  | 'signpostMarket'
  | 'signpostShipyard'
  | 'clock'
  | 'porchPost'
  | 'porchRail'
  | 'hullOnStocks';

export const PROP_KINDS: readonly PropKind[] = ['lantern', 'wallLantern', 'signTavern', 'signOffice', 'signpostMarket', 'signpostShipyard', 'clock', 'porchPost', 'porchRail', 'hullOnStocks'];

export interface Point {
  x: number;
  y: number;
  z: number;
}

/** A prop set in the world by the town builder. Not saved: it comes from the seed, with the town. */
export interface PropPlacement {
  kind: PropKind;
  /** Where the model's origin goes, in world units. */
  x: number;
  y: number;
  z: number;
  /** A quarter turn, as FACING_DIRS: the way the model's +z (out from a wall, or its front) faces. */
  facing: number;
  /** The block it hangs on: while that's lifted away on foot, so is the prop. Null for one that never lifts. */
  anchor: Point | null;
}

/**
 * A small voxel model for decoration. `cells` are (x, y, z, colour index) quads in the
 * model's own voxels, and `origin` (in voxels) is the point that goes where it's placed:
 * the middle of its foot for one that stands, the middle of its back at its foot for one on
 * a wall. It's drawn `scale` world units a voxel.
 */
export interface PropModel {
  cells: Int32Array;
  palette: VoxelPalette;
  origin: Point;
  scale: number;
  /** Keep people out of the cells it fills (Block.Blocker): only for a prop drawn a block a voxel. */
  reserve?: boolean;
}
```

- [ ] **Step 4: Create `src/props/sketch.ts`:**

```ts
import { FLAG_GLOW, srgbToLinear } from '../voxel/palette';
import type { Point, PropModel } from './types';

/** Draws a prop voxel by voxel in named colours, then hands it over as a model. */
export class Sketch {
  private readonly cells: number[] = [];
  private readonly hex: number[] = [];
  private readonly glowing: boolean[] = [];
  private readonly names = new Map<string, number>();

  /** A colour to draw in (sRGB hex, as a paint program shows it). `glow` lights it after dark: lantern glass. */
  paint(name: string, hex: number, glow = false): this {
    this.hex.push(hex);
    this.glowing.push(glow);
    this.names.set(name, this.hex.length);
    return this;
  }

  put(x: number, y: number, z: number, name: string): this {
    const index = this.names.get(name);
    if (index === undefined) throw new Error(`Sketch: no colour called ${name}`);
    this.cells.push(x, y, z, index);
    return this;
  }

  /** Fills a box, both corners included. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, name: string): this {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) this.put(x, y, z, name);
    return this;
  }

  /**
   * Lays rows of characters in the x–y plane at depth z: the top row first, the bottom one
   * at y0, from x0 across. Each character names a colour in `key`; '.' leaves the voxel empty.
   */
  rows(x0: number, y0: number, z: number, rows: readonly string[], key: Readonly<Record<string, string>>): this {
    rows.forEach((row, r) => [...row].forEach((ch, c) => ch !== '.' && this.put(x0 + c, y0 + rows.length - 1 - r, z, key[ch])));
    return this;
  }

  /** The same in the z–y plane at x: a board seen edge-on from the wall it hangs from. */
  rowsZ(z0: number, y0: number, x: number, rows: readonly string[], key: Readonly<Record<string, string>>): this {
    rows.forEach((row, r) => [...row].forEach((ch, c) => ch !== '.' && this.put(x, y0 + rows.length - 1 - r, z0 + c, key[ch])));
    return this;
  }

  /** The finished model: `origin` (in voxels) is the point that goes where the prop is placed. */
  model(origin: Point, scale = 0.25): PropModel {
    const colors = new Float32Array(256 * 3);
    const solid = new Uint8Array(256);
    const flags = new Uint8Array(256);
    this.hex.forEach((hex, i) => {
      const id = i + 1;
      solid[id] = 1;
      colors[id * 3] = srgbToLinear(((hex >> 16) & 0xff) / 255);
      colors[id * 3 + 1] = srgbToLinear(((hex >> 8) & 0xff) / 255);
      colors[id * 3 + 2] = srgbToLinear((hex & 0xff) / 255);
      if (this.glowing[i]) flags[id] = FLAG_GLOW;
    });
    return { cells: Int32Array.from(this.cells), palette: { colors, solid, flags }, origin, scale };
  }
}
```

- [ ] **Step 5: Create `src/props/models.ts`:**

```ts
import { Sketch } from './sketch';
import type { PropModel } from './types';

const IRON = 0x2f3237;
const GLASS = 0xffd27a;
const TIMBER = 0x6b4a2b;
const FRAME = 0x4a3320;
const WHITE = 0xf2eee2;
const GOLD = 0xe0b83a;

/** A lantern cage: iron base, glowing glass with iron corner bars, an iron roof. Four voxels across, from (x0, y0, z0). */
function cage(s: Sketch, x0: number, y0: number, z0: number): void {
  s.box(x0, y0, z0, x0 + 3, y0, z0 + 3, 'iron');
  s.box(x0, y0 + 1, z0, x0 + 3, y0 + 3, z0 + 3, 'glass');
  for (const x of [x0, x0 + 3]) for (const z of [z0, z0 + 3]) s.box(x, y0 + 1, z, x, y0 + 3, z, 'iron');
  s.box(x0, y0 + 4, z0, x0 + 3, y0 + 4, z0 + 3, 'iron');
  s.box(x0 + 1, y0 + 5, z0 + 1, x0 + 2, y0 + 5, z0 + 2, 'iron');
}

/** A lantern on top of a post: half a block across, an eighth of a block a voxel. */
export function lantern(): PropModel {
  const s = new Sketch().paint('iron', IRON).paint('glass', GLASS, true);
  cage(s, -2, 0, -2);
  return s.model({ x: 0, y: 0, z: 0 }, 0.125);
}

/** A lantern hung from an iron bracket on a wall, beside a door. */
export function wallLantern(): PropModel {
  const s = new Sketch().paint('iron', IRON).paint('glass', GLASS, true);
  s.box(-1, 7, 0, 0, 7, 5, 'iron'); // the bracket, out from the wall
  s.box(-1, 6, 3, 0, 6, 4, 'iron'); // the hanger
  cage(s, -2, 0, 2);
  return s.model({ x: 0, y: 0, z: 0 }, 0.125);
}

type Place = 'tavern' | 'office' | 'market' | 'shipyard';

/** Each place's board: its colour, and its device in rows (top first) of I iron, W white, B brown, G gold, Y dark gold. */
const DEVICES: Record<Place, { field: number; rows: readonly string[] }> = {
  tavern: { field: 0x2f5d3a, rows: ['WWW..', 'BBBB.', 'BBB.B', 'BBBB.'] }, // a tankard of ale
  office: { field: 0x2b3f6b, rows: ['.GGG.', 'GGYGG', 'GGYGG', '.GGG.'] }, // a seal
  market: { field: 0x8c3a2c, rows: ['..I..', 'IIIII', 'G.I.G', 'GGIGG'] }, // scales
  shipyard: { field: 0x46607a, rows: ['..I..', '.III.', 'I.I.I', '.III.'] }, // an anchor
};

function signPaints(place: Place): Sketch {
  return new Sketch()
    .paint('frame', FRAME)
    .paint('field', DEVICES[place].field)
    .paint('iron', IRON)
    .paint('white', WHITE)
    .paint('brown', 0x8a5a2b)
    .paint('gold', GOLD)
    .paint('darkGold', 0xb8912a);
}

/** A board 7 long and 6 tall in the z–y plane at x = 0, out from z0 and down from `top`: a frame, the field, the device. */
function board(s: Sketch, z0: number, top: number, place: Place): void {
  for (let z = z0; z < z0 + 7; z++) {
    for (let y = top - 5; y <= top; y++) s.put(0, y, z, z === z0 || z === z0 + 6 || y === top - 5 || y === top ? 'frame' : 'field');
  }
  s.rowsZ(z0 + 1, top - 4, 0, DEVICES[place].rows, { I: 'iron', W: 'white', B: 'brown', G: 'gold', Y: 'darkGold' });
}

/** A signboard hung on a bracket out from the wall by a door, with the place's device. */
export function signboard(place: 'tavern' | 'office'): PropModel {
  const s = signPaints(place);
  s.box(0, 3, 0, 0, 3, 7, 'iron'); // the bracket
  s.put(0, 2, 1, 'iron').put(0, 2, 7, 'iron'); // its hooks
  board(s, 1, 1, place);
  return s.model({ x: 0.5, y: 0, z: 0 }, 0.25);
}

/** A post by a way in with the place's board hung from an arm: for the market's open hall and the shipyard's shed. */
export function signpost(place: 'market' | 'shipyard'): PropModel {
  const s = signPaints(place);
  s.box(0, 0, -1, 1, 10, 0, 'frame'); // the post
  s.box(0, 10, 1, 0, 10, 8, 'iron'); // the arm
  s.put(0, 9, 2, 'iron').put(0, 9, 8, 'iron');
  board(s, 2, 8, place);
  return s.model({ x: 1, y: 0, z: 0 }, 0.25);
}

/** A clock on the front of the Governor's House: a gold rim round a white face, and its hands. Two blocks across. */
export function clock(): PropModel {
  const s = new Sketch().paint('rim', GOLD).paint('face', WHITE).paint('hand', 0x1c1c22);
  s.rows(-4, 0, 0, ['..RRRR..', '.RFFFFR.', 'RFFHFFFR', 'RFFHFFFR', 'RFFHHHFR', 'RFFFFFFR', '.RFFFFR.', '..RRRR..'], { R: 'rim', F: 'face', H: 'hand' });
  return s.model({ x: 0, y: 0, z: 0 }, 0.25);
}

/** A porch post, from the deck up to the canopy: two and a half blocks. */
export function porchPost(): PropModel {
  return new Sketch().paint('timber', TIMBER).box(-1, 0, -1, 0, 9, 0, 'timber').model({ x: 0, y: 0, z: 0 }, 0.25);
}

/** A block's length of porch rail: a top rail on two balusters, running along x. */
export function porchRail(): PropModel {
  const s = new Sketch().paint('timber', TIMBER);
  s.box(-2, 3, 0, 1, 3, 0, 'timber');
  for (const x of [-2, 0]) s.box(x, 0, 0, x, 2, 0, 'timber');
  return s.model({ x: 0, y: 0, z: 0.5 }, 0.25);
}
```

- [ ] **Step 6: Create `src/props/catalog.ts`:**

```ts
import type { ShipModel } from '../sailing/shipModel';
import { instanceVoxels, mvToGame, type VoxFile } from '../vox/parseVox';
import { paletteFromRgba } from '../voxel/palette';
import { clock, lantern, porchPost, porchRail, signboard, signpost, wallLantern } from './models';
import type { Point, PropKind, PropModel } from './types';

/** The middle of a model's foot: centred across x and z, at its lowest voxel. */
function foot(cells: ArrayLike<number>): Point & { minZ: number } {
  let [minX, maxX, minY, minZ, maxZ] = [Infinity, -Infinity, Infinity, Infinity, -Infinity];
  for (let i = 0; i < cells.length; i += 4) {
    minX = Math.min(minX, cells[i]);
    maxX = Math.max(maxX, cells[i]);
    minY = Math.min(minY, cells[i + 1]);
    minZ = Math.min(minZ, cells[i + 2]);
    maxZ = Math.max(maxZ, cells[i + 2]);
  }
  return { x: (minX + maxX + 1) / 2, y: minY, z: (minZ + maxZ + 1) / 2, minZ };
}

/** The sloop's hull (no sails or flag), a block a voxel, for the ship on the stocks: her origin at her stern, on her keel. */
export function hullOnStocks(sloop: ShipModel): PropModel {
  const f = foot(sloop.hull.cells);
  return { cells: sloop.hull.cells, palette: { ...paletteFromRgba(sloop.palette), flags: new Uint8Array(256) }, origin: { x: f.x, y: f.y, z: f.minZ }, scale: 1, reserve: true };
}

/** A prop from a MagicaVoxel file: every object in it as one, standing on the middle of its foot. */
export function propFromVox(file: VoxFile, scale = 0.25): PropModel {
  const cells: number[] = [];
  for (const instance of file.instances) {
    const voxels = instanceVoxels(file, instance);
    for (let i = 0; i < voxels.length; i += 4) cells.push(...mvToGame(voxels[i], voxels[i + 1], voxels[i + 2]), voxels[i + 3]);
  }
  const { x, y, z } = foot(cells);
  return { cells: Int32Array.from(cells), palette: { ...paletteFromRgba(file.palette), flags: new Uint8Array(256) }, origin: { x, y, z }, scale };
}

/** Every prop the towns use, built once at startup. The sloop's model gives the ship on the stocks. */
export function propCatalog(sloop: ShipModel): Record<PropKind, PropModel> {
  return {
    lantern: lantern(),
    wallLantern: wallLantern(),
    signTavern: signboard('tavern'),
    signOffice: signboard('office'),
    signpostMarket: signpost('market'),
    signpostShipyard: signpost('shipyard'),
    clock: clock(),
    porchPost: porchPost(),
    porchRail: porchRail(),
    hullOnStocks: hullOnStocks(sloop),
  };
}
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/props`, then `npx vitest run` and `npx tsc --noEmit`.
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/props
git commit -m "Props: fine-voxel models for lanterns, signs, a clock, porches and the sloop on the stocks"
```

---

### Task 8: Drawing props, and keeping people out of the ship on the stocks

**Files:**
- Create: `src/props/place.ts`, `src/props/reserve.ts`, `src/render/PropsView.ts`
- Modify: `src/economy/ports.ts` (`Port.decor`), `src/worldgen/town.ts` (`Town.decor`), `src/worldgen/harbour.ts` (`Harbour.decor`), `src/Game.ts`
- Test: `src/props/place.test.ts`, `src/props/reserve.test.ts`, `src/render/PropsView.test.ts`

**Interfaces:**
- Consumes: `PropPlacement`, `PropModel`, `PropKind`, `Sketch`, `propCatalog` (Task 7); `Lifts`, `LIFT_GLSL` (Task 6); `FACING_DIRS` and `Block.Blocker` (Task 1); `meshCells` (`render/voxelGeometry`).
- Produces:
  - `toWorld(p: PropPlacement, m: PropModel, vx: number, vy: number, vz: number): Point`
  - `placementMatrix(p: PropPlacement, m: PropModel, out?: Matrix4): Matrix4`
  - `reserveProps(world: VoxelWorld, placements: readonly PropPlacement[], catalog: Readonly<Record<PropKind, PropModel>>): number` (returns how many cells it took)
  - `class PropsView { readonly group: Group; readonly meshes: Map<PropKind, InstancedMesh>; constructor(placements, catalog, lifts: Lifts); setGlow(amount: number): void }`
  - `Town.decor: PropPlacement[]`, `Harbour.decor: PropPlacement[]`, `Port.decor?: PropPlacement[]`

- [ ] **Step 1: Write the failing tests.**

`src/props/place.test.ts`:

```ts
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { FACING_DIRS } from '../voxel/blocks';
import { placementMatrix, toWorld } from './place';
import { Sketch } from './sketch';
import type { PropPlacement } from './types';

const at = (facing: number): PropPlacement => ({ kind: 'lantern', x: 3, y: 4, z: 5, facing, anchor: null });

describe('placing a prop', () => {
  it('faces the model’s front (+z) the way its facing says', () => {
    const model = new Sketch().paint('a', 0).put(0, 0, 0, 'a').model({ x: 0, y: 0, z: 0 }, 1);
    for (let facing = 0; facing < 4; facing++) {
      const [dx, dz] = FACING_DIRS[facing];
      const front = toWorld(at(facing), model, 0, 0, 1);
      expect(front.x - 3).toBeCloseTo(dx);
      expect(front.z - 5).toBeCloseTo(dz);
    }
  });

  it('moves, turns and scales a model the same way for drawing as for reserving', () => {
    const model = new Sketch().paint('a', 0).put(0, 0, 0, 'a').model({ x: 1, y: 0, z: 2 }, 0.5);
    for (let facing = 0; facing < 4; facing++) {
      const matrix = placementMatrix(at(facing), model);
      for (const [vx, vy, vz] of [[0, 0, 0], [3, 1, -2], [1, 0, 2]]) {
        const a = toWorld(at(facing), model, vx, vy, vz);
        const b = new Vector3(vx, vy, vz).applyMatrix4(matrix);
        expect(b.x).toBeCloseTo(a.x);
        expect(b.y).toBeCloseTo(a.y);
        expect(b.z).toBeCloseTo(a.z);
      }
    }
  });
});
```

`src/props/reserve.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Block } from '../voxel/blocks';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { reserveProps } from './reserve';
import { Sketch } from './sketch';
import type { PropKind, PropModel } from './types';

/** A 2 × 1 × 3 block, a block a voxel, standing on the middle of its left edge's end. */
const brick = (): PropModel => ({ ...new Sketch().paint('a', 0).box(0, 0, 0, 1, 0, 2, 'a').model({ x: 1, y: 0, z: 0 }, 1), reserve: true });
const catalog = (model: PropModel) => ({ hullOnStocks: model }) as unknown as Record<PropKind, PropModel>;

describe('reserving props', () => {
  it('fills the air in the cells a block-a-voxel prop fills with the blocker, and leaves what’s there', () => {
    const world = new VoxelWorld();
    world.setVoxel(10, 5, 21, Block.Stone);
    const taken = reserveProps(world, [{ kind: 'hullOnStocks', x: 11, y: 5, z: 20, facing: 0, anchor: null }], catalog(brick()));
    expect(taken).toBe(5);
    expect(world.getVoxel(10, 5, 21)).toBe(Block.Stone);
    for (const [x, z] of [[10, 20], [11, 20], [11, 21], [10, 22], [11, 22]]) expect(world.getVoxel(x, 5, z)).toBe(Block.Blocker);
  });

  it('turns with the prop', () => {
    const world = new VoxelWorld();
    // Facing east: the model's +z runs along +x, its +x along −z.
    reserveProps(world, [{ kind: 'hullOnStocks', x: 11, y: 5, z: 20, facing: 1, anchor: null }], catalog(brick()));
    for (let x = 11; x <= 13; x++) for (const z of [19, 20]) expect(world.getVoxel(x, 5, z), `${x},${z}`).toBe(Block.Blocker);
  });

  it('leaves alone props that don’t ask, and refuses one drawn finer than a block a voxel', () => {
    const world = new VoxelWorld();
    expect(reserveProps(world, [{ kind: 'hullOnStocks', x: 0, y: 0, z: 0, facing: 0, anchor: null }], catalog({ ...brick(), reserve: false }))).toBe(0);
    expect(() => reserveProps(world, [{ kind: 'hullOnStocks', x: 0, y: 0, z: 0, facing: 0, anchor: null }], catalog({ ...brick(), scale: 0.25 }))).toThrow();
  });
});
```

`src/render/PropsView.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Sketch } from '../props/sketch';
import { PROP_KINDS, type PropKind, type PropModel } from '../props/types';
import { Lifts } from './lifts';
import { PropsView } from './PropsView';

const tiny = new Sketch().paint('a', 0xffffff).put(0, 0, 0, 'a').model({ x: 0.5, y: 0, z: 0.5 }, 0.25);
const catalog = Object.fromEntries(PROP_KINDS.map((k) => [k, tiny])) as Record<PropKind, PropModel>;

describe('props view', () => {
  it('draws each kind the towns use as one instanced mesh', () => {
    const view = new PropsView(
      [
        { kind: 'lantern', x: 10.5, y: 15, z: 20.5, facing: 0, anchor: null },
        { kind: 'lantern', x: 12.5, y: 15, z: 20.5, facing: 1, anchor: { x: 12, y: 16, z: 21 } },
        { kind: 'clock', x: 0, y: 0, z: 0, facing: 2, anchor: null },
      ],
      catalog,
      new Lifts(),
    );
    expect(view.group.children).toHaveLength(2);
    const lanterns = view.meshes.get('lantern')!;
    expect(lanterns.count).toBe(2);
    const anchors = lanterns.geometry.getAttribute('anchor');
    expect(anchors.getY(0)).toBeLessThan(-1000); // never lifts
    expect([anchors.getX(1), anchors.getY(1), anchors.getZ(1)]).toEqual([12.5, 16.5, 21.5]); // its block's centre
    expect(view.meshes.has('signTavern')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to check they fail**

Run: `npx vitest run src/props src/render/PropsView.test.ts`
Expected: FAIL, because the modules don't exist yet.

- [ ] **Step 3: Create `src/props/place.ts`:**

```ts
import { Matrix4 } from 'three';
import { FACING_DIRS } from '../voxel/blocks';
import type { Point, PropModel, PropPlacement } from './types';

/**
 * Where a point of a model (in its own voxels) lands in the world: less the model's
 * origin, scaled, turned so its +z faces the placement's way (its +x then runs along
 * (dz, −dx)), and moved to the placement.
 */
export function toWorld(p: PropPlacement, m: PropModel, vx: number, vy: number, vz: number): Point {
  const [dx, dz] = FACING_DIRS[p.facing];
  const x = (vx - m.origin.x) * m.scale;
  const y = (vy - m.origin.y) * m.scale;
  const z = (vz - m.origin.z) * m.scale;
  return { x: p.x + x * dz + z * dx, y: p.y + y, z: p.z - x * dx + z * dz };
}

/** The same as a matrix, for drawing: the model's x, y and z axes, then where its origin goes. */
export function placementMatrix(p: PropPlacement, m: PropModel, out = new Matrix4()): Matrix4 {
  const [dx, dz] = FACING_DIRS[p.facing];
  const s = m.scale;
  const { x: ox, y: oy, z: oz } = m.origin;
  return out.set(
    dz * s, 0, dx * s, p.x - (ox * dz + oz * dx) * s,
    0, s, 0, p.y - oy * s,
    -dx * s, 0, dz * s, p.z - (-ox * dx + oz * dz) * s,
    0, 0, 0, 1,
  );
}
```

- [ ] **Step 4: Create `src/props/reserve.ts`:**

```ts
import { Block } from '../voxel/blocks';
import type { VoxelWorld } from '../voxel/VoxelWorld';
import { toWorld } from './place';
import type { PropKind, PropModel, PropPlacement } from './types';

/**
 * Keeps people out of the props that ask for it (the ship on the stocks): every air cell
 * such a prop's voxels fill becomes Block.Blocker. Run it once, straight after the world is
 * generated and before edits are tracked, so the blockers are part of the world, not of a
 * save. Returns how many cells it took.
 */
export function reserveProps(world: VoxelWorld, placements: readonly PropPlacement[], catalog: Readonly<Record<PropKind, PropModel>>): number {
  let taken = 0;
  for (const p of placements) {
    const model = catalog[p.kind];
    if (!model.reserve) continue;
    if (model.scale !== 1) throw new Error(`reserveProps: ${p.kind} is drawn ${model.scale} a voxel; only a prop drawn a block a voxel reserves cells`);
    for (let i = 0; i < model.cells.length; i += 4) {
      const w = toWorld(p, model, model.cells[i] + 0.5, model.cells[i + 1] + 0.5, model.cells[i + 2] + 0.5);
      const [x, y, z] = [Math.floor(w.x), Math.floor(w.y), Math.floor(w.z)];
      if (world.getVoxel(x, y, z) !== Block.Air) continue;
      world.setVoxel(x, y, z, Block.Blocker);
      taken++;
    }
  }
  return taken;
}
```

- [ ] **Step 5: Create `src/render/PropsView.ts`:**

```ts
import { Group, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshLambertMaterial } from 'three';
import { placementMatrix } from '../props/place';
import type { PropKind, PropModel, PropPlacement } from '../props/types';
import { LIFT_GLSL, type Lifts } from './lifts';
import { meshCells } from './voxelGeometry';

/** The anchor of a prop that never lifts: under anything a lift reaches. */
const NEVER_LIFTED = -1e6;

/**
 * The towns' props: one instanced mesh a kind, for every town at once (about ten draw
 * calls). They're lit like the terrain, their lantern glass glows after dark, and one hung
 * on a building goes with it when it's lifted away on foot.
 */
export class PropsView {
  readonly group = new Group();
  /** Each kind's mesh (none for a kind no town uses). */
  readonly meshes = new Map<PropKind, InstancedMesh>();
  private readonly glow = { value: 0.2 };
  private readonly material = new MeshLambertMaterial({ vertexColors: true });

  constructor(placements: readonly PropPlacement[], catalog: Readonly<Record<PropKind, PropModel>>, lifts: Lifts) {
    this.group.name = 'props';
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, lifts.uniforms);
      shader.uniforms.uGlow = this.glow;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float flags;\nattribute vec3 anchor;\nvarying float vGlow;\nvarying vec3 vAnchor;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = step(1.5, flags);\nvAnchor = anchor;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${LIFT_GLSL}\nuniform float uGlow;\nvarying float vGlow;\nvarying vec3 vAnchor;`)
        // Hung on a building that's lifted away: gone with it.
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (lifted(vAnchor)) discard;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vGlow * uGlow;');
    };
    this.material.customProgramCacheKey = () => 'havens-end-props';

    const byKind = new Map<PropKind, PropPlacement[]>();
    for (const p of placements) byKind.set(p.kind, [...(byKind.get(p.kind) ?? []), p]);
    const matrix = new Matrix4();
    for (const [kind, list] of byKind) {
      const model = catalog[kind];
      const geometry = meshCells(model.cells, model.palette);
      const anchors = new Float32Array(list.length * 3);
      list.forEach((p, i) => anchors.set(p.anchor ? [p.anchor.x + 0.5, p.anchor.y + 0.5, p.anchor.z + 0.5] : [0, NEVER_LIFTED, 0], i * 3));
      geometry.setAttribute('anchor', new InstancedBufferAttribute(anchors, 3));
      const mesh = new InstancedMesh(geometry, this.material, list.length);
      list.forEach((p, i) => mesh.setMatrixAt(i, placementMatrix(p, model, matrix)));
      mesh.computeBoundingSphere();
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `props:${kind}`;
      this.meshes.set(kind, mesh);
      this.group.add(mesh);
    }
  }

  /** How brightly lantern glass glows: the same as the terrain's glowing blocks. */
  setGlow(amount: number): void {
    this.glow.value = amount;
  }
}
```

- [ ] **Step 6: Pass placements through to the port.**
- `src/economy/ports.ts`: add `import type { PropPlacement } from '../props/types';`, and to `Port`: `/** The town's props (lanterns, signs, the ship on the stocks): from the seed, never saved. */ decor?: PropPlacement[];`.
- `src/worldgen/town.ts`: add `import type { PropPlacement } from '../props/types';`, and to `Town`: `/** Props set about the town: lanterns, signs, porches, the ship on the stocks. */ decor: PropPlacement[];`. In `buildTown`, right after `const f = frame(...)`, add `const decor: PropPlacement[] = [];`. Add `decor,` to the returned object.
- `src/worldgen/harbour.ts`: add `import type { PropPlacement } from '../props/types';`, and to `Harbour`: `/** The town's props (see Town.decor), and the pier's. */ decor: PropPlacement[];`. Add `decor: town.decor` to the returned object. `buildArchipelago` spreads the harbour into the `Port`, so `Port.decor` is filled with no further change.

- [ ] **Step 7: Draw them in the game** (`src/Game.ts`).

Add the imports:

```ts
import { propCatalog } from './props/catalog';
import { reserveProps } from './props/reserve';
import { PropsView } from './render/PropsView';
```

Add a field `private readonly props: PropsView;` next to `terrain`. Replace the line `this.world.trackEdits(); // from here on, changes are what a save stores` with:

```ts
    // The towns' props, and the ship on the stocks keeping people out of the cells she fills.
    const decor = this.ports.flatMap((p) => p.decor ?? []);
    const catalog = propCatalog(models.get(SLOOP)!);
    reserveProps(this.world, decor, catalog);
    this.world.trackEdits(); // from here on, changes are what a save stores
```

After `this.terrain = new ChunkRenderer(this.world);`, add `this.props = new PropsView(decor, catalog, this.terrain.lifts);`. Add `this.props.group,` after `this.terrain.group,` in `this.scene.add(…)`. After `this.terrain.setGlow(0.2 + 2.2 * dark);`, add `this.props.setGlow(0.2 + 2.2 * dark);`.

- [ ] **Step 8: Run the tests**

Run: `npx vitest run`, then `npx tsc --noEmit`.
Expected: all pass. There are no placements yet, so the game looks the same.

- [ ] **Step 9: Commit**

```bash
git add src/props/place.ts src/props/place.test.ts src/props/reserve.ts src/props/reserve.test.ts src/render/PropsView.ts src/render/PropsView.test.ts src/economy/ports.ts src/worldgen/town.ts src/worldgen/harbour.ts src/Game.ts
git commit -m "Props drawn as one instanced mesh a kind, lifting with their wall; reserved cells for the ship on the stocks"
```

---

### Task 9: Lanterns, signs and a clock in the towns

**Files:**
- Modify: `src/worldgen/town.ts` (`buildTown`, `markDoor`, `lampPost`, and new `alongOf`, `facingOf`, `onWall`, `signpostAt`, `clockOver`), `src/worldgen/harbour.ts` (the pier's `lampPost`)
- Test: `src/worldgen/town.test.ts`

**Interfaces:**
- Consumes: `PropPlacement`, `PropKind` (Task 7); `Town.decor`, `Harbour.decor` (Task 8); `FACING_DIRS`, `isSolid`, `Block.Blocker` (Task 1).
- Produces:
  - `Town.decor` holds `lantern` (on every lamp post), `wallLantern` (by the tavern's and office's doors), `signTavern` and `signOffice` (wall-hung), `signpostMarket` and `signpostShipyard`, and `clock` (on the office, where it has an upper storey).
  - `Harbour.decor` adds the pier lamps' lanterns.
  - `Town.lamps` gains the door lanterns' lights.
  - Lamp posts no longer have `Block.Lantern` on top.

- [ ] **Step 1: Write the failing tests.** In `src/worldgen/town.test.ts`, add `FACING_DIRS` (if Task 4 didn't already) and `isSolid` to the blocks import. In `'mark the doors you can go in: …'`:
- change the step check to `expect(world.getVoxel(ox, Math.floor(p.y) - 1, oz), `${label} step`).toBe(Block.Stone);`;
- replace the three `lanterns` lines with:

```ts
        const lantern = harbour.decor.find((d) => d.kind === 'wallLantern' && Math.hypot(d.x - p.x, d.z - p.z) <= 1.6 && d.y === Math.floor(p.y) + 2);
        expect(lantern, `${label} lantern`).toBeDefined();
```

Then add:

```ts
  it('top the lamp posts with lanterns, each with its light', () => {
    for (const { name, world, harbour } of PORTS) {
      const posts = harbour.decor.filter((d) => d.kind === 'lantern');
      expect(posts.length, `${name} lanterns`).toBeGreaterThanOrEqual(4);
      for (const d of posts) {
        const [x, z] = [Math.floor(d.x), Math.floor(d.z)];
        expect(world.getVoxel(x, d.y - 1, z), `${name} post under the lantern at ${x},${z}`).toBe(Block.Wood);
        expect(world.getVoxel(x, d.y, z), `${name} nothing where the lantern stands at ${x},${z}`).toBe(Block.Air);
        expect(harbour.lamps.some((l) => Math.hypot(l.x - d.x, l.z - d.z) < 0.01), `${name} its light at ${x},${z}`).toBe(true);
      }
    }
  });

  it('hang a signboard by the tavern’s and office’s doors, and stand signposts by the market and the shipyard', () => {
    for (const { name, world, harbour } of PORTS) {
      for (const [kind, sign] of [['tavern', 'signTavern'], ['office', 'signOffice']] as const) {
        const p = harbour.places.find((q) => q.kind === kind)!;
        const board = harbour.decor.find((d) => d.kind === sign);
        expect(board, `${name} ${kind} sign`).toBeDefined();
        expect(Math.hypot(board!.x - p.x, board!.z - p.z), `${name} ${kind} sign by the door`).toBeLessThanOrEqual(1.6);
        const { x, y, z } = board!.anchor!;
        expect(isSolid(world.getVoxel(x, y, z)), `${name} ${kind} sign on a wall`).toBe(true);
      }
      const yard = harbour.places.find((q) => q.kind === 'shipyard')!;
      for (const [kind, sign] of [['market', 'signpostMarket'], ['shipyard', 'signpostShipyard']] as const) {
        const p = harbour.places.find((q) => q.kind === kind)!;
        if (kind === 'market' && p.x === yard.x && p.z === yard.z) continue; // no market hall of its own
        const post = harbour.decor.find((d) => d.kind === sign);
        expect(post, `${name} ${kind} signpost`).toBeDefined();
        expect(Math.hypot(post!.x - p.x, post!.z - p.z), `${name} ${kind} signpost by the way in`).toBeLessThanOrEqual(3.5);
        expect(world.getVoxel(Math.floor(post!.x), post!.y, Math.floor(post!.z)), `${name} ${kind} signpost keeps its cell`).toBe(Block.Blocker);
      }
    }
  });

  it('put a clock over the office door, where it has an upper storey to hang on', () => {
    let clocks = 0;
    for (const { name, world, harbour } of PORTS) {
      const office = harbour.places.find((q) => q.kind === 'office')!;
      for (const c of harbour.decor.filter((d) => d.kind === 'clock')) {
        clocks++;
        const { x, y, z } = c.anchor!;
        expect(isSolid(world.getVoxel(x, y, z)), `${name} clock on a wall`).toBe(true);
        expect(Math.hypot(c.x - office.x, c.z - office.z), `${name} clock over the door`).toBeLessThanOrEqual(1);
        expect(y - Math.floor(office.y), `${name} clock a storey up`).toBe(3);
      }
    }
    expect(clocks).toBeGreaterThanOrEqual(1);
  });
```

- [ ] **Step 2: Run the tests to check they fail**

Run: `npx vitest run src/worldgen/town.test.ts`
Expected: the lantern, sign and clock tests FAIL, because `decor` is still empty.

- [ ] **Step 3: Implement in `src/worldgen/town.ts`.**

Imports: `import { baseOf, Block, type BlockId, FACING_DIRS, isSolid, stairOf } from '../voxel/blocks';` and `import type { PropKind, PropPlacement } from '../props/types';`.

Move the lamp list up. Delete the line `const lamps: Town['lamps'] = [];` in the lamps section, and declare it at the top of `buildTown`, next to `const decor: PropPlacement[] = [];`.

Add the helpers after `signBy`:

```ts
/** Along a door's wall: the grid step from the door to its jambs. */
const alongOf = (door: Door): readonly [number, number] => (door.outX !== door.x ? [0, 1] : [1, 0]);

/** The quarter turn (as FACING_DIRS) that looks along (dx, dz). */
const facingOf = (dx: number, dz: number): number => FACING_DIRS.findIndex(([fx, fz]) => fx === dx && fz === dz);

/** A prop hung on the face of wall block (x, y, z) looking out along (ox, oz): its origin at the middle of that face, at the block's foot. */
function onWall(kind: PropKind, x: number, y: number, z: number, ox: number, oz: number): PropPlacement {
  return { kind, x: x + 0.5 + ox * 0.5, y, z: z + 0.5 + oz * 0.5, facing: facingOf(ox, oz), anchor: { x, y, z } };
}

/**
 * A signpost by a way in with no wall beside it (the market's open hall, the shipyard's
 * shed), on the first of `spots` with room for it, looking out along (ox, oz). It keeps
 * people out of its post's cells.
 */
function signpostAt(world: VoxelWorld, kind: PropKind, spots: ReadonlyArray<{ x: number; z: number }>, y: number, ox: number, oz: number, decor: PropPlacement[]): void {
  for (const { x, z } of spots) {
    if (world.getVoxel(x, y, z) !== Block.Air || world.getVoxel(x, y + 1, z) !== Block.Air || !isSolid(world.getVoxel(x, y - 1, z))) continue;
    decor.push({ kind, x: x + 0.5, y, z: z + 0.5, facing: facingOf(ox, oz), anchor: null });
    world.setVoxel(x, y, z, Block.Blocker);
    world.setVoxel(x, y + 1, z, Block.Blocker);
    return;
  }
}

/** A clock on the office's front over its door, where there's an upper storey's wall to hang it on. */
function clockOver(world: VoxelWorld, door: Door, decor: PropPlacement[]): void {
  const y = door.y + 3;
  const wall = world.getVoxel(door.x, y, door.z);
  if (!isSolid(wall) || [Block.Thatch, Block.RoofTile, Block.RoofSlate, Block.TarredRoof].includes(wall as never)) return;
  decor.push(onWall('clock', door.x, y, door.z, door.outX - door.x, door.outZ - door.z));
}
```

Replace `markDoor` with a version that hangs a lantern prop and returns its light:

```ts
/**
 * A door you can go in, marked out: its frame in timber (the jambs and the lintel), a
 * stone step before it, and a lantern hung on the wall beside it. Returns the lantern's light.
 */
function markDoor(world: VoxelWorld, door: Door, decor: PropPlacement[]): { x: number; y: number; z: number } {
  const [ax, az] = alongOf(door);
  const [ox, oz] = [door.outX - door.x, door.outZ - door.z];
  for (const s of [-1, 1]) for (let y = door.y; y < door.y + 2; y++) world.setVoxel(door.x + ax * s, y, door.z + az * s, Block.Wood);
  world.setVoxel(door.x, door.y + 2, door.z, Block.Wood);
  world.setVoxel(door.outX, door.y - 1, door.outZ, Block.Stone);
  decor.push(onWall('wallLantern', door.x + ax, door.y + 2, door.z + az, ox, oz));
  return { x: door.x + ax + 0.5 + ox * 0.9, y: door.y + 2.5, z: door.z + az + 0.5 + oz * 0.9 };
}
```

Replace `lampPost` with:

```ts
/** A street lamp: a post two high with a lantern standing on top. Returns where the light is. */
function lampPost(world: VoxelWorld, x: number, h: number, z: number, decor: PropPlacement[]): { x: number; y: number; z: number } {
  world.setVoxel(x, h, z, Block.Wood);
  world.setVoxel(x, h + 1, z, Block.Wood);
  decor.push({ kind: 'lantern', x: x + 0.5, y: h + 2, z: z + 0.5, facing: 0, anchor: null });
  return { x: x + 0.5, y: h + 2.5, z: z + 0.5 };
}
```

In the building loop, replace the `if (lot.role !== 'house') { … }` block with:

```ts
    if (lot.role !== 'house') {
      // A door you can go in: framed in timber, a stone step, a lantern, and its signboard on a
      // bracket (the market's open hall gets a signpost, once the square is dressed).
      if (lot.role !== 'market') {
        lamps.push(markDoor(world, door, decor));
        const [ax, az] = alongOf(door);
        decor.push(onWall(lot.role === 'tavern' ? 'signTavern' : 'signOffice', door.x - ax, door.y + 2, door.z - az, door.outX - door.x, door.outZ - door.z));
        if (lot.role === 'office') clockOver(world, door, decor);
      } else {
        world.setVoxel(door.outX, door.y - 1, door.outZ, Block.Stone);
      }
      doors[lot.role] = door;
      signs[lot.role] = signBy(door);
    }
```

Right before the `// Lamps: at the corners of the square…` comment, add the signposts:

```ts
  // Signposts by the ways in with no wall beside them: the market's open hall, and the shipyard's shed.
  if (doors.market) {
    const d = doors.market;
    const [ax, az] = alongOf(d);
    signpostAt(world, 'signpostMarket', [2, -2, 3, -3].map((a) => ({ x: d.outX + ax * a, z: d.outZ + az * a })), d.y, d.outX - d.x, d.outZ - d.z, decor);
  }
  signpostAt(world, 'signpostShipyard', [1, 5, 0, 6].map((du) => at(f, q + du, ys * 8)), low, -f.sx * ys, -f.sz * ys, decor);
```

Change the lamp call to `lamps.push(lampPost(world, x, height, z, decor));`.

- [ ] **Step 4: The pier's lanterns** (`src/worldgen/harbour.ts`). Change the pier's `lampPost` to take `decor: PropPlacement[]`. It keeps the two `Block.Wood` posts, drops the `Block.Lantern` line, and adds `decor.push({ kind: 'lantern', x: x + 0.5, y: PIER_Y + 3, z: z + 0.5, facing: 0, anchor: null });`. In `buildHarbour`, declare `const decor = [...town.decor];` before the lamps, pass `decor` to both `lampPost` calls, and return `decor` instead of `town.decor`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run`, then `npx tsc --noEmit`.
Expected: all pass. If the signpost test fails for a port because none of the candidate cells has room, add the next cells out (±4 along) to that port's list. Don't loosen the test.

- [ ] **Step 6: Check it in the game.** Dock in Haven by day and by night (`game.sea.clock.phase = 0.86`). Check that:
- lanterns stand on the lamp posts and the pier posts, and glow at night with halos and streaks on the water;
- the tavern's and office's signboards and the clock read clearly on foot;
- the signposts stand by the market and the shipyard.

Walk behind the office and check its sign and clock lift with it. Put screenshots in `.playwright-mcp/`.

- [ ] **Step 7: Commit**

```bash
git add src/worldgen/town.ts src/worldgen/harbour.ts src/worldgen/town.test.ts
git commit -m "Towns: lanterns on the posts and by the doors, signboards and signposts, a clock on the office"
```

---

### Task 10: Porches

**Files:**
- Modify: `src/worldgen/buildings.ts` (`Door.outY`), `src/worldgen/town.ts` (new `buildPorch`; the building loop; the townsfolk spots), `src/worldgen/harbour.ts` (door places)
- Test: `src/worldgen/town.test.ts`

**Interfaces:**
- Consumes: `slabOf`, `baseOf`, `isSolid` (Task 1); `alongOf`, `facingOf` (Task 9); `porchPost`, `porchRail` kinds (Task 7).
- Produces: `Door.outY?: number`, the floor height just outside, when it isn't the door's own. The tavern's and office's `PortPlace.y` is `door.y + 0.5` when there's a porch. Townsfolk spots on a deck stand at the deck's height.

- [ ] **Step 1: Write the failing tests** in `src/worldgen/town.test.ts`. Add `import { groundBelow } from '../land/walker';`, then:

```ts
  it('build porches before the tavern and the office: a deck of plank slabs, posts and rails', () => {
    for (const { name, world, harbour } of PORTS) {
      for (const kind of ['tavern', 'office'] as const) {
        const p = harbour.places.find((q) => q.kind === kind)!;
        const [x, z] = [Math.floor(p.x), Math.floor(p.z)];
        const label = `${name} ${kind} porch`;
        expect(p.y % 1, `${label}: the place stands on the deck`).toBe(0.5);
        expect(world.getVoxel(x, Math.floor(p.y), z), label).toBe(Block.PlanksSlab);
        const near = (kind: string) => harbour.decor.filter((d) => d.kind === kind && Math.hypot(d.x - p.x, d.z - p.z) < 3).length;
        expect(near('porchPost'), `${label} posts`).toBe(2);
        expect(near('porchRail'), `${label} rails`).toBe(2);
      }
    }
  });

  it('stand townsfolk on the tavern’s and office’s porches at the deck’s height, not in it', () => {
    for (const { name, world, harbour } of PORTS) {
      const porches = harbour.places.filter((q) => q.kind === 'tavern' || q.kind === 'office');
      const onPorch = (harbour.spots ?? []).filter((q) => (q.kind === 'door' || q.kind === 'tavern') && porches.some((p) => Math.hypot(q.x - p.x, q.z - p.z) < 2.5));
      expect(onPorch.length, `${name} spots by the porches`).toBeGreaterThan(0);
      for (const s of onPorch) expect(groundBelow(world, s.x, s.z, s.y + 0.5), `${name} ${s.kind} spot at ${s.x},${s.z}`).toBe(s.y);
    }
  });
```

- [ ] **Step 2: Run the tests to check they fail**

Run: `npx vitest run src/worldgen/town.test.ts`
Expected: the porch test FAILS, with `p.y % 1` equal to 0. The spots test may pass already; it guards the change.

- [ ] **Step 3: Add `Door.outY`** in `src/worldgen/buildings.ts`, inside `interface Door`:

```ts
  /** The floor just outside, where it isn't the door's own height: half a block up on a porch. */
  outY?: number;
```

- [ ] **Step 4: Build the porches** (`src/worldgen/town.ts`). Extend the blocks import with `slabOf`. Add after `clockOver`:

```ts
/**
 * A porch before a door (the tavern's and the office's): a deck of plank slabs three wide
 * and two deep (one, where the street comes closer), a plank-slab canopy over it a storey
 * up, posts at the deck's front corners, and a rail either side of the way in. It's built
 * only on dry pad in front of the door, never on the street's paving. Returns the deck's cells ("x,z").
 */
function buildPorch(world: VoxelWorld, door: Door, decor: PropPlacement[]): Set<string> {
  const [ax, az] = alongOf(door);
  const [ox, oz] = [door.outX - door.x, door.outZ - door.z];
  const cell = (a: number, k: number) => ({ x: door.x + ox * k + ax * a, z: door.z + oz * k + az * a });
  const clear = (k: number) =>
    [-1, 0, 1].every((a) => {
      const { x, z } = cell(a, k);
      const under = world.getVoxel(x, door.y - 1, z);
      return world.getVoxel(x, door.y, z) === Block.Air && isSolid(under) && baseOf(under) !== Block.Gravel;
    });
  const deck = new Set<string>();
  if (!clear(1)) return deck;
  const deep = clear(2) ? 2 : 1;
  for (let k = 1; k <= deep; k++) {
    for (const a of [-1, 0, 1]) {
      const { x, z } = cell(a, k);
      world.setVoxel(x, door.y, z, slabOf(Block.Planks));
      if (world.getVoxel(x, door.y + 3, z) === Block.Air) world.setVoxel(x, door.y + 3, z, slabOf(Block.Planks));
      deck.add(`${x},${z}`);
    }
  }
  // A point `t` out from the wall's face and `s` along it from the door's middle.
  const at = (t: number, s: number) => ({ x: door.x + 0.5 + ox * (0.5 + t) + ax * s, z: door.z + 0.5 + oz * (0.5 + t) + az * s });
  const facing = facingOf(ox, oz);
  for (const s of [-1.25, 1.25]) decor.push({ kind: 'porchPost', ...at(deep - 0.25, s), y: door.y + 0.5, facing, anchor: null });
  for (const s of [-1, 1]) decor.push({ kind: 'porchRail', ...at(deep - 0.125, s), y: door.y + 0.5, facing, anchor: null });
  return deck;
}
```

In `buildTown`, next to `decor`, add `/** Porch decks' cells ("x,z"): half a block up from the ground under them. */ const decked = new Set<string>();`. In the building loop's `if (lot.role !== 'market') {` branch, after `lamps.push(markDoor(…))`, add:

```ts
        for (const c of buildPorch(world, door, decor)) decked.add(c);
        if (decked.has(`${door.outX},${door.outZ}`)) door.outY = door.y + 0.5;
```

Replace the `outside` helper in the townsfolk section with:

```ts
  const outside = (d: Door, steps: number, kind: SpotKind) => {
    const x = d.x + (d.outX - d.x) * steps;
    const z = d.z + (d.outZ - d.z) * steps;
    townSpots.push({ x: x + 0.5, y: decked.has(`${x},${z}`) ? d.y + 0.5 : d.y, z: z + 0.5, kind });
  };
```

- [ ] **Step 5: Door places at porch height** (`src/worldgen/harbour.ts`). In the `places.push(…)` for roles with a door, change `y: door.y` to `y: door.outY ?? door.y`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run`, then `npx tsc --noEmit`.
Expected: all pass, including the archipelago test: every place can still be stood on and walked to from the pier.

- [ ] **Step 7: Check it in the game.** Walk the captain up onto the tavern's porch and in at its door. The deck is half a block up, the canopy is overhead, and the posts and rails stand at the front. Check the townsfolk at the tavern door stand on the deck, not in it. Screenshots go in `.playwright-mcp/`.

- [ ] **Step 8: Commit**

```bash
git add src/worldgen/buildings.ts src/worldgen/town.ts src/worldgen/harbour.ts src/worldgen/town.test.ts
git commit -m "Towns: porches before the tavern and the office"
```

---

### Task 11: The sloop on the stocks

**Files:**
- Modify: `src/worldgen/town.ts` (`buildSlipway`, and a new constant `HULL_ON_STOCKS_LENGTH`)
- Test: `src/worldgen/town.test.ts`, `src/props/models.test.ts`

**Interfaces:**
- Consumes: `hullOnStocks` (Task 7); `reserveProps` in `Game` (Task 8); `facingOf` (Task 9).
- Produces:
  - `export const HULL_ON_STOCKS_LENGTH = 18` (`worldgen/town.ts`).
  - A `hullOnStocks` placement in `Town.decor`. Its origin is the middle of her stern's face, on her keel, and she faces down the slipway.
  - Stocks of `Block.Wood` every third cell under her, where the slipway runs.
  - The block-built half hull and its mast are gone.

- [ ] **Step 1: Write the failing tests.** In `src/props/models.test.ts`, import `HULL_ON_STOCKS_LENGTH` from `../worldgen/town` and add:

```ts
  it('lay the stocks for the sloop’s own length', () => {
    const hull = hullOnStocks(loadSloop());
    let maxZ = -Infinity;
    for (let i = 2; i < hull.cells.length; i += 4) maxZ = Math.max(maxZ, hull.cells[i]);
    expect(maxZ + 1 - hull.origin.z).toBe(HULL_ON_STOCKS_LENGTH);
  });
```

In `src/worldgen/town.test.ts`, import `HULL_ON_STOCKS_LENGTH` from `./town`. In `'build a shipyard: a slipway down into the water, a hull on the stocks, and a shed by it'`, replace the lines from `// The hull's timber and planking…` through `expect(hull, `${name} hull`).toBeGreaterThanOrEqual(12);` with:

```ts
      const hull = harbour.decor.find((d) => d.kind === 'hullOnStocks');
      expect(hull, `${name} hull`).toBeDefined();
      expect(outside(way, Math.floor(hull!.x), Math.floor(hull!.z)), `${name} hull over the slipway`).toBeLessThanOrEqual(1);
```

Replace the whole test `'build a ship on the stocks: seven wide amidships, her ribs bare forward, and a mast stepped'` with:

```ts
  it('set the sloop on the stocks: level on her keel over them, stern to the land and bow to the sea', () => {
    for (const { name, world, harbour } of PORTS) {
      const hull = harbour.decor.find((d) => d.kind === 'hullOnStocks')!;
      const [dx, dz] = FACING_DIRS[hull.facing];
      // Bow to the sea: down the slipway ahead of her, the ground falls away.
      expect(groundHeight(world, Math.floor(hull.x + dx * 10), Math.floor(hull.z + dz * 10)), `${name} bow to the sea`).toBeLessThan(hull.y);
      // Stocks under her, up to her keel.
      let stocks = 0;
      for (let t = 1; t < HULL_ON_STOCKS_LENGTH; t++) {
        if (world.getVoxel(Math.floor(hull.x + dx * (t - 0.5)), hull.y - 1, Math.floor(hull.z + dz * (t - 0.5))) === Block.Wood) stocks++;
      }
      expect(stocks, `${name} stocks`).toBeGreaterThanOrEqual(2);
    }
  });
```

- [ ] **Step 2: Run the tests to check they fail**

Run: `npx vitest run src/worldgen/town.test.ts src/props/models.test.ts`
Expected: FAIL, because `HULL_ON_STOCKS_LENGTH` isn't exported yet and there's no `hullOnStocks` placement.

- [ ] **Step 3: Implement** in `src/worldgen/town.ts`. Add after `LAMP_EVERY`:

```ts
/** The ship on the stocks is the sloop's own model (props/catalog.ts): this long, stern to stem. */
export const HULL_ON_STOCKS_LENGTH = 18;
```

Change `buildSlipway`'s signature to add `decor: PropPlacement[]`, and its doc comment to `/** The slipway's planks, falling to the water, and the stocks under a ship: the sloop's model, a prop (Town.decor). */`. Keep the first loop, which lays the planks. Replace everything after it, from the hull comment to the end of the function, with:

```ts
  // She lies level on her keel over stocks down to the falling planks, stern to the land and bow to the sea.
  const centre = side * 11;
  const stern = lane.u1 - 2;
  const keel = heights.get(stern)!;
  for (let u = stern; u > stern - HULL_ON_STOCKS_LENGTH; u -= 3) {
    const deck = heights.get(u);
    if (deck === undefined) continue; // past the slipway's end, over the water
    for (let y = deck; y < keel; y++) place(world, f, u, centre, y, Block.Wood);
  }
  // Her origin is the middle of her stern's face: between her stern's cell and the one landward of it.
  const here = at(f, stern, centre);
  const back = at(f, stern + 1, centre);
  decor.push({
    kind: 'hullOnStocks',
    x: (here.x + back.x) / 2 + 0.5,
    y: keel,
    z: (here.z + back.z) / 2 + 0.5,
    facing: facingOf(here.x - back.x, here.z - back.z),
    anchor: null,
  });
```

Change the call in `buildTown` to `buildSlipway(world, f, slip.lane, slip.heights, ys, decor);`. Remove anything left unused (TypeScript's `noUnusedLocals` will point it out).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run`, then `npx tsc --noEmit`.
Expected: all pass.

- [ ] **Step 5: Check it in the game.** Look down on each shipyard, starting with Haven. The sloop should sit on her stocks, read as a ship from above at the default zoom, and face the water. On foot, check the captain can't walk into her hull, and that the water under her bow is still drawn.

- [ ] **Step 6: Commit**

```bash
git add src/worldgen/town.ts src/worldgen/town.test.ts src/props/models.test.ts
git commit -m "Towns: the sloop on the stocks, in place of the block-built hull"
```

---

### Task 12: Docs, the game, frame time and the critic

**Files:**
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Write the docs.** In `docs/ARCHITECTURE.md`:
- **§3 Voxel pipeline.** Add a bullet: stairs and slabs are ordinary ids (60–74). The terrain palette's `shapes` gives their boxes. The mesher draws a box's face unless it's on the cell's side against a whole cube, and shades it by blending the cube face's corner occlusion across the box. Add another: the blocker (75) is solid to walkers and ships but never drawn or picked, `surfaceHeight` skips it, and it keeps people out of a prop.
- **§8 Towns.** The streets climb by stairs, placed by the rule in `laySteps`. The porches. The props: lanterns on the posts and by the doors (lit, with their light in `Port.lamps`), signboards and signposts, the clock, and the sloop on the stocks. Name `props/`, `render/PropsView.ts`, `Port.decor`, the anchor-based lift, and `reserveProps` running before `trackEdits`.
- **§9 On foot.** Heights come in half-block steps: the walker, pathfinding and dropped items.
- **Building.** Add the four stair and slab pieces to the list of structures.
- **§15 Module map.** Add `props/` (types, sketch, models, catalog, place, reserve).
- **§16 Roadmap.** Under the town art pass, mark as done the porch, the hanging signboards, the clock, and the ship readable from above. Leave columns, per-faction layouts, the captain's readability and the night items open.

- [ ] **Step 2: The game.** Run `npx vite --port 5199 --strictPort` and look with Playwright. Put screenshots in `.playwright-mcp/`:
- Haven, the free port, the Crown's port and the Brethren's, by day and at night (`game.sea.clock.phase` 0.32 and 0.86);
- on foot: up the ramp from the pier, along the main street, onto the tavern's porch, and at the shipyard;
- a camp with built plank and stone stairs.

Check the browser console has no errors.

- [ ] **Step 3: Frame time.** Measure Haven at night on `main` and on this branch, alternating runs. Use the GPU-timer harness from the water work: wrap `game.render` with an `EXT_disjoint_timer_query_webgl2` query, and take the medians of GPU time and of the render call's CPU time over 5 s, after a 1.5 s warm-up. The branch must be within +0.5 ms CPU and +0.5 ms GPU. If it isn't, first check the props' draw calls (`renderer.info.render.calls`) and triangle counts. Record the numbers in the commit message.

- [ ] **Step 4: The critic.** Run the `visual-critic` skill on the towns (day and night, at sea and on foot) with the town art pass's open points as context. Fix what it finds that's within this work, such as a sign or lantern that reads badly or a prop out of place. List the rest in the roadmap's town art pass.

- [ ] **Step 5: Run everything**

Run: `npx vitest run`, then `npx tsc --noEmit`.
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "Docs: stairs, slabs and props (voxel pipeline, towns, on foot, building, module map, roadmap)"
```
