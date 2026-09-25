# Stairs, slabs and fine-voxel props: design

Date: 2026-09-25. Status: design approved in conversation; spec awaiting review.
Branch: `block-shapes-and-props`, based on the towns commit `2264c35` (the Phase 10
branch, whose session is paused). It merges to `main` after, or with, that branch.

## Goal

More detail where the eye lands (towns, on foot), and walking that climbs rather than
scrambles. What the user asked for (2026-09-25):
- blocks divided up, like Minecraft's stairs, because the houses (and the ships)
  could use more detail;
- the detail is for looks **and** for walking on: the captain and settlers walk up
  stairs and half-steps;
- players can build stairs and slabs in their own camps;
- the sea stays low detail.

The visual critic's last report on the towns (4/10, see the roadmap's "town art
pass") asks for the same kind of thing: a porch, a hanging signboard, columns and a
clock on the Tavern, Guildhall and Governor's House, and a ship on the stocks that
reads as a ship from above.

Out of scope, each its own later project: finer ships; block textures (last, if at
all: they would change the look most); buildable props.

## Why this approach

Three approaches were weighed:
- **A. A set of shaped blocks** (Minecraft's way): simple, but detail stops at the
  shapes in the set. No signboards or clocks.
- **B. Blocks split into 4×4×4 sub-voxels**: can make anything, but the mesher,
  picking, walker, pathfinding, saves and the roof lifter all learn a second
  resolution. Too much risk for the gain.
- **C. Two walkable shapes, plus fine-voxel props for decoration** (chosen). Walking
  rules stay small (slab and stair), and props give the finest detail exactly where
  it is wanted. The prop renderer can dress the ships later.

What detail shows: at sea (camera ~90 away) a voxel is 8–9 px on screen and a quarter
voxel ~2 px; on foot (26–36 away) a voxel is 25–30 px and a quarter voxel ~7 px. So
props are made at a quarter of a block, and matter most on foot.

## Part 1: walkable shapes

### The shapes

- **Slab:** the bottom half of the cell, full footprint (box 0–1, 0–0.5, 0–1).
- **Stair:** a slab plus the upper half-box on the high side. A stair **faces the way
  you climb it**: a north stair (`N`, toward −z) has its upper box over z 0–0.5 of the
  cell. Facings `N`, `E`, `S`, `W`.
- **Materials:** gravel (streets and the square), stone (steps) and planks (floors,
  the pier). 3 materials × (slab + 4 stairs) = **15 new block ids** (`GravelSlab`,
  `GravelStairN` … `PlanksStairW`). There are 60 ids today, out of 256.

### Storage

Shapes are ordinary block ids. Chunks, edits, saves and worldgen are unchanged, and a
save needs no new version: an older save simply has none of them.

`voxel/blocks.ts` gains a shape table, indexed by id:
- `shapeOf(id)`: the boxes, in cell units, or `null` for a full cube;
- `baseOf(id)`: the material it's made of (its colour, flags and name come from it);
- `stairFacing(id)`: 0–3 for stairs.

It also gains a new `OPAQUE_CUBE` table (full solid cubes only), next to `SOLID`
(anything solid, shaped blocks included).

### Mesher (`voxel/mesher.ts`)

- **Full cubes:** as now, except a face is culled only against an `OPAQUE_CUBE`
  neighbour. So a wall face beside a slab is drawn.
- **Shaped blocks:** each box emits its six faces. A face lying on the cell's boundary
  is dropped if the neighbour on that side is an `OPAQUE_CUBE`. Faces inside the cell
  (a stair's riser, the tread under the upper box's edge) are always drawn.
- **AO and jitter:** colour jitter as for any block. AO is sampled with the existing
  whole-block neighbourhood, from the cell the face lies in. That's approximate. If a
  stair's underside shades visibly wrong, the fix stays inside the mesher.
- **Flags:** from the base material (cutaway, glow), as for any block.

### Heights

One lookup, in `voxel/`:
`topAt(world, x, y, z): number`. It gives the world height of the solid top under
point (x, z) in the cell `floor(y)`. That's `y0` for air, `y0 + 1` for a full cube,
`y0 + 0.5` for a slab, and `y0 + 1` or `y0 + 0.5` for a stair, depending on which half
the point is in.

- **Walker (`land/walker.ts`):** collision tests the walker against the shape's boxes,
  not whole cells. A rise of up to 0.5 is walked up smoothly (the feet follow `topAt`).
  A rise above 0.5, up to `STEP_UP` (2), is the existing scramble. Water and wading
  rules are unchanged, measured from the real feet height.
- **Pathfinding (`land/paths.ts`: settlers, creatures, townsfolk):** a node's standing
  height is its real top (whole or half). The existing rise limits apply to real
  heights, so a stair turns a 1-block rise into two half-steps. Fences still count as
  two high.
- **Ships, picking, tools:** whole-cell, as now. A shaped block grounds a ship like any
  block (`SOLID`), and the raycast picks the whole cell.

### Towns use them (`worldgen/town.ts`)

- Along the streets, the square's edges, the ramp up from the pier and the doorsteps,
  a 1-block rise between neighbouring cells in the direction of travel gets a stair,
  in the ground's material, in the lower cell, facing up the rise.
- Where streets cross, at corners, and wherever a stair would block a door or another
  street, the full-block rise stays.
- Slabs go where a half-step reads better: a porch floor, the top of the pier ramp.
- The town test that every door can be walked to from the pier still passes, now over
  stairs.

### Building them in camps

- Four new free-form pieces in `land/structures.ts`, like the fence, path and torch:
  **plank stair** (1 timber), **plank slab** (1 timber), **stone stair** (1 stone) and
  **stone slab** (1 stone).
- **Facing:** the build menu's existing rotation (`Shore.placing.rot`, 0–3) sets a
  stair's facing.
- **Placement** (`Land.placement`): the rules for free-form pieces (dry, not on town
  land, not in the way of a building or outcrop). A stair or slab may stand on top of
  another full block, so flights can be built up a slope.
- **Removal:** as other free-form pieces (`unbuild`, full refund).
- **Saved** like any placed piece (the building list and the edited chunks). No save
  format change.

### Part 1 tests

- The shape table: every new id has boxes, a base and (for stairs) a facing.
- `topAt` on a full cube, a slab and each stair facing, on both halves.
- Mesher: face counts for a slab and a stair alone, beside a full cube and beside each
  other. A full cube beside a slab keeps its face.
- Walker: walks up a stair without a scramble, climbs a slab, still scrambles up a
  2-block ledge, and stops at water as before.
- Paths: a route up a street of stairs; creatures still can't climb fences.
- Towns: every door is reachable from the pier. Stairs appear at the street rises.
- Building: the four pieces place, rotate, refuse bad spots, unbuild and refund.

## Part 2: fine-voxel props

Decoration finer than a block, placed by the town builder. Not collidable (with one
exception: reserved cells, below), not buildable, not saved.

### Models

A prop kind (`props/`) is:
- **cells:** x, y, z and a colour index, as ships use;
- **a palette**, with a glow flag for lantern glass;
- **scale:** world units per voxel. The default is 0.25, a quarter block;
- **anchor:** `floor` (standing on the cell below its origin) or `wall` (hung on the
  face of the cell behind it);
- optionally, **reserved cells:** whole-block cells, relative to its origin, that it
  blocks.

Two sources:
- **Built in code** (`props/models.ts`), like the town's other builders but at the
  finer scale.
- **`.vox` files** in `public/models/props/`, from MagicaVoxel or `npm run asset`,
  loaded with the existing `parseVox`.

Both are meshed with `meshCells` (`render/voxelGeometry.ts`), the path ships use, so
props get the same AO and jitter as everything else.

**The first set:**
- **Signboards:** one per place kind (`market`, `tavern`, `office`, `shipyard`), each
  with its own device, hung from a bracket beside the door.
- **A clock** on the front of the Governor's House (the `office`).
- **Porch posts and rails** for the Tavern and the Governor's House. The porch floor
  is plank slabs (part 1).
- **Lantern heads:** a caged lantern with glowing glass, on top of lamp posts (the
  streets and the pier) and beside the doors. It replaces the `Lantern` block there.
- **The ship on the stocks:** the sloop's own `.vox` model, at a scale of 1, in place
  of the plank hull the slipway builds now. It reserves the cells under its hull.

The critic's other items (columns, each faction laying its town out its own way) can
use the same machinery later.

### Placements

`PropPlacement { kind, x, y, z, facing (0–3), building? }`, in world units. The town
builder returns them with the town (`Town.props`). They come from the seed like the
rest of the town, so they aren't saved.

### Drawing (`render/PropsView.ts`)

- One geometry per kind. One `InstancedMesh` per kind per town, with each instance's
  matrix from its placement (position, facing, scale). The mesh's bounds are computed
  from its instances, so a town out of view is culled whole.
- The material is Lambert with vertex colours, like the terrain's. It shares the
  terrain's injected shader code for glow (lit more at night) and for the roof lift.
- Props cast and receive shadows, and are drawn in both passes of the water.

### The roof lift and the cutaway

The lift test in the terrain shader moves into a shared GLSL snippet
(`render/liftGlsl.ts`). The terrain and the props both include it and read the same
uniform objects that `RoofLifter` fills. So a signboard or porch rail on a lifted
building lifts with it. The cutaway works the same way.

### Reserved cells

A new block, `Block.Blocker`:
- invisible (the mesher draws nothing);
- solid to the walker, pathfinding and ships (`SOLID`);
- skipped by the picking raycast.

The town builder writes it into a prop's reserved cells. That keeps the captain out
of the ship on the stocks, and later out of carts or wells made as props.

### Night

Lantern props are light sources (`Game.lightSources`), with a halo, like the pier
lamps. So the nearest get a point light and a streak on the water.

### Part 2 tests

- Code-built models: expected dimensions and colours, and glow on the lantern glass.
- Placements: the same seed gives the same list. Every `floor` prop stands on
  something solid, and every `wall` prop hangs against something solid.
- Reserved cells get `Block.Blocker`. The walker can't enter them, and picking passes
  through them.
- The shared lift test hides a prop inside a lifted box (the `RoofLifter` tests,
  extended).
- A `.vox` prop loads and meshes (with a small fixture file).

## Order of work

Each step ends with the tests passing and a look at the game.
1. Shapes: the table, mesher, `topAt`, walker, pathfinding.
2. Towns use stairs and slabs.
3. Buildable stairs and slabs.
4. The props machinery: models, placements, `PropsView`, the shared lift test,
   `Block.Blocker`, night lights.
5. The first props in the towns.
6. Docs (`ARCHITECTURE.md`: voxel pipeline, towns, on foot, building, roadmap) and a
   visual critic pass on the towns, day and night.

## Risks

- **Old saves.** A save keeps every chunk the player changed whole. A town chunk the
  player changed keeps its old full-block rises. Harmless: they still work, as they
  did before.
- **Performance.** The shapes add a handful of faces each. The props cost about one
  draw call per kind per visible town, with small triangle counts. Measure CPU and GPU
  frame time in Haven at night before and after (the method used for the water:
  median of a GPU timer query and of the render call's CPU time). Look into it if
  either grows by more than 0.5 ms.
- **AO on shapes** is approximate. See the mesher section.
- **The Phase 10 branch is active.** This touches `worldgen/town.ts`,
  `ChunkRenderer` and `RoofLifter`, which that branch just wrote. Start only once it is
  merged, and rebase before each step if it moves.

## Success

- The captain, settlers and creatures walk up town streets and doorsteps on stairs,
  without scrambling.
- Players build plank and stone stairs and slabs in their camps, facing the way they
  choose.
- The towns show signboards, the clock, porches, lantern heads and a ship on the
  stocks that reads as a ship from above: the critic's porch, signboard, clock and
  ship items. All tests pass, and frame time is within the budget above.
