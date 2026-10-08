# Town Shops and Interiors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shop roofs that lift as a house's do, stalls and a hand cart that read at play zoom, rooms dressed with finer furniture laid out by role and size, and a keeper behind each shop's counter.

**Architecture:** `render/RoofLifter.ts` cuts every building at head height (two blocks above its floor), lets a line of sight go on past what it has lifted, and sees a prop's blocker as part of a structure. New props are drawn in code at an eighth of a block a voxel (`props/kit.ts`, `props/furniture.ts`, `props/market.ts`). Each has a shape in blocks (`props/shapes.ts`). The town builder stands them with `worldgen/furnish.ts`'s `standProp`, which writes the blocker three high into their cells and anchors each prop at its top cell. `worldgen/rooms.ts` lays a room out by role and size as pure cell maths, keeping the doorway and the way in clear, and says where the keeper stands. Keepers are townsfolk with a fixed `keep` task (`land/townsfolk.ts`), posted from `Port.keepers`. They're all there by day, and only the tavern's at night.

**Tech Stack:** TypeScript (strict), Vite, Vitest, vanilla Three.js (render only).

**Spec:** `docs/town-shops-and-interiors.md` (GitHub issues #1 to #4). Read it first: it's the authority. This plan argues from it.

## Global Constraints

- **World generation stays deterministic in `WORLD_SEED`.** Props, their blockers and keepers' posts come from the seed. Furnishing varies by `hash2` of the plot, never by a draw from any stream.
- **No save-format change.** Props and their blockers are placed in worldgen, before `trackEdits`, and townsfolk (keepers too) aren't saved. `SAVE_VERSION` stays 6. Towns in older saves keep their old blocks wherever the save's own chunks cover them (ARCHITECTURE, "Towns in older saves").
- **`Land.random` is shared** by creatures, townsfolk, drops, settlers and bandits. Keepers take no draws from it: their looks come from `hash2` of their post. Townsfolk's draws must stay exactly as they are (Task 6 pins this with a test).
- **Player-facing text and test names:** British spelling ("colour", "centre", "neighbour") and typographic apostrophes (’), as the codebase does.
- **Commits.** Each task ends with one commit on the branch `town-shops-and-interiors` (don't switch branches), made only when `npx vitest run` and `npx tsc --noEmit -p .` both pass. Stage by path, never `git add -A` or `.`. Never stage the repo-root MP3s or `.opencode/`. End every commit message with the line:
  `Claude-Session: https://claude.ai/code/session_01XGX2Zy161PcviqWzCXinMn`
- **Slow world-building tests get `20_000` ms** (`it(..., 20_000)`), as the others do. Build the worlds inside the test, not at module scope.
- **Props are authored in code** as cell lists (`Sketch`, as `props/models.ts` and `render/toolModels.ts` do). There are no `.vox` files and no paid generation. Every new prop is drawn at an eighth of a block a voxel.
- **Module boundaries.** `props` imports nothing from `render` or `ui`, and three.js only in `place.ts`. `worldgen` imports `props/shapes.ts` and `props/types.ts`, but never `props/place.ts`, which imports three.js.
- **Out of scope** (spec): talking to keepers, keepers' dialogue, opening hours that close a shop, image textures on blocks, paid assets, new shop kinds, and changing the town layout beyond moving stalls and carts clear of doors. The shop's E spot and its screens stay as they are.
- **The browser.** A dev server is already running at `http://localhost:5173`. Don't start or stop it. It serves the working tree, so after a worldgen change reload `/?new`. Close the browser when a look is done. See "Looking at it in the game" below.

## Review Focus

The cases the spec implies that a player will hit first. Each line names its test, in the task that owns the code.

1. **Turning the camera at a shop's door.** From any of the four quarter turns, the shop lifts and nothing is left between the captain and the camera. A stall's post must not use up the line of sight, a prop in the way goes, and stalls stand clear of doors.
   → Task 1 "looks past a stall in the way to the roof behind it"; Task 2 "takes a prop that keeps people out away when it’s in the way"; Task 3 "keep the stalls and the cart two clear of every door’s step, and out of the market’s front".
2. **The smallest rooms.** These are a three-wide house, or a tavern or office built on a house's lot. Furniture never stands in the doorway or cuts the way to the middle of the room.
   → Task 5 "keeps the door and the way in clear, in every room of every size" (every width 3 to 5, depth 3 to 5 and door column); Task 5 "leave every door and the way into each room clear" (the five real ports, by pathfinding).
3. **Walking into a stall, the cart or furniture.** Nobody walks through it or scrambles up on top (the walker climbs ledges of up to two).
   → Task 2 "sets it over its cells, anchored where its top is, and keeps people out of them three high"; Task 3 "keep everyone out of the stalls and the cart: nobody walks in or scrambles up on top".
4. **Day turning to night in town.** Keepers go at dusk, leaving only the tavern keeper, and come back at dawn. They're back after the captain leaves and lands again, and nobody else stands where they stand.
   → Task 6 "leave only the tavern keeper at night, and are all back in the morning"; "are gone when the captain leaves town, and back behind their counters when they land"; "post a keeper in each shop with a building of its own".
5. **Frame time with furniture in every town.** A town that's off screen isn't drawn.
   → Task 2 "gives each town its own mesh of a kind, so a town that’s off screen isn’t drawn"; Task 5's browser step compares frame time and triangles with Task 1's baseline.

## Findings: why shop roofs seemed not to lift (#2)

The cause was measured in the browser, not guessed. Screenshots are in `.playwright-mcp/plan-town-01…15-*.png`. Those files aren't in git.

- **The lifter does find and lift every shop.** This held at the shop's spot and inside it, for the market hall, tavern, office and shipyard shed, in Haven, Port Clemency (free), Kingsreach (Crown) and Rook's Nest. `RoofLifter.lookNear` found each shop's box at its spot, and a scan of every cell within 2 of each shop found no misses inside.
- **The spec's first guess is ruled out.** It said the market and shed have no door, so the spot is too far from their roofs. In fact both stand points lie under the building's own eaves, at distance 0 (Haven's market box is x −15…−7 and its spot is at x −7.5).
- **What does differ from a house, and reads as "the roof stays on":**
  1. **Shops are cut a storey up.** The tavern and office have two storeys (three in Crown ports), so `structureAt` lifts them from `y0 + STOREY − 0.5`, which is 2.5 above the floor. Their whole three-high ground-floor walls stay. So do the door jambs carried up to that height, and the signboard and door lantern anchored on those jambs. The porch posts (props with no anchor) stand on after their canopy has gone. A one-storey house is cut at its eaves, 1.5 above the floor, with 2-high walls. Compare screenshots 02 and 05 with 13.
  2. **A line of sight lifts only the first thing it meets.** A ray that hits a stall's post lifts the stall, though nothing of the stall is above its cut, and then stops. The market's roof behind it stays on and hides the captain. Measured at Haven: captain at (−4.5, 18, 46.5), camera from the north-west. The ray hit Wood at (−6, 20, 45), and the market's thatch at (−8, 23, 43) stayed. See screenshot 15. This is also the open ARCHITECTURE note about Kingsreach's street, where "a roof hides the captain and doesn't lift".
  3. **The market's stalls stand in its front.** Their awnings (Canvas and Awning blocks, not cutaway) sit 3 up, a cell before the hall. From the default (south-east) and north-east cameras, the line from the captain at the market's door to the camera passes through a stall's Canvas at (−6, 21, 44). See screenshots 01 and 10.
- **Fixes:**
  - Cause 1: cut at head height (Task 1), and anchor the porch posts to their canopy (Task 1).
  - Cause 2: lines of sight go on through what they've lifted (Task 1), and the lifter sees a prop's blocker (Task 2).
  - Cause 3: the stalls become props set back from the doors (Task 3).

## Rulings (decided while planning, on best judgement as the spec asks)

- **Every building is cut at head height**, two blocks above its floor (`STOREY = 2`), or at its eaves if lower. "As with a house": a two-storey shop now shows its room as a one-storey house does. The signboard and door lantern go with the jambs they hang on (above the cut), and the porch posts go with their canopy. The spec's "porch canopy, hanging sign, wall lanterns" are all covered.
- **A line of sight goes on through up to three trees or buildings** it has lifted (`THROUGH = 3`).
- **"At least 2 clear of any door's step"** means two empty cells between: every stall or cart cell is at least 3 from the step (the larger of the two grid distances).
- **"A stall sits beside the market's front, not in it."** Two stalls, three across and two deep, flank the column of the market's door. Their fronts face the square's middle, and two clear rows lie between their backs and the market's step. At Crown and Brethren ports the seaward stall stands just behind the gun at the square's edge. Guns don't move, because layout changes are out of scope.
- **Four stall kinds:** produce or cloth, under a red or blue awning. Blue is at the free port only, as before. The cart (a hand cart of timber) keeps its old place by the shipyard. The Brethren keep their gallows there instead.
- **What keeps people out, and how high.** A stall, the cart, the hall's counters and all furniture except stools, chairs and rugs keep people out of their cells, three high, so nobody scrambles on top (the walker climbs two). Rugs are walked on. Stools and chairs tuck in at tables.
- **The lifter sees a prop's blocker** as a block of planks. A stall or the cart in the way lifts, and goes whole by its anchor (its top cell). Furniture is two blocks high at most and is never above the cut, so it never goes.
- **"The middle of the room"** (for "nothing blocks … the way from the door to the middle") means a cell within one of the room's centre. The house's table can then stand at the centre.
- **"An end wall"** for the hearth means a side wall, across the room from the bed.
- **Keepers' looks come from where they stand** (`hash2`), dressed for the port and never as a soldier. They take no draw from `Land.random`, and they look the same each visit. They simply go at dusk (no walk home) and come back at dawn.
- **The shipwright** stands inside the shed by the timber, looking out to the square. He swings his hammer as the yard's townsfolk do.
- **Hearths and candles glow** after dark (the glow flag). They get no point lights of their own.
- **Props are drawn one mesh a kind a town** (was one a kind for all towns), so a town off screen isn't drawn.

---

## Looking at it in the game

Every task that changes what you see ends with a look in the browser. Use the Playwright tools (`mcp__plugin_playwright_playwright__*`, loaded with ToolSearch).

1. Resize to 1280 × 800. Navigate to `http://localhost:5173/?new`, wait 5 s, and click **Skip**.
2. Press `b`. The ship starts at Haven's berth, so this docks and puts the captain on the pier.
3. Install the helpers with `browser_evaluate`:

```js
() => {
  window.tp = (x, y, z) => { const w = game.land.walker; Object.assign(w, { x, y, z, vx: 0, vz: 0, vy: 0 }); Object.assign(w.prev, { x, y, z }); };
  window.lifts = () => { const u = game.terrain.lifts.uniforms; return u.uLiftBox.value.map((b, k) => ({ x0: b.x, z0: b.y, x1: b.z, z1: b.w, from: u.uLiftFrom.value[k] })).filter((l) => l.from < 1e5); };
  window.place = (kind) => game.sea.docked.places.find((p) => p.kind === kind);
  // Two cells in from a place's stand point: inside the room (a free floor cell, through an open doorway).
  window.inside = (kind) => { const p = place(kind), W = game.world, y = Math.floor(p.y), [px, pz] = [Math.floor(p.x), Math.floor(p.z)];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const [x, z] = [px + dx * 2, pz + dz * 2];
      if (W.getVoxel(x, y - 1, z) === 9 && W.getVoxel(x, y, z) === 0 && W.getVoxel(px + dx, y + 1, pz + dz) === 0) return { x: x + 0.5, y, z: z + 0.5 }; }
    return null; };
  window.toPort = async (i) => { game.setSail(); await new Promise((r) => setTimeout(r, 500)); const p = game.ports[i];
    Object.assign(game.sea.player.ship, { x: p.x, z: p.z, heading: p.heading, surge: 0 }); await new Promise((r) => setTimeout(r, 1500)); };
  window.frames = async () => { const t = []; let last = performance.now();
    for (let i = 0; i < 120; i++) { await new Promise((r) => requestAnimationFrame(r)); const now = performance.now(); t.push(now - last); last = now; }
    t.sort((a, b) => a - b); const info = game.renderer.info.render; return { median: t[60].toFixed(1), p90: t[108].toFixed(1), triangles: info.triangles, calls: info.calls }; };
  return 'ok';
}
```

4. **Ports.** `game.ports`: 0 Haven, 1 Port Clemency (free), 2 Rook's Nest (Brethren), 3 Kingsreach (Crown), 4 Castell Sorn (Crown). To go to one, `await toPort(i)`, then press `b` to dock. Install the helpers again only after a reload.
5. **Standing somewhere.** At a shop's spot: `tp(place('tavern').x, place('tavern').y, place('tavern').z)`. Inside it: `const p = inside('tavern'); tp(p.x, p.y, p.z)`. Wait about 1.5 s before taking a screenshot.
6. **Camera.** Turn it with `game.rig.targetYaw = Math.PI / 4 * (1 + 2 * n)`. n = 0 is south-east (the default), 1 north-east, 2 north-west and 3 south-west.
7. **Time of day.** Day is `game.sea.clock.phase = 0.3`. Night is `game.sea.clock.phase = 0.85`.
8. **Screenshots.** Use `browser_take_screenshot` with `filename: '.playwright-mcp/<prefix>-NN-<what>.png'`, then Read each one and look at it. `lifts()` lists what's lifted. `game.land.townsfolk` lists the townsfolk.
9. Close the browser when done (`browser_close`).

---

## File map

| File | Task | Change |
|---|---|---|
| `src/render/RoofLifter.ts` | 1, 2 | Cut at head height. A line of sight goes on through what it has lifted. (2) It sees a prop's blocker. |
| `src/render/RoofLifter.test.ts` | 1, 2 | An open hall, a three-sided shed, a two-storey shop with a porch, looking past a stall. (2) A prop's blocker. |
| `src/render/shopLift.test.ts` (new) | 1 | Every shop in the five real ports lifts from its spot and from every floor cell inside. |
| `src/worldgen/town.ts` | 1, 3, 5, 6 | (1) Porch posts anchored to the canopy. (3) Stalls and the cart become props. (5) Rooms and the hall's interior are furnished with props. (6) Keepers' posts. |
| `src/worldgen/town.test.ts` | 1, 3, 5, 6 | Matching tests. Old block-stall and block-furniture checks are replaced. |
| `src/props/types.ts` | 2, 3, 4 | New kinds. |
| `src/props/shapes.ts` (new) | 2, 3, 4 | `PropShape`, `PROP_SHAPES`, `shapeCells`. |
| `src/props/shapes.test.ts` (new) | 2 | Every finer model fits its shape. `shapeCells` turns. |
| `src/props/kit.ts` (new) | 2 | The new props' colours. `kit`, `barrelAt`, `crateAt`, `basketAt`. |
| `src/props/furniture.ts` (new) | 2, 4 | (2) Barrel, crate. (4) Bed, table, stool, chair, shelves, chest, hearth, rug, runner, bar, bar with a cask, desk. |
| `src/props/market.ts` (new) | 3, 4 | (3) Stalls, the hand cart. (4) The hall's counters. |
| `src/props/catalog.ts` | 2, 3, 4 | New kinds in `propCatalog`. |
| `src/props/models.test.ts` | 4 | What glows. Room furniture stays under head height. Rugs lie flat. |
| `src/render/PropsView.ts` | 2 | One mesh a kind a town. |
| `src/render/PropsView.test.ts` | 2 | The meshes become a list. Towns are drawn apart. |
| `src/worldgen/furnish.ts` (new) | 2, 3, 5 | (2) `standProp`. (3) `plotCells`. (5) `furnish`, `Post`. |
| `src/worldgen/furnish.test.ts` (new) | 2, 3, 5 | Matching tests. |
| `src/worldgen/rooms.ts` (new) | 5 | `layRoom` and its types. |
| `src/worldgen/rooms.test.ts` (new) | 5 | Layouts for every role and size. |
| `src/economy/ports.ts` | 6 | `KeeperPost`, `Port.keepers`. |
| `src/worldgen/harbour.ts` | 6 | `Harbour.keepers`. |
| `src/land/townsfolk.ts` | 6 | The `keep` task, `keeping`, `keeperLook`, `postedBy`. |
| `src/land/townsfolk.test.ts` | 6 | Keepers. |
| `src/render/PeopleView.ts` | 6 | The shipwright's hammer. |
| `docs/ARCHITECTURE.md` | 7 | Towns, props, the view, townsfolk, the module map, the roadmap. |

---

### Task 1: Shop roofs lift as a house's do

**Files:**
- Modify: `src/render/RoofLifter.ts` (constants at lines 20–38, the class comment at 57–63, `update` at lines 87–114)
- Modify: `src/render/RoofLifter.test.ts` (new `describe('shops')` block at the end)
- Create: `src/render/shopLift.test.ts`
- Modify: `src/worldgen/town.ts` (`buildPorch`, the porch-post line at ~1023)
- Modify: `src/worldgen/town.test.ts` (a new test after "build porches before the tavern and the office…")

**Interfaces:**
- Consumes: `RoofLifter.update(focus, feet, camera, dt, near)` and `Lift` (unchanged); `buildHouse`, `Footprint` from `worldgen/buildings.ts`; `buildHarbour`, `planArchipelago`, `generateIsland`.
- Produces:
  - `STOREY = 2` (module constant in RoofLifter.ts).
  - `THROUGH = 3`.
  - `holds(l: Lift, x, y, z): boolean` (module function, the shader's test).
  - Porch posts' `anchor` is the canopy slab over them, at `door.y + 3`.

- [ ] **Step 1: Write the failing RoofLifter tests**

Append inside the outer `describe('RoofLifter', …)` in `src/render/RoofLifter.test.ts`, after `describe('in town', …)`. No new imports are needed (`Block`, `VoxelWorld`, `buildHouse`, `Footprint`, `village`, `lifted`, `GROUND` and `BASE` are already there).

```ts
  describe('shops', () => {
    /** Flat grass round the shop. */
    function flat() {
      const world = new VoxelWorld();
      for (let x = -12; x < 30; x++) for (let z = -20; z < 20; z++) for (let y = 0; y <= GROUND; y++) world.setVoxel(x, y, z, Block.Grass);
      return world;
    }
    /** The camera straight over the captain, so only nearness lifts. */
    const overhead = (x: number, z: number) => ({ x, y: BASE + 40, z: z + 0.01 });
    /** The blocks of these kinds in a plot and a block round it. */
    function blocks(world: VoxelWorld, f: Footprint, ids: readonly number[]): Array<[number, number, number]> {
      const out: Array<[number, number, number]> = [];
      for (let x = f.x0 - 1; x <= f.x0 + f.w; x++) {
        for (let z = f.z0 - 1; z <= f.z0 + f.d; z++) for (let y = BASE; y < BASE + 12; y++) if (ids.includes(world.getVoxel(x, y, z))) out.push([x, y, z]);
      }
      return out;
    }

    /**
     * An open hall like the market's: posts at the corners and every other cell down both
     * sides, a wall across the back, open at the front (toward −z), under a gable roof whose
     * ridge runs along the front, its eaves at head height.
     */
    function openHall(world: VoxelWorld, f: Footprint): void {
      const [x1, z1] = [f.x0 + f.w - 1, f.z0 + f.d - 1];
      for (let x = f.x0; x <= x1; x++) {
        for (let z = f.z0; z <= z1; z++) {
          world.setVoxel(x, BASE - 1, z, Block.Planks);
          const side = x === f.x0 || x === x1;
          if (z === z1) for (let y = BASE; y < BASE + 3; y++) world.setVoxel(x, y, z, Block.Plaster);
          else if (side && (z - f.z0) % 2 === 0) for (let y = BASE; y < BASE + 3; y++) world.setVoxel(x, y, z, Block.Wood);
        }
      }
      for (let x = f.x0 - 1; x <= x1 + 1; x++) {
        for (let z = f.z0 - 1; z <= z1 + 1; z++) world.setVoxel(x, BASE + 3 + Math.round((f.d + 1) / 2 - Math.abs(z - (f.z0 + (f.d - 1) / 2))) - 1, z, Block.Thatch);
      }
    }

    /**
     * A shipyard's shed: a plank wall across the back and up one end, posts at the open
     * corners, a gable roof with its ridge along the shed, and timber stacked against the
     * back. Open at the front (toward −z) and at the other end.
     */
    function shed(world: VoxelWorld, f: Footprint): void {
      const [x1, z1] = [f.x0 + f.w - 1, f.z0 + f.d - 1];
      for (let x = f.x0; x <= x1; x++) {
        for (let z = f.z0; z <= z1; z++) {
          world.setVoxel(x, BASE - 1, z, Block.Planks);
          const wall = z === z1 || x === x1;
          const post = (x === f.x0 || x === x1) && (z === f.z0 || z === z1);
          if (wall || post) for (let y = BASE; y < BASE + 3; y++) world.setVoxel(x, y, z, wall ? Block.Planks : Block.Wood);
        }
      }
      const half = (f.d - 1) / 2 + 1;
      for (let x = f.x0 - 1; x <= x1 + 1; x++) {
        for (let z = f.z0 - 1; z <= z1 + 1; z++) world.setVoxel(x, BASE + 3 + Math.round(half - Math.abs(z - (f.z0 + (f.d - 1) / 2))) - 1, z, Block.Thatch);
      }
      for (let x = f.x0 + 1; x < x1; x++) for (let y = BASE; y < BASE + 2; y++) world.setVoxel(x, y, z1 - 1, Block.Wood);
    }

    it('lifts an open market hall’s roof whole, from the middle of its open front and from inside, and leaves its posts to head height', () => {
      const world = flat();
      const hall: Footprint = { x0: 10, z0: -6, w: 6, d: 6 };
      openHall(world, hall);
      for (const [x, z] of [[12.5, -6.5], [12.5, -3.5]]) {
        const lifts = new RoofLifter(world).update({ x, y: BASE + 1.2, z }, BASE, overhead(x, z), 1 / 60, 2);
        expect(blocks(world, hall, [Block.Thatch]).filter(([bx, by, bz]) => !lifted(lifts, bx, by, bz)), `thatch left, from ${x},${z}`).toEqual([]);
        expect(blocks(world, hall, [Block.Wood, Block.Plaster]).filter(([bx, by, bz]) => by < BASE + 2 && lifted(lifts, bx, by, bz)), `lifted below head height, from ${x},${z}`).toEqual([]);
      }
    });

    it('lifts a three-sided shed’s roof whole, from its open front and from inside, and leaves its walls to head height', () => {
      const world = flat();
      const yard: Footprint = { x0: 10, z0: -6, w: 5, d: 5 };
      shed(world, yard);
      for (const [x, z] of [[12.5, -6.5], [11.5, -4.5]]) {
        const lifts = new RoofLifter(world).update({ x, y: BASE + 1.2, z }, BASE, overhead(x, z), 1 / 60, 2);
        expect(blocks(world, yard, [Block.Thatch]).filter(([bx, by, bz]) => !lifted(lifts, bx, by, bz)), `thatch left, from ${x},${z}`).toEqual([]);
        expect(blocks(world, yard, [Block.Wood, Block.Planks]).filter(([bx, by, bz]) => by < BASE + 2 && lifted(lifts, bx, by, bz)), `lifted below head height, from ${x},${z}`).toEqual([]);
      }
    });

    it('cuts a two-storey shop at head height from its porch, canopy, jambs and all, as a house is cut', () => {
      const world = flat();
      const plot: Footprint = { x0: 0, z0: 0, w: 7, d: 6 };
      const door = buildHouse(world, plot, BASE, { walls: Block.Plaster, roof: Block.Thatch }, 3.5, -10, 2);
      // A porch as the town builds one: a deck of plank slabs three wide and two deep, a canopy
      // over it a storey up, and the doorway opened a storey high, its jambs carried up beside it.
      for (let k = 1; k <= 2; k++) {
        for (let a = -1; a <= 1; a++) {
          world.setVoxel(door.x + a, BASE, door.z - k, Block.PlanksSlab);
          world.setVoxel(door.x + a, BASE + 3, door.z - k, Block.PlanksSlab);
        }
      }
      world.setVoxel(door.x, BASE + 2, door.z, Block.Air);
      for (const a of [-1, 1]) for (let y = BASE; y <= BASE + 2; y++) world.setVoxel(door.x + a, y, door.z, Block.Wood);
      // The captain on the deck, half a block up, before the door.
      const [x, z] = [door.x + 0.5, door.z - 0.5];
      const lifts = new RoofLifter(world).update({ x, y: BASE + 1.7, z }, BASE + 0.5, overhead(x, z), 1 / 60, 2);
      const withPorch: Footprint = { x0: plot.x0, z0: plot.z0 - 2, w: plot.w, d: plot.d + 2 };
      const shop = blocks(world, withPorch, [Block.Plaster, Block.Window, Block.Wood, Block.Thatch, Block.PlanksSlab]);
      expect(shop.filter(([bx, by, bz]) => by >= BASE + 2 && !lifted(lifts, bx, by, bz)), 'left standing from head height up').toEqual([]);
      expect(shop.filter(([bx, by, bz]) => by < BASE + 2 && lifted(lifts, bx, by, bz)), 'lifted below head height').toEqual([]);
    });

    it('looks past a stall in the way to the roof behind it', () => {
      const world = village();
      // A stall's corner post between the captain and the house, and the camera beyond the house.
      for (let y = BASE; y < BASE + 3; y++) world.setVoxel(3, y, -4, Block.Wood);
      const chest = { x: 3.5, y: BASE + 1.2, z: -6.5 };
      const camera = { x: 3.5, y: BASE + 8, z: 16 };
      const lifts = new RoofLifter(world).update(chest, BASE, camera, 1 / 60);
      const d = Math.hypot(camera.x - chest.x, camera.y - chest.y, camera.z - chest.z);
      const inTheWay: string[] = [];
      for (let t = 0; t < d; t += 0.05) {
        const [x, y, z] = [chest.x, chest.y, chest.z].map((c, i) => Math.floor(c + (([camera.x, camera.y, camera.z][i] - c) * t) / d));
        if ([Block.Plaster, Block.Window, Block.Thatch, Block.Wood].includes(world.getVoxel(x, y, z) as never) && !lifted(lifts, x, y, z)) inTheWay.push(`${x},${y},${z}`);
      }
      expect(inTheWay).toEqual([]);
    });
  });
```

- [ ] **Step 2: Run them to see which fail**

Run: `npx vitest run src/render/RoofLifter.test.ts`

Expected:
- "lifts an open market hall’s roof whole…" and "lifts a three-sided shed’s roof whole…" PASS already. They pin the shapes the spec asks to cover.
- "cuts a two-storey shop at head height…" FAILS: `left standing from head height up` lists blocks at `y = BASE + 2` (the old cut is 2.5 up).
- "looks past a stall in the way…" FAILS: `inTheWay` lists the thatch at `3,13,-1`.

- [ ] **Step 3: Write the failing real-town test**

Create `src/render/shopLift.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Block, BLOCK_PALETTE } from '../voxel/blocks';
import { FLAG_CUTAWAY } from '../voxel/palette';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { planArchipelago } from '../worldgen/archipelago';
import type { Footprint } from '../worldgen/buildings';
import { buildHarbour } from '../worldgen/harbour';
import { generateIsland } from '../worldgen/island';
import { type Lift, RoofLifter } from './RoofLifter';

/** As the terrain shader tests it: the middle of the voxel, inside a box and above where it lifts from. */
const lifted = (lifts: Lift[], x: number, y: number, z: number) =>
  lifts.some((l) => y + 0.5 > l.from && x + 0.5 > l.x0 && x + 0.5 < l.x1 && z + 0.5 > l.z0 && z + 0.5 < l.z1);
const cutaway = (id: number) => ((BLOCK_PALETTE.flags?.[id] ?? 0) & FLAG_CUTAWAY) !== 0;
/** How far (x, z) lies outside a plot, in blocks either way (0 inside it). */
const outside = (f: Footprint, x: number, z: number) => Math.max(f.x0 - x, x - (f.x0 + f.w - 1), f.z0 - z, z - (f.z0 + f.d - 1), 0);

describe('shops in the real ports', () => {
  it('lift from their door and from anywhere inside, down to head height, as a house does', () => {
    let stands = 0;
    planArchipelago(1717)
      .filter((plan) => plan.port)
      .forEach((plan, i) => {
        const world = new VoxelWorld();
        generateIsland(world, plan);
        const harbour = buildHarbour(world, plan, plan.port!.faction, i === 0);
        const yard = harbour.places.find((p) => p.kind === 'shipyard')!;
        for (const place of harbour.places) {
          // A shop with no building of its own shares the shipyard's way in.
          if (place.kind !== 'shipyard' && place.x === yard.x && place.z === yard.z) continue;
          const plot = place.kind === 'shipyard' ? harbour.town.shed : harbour.town.houses.find((h) => outside(h, Math.floor(place.x), Math.floor(place.z)) <= 1)!;
          const floor = Math.floor(place.y);
          // The shop from head height up: everything of it that lifts, in its plot and its eaves.
          const shop: Array<[number, number, number]> = [];
          for (let x = plot.x0 - 1; x <= plot.x0 + plot.w; x++) {
            for (let z = plot.z0 - 1; z <= plot.z0 + plot.d; z++) {
              for (let y = floor + 2; y < floor + 16; y++) if (cutaway(world.getVoxel(x, y, z))) shop.push([x, y, z]);
            }
          }
          // Where the captain stands: at the door, and on every clear floor cell inside.
          const at = [{ x: place.x, y: place.y, z: place.z }];
          for (let x = plot.x0 + 1; x < plot.x0 + plot.w - 1; x++) {
            for (let z = plot.z0 + 1; z < plot.z0 + plot.d - 1; z++) {
              const clear = world.getVoxel(x, floor, z) === Block.Air && world.getVoxel(x, floor + 1, z) === Block.Air && world.getVoxel(x, floor - 1, z) !== Block.Air;
              if (clear) at.push({ x: x + 0.5, y: floor, z: z + 0.5 });
            }
          }
          for (const p of at) {
            stands++;
            const lifts = new RoofLifter(world).update({ x: p.x, y: p.y + 1.2, z: p.z }, p.y, { x: p.x, y: p.y + 40, z: p.z + 0.01 }, 1 / 60, 2);
            const left = shop.filter(([x, y, z]) => !lifted(lifts, x, y, z));
            expect(left, `${plan.port!.name} ${place.kind}, the captain at ${p.x},${p.y},${p.z}`).toEqual([]);
          }
        }
      });
    expect(stands).toBeGreaterThan(40);
  }, 20_000); // builds all five ports and lifts from every cell of every shop
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `npx vitest run src/render/shopLift.test.ts`

Expected: FAIL on the first tavern or office, for example `Haven tavern, the captain at 3.5,22.5,30.5`, listing its walls and jambs at `floor + 2`.

- [ ] **Step 5: Cut at head height, and let a line of sight go on through what it has lifted**

In `src/render/RoofLifter.ts`, replace the `STOREY` constant (lines 27–28):

```ts
/**
 * Blocks from this far above the floor lift: head height, where a one-storey house's eaves
 * are, so every building's room shows alike (the floor above, the roof, a porch's canopy
 * and the top of a doorway go; the walls stay two high).
 */
const STOREY = 2;
/**
 * A line of sight goes on through what it has lifted to what's behind, through this many trees
 * and buildings at most: a stall's post in front of a shop would otherwise keep the shop's roof on.
 */
const THROUGH = 3;
```

After `const box = …` (line 54), add:

```ts
/** Is the voxel at (x, y, z) lifted away by this box? The shader's test, at the voxel's middle. */
const holds = (l: Lift, x: number, y: number, z: number) => y + 0.5 > l.from && x + 0.5 > l.x0 && x + 0.5 < l.x1 && z + 0.5 > l.z0 && z + 0.5 < l.z1;
```

Replace the class comment's first sentences (lines 57–63) with:

```ts
/**
 * Lifts roofs and canopies out of the way on foot. Each frame it looks from the captain
 * toward the camera; a tree or building in the way is found whole (its connected blocks)
 * and lifted from head height above its floor, or from its eaves, so the rooms below show,
 * as in a doll's house, and the line of sight goes on through it to whatever's behind. In
 * town it also lifts every building near the captain, so the streets, doors and rooms round
 * them show too. Plain presentation over the world.
 */
```

Replace the body of the `for (const [ox, oy, oz] of origins)` loop in `update` (lines 98–113) with:

```ts
    for (const [ox, oy, oz] of origins) {
      const x = focus.x + ox;
      const y = focus.y + oy;
      const z = focus.z + oz;
      const d = Math.hypot(camera.x - x, camera.y - y, camera.z - z) || 1;
      const [dx, dy, dz] = [(camera.x - x) / d, (camera.y - y) / d, (camera.z - z) / d];
      // On through what this line has lifted already, to whatever's behind it.
      const passed: Lift[] = [];
      const clear: VoxelReader = { getVoxel: (vx, vy, vz) => (passed.some((l) => holds(l, vx, vy, vz)) ? Block.Air : this.structures.getVoxel(vx, vy, vz)) };
      for (let n = 0; n < THROUGH; n++) {
        const hit = raycastVoxels(clear, x, y, z, dx, dy, dz, Math.min(d, 40));
        if (!hit) break;
        const known = this.held.find((l) => holds(l, hit.x, hit.y, hit.z));
        if (known) {
          known.until = this.clock + HOLD_SECONDS;
          passed.push(known);
          continue;
        }
        // Lifted from where it would be anyway, or lower if that's where the line of sight
        // runs through it (the captain just behind a tall building's wall).
        const found = this.structureAt(hit.x, hit.y, hit.z, feet, new Set());
        if (!found) break;
        const lift = { ...box(found), from: Math.min(found.from, hit.y - 0.5), until: this.clock + HOLD_SECONDS };
        this.held.push(lift);
        passed.push(lift);
      }
    }
```

In `structureAt`'s comment, change "it lifts from a storey above its floor" to "it lifts from head height above its floor".

- [ ] **Step 6: Anchor the porch posts to their canopy**

In `src/worldgen/town.ts`, `buildPorch`, replace:

```ts
  for (const s of [-1.25, 1.25]) decor.push({ kind: 'porchPost', ...at(deep - 0.25, s), y: door.y + 0.5, facing, anchor: null });
```

with:

```ts
  // The posts hold up the canopy, and go with it when the roof lifts on foot.
  for (const s of [-1.25, 1.25]) decor.push({ kind: 'porchPost', ...at(deep - 0.25, s), y: door.y + 0.5, facing, anchor: { ...cell(Math.sign(s), deep), y: door.y + 3 } });
```

In `src/worldgen/town.test.ts`, add after the test "build porches before the tavern and the office…":

```ts
  it('anchor each porch post to the canopy over it, so the posts go when the roof lifts', () => {
    for (const { name, world, harbour } of PORTS) {
      const posts = harbour.decor.filter((d) => d.kind === 'porchPost');
      expect(posts.length, name).toBeGreaterThan(0);
      for (const p of posts) {
        const a = p.anchor;
        expect(a, `${name} post at ${p.x},${p.z}`).not.toBeNull();
        expect(world.getVoxel(a!.x, a!.y, a!.z), `${name} canopy over the post at ${p.x},${p.z}`).toBe(Block.PlanksSlab);
        expect(a!.y, `${name} post at ${p.x},${p.z}`).toBe(Math.floor(p.y) + 3);
        expect([Math.floor(p.x), Math.floor(p.z)], `${name} post at ${p.x},${p.z}`).toEqual([a!.x, a!.z]);
      }
    }
  });
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/render/RoofLifter.test.ts src/render/shopLift.test.ts src/worldgen/town.test.ts`

Expected: all PASS. The earlier RoofLifter tests still pass: a one-storey house is cut at its eaves as before, and the walls below head height stay.

- [ ] **Step 8: Look in the game, and record the baseline**

Follow "Looking at it in the game". Screenshot to `.playwright-mcp/t1-NN-*.png`:

1. Haven, the tavern from its spot and from inside (camera south-east). The walls are cut to two high. The canopy, the porch posts, the signboard and the door lantern are gone with the roof. The room shows.
2. Haven, the office from its spot.
3. Haven, `tp(-4.5, 18, 46.5)` with the camera north-west (`n = 2`). This is the measured failing case. The market's roof is now lifted. The stall's own awning (still blocks, until Task 3) may still cover the captain.
4. Kingsreach, the street between the tavern and the Governor's House, `tp(-812.5, 16, -963.5)`, camera south-west (`n = 3`). No roof hides the captain.
5. The baseline for Task 5: stand on Haven's square at night (`tp(-1.5, 18, 42.5)`, `phase = 0.85`) and record `await frames()` (median, p90, triangles, calls) in the task's report.

Close the browser.

- [ ] **Step 9: Run everything and commit**

Run: `npx vitest run` and `npx tsc --noEmit -p .`. Expected: all pass, no type errors.

```bash
git add src/render/RoofLifter.ts src/render/RoofLifter.test.ts src/render/shopLift.test.ts src/worldgen/town.ts src/worldgen/town.test.ts
git commit -m "$(cat <<'EOF'
Shop roofs lift as a house's do: cut at head height, the porch posts with their canopy, and lines of sight that look past a stall

Claude-Session: https://claude.ai/code/session_01XGX2Zy161PcviqWzCXinMn
EOF
)"
```

---

### Task 2: Props finer than a block that keep people out

**Files:**
- Create: `src/props/kit.ts`, `src/props/shapes.ts`, `src/props/shapes.test.ts`, `src/props/furniture.ts`
- Create: `src/worldgen/furnish.ts`, `src/worldgen/furnish.test.ts`
- Modify: `src/props/types.ts`, `src/props/catalog.ts`
- Modify: `src/render/RoofLifter.ts` (the constructor's reader), `src/render/RoofLifter.test.ts`
- Modify: `src/render/PropsView.ts`, `src/render/PropsView.test.ts`

**Interfaces:**
- Consumes: `Sketch` (`props/sketch.ts`), `PropKind`, `PropModel`, `PropPlacement`, `FACING_DIRS`, `Block`, `VoxelWorld`.
- Produces:
  - `props/kit.ts`:
    - `COLOURS` and `type Colour = keyof typeof COLOURS`.
    - `kit(...names: Colour[]): Sketch`.
    - `EIGHTH = 1 / 8`.
    - `barrelAt(s, x0, y0, z0, high = 8)` (6 × 6 across). Needs `stave`, `staveDark`, `hoop`, `lid`.
    - `crateAt(s, x0, y0, z0, w, h, d)`. Needs `crate`, `crateLight`, `crateDark`.
    - `basketAt(s, x0, y0, z0, goods: Colour)` (4 × 4, 3 high). Needs `wicker`, `wickerDark`, `goods`.
  - `props/shapes.ts`:
    - `interface PropShape { w: number; d: number; h: number; blocks: boolean }`.
    - `PROP_SHAPES: Partial<Record<PropKind, PropShape>>`.
    - `shapeCells(p: PropPlacement, shape: { w: number; d: number }): Array<{ x: number; z: number }>`.
  - `props/furniture.ts`: `barrel(): PropModel`, `crate(): PropModel`.
  - New `PropKind`s: `'barrel' | 'crate'`.
  - `worldgen/furnish.ts`:
    - `interface Cells { x0: number; z0: number; x1: number; z1: number }` (both ends included).
    - `KEEP_OUT = 3`.
    - `standProp(world, decor, kind, cells, y, facing): PropPlacement`. It throws if the cells aren't the kind's shape turned to `facing`. The anchor is `{ x: floor((x0+x1)/2), y: y + max(0, ceil(h) − 1), z: floor((z0+z1)/2) }`. If the shape blocks, it fills the air in its cells `KEEP_OUT` high with `Block.Blocker`.
  - `RoofLifter` reads `Block.Blocker` as `Block.Planks`.
  - `PropsView.meshes: Map<PropKind, InstancedMesh[]>`, one mesh a kind a town (`TOWN_REACH = 150`).

- [ ] **Step 1: Add the kinds**

In `src/props/types.ts`, extend the union and the list:

```ts
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
  | 'hullOnStocks'
  | 'barrel'
  | 'crate';

/** Every prop kind, in one list. */
export const PROP_KINDS: readonly PropKind[] = ['lantern', 'wallLantern', 'signTavern', 'signOffice', 'signpostMarket', 'signpostShipyard', 'clock', 'porchPost', 'porchRail', 'hullOnStocks', 'barrel', 'crate'];
```

- [ ] **Step 2: Write the kit**

Create `src/props/kit.ts`:

```ts
import { Sketch } from './sketch';

/**
 * The colours the town's finer props are drawn in (furniture, stalls, the cart), by name, in
 * sRGB hex as a paint program shows it. A few to each prop, so it reads at a glance.
 */
export const COLOURS = {
  // Wood: timber for frames and posts, planks for boards and tops, walnut for the better pieces.
  timber: 0x6b4a2b,
  timberDark: 0x4a3320,
  plank: 0xa57b4c,
  plankDark: 0x8a6238,
  plankLight: 0xc0925a,
  walnut: 0x5a3a22,
  stave: 0x8a5a2e,
  staveDark: 0x6e4524,
  hoop: 0x2f3237,
  lid: 0xa57b4c,
  crate: 0x9a7444,
  crateLight: 0xae8650,
  crateDark: 0x6e5030,
  bark: 0x6e4a2a,
  grain: 0xc9a06a,
  chest: 0x7a4a24,
  // Metal and stone.
  iron: 0x2f3237,
  ironLight: 0x5a5f66,
  gold: 0xe0b83a,
  pewter: 0x9aa0a6,
  stone: 0x8f9193,
  stoneDark: 0x6e7073,
  soot: 0x2a2624,
  // Fire: these glow after dark.
  ember: 0xf07a22,
  flame: 0xffc04a,
  // Cloth.
  linen: 0xf4f0e6,
  canvas: 0xece2c8,
  sack: 0xc9b283,
  blanket: 0xa63a2e,
  blanketDark: 0x7e2a22,
  rug: 0x9a2f2a,
  rugBorder: 0xc9a24a,
  rugMotif: 0x2b3f6b,
  awningRed: 0xb8422e,
  awningBlue: 0x356aa3,
  clothPurple: 0x7d4a93,
  clothBlue: 0x3f6590,
  clothOchre: 0xc9a24a,
  // Goods and wares.
  wicker: 0xc49a5a,
  wickerDark: 0xa07a40,
  greens: 0x78b33c,
  fruit: 0xe8892a,
  apple: 0xc23b2b,
  crockery: 0xe9e4d8,
  blueWare: 0x4a6f9a,
  clay: 0xb5653a,
  foam: 0xf2e8c8,
  bottleGreen: 0x2f6b3a,
  bottleBrown: 0x6b3a1f,
  bookRed: 0x8c3a2c,
  bookGreen: 0x2f5d3a,
  bookBlue: 0x2b3f6b,
  bookTan: 0xb08a4a,
  paper: 0xf2eee2,
  ink: 0x1c1c22,
  wax: 0xf2e8c8,
} as const;

export type Colour = keyof typeof COLOURS;

const GLOWING: ReadonlySet<Colour> = new Set<Colour>(['ember', 'flame']);

/** Everything drawn with the kit is drawn an eighth of a block a voxel. */
export const EIGHTH = 1 / 8;

/** A sketch with these of the colours to draw in (fire glows after dark). */
export function kit(...names: Colour[]): Sketch {
  const s = new Sketch();
  for (const name of names) s.paint(name, COLOURS[name], GLOWING.has(name));
  return s;
}

/**
 * A barrel six across and `high` tall from (x0, y0, z0): round, its staves light and dark,
 * an iron hoop near each end, drawn in at top and bottom, a lid on top. Paints: stave,
 * staveDark, hoop, lid.
 */
export function barrelAt(s: Sketch, x0: number, y0: number, z0: number, high = 8): void {
  for (let y = 0; y < high; y++) {
    const end = y === 0 || y === high - 1;
    for (let x = 0; x < 6; x++) {
      for (let z = 0; z < 6; z++) {
        const rimX = x === 0 || x === 5;
        const rimZ = z === 0 || z === 5;
        if ((rimX && rimZ) || (end && (rimX || rimZ))) continue;
        const colour = y === high - 1 ? 'lid' : y === 1 || y === high - 2 ? 'hoop' : (x + z) % 2 ? 'stave' : 'staveDark';
        s.put(x0 + x, y0 + y, z0 + z, colour);
      }
    }
  }
}

/** A crate `w` × `h` × `d` from (x0, y0, z0): planked sides in light and dark rows, dark battens at its edges. Paints: crate, crateLight, crateDark. */
export function crateAt(s: Sketch, x0: number, y0: number, z0: number, w: number, h: number, d: number): void {
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      for (let z = 0; z < d; z++) {
        const edges = Number(x === 0 || x === w - 1) + Number(y === 0 || y === h - 1) + Number(z === 0 || z === d - 1);
        if (edges === 0) continue;
        s.put(x0 + x, y0 + y, z0 + z, edges >= 2 ? 'crateDark' : y % 2 ? 'crate' : 'crateLight');
      }
    }
  }
}

/** A basket four across from (x0, y0, z0): a wicker rim two high round its goods, heaped above it. Paints: wicker, wickerDark and the goods. */
export function basketAt(s: Sketch, x0: number, y0: number, z0: number, goods: Colour): void {
  for (let x = 0; x < 4; x++) {
    for (let z = 0; z < 4; z++) {
      const rim = x === 0 || x === 3 || z === 0 || z === 3;
      for (let y = 0; y < 2; y++) s.put(x0 + x, y0 + y, z0 + z, rim ? ((x + z + y) % 2 ? 'wicker' : 'wickerDark') : goods);
    }
  }
  s.put(x0 + 1, y0 + 2, z0 + 2, goods);
  s.put(x0 + 2, y0 + 2, z0 + 1, goods);
}
```

- [ ] **Step 3: Write the shapes**

Create `src/props/shapes.ts`:

```ts
import { FACING_DIRS } from '../voxel/blocks';
import type { PropKind, PropPlacement } from './types';

/**
 * How much room a prop drawn finer than a block takes, in blocks: `w` across its own x, `d`
 * along its own z (the way it faces), centred on its origin at its foot, and `h` high. One
 * that `blocks` keeps people out of its cells: the town builder puts the blocker in them,
 * three high, so nobody walks through it or scrambles up on top.
 */
export interface PropShape {
  w: number;
  d: number;
  h: number;
  blocks: boolean;
}

/** Every prop drawn finer than a block that the town builder stands on a floor, by kind. */
export const PROP_SHAPES: Partial<Record<PropKind, PropShape>> = {
  barrel: { w: 1, d: 1, h: 1, blocks: true },
  crate: { w: 1, d: 1, h: 0.75, blocks: true },
};

/** The grid cells a placed prop of this shape stands in: round its origin, turned with it. */
export function shapeCells(p: PropPlacement, shape: { w: number; d: number }): Array<{ x: number; z: number }> {
  // Facing along x, its own x runs along z.
  const along = FACING_DIRS[p.facing][0] !== 0;
  const [wx, wz] = along ? [shape.d, shape.w] : [shape.w, shape.d];
  const x0 = Math.round(p.x - wx / 2);
  const z0 = Math.round(p.z - wz / 2);
  const out: Array<{ x: number; z: number }> = [];
  for (let x = x0; x < x0 + wx; x++) for (let z = z0; z < z0 + wz; z++) out.push({ x, z });
  return out;
}
```

- [ ] **Step 4: Write the barrel and the crate**

Create `src/props/furniture.ts`:

```ts
import { barrelAt, crateAt, EIGHTH, kit } from './kit';
import type { PropModel } from './types';

/** A barrel standing on the floor, a block high. */
export function barrel(): PropModel {
  const s = kit('stave', 'staveDark', 'hoop', 'lid');
  barrelAt(s, 1, 0, 1);
  return s.model({ x: 4, y: 0, z: 4 }, EIGHTH);
}

/** A crate, three quarters of a block each way. */
export function crate(): PropModel {
  const s = kit('crate', 'crateLight', 'crateDark');
  crateAt(s, 1, 0, 1, 6, 6, 6);
  return s.model({ x: 4, y: 0, z: 4 }, EIGHTH);
}
```

In `src/props/catalog.ts`, add `import { barrel, crate } from './furniture';` and, in `propCatalog`'s object after `hullOnStocks`:

```ts
    barrel: barrel(),
    crate: crate(),
```

- [ ] **Step 5: Write the shape tests**

Create `src/props/shapes.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildShipModel, type ShipModel } from '../sailing/shipModel';
import { SLOOP } from '../sailing/ships';
import { parseVox } from '../vox/parseVox';
import { propCatalog } from './catalog';
import { PROP_SHAPES, shapeCells } from './shapes';
import type { PropKind, PropPlacement } from './types';

function loadSloop(): ShipModel {
  const bytes = readFileSync(`public/${SLOOP.model}`);
  return buildShipModel(parseVox(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), SLOOP.draft);
}

describe('prop shapes', () => {
  it('fit every model drawn finer than a block: an eighth a voxel, standing on its foot in its cells, as tall as it says', () => {
    const catalog = propCatalog(loadSloop());
    const kinds = Object.keys(PROP_SHAPES) as PropKind[];
    expect(kinds.length).toBeGreaterThan(0);
    for (const kind of kinds) {
      const shape = PROP_SHAPES[kind]!;
      const m = catalog[kind];
      expect(m.scale, kind).toBe(1 / 8);
      expect(m.origin, kind).toEqual({ x: 4 * shape.w, y: 0, z: 4 * shape.d });
      let [minY, maxY] = [Infinity, -Infinity];
      for (let i = 0; i < m.cells.length; i += 4) {
        const [x, y, z] = [m.cells[i], m.cells[i + 1], m.cells[i + 2]];
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        // What stands on the floor (its lowest block) keeps to its cells; an awning may reach out over them.
        if (y < 8) expect(x >= 0 && x < 8 * shape.w && z >= 0 && z < 8 * shape.d, `${kind} voxel at ${x},${y},${z} in its cells`).toBe(true);
      }
      expect(minY, `${kind} on the floor`).toBe(0);
      expect((maxY + 1) / 8, `${kind} as tall as it says`).toBe(shape.h);
    }
  });

  it('cover the cells round a placed prop, turned with it', () => {
    const shape = { w: 3, d: 2 };
    const box = (cells: Array<{ x: number; z: number }>) => ({
      x0: Math.min(...cells.map((c) => c.x)),
      x1: Math.max(...cells.map((c) => c.x)),
      z0: Math.min(...cells.map((c) => c.z)),
      z1: Math.max(...cells.map((c) => c.z)),
      n: cells.length,
    });
    const at = (x: number, z: number, facing: number): PropPlacement => ({ kind: 'crate', x, y: 4, z, facing, anchor: null });
    // Facing south or north: three across x, two along z.
    for (const facing of [0, 2]) expect(box(shapeCells(at(10.5, 20, facing), shape))).toEqual({ x0: 9, x1: 11, z0: 19, z1: 20, n: 6 });
    // Facing east or west: two along x, three along z.
    for (const facing of [1, 3]) expect(box(shapeCells(at(10, 20.5, facing), shape))).toEqual({ x0: 9, x1: 10, z0: 19, z1: 21, n: 6 });
  });
});
```

Run: `npx vitest run src/props`. Expected: all PASS. The models test's "build every kind…" now covers `barrel` and `crate` too.

- [ ] **Step 6: Write the failing `standProp` tests**

Create `src/worldgen/furnish.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { PropPlacement } from '../props/types';
import { Block } from '../voxel/blocks';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { standProp } from './furnish';

describe('standing a prop', () => {
  it('sets it over its cells, anchored where its top is, and keeps people out of them three high', () => {
    const world = new VoxelWorld();
    world.setVoxel(5, 11, 7, Block.Stone); // what's there already stays
    const decor: PropPlacement[] = [];
    const p = standProp(world, decor, 'barrel', { x0: 5, z0: 7, x1: 5, z1: 7 }, 10, 2);
    expect(decor).toEqual([p]);
    expect(p).toEqual({ kind: 'barrel', x: 5.5, y: 10, z: 7.5, facing: 2, anchor: { x: 5, y: 10, z: 7 } });
    expect([10, 11, 12, 13].map((y) => world.getVoxel(5, y, 7))).toEqual([Block.Blocker, Block.Stone, Block.Blocker, Block.Air]);
  });

  it('refuses cells that aren’t its shape', () => {
    expect(() => standProp(new VoxelWorld(), [], 'crate', { x0: 0, z0: 0, x1: 1, z1: 0 }, 10, 0)).toThrow();
  });
});
```

Run: `npx vitest run src/worldgen/furnish.test.ts`. Expected: FAIL, "Failed to resolve import './furnish'".

- [ ] **Step 7: Write `standProp`**

Create `src/worldgen/furnish.ts`:

```ts
import { PROP_SHAPES, shapeCells } from '../props/shapes';
import type { PropKind, PropPlacement } from '../props/types';
import { Block } from '../voxel/blocks';
import type { VoxelWorld } from '../voxel/VoxelWorld';

/** A block of grid cells, from (x0, z0) to (x1, z1), both included. */
export interface Cells {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** How high a prop that keeps people out takes its cells: the walker scrambles up two, never three. */
export const KEEP_OUT = 3;

/**
 * Stands a prop drawn finer than a block on the floor at `y`, over these cells, its front
 * (+z) looking along `facing` (as FACING_DIRS). Its anchor is the cell its top is in, so it
 * goes when that's lifted away on foot (a stall in the way, say). One that keeps people out
 * takes its cells KEEP_OUT high with the blocker, where there's air. Throws if the cells
 * aren't its shape, turned that way.
 */
export function standProp(world: VoxelWorld, decor: PropPlacement[], kind: PropKind, cells: Cells, y: number, facing: number): PropPlacement {
  const shape = PROP_SHAPES[kind];
  if (!shape) throw new Error(`standProp: ${kind} has no shape`);
  const p: PropPlacement = { kind, x: (cells.x0 + cells.x1 + 1) / 2, y, z: (cells.z0 + cells.z1 + 1) / 2, facing, anchor: null };
  const covered = shapeCells(p, shape);
  const wanted = (cells.x1 - cells.x0 + 1) * (cells.z1 - cells.z0 + 1);
  if (covered.length !== wanted || covered.some(({ x, z }) => x < cells.x0 || x > cells.x1 || z < cells.z0 || z > cells.z1)) {
    throw new Error(`standProp: ${kind} facing ${facing} doesn't fit ${cells.x0},${cells.z0} to ${cells.x1},${cells.z1}`);
  }
  p.anchor = { x: Math.floor((cells.x0 + cells.x1) / 2), y: y + Math.max(0, Math.ceil(shape.h) - 1), z: Math.floor((cells.z0 + cells.z1) / 2) };
  decor.push(p);
  if (shape.blocks) {
    for (const { x, z } of covered) for (let dy = 0; dy < KEEP_OUT; dy++) if (world.getVoxel(x, y + dy, z) === Block.Air) world.setVoxel(x, y + dy, z, Block.Blocker);
  }
  return p;
}
```

Run: `npx vitest run src/worldgen/furnish.test.ts`. Expected: PASS.

- [ ] **Step 8: Write the failing lifter test: it sees a prop's blocker**

In `src/render/RoofLifter.test.ts`, add inside `describe('shops', …)`:

```ts
    it('takes a prop that keeps people out away when it’s in the way: the lifter sees its blocker', () => {
      const world = village();
      // A stall's cells, as the town builder keeps people out of them (three high), between the captain and the house.
      for (let y = BASE; y < BASE + 3; y++) world.setVoxel(3, y, -4, Block.Blocker);
      const lifts = new RoofLifter(world).update({ x: 3.5, y: BASE + 1.2, z: -6.5 }, BASE, { x: 3.5, y: BASE + 8, z: 16 }, 1 / 60);
      // Its anchor is the cell its top is in: lifted, so the prop goes.
      expect(lifted(lifts, 3, BASE + 2, -4)).toBe(true);
    });
```

Run: `npx vitest run src/render/RoofLifter.test.ts`. Expected: this test FAILS (`expected false to be true`).

- [ ] **Step 9: Let the lifter see the blocker**

In `src/render/RoofLifter.ts`, replace the reader in the constructor:

```ts
    this.structures = {
      getVoxel: (x, y, z) => {
        const id = world.getVoxel(x, y, z);
        // A prop that keeps people out is seen by the blocker in its cells, as planks: part of
        // the room it stands in, or a thing of its own in the open, lifted (and gone, by its
        // anchor) when it's in the way.
        if (id === Block.Blocker) return Block.Planks;
        return ((BLOCK_PALETTE.flags?.[id] ?? 0) & FLAG_CUTAWAY) !== 0 ? id : Block.Air;
      },
    };
```

Run: `npx vitest run src/render/RoofLifter.test.ts`. Expected: all PASS.

- [ ] **Step 10: Write the failing PropsView test: a mesh a kind a town**

In `src/render/PropsView.test.ts`, the first test's lines become:

```ts
    expect(view.group.children).toHaveLength(2);
    expect(view.meshes.get('lantern')).toHaveLength(1);
    const lanterns = view.meshes.get('lantern')![0];
```

The second test's lookup becomes `view.meshes.get('lantern')![0].geometry.getAttribute('flags')`. Add:

```ts
  it('gives each town its own mesh of a kind, so a town that’s off screen isn’t drawn', () => {
    const view = new PropsView(
      [
        { kind: 'lantern', x: 0.5, y: 15, z: 0.5, facing: 0, anchor: null },
        { kind: 'lantern', x: 40.5, y: 15, z: 60.5, facing: 0, anchor: null },
        { kind: 'lantern', x: 500.5, y: 15, z: 0.5, facing: 0, anchor: null },
      ],
      catalog,
      new Lifts(),
    );
    const meshes = view.meshes.get('lantern')!;
    expect(meshes.map((m) => m.count)).toEqual([2, 1]);
    for (const m of meshes) {
      expect(m.frustumCulled).toBe(true);
      expect(m.boundingSphere!.radius).toBeLessThan(100);
    }
  });
```

Run: `npx vitest run src/render/PropsView.test.ts`. Expected: FAIL (`meshes.get('lantern')` is a mesh, not a list).

- [ ] **Step 11: Draw a mesh a kind a town**

In `src/render/PropsView.ts`, change the three import to `import { type BufferGeometry, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshLambertMaterial } from 'three';`. After `NEVER_LIFTED`, add:

```ts
/**
 * Props within this of a town's first share its meshes: one a kind a town, so a town that's
 * off screen isn't drawn (ports lie hundreds apart; a town is about a hundred across).
 */
const TOWN_REACH = 150;
```

Change the class comment's "(about ten draw calls)" to "(one mesh a kind a town, so a town off screen isn't drawn)". Change the `meshes` field to:

```ts
  /** Each kind's meshes, one a town (none for a kind no town uses). */
  readonly meshes = new Map<PropKind, InstancedMesh[]>();
```

Replace everything in the constructor from `const byKind = …` to the end of its loop with:

```ts
    // Each town's props of a kind together: a town's first prop marks it, and the rest within reach join it.
    const towns: Array<{ x: number; z: number }> = [];
    const townOf = (p: PropPlacement): number => {
      const i = towns.findIndex((t) => Math.hypot(t.x - p.x, t.z - p.z) < TOWN_REACH);
      return i >= 0 ? i : towns.push({ x: p.x, z: p.z }) - 1;
    };
    const groups = new Map<string, PropPlacement[]>();
    for (const p of placements) {
      const key = `${p.kind}@${townOf(p)}`;
      const list = groups.get(key);
      if (list) list.push(p);
      else groups.set(key, [p]);
    }
    const shapes = new Map<PropKind, BufferGeometry>();
    const matrix = new Matrix4();
    for (const list of groups.values()) {
      const kind = list[0].kind;
      const model = catalog[kind];
      let shape = shapes.get(kind);
      if (!shape) {
        shape = meshCells(model.cells, model.palette);
        shapes.set(kind, shape);
      }
      // Its own copy, for its own instances' anchors.
      const geometry = shape.clone();
      const anchors = new Float32Array(list.length * 3);
      list.forEach((p, i) => anchors.set(p.anchor ? [p.anchor.x + 0.5, p.anchor.y + 0.5, p.anchor.z + 0.5] : [0, NEVER_LIFTED, 0], i * 3));
      geometry.setAttribute('anchor', new InstancedBufferAttribute(anchors, 3));
      const mesh = new InstancedMesh(geometry, this.material, list.length);
      list.forEach((p, i) => mesh.setMatrixAt(i, placementMatrix(p, model, matrix)));
      mesh.computeBoundingSphere();
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `props:${kind}`;
      this.meshes.set(kind, [...(this.meshes.get(kind) ?? []), mesh]);
      this.group.add(mesh);
    }
```

Run: `npx vitest run src/render/PropsView.test.ts`. Expected: PASS.

- [ ] **Step 12: Look in the game**

Follow "Looking at it in the game". In Haven:
- Check that the lanterns, signs, clock, porch posts and the ship on the stocks still draw (screenshot `.playwright-mcp/t2-01-haven-square.png`).
- Check that the lanterns still light up at night (screenshot `.playwright-mcp/t2-02-haven-square-night.png`).
- Stand at the shipyard's spot with each of the four camera turns. When the ship on the stocks is in the line of sight, the shed behind her still lifts. Her hull now uses up a line of sight only for herself.
- Record `await frames()` on the square at night, next to Task 1's baseline. Calls should be no higher.

Close the browser.

- [ ] **Step 13: Run everything and commit**

Run: `npx vitest run` and `npx tsc --noEmit -p .`. Expected: all pass.

```bash
git add src/props/kit.ts src/props/shapes.ts src/props/shapes.test.ts src/props/furniture.ts src/props/types.ts src/props/catalog.ts src/worldgen/furnish.ts src/worldgen/furnish.test.ts src/render/RoofLifter.ts src/render/RoofLifter.test.ts src/render/PropsView.ts src/render/PropsView.test.ts
git commit -m "$(cat <<'EOF'
Props finer than a block can keep people out: shapes, standProp, the lifter sees their blocker, and a mesh a kind a town

Claude-Session: https://claude.ai/code/session_01XGX2Zy161PcviqWzCXinMn
EOF
)"
```

---

### Task 3: Stalls and a hand cart that read

**Files:**
- Create: `src/props/market.ts`
- Modify: `src/props/types.ts`, `src/props/shapes.ts`, `src/props/catalog.ts`
- Modify: `src/worldgen/furnish.ts` (`plotCells`), `src/worldgen/furnish.test.ts`
- Modify: `src/worldgen/town.ts` (the square's dressing, ~lines 357–381; delete `STALL_GOODS`, `buildStall`, `buildCart`; a new constant `STALL_BACK`)
- Modify: `src/worldgen/town.test.ts`

**Interfaces:**
- Consumes:
  - From Task 2: `kit`, `EIGHTH`, `crateAt`, `basketAt`, `Colour`; `PROP_SHAPES`, `shapeCells`; `standProp(world, decor, kind, cells, y, facing)`, `Cells`.
  - In town.ts: `footprint(f, r)`, `facingOf(dx, dz)`, `side(lo, hi, s)`.
- Produces:
  - `stall(awning: 'red' | 'blue', goods: 'produce' | 'cloth'): PropModel` (3 × 2, h 2.875).
  - `handCart(): PropModel` (2 × 3, h 1.625).
  - Kinds `'stallProduceRed' | 'stallClothRed' | 'stallProduceBlue' | 'stallClothBlue' | 'handCart'`.
  - `plotCells(fp: Footprint): Cells`.
  - The town keeps the stall and cart rects in `layout.props`, and 'stall' spots stand before each stall.

- [ ] **Step 1: Add the kinds and shapes**

In `src/props/types.ts`, add the five kinds to the union and to `PROP_KINDS` after `'crate'`:

```ts
  | 'stallProduceRed'
  | 'stallClothRed'
  | 'stallProduceBlue'
  | 'stallClothBlue'
  | 'handCart';
```

and `…, 'barrel', 'crate', 'stallProduceRed', 'stallClothRed', 'stallProduceBlue', 'stallClothBlue', 'handCart']`.

In `src/props/shapes.ts`, add to `PROP_SHAPES`:

```ts
  stallProduceRed: { w: 3, d: 2, h: 2.875, blocks: true },
  stallClothRed: { w: 3, d: 2, h: 2.875, blocks: true },
  stallProduceBlue: { w: 3, d: 2, h: 2.875, blocks: true },
  stallClothBlue: { w: 3, d: 2, h: 2.875, blocks: true },
  handCart: { w: 2, d: 3, h: 1.625, blocks: true },
```

- [ ] **Step 2: Draw the stall and the cart**

Create `src/props/market.ts`:

```ts
import { basketAt, type Colour, crateAt, EIGHTH, kit } from './kit';
import type { PropModel } from './types';

/**
 * A market stall, three blocks across and two deep, its front (+z) to the customers: a
 * counter of upright boards with its goods along it, the stallholder's stock behind, a post
 * at each corner, and a striped awning falling from the back out over the counter, its edge
 * scalloped. What reads at play zoom is the awning's stripes and the colours of the goods.
 */
export function stall(awning: 'red' | 'blue', goods: 'produce' | 'cloth'): PropModel {
  const stripe: Colour = awning === 'red' ? 'awningRed' : 'awningBlue';
  const s = kit('timber', 'plank', 'plankDark', 'plankLight', stripe, 'canvas', 'crate', 'crateLight', 'crateDark', 'sack', 'wicker', 'wickerDark', 'greens', 'fruit', 'apple', 'clothPurple', 'clothBlue', 'clothOchre', 'linen');
  // Posts at the corners, a quarter of a block square: the back pair taller, for the awning's fall.
  for (const x of [0, 22]) {
    s.box(x, 0, 0, x + 1, 21, 1, 'timber');
    s.box(x, 0, 14, x + 1, 19, 15, 'timber');
  }
  // The counter across the front: upright boards under a lighter top.
  for (let x = 2; x <= 21; x++) s.box(x, 0, 10, x, 5, 14, x % 3 === 2 ? 'plankDark' : 'plank');
  s.box(2, 6, 9, 21, 6, 15, 'plankLight');
  // The goods along it.
  if (goods === 'produce') {
    basketAt(s, 3, 7, 10, 'greens');
    basketAt(s, 9, 7, 11, 'fruit');
    basketAt(s, 15, 7, 10, 'apple');
  } else {
    for (const [z, colour] of [[10, 'clothPurple'], [12, 'clothBlue'], [14, 'clothOchre']] as const) {
      s.box(3, 7, z, 12, 8, z + 1, colour);
      s.box(3, 7, z, 3, 8, z + 1, 'linen'); // the bolt's end
    }
    basketAt(s, 15, 7, 10, 'greens');
  }
  // The stallholder's stock behind it: a crate and a sack.
  crateAt(s, 3, 0, 2, 6, 5, 5);
  s.box(15, 0, 2, 19, 3, 6, 'sack');
  s.box(16, 4, 3, 18, 4, 5, 'sack');
  // The awning: striped, falling from the back to the front and out over the counter, with a scalloped edge.
  for (let z = 0; z <= 17; z++) {
    const y = 22 - Math.floor(z / 6);
    for (let x = 0; x <= 23; x++) s.put(x, y, z, Math.floor(x / 3) % 2 === 0 ? stripe : 'canvas');
  }
  for (let x = 0; x <= 23; x++) if (x % 3 !== 2) s.put(x, 19, 17, Math.floor(x / 3) % 2 === 0 ? stripe : 'canvas');
  return s.model({ x: 12, y: 0, z: 8 }, EIGHTH);
}

/**
 * A hand cart of timber, two blocks across and three long, its shafts to the front (+z): two
 * spoked wheels on an iron axle, a plank bed with low sides, legs at the back to stand it
 * level, the shafts down to the ground, and a load of logs with a sack on top.
 */
export function handCart(): PropModel {
  const s = kit('timber', 'timberDark', 'plank', 'plankDark', 'iron', 'bark', 'grain', 'sack');
  // The wheels, one either side: a rim, eight spokes and an iron hub.
  const [cy, cz, r] = [5, 9, 5];
  for (const x of [1, 14]) {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let z = cz - r; z <= cz + r; z++) {
        const [dy, dz] = [y - cy, z - cz];
        const d = Math.hypot(dy, dz);
        if (Math.round(d) === r) s.put(x, y, z, 'timberDark');
        else if (d <= 1) s.put(x, y, z, 'iron');
        else if (d < r && (dy === 0 || dz === 0 || Math.abs(dy) === Math.abs(dz))) s.put(x, y, z, 'timber');
      }
    }
  }
  s.box(2, cy, cz, 13, cy, cz, 'iron'); // the axle
  // The bed: a plank floor, low sides, and a leg either side at the back.
  s.box(2, 6, 3, 13, 6, 16, 'plank');
  for (const x of [2, 13]) s.box(x, 7, 3, x, 8, 16, 'plankDark');
  for (const z of [3, 16]) s.box(3, 7, z, 12, 8, z, 'plankDark');
  for (const x of [3, 12]) s.box(x, 0, 4, x, 5, 4, 'timber');
  // The shafts, out in front and down to the ground.
  for (const x of [4, 11]) for (let z = 17; z <= 23; z++) s.put(x, Math.round(5 - ((z - 17) * 5) / 6), z, 'timber');
  // A load of logs, their cut ends showing, and a sack on top.
  for (const x0 of [3, 6, 9]) {
    s.box(x0, 7, 4, x0 + 2, 9, 15, 'bark');
    for (const z of [4, 15]) s.box(x0, 7, z, x0 + 2, 9, z, 'grain');
  }
  s.box(5, 10, 5, 7, 12, 14, 'bark');
  for (const z of [5, 14]) s.box(5, 10, z, 7, 12, z, 'grain');
  s.box(9, 10, 10, 11, 11, 13, 'sack');
  return s.model({ x: 8, y: 0, z: 12 }, EIGHTH);
}
```

In `src/props/catalog.ts`, add `import { handCart, stall } from './market';` and:

```ts
    stallProduceRed: stall('red', 'produce'),
    stallClothRed: stall('red', 'cloth'),
    stallProduceBlue: stall('blue', 'produce'),
    stallClothBlue: stall('blue', 'cloth'),
    handCart: handCart(),
```

Run: `npx vitest run src/props`. Expected: PASS. "fit every model drawn finer than a block…" now checks the stalls and the cart.

- [ ] **Step 3: Write the failing tests**

In `src/worldgen/furnish.test.ts`, add `plotCells` to the import from `./furnish`, and add:

```ts
  it('turns a prop that isn’t square with its facing', () => {
    const decor: PropPlacement[] = [];
    // A stall is three across and two deep: facing east, it takes two cells along x and three along z.
    const p = standProp(new VoxelWorld(), decor, 'stallProduceRed', { x0: 0, z0: 0, x1: 1, z1: 2 }, 10, 1);
    expect([p.x, p.z]).toEqual([1, 1.5]);
    expect(p.anchor).toEqual({ x: 0, y: 12, z: 1 });
    expect(() => standProp(new VoxelWorld(), decor, 'stallProduceRed', { x0: 0, z0: 0, x1: 1, z1: 2 }, 10, 0)).toThrow();
  });

  it('gives a plot’s cells as standProp takes them', () => {
    expect(plotCells({ x0: 4, z0: -2, w: 3, d: 2 })).toEqual({ x0: 4, z0: -2, x1: 6, z1: -1 });
  });
```

In `src/worldgen/town.test.ts`:
- Add imports `import { PROP_SHAPES, shapeCells } from '../props/shapes';` and `import type { PropKind } from '../props/types';`.
- Replace the test "set out stalls under striped awnings by the market, with goods on their counters" with the three tests below.
- Delete the now-unused `AWNINGS` and `GOODS` constants.

```ts
  it('set out two stalls by the market, under awnings in the port’s colour, and a hand cart by the shipyard', () => {
    for (const { name, faction, home, world, harbour } of PORTS) {
      const { square } = harbour.town;
      const stalls = harbour.decor.filter((d) => d.kind.startsWith('stall'));
      expect(stalls.length, `${name} stalls`).toBe(2);
      expect(new Set(stalls.map((s) => s.kind)).size, `${name} two kinds of stall`).toBe(2);
      const blue = !home && faction === 'merchant';
      for (const s of stalls) {
        expect(s.kind.endsWith(blue ? 'Blue' : 'Red'), `${name} ${s.kind}`).toBe(true);
        expect(inside(square, Math.floor(s.x), Math.floor(s.z)), `${name} ${s.kind} on the square`).toBe(true);
        expect(world.getVoxel(Math.floor(s.x), s.y, Math.floor(s.z)), `${name} ${s.kind} keeps people out`).toBe(Block.Blocker);
      }
      expect(harbour.decor.filter((d) => d.kind === 'handCart').length, `${name} cart`).toBe(faction === 'pirate' ? 0 : 1);
      // Townsfolk shop at them.
      expect(harbour.spots.filter((p) => p.kind === 'stall' && inside(square, Math.floor(p.x), Math.floor(p.z))).length, `${name} stall spots`).toBeGreaterThanOrEqual(2);
    }
  });

  it('keep the stalls and the cart two clear of every door’s step, and out of the market’s front', () => {
    for (const { name, harbour } of PORTS) {
      const steps = [...harbour.places, ...harbour.spots.filter((s) => s.kind === 'door')].map((p) => ({ x: Math.floor(p.x), z: Math.floor(p.z) }));
      const market = harbour.places.find((p) => p.kind === 'market')!;
      const hall = harbour.town.houses.find((h) => outside(h, Math.floor(market.x), Math.floor(market.z)) <= 1);
      for (const d of harbour.decor.filter((p) => p.kind.startsWith('stall') || p.kind === 'handCart')) {
        for (const c of shapeCells(d, PROP_SHAPES[d.kind]!)) {
          for (const s of steps) expect(Math.max(Math.abs(c.x - s.x), Math.abs(c.z - s.z)), `${name} ${d.kind} at ${c.x},${c.z} by the step at ${s.x},${s.z}`).toBeGreaterThanOrEqual(3);
          if (hall) expect(outside(hall, c.x, c.z), `${name} ${d.kind} at ${c.x},${c.z} in the market’s front`).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it('keep everyone out of the stalls and the cart: nobody walks in or scrambles up on top', () => {
    let tried = 0;
    for (const { name, world, harbour } of PORTS) {
      for (const d of harbour.decor.filter((p) => p.kind.startsWith('stall') || p.kind === 'handCart')) {
        const cells = shapeCells(d, PROP_SHAPES[d.kind]!);
        const inProp = (x: number, z: number) => cells.some((c) => c.x === Math.floor(x) && c.z === Math.floor(z));
        for (const c of cells) {
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const [bx, bz] = [c.x + dx, c.z + dz];
            if (inProp(bx, bz) || collides(world, bx + 0.5, d.y, bz + 0.5) || groundBelow(world, bx + 0.5, bz + 0.5, d.y + 0.5) !== d.y) continue;
            tried++;
            const w = createWalker(bx + 0.5, d.y, bz + 0.5);
            for (let t = 0; t < 1.5; t += 1 / 60) stepWalker(w, -dx, -dz, world, 1 / 60);
            expect(inProp(w.x, w.z), `${name} ${d.kind}: walked in from ${bx},${bz}`).toBe(false);
            expect(w.y, `${name} ${d.kind}: climbed from ${bx},${bz}`).toBe(d.y);
          }
        }
      }
    }
    expect(tried).toBeGreaterThan(0);
  });
```

Also widen the test "stand every prop that stands on the ground on something solid…" so it covers the new props. Replace its first line, `const standing = new Set([...])`, and its filter with:

```ts
    const kinds = new Set<string>(['lantern', 'porchPost', 'porchRail', 'signpostMarket', 'signpostShipyard']);
    const standing = (kind: PropKind) => kinds.has(kind) || PROP_SHAPES[kind] !== undefined;
    for (const { name, world, harbour } of PORTS) {
      const props = harbour.decor.filter((d) => standing(d.kind));
```

(the rest of that test is unchanged).

Run: `npx vitest run src/worldgen/furnish.test.ts src/worldgen/town.test.ts`. Expected: FAIL. `plotCells` isn't exported, and the town has no stall props yet.

- [ ] **Step 4: Stand the stalls and the cart**

In `src/worldgen/furnish.ts`, add `import type { Footprint } from './buildings';` and:

```ts
/** A plot's cells, as standProp takes them. */
export const plotCells = (fp: Footprint): Cells => ({ x0: fp.x0, z0: fp.z0, x1: fp.x0 + fp.w - 1, z1: fp.z0 + fp.d - 1 });
```

In `src/worldgen/town.ts`, add `import { plotCells, standProp } from './furnish';`. After `LAMP_EVERY`, add:

```ts
/**
 * The row of the square the market's stalls back onto: the market's step is three further on
 * (its front is at 9, the step at 8), so two clear rows lie between.
 */
const STALL_BACK = 5;
```

Replace the start of the square's dressing, from the comment `// The square, dressed.` down to and including `props.push(corner);`, with:

```ts
  // The square, dressed. Two stalls by the market, set back from its front so the way in
  // stays open; benches at its top; a hand cart of timber by the shipyard (the Brethren
  // hang a gallows there instead); and the port's own: guns at the seaward edge for the
  // Crown and the Brethren, net racks at Haven, bales at the free port.
  const props: Rect[] = [];
  const stallSpots: Array<[number, number]> = [];
  // (Where there was no room for the market by the square, they stand either side of its middle.)
  const marketU = doors.market ? local(f, doors.market.x, doors.market.z).u : Infinity;
  const doorU = marketU <= q + SQUARE_DEEP ? marketU : q + 4;
  const stalls: PropKind[] = style.dress === 'free' ? ['stallProduceBlue', 'stallClothBlue'] : ['stallProduceRed', 'stallClothRed'];
  if (style.mirror) stalls.reverse();
  // Either side of the column of the market's door, their fronts to the square's middle and
  // two clear rows between their backs and the market's step.
  for (const [u0, kind] of [[clamp(doorU - 4, q + 1, q + 7), stalls[0]], [clamp(doorU + 2, q + 1, q + 7), stalls[1]]] as const) {
    const r: Rect = { u0, u1: u0 + 2, ...side(STALL_BACK - 1, STALL_BACK, ms) };
    standProp(world, decor, kind, plotCells(footprint(f, r)), low, facingOf(-ms * f.sx, -ms * f.sz));
    props.push(r);
    stallSpots.push([u0 + 1, ms * (STALL_BACK - 2)]);
  }
  for (const s of [-1, 1]) {
    const r: Rect = { u0: q + SQUARE_DEEP - 1, u1: q + SQUARE_DEEP - 1, ...side(2, 3, s) };
    for (const [u, v] of cells(r)) place(world, f, u, v, low, Block.Planks);
    props.push(r);
  }
  const corner: Rect = { u0: q + 6, u1: q + 8, ...side(6, 7, ys) };
  if (style.dress === 'brethren') buildGallows(world, f, corner, low, ys);
  else standProp(world, decor, 'handCart', plotCells(footprint(f, corner)), low, facingOf(f.ix, f.iz));
  props.push(corner);
```

Delete `STALL_GOODS`, `buildStall` and `buildCart` with their comments. They're unused now. The blocks they used stay in the palette, for older saves.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/worldgen src/props`. Expected: all PASS, including "pave a flat square…", which still leaves the stall and cart rects out.

- [ ] **Step 6: Look in the game**

Reload `/?new` and follow "Looking at it in the game". Screenshot to `.playwright-mcp/t3-NN-*.png`:

1. Haven's square by day, from its middle (`tp(-1.5, 18, 42.5)`), camera south-east and north-west. Both stalls read as stalls (striped awning, goods, posts). The cart reads as a cart (wheels, shafts, logs).
2. Haven's market spot with all four camera turns. Nothing hides the captain at the door.
3. Port Clemency's square: blue awnings.
4. Kingsreach's square: red awnings, and the seaward stall beside the gun.
5. Rook's Nest: the gallows where the cart would be, and no cart.
6. Walk into a stall with the keys (`browser_press_key` `w`/`a`/`s`/`d` held over a few presses). The captain stops at it and doesn't climb.
7. With the camera turned so a stall stands between the camera and the captain, the stall goes.

Close the browser.

- [ ] **Step 7: Run everything and commit**

Run: `npx vitest run` and `npx tsc --noEmit -p .`. Expected: all pass.

```bash
git add src/props/market.ts src/props/types.ts src/props/shapes.ts src/props/catalog.ts src/worldgen/furnish.ts src/worldgen/furnish.test.ts src/worldgen/town.ts src/worldgen/town.test.ts
git commit -m "$(cat <<'EOF'
Stalls and a hand cart drawn finer, set back from the doors

Claude-Session: https://claude.ai/code/session_01XGX2Zy161PcviqWzCXinMn
EOF
)"
```

---

### Task 4: Furniture drawn finer

**Files:**
- Modify: `src/props/furniture.ts` (append), `src/props/market.ts` (append `counter`)
- Modify: `src/props/types.ts`, `src/props/shapes.ts`, `src/props/catalog.ts`
- Modify: `src/props/models.test.ts`

**Interfaces:**
- Consumes: from Task 2, `kit`, `EIGHTH`, `basketAt`, `type Colour`, and `Sketch` (for helper parameters).
- Produces: models and their kinds, all at an eighth of a block. Each kind's shape is (w, d, h, blocks):

  | Kind | Model | w | d | h | Blocks |
  |---|---|---|---|---|---|
  | `bed` | `bed()` | 1 | 2 | 0.875 | yes |
  | `table` | `table()` | 1 | 1 | 1 | yes |
  | `stool` | `stool()` | 1 | 1 | 0.5 | no |
  | `chair` | `chair()` | 1 | 1 | 1 | no |
  | `shelfCrockery`, `shelfBottles`, `shelfBooks` | `shelf(wares)` | 1 | 1 | 1.75 | yes |
  | `chest` | `chest()` | 1 | 1 | 0.625 | yes |
  | `hearth` | `hearth()` | 1 | 1 | 2 | yes |
  | `rug` | `rug()` | 2 | 2 | 0.125 | no |
  | `runner` | `runner()` | 1 | 2 | 0.125 | no |
  | `bar` | `bar()` | 1 | 1 | 1.25 | yes |
  | `barCask` | `barCask()` | 1 | 1 | 1.375 | yes |
  | `desk` | `desk()` | 1 | 1 | 1.25 | yes |
  | `counterProduce`, `counterCloth` | `counter(goods)` | 1 | 1 | 1.125 | yes |

- **Convention:** a piece that stands against a wall has its back at z = 0, and its front (+z) faces into the room. The bed's head is at z = 0 and its foot at +z. A stool's or chair's seat sits toward +z, so it faces the table it's drawn up to.

- [ ] **Step 1: Write the failing model tests**

In `src/props/models.test.ts`, add `import { PROP_SHAPES } from './shapes';` and `import type { PropKind } from './types';` (merge with the existing `./types` import). Then add inside `describe('prop models', …)`:

```ts
  /** What furnishes a room or stands in the market hall: under its walls when the roof's lifted. */
  const ROOM_KINDS: readonly PropKind[] = ['bed', 'table', 'stool', 'chair', 'shelfCrockery', 'shelfBottles', 'shelfBooks', 'chest', 'hearth', 'rug', 'runner', 'barrel', 'crate', 'bar', 'barCask', 'desk', 'counterProduce', 'counterCloth'];

  it('shape every piece of furniture', () => {
    for (const kind of ROOM_KINDS) expect(PROP_SHAPES[kind], kind).toBeDefined();
  });

  it('keep a room’s furniture to head height, where the walls are cut, so none of it pokes up when the roof lifts', () => {
    for (const kind of ROOM_KINDS) expect(PROP_SHAPES[kind]!.h, kind).toBeLessThanOrEqual(2);
  });

  it('light only the hearth’s fire and the desk’s candle after dark, of all that’s drawn finer', () => {
    const catalog = propCatalog(loadSloop());
    const glows = (kind: PropKind) => {
      const m = catalog[kind];
      for (let i = 3; i < m.cells.length; i += 4) if (m.palette.flags![m.cells[i]] & FLAG_GLOW) return true;
      return false;
    };
    expect((Object.keys(PROP_SHAPES) as PropKind[]).filter(glows).sort()).toEqual(['desk', 'hearth']);
  });

  it('lay rugs flat on the floor, a voxel thick, keeping nobody out', () => {
    for (const kind of ['rug', 'runner'] as const) expect(PROP_SHAPES[kind], kind).toMatchObject({ h: 1 / 8, blocks: false });
  });
```

Run: `npx tsc --noEmit -p .`. Expected: errors, because `'bed'` and the rest aren't `PropKind`s yet.

- [ ] **Step 2: Add the kinds and shapes**

In `src/props/types.ts`, add to the union (after `'handCart'`) and to `PROP_KINDS` in the same order:

```ts
  | 'bed'
  | 'table'
  | 'stool'
  | 'chair'
  | 'shelfCrockery'
  | 'shelfBottles'
  | 'shelfBooks'
  | 'chest'
  | 'hearth'
  | 'rug'
  | 'runner'
  | 'bar'
  | 'barCask'
  | 'desk'
  | 'counterProduce'
  | 'counterCloth';
```

In `src/props/shapes.ts`, add to `PROP_SHAPES`:

```ts
  bed: { w: 1, d: 2, h: 0.875, blocks: true },
  table: { w: 1, d: 1, h: 1, blocks: true },
  stool: { w: 1, d: 1, h: 0.5, blocks: false },
  chair: { w: 1, d: 1, h: 1, blocks: false },
  shelfCrockery: { w: 1, d: 1, h: 1.75, blocks: true },
  shelfBottles: { w: 1, d: 1, h: 1.75, blocks: true },
  shelfBooks: { w: 1, d: 1, h: 1.75, blocks: true },
  chest: { w: 1, d: 1, h: 0.625, blocks: true },
  hearth: { w: 1, d: 1, h: 2, blocks: true },
  rug: { w: 2, d: 2, h: 0.125, blocks: false },
  runner: { w: 1, d: 2, h: 0.125, blocks: false },
  bar: { w: 1, d: 1, h: 1.25, blocks: true },
  barCask: { w: 1, d: 1, h: 1.375, blocks: true },
  desk: { w: 1, d: 1, h: 1.25, blocks: true },
  counterProduce: { w: 1, d: 1, h: 1.125, blocks: true },
  counterCloth: { w: 1, d: 1, h: 1.125, blocks: true },
```

- [ ] **Step 3: Draw the furniture**

Append to `src/props/furniture.ts`, and add `import type { Sketch } from './sketch';` to its imports:

```ts
/**
 * A bed a block wide and two long, its head (z = 0) to the wall: corner posts, taller at the
 * head, side rails and boards at its ends, a mattress, a pillow, and a striped wool blanket
 * turned down at the sheet and hanging over the sides.
 */
export function bed(): PropModel {
  const s = kit('timber', 'timberDark', 'linen', 'canvas', 'blanket', 'blanketDark');
  for (const x of [0, 7]) {
    s.box(x, 0, 0, x, 6, 0, 'timberDark');
    s.box(x, 0, 15, x, 3, 15, 'timberDark');
    s.box(x, 1, 1, x, 2, 14, 'timber');
  }
  s.box(1, 1, 0, 6, 5, 0, 'timber'); // the headboard
  s.box(1, 1, 15, 6, 3, 15, 'timber'); // the footboard
  s.box(1, 2, 1, 6, 3, 14, 'canvas'); // the mattress
  s.box(1, 4, 1, 6, 4, 3, 'linen'); // the pillow
  s.box(1, 4, 5, 6, 4, 5, 'linen'); // the sheet, turned down over the blanket
  for (let z = 6; z <= 14; z++) s.box(1, 4, z, 6, 4, z, z % 3 === 0 ? 'blanketDark' : 'blanket');
  for (const x of [0, 7]) for (let z = 5; z <= 14; z++) s.put(x, 3, z, z % 3 === 0 ? 'blanketDark' : 'blanket');
  return s.model({ x: 4, y: 0, z: 8 }, EIGHTH);
}

/** A table a block square on four legs, a jug, a plate and a tankard of ale on it. */
export function table(): PropModel {
  const s = kit('timber', 'plank', 'plankDark', 'clay', 'crockery', 'pewter', 'foam');
  for (const [x, z] of [[1, 1], [1, 6], [6, 1], [6, 6]]) s.box(x, 0, z, x, 4, z, 'timber');
  s.box(0, 5, 0, 7, 5, 7, 'plank');
  for (const z of [0, 7]) s.box(0, 5, z, 7, 5, z, 'plankDark'); // the top's edges
  s.box(1, 6, 1, 2, 7, 2, 'clay'); // a jug
  s.box(4, 6, 4, 5, 6, 5, 'crockery'); // a plate
  s.put(5, 6, 1, 'pewter'); // a tankard, its ale foaming
  s.put(5, 7, 1, 'foam');
  return s.model({ x: 4, y: 0, z: 4 }, EIGHTH);
}

/** A stool's seat on four legs, toward its front, to draw up to a table. */
function seat(s: Sketch): void {
  for (const [x, z] of [[2, 3], [2, 6], [5, 3], [5, 6]]) s.box(x, 0, z, x, 2, z, 'timber');
  s.box(2, 3, 3, 5, 3, 6, 'plank');
}

/** A stool, half a block high. */
export function stool(): PropModel {
  const s = kit('timber', 'plank');
  seat(s);
  return s.model({ x: 4, y: 0, z: 4 }, EIGHTH);
}

/** A chair: a stool with a slatted back. */
export function chair(): PropModel {
  const s = kit('timber', 'plank');
  seat(s);
  for (const x of [2, 5]) s.box(x, 4, 3, x, 7, 3, 'timber');
  for (const y of [5, 7]) s.box(3, y, 3, 4, y, 3, 'plank');
  return s.model({ x: 4, y: 0, z: 4 }, EIGHTH);
}

/** What's on a set of shelves. */
export type Wares = 'crockery' | 'bottles' | 'books';

/** Shelves against a wall, half a block deep: three boards and a top in a timber frame, and their wares on them. */
export function shelf(wares: Wares): PropModel {
  const s = kit('timber', 'plank', 'plankDark', 'crockery', 'blueWare', 'clay', 'pewter', 'bottleGreen', 'bottleBrown', 'stave', 'hoop', 'bookRed', 'bookGreen', 'bookBlue', 'bookTan');
  for (const x of [0, 7]) s.box(x, 0, 0, x, 13, 3, 'timber');
  s.box(1, 0, 0, 6, 13, 0, 'plankDark');
  for (const y of [0, 5, 9]) s.box(1, y, 1, 6, y, 3, 'plank');
  s.box(0, 13, 0, 7, 13, 3, 'timber');
  // Its wares, on the shelves' three spaces: y 1–4, 6–8 and 10–12.
  if (wares === 'crockery') {
    s.box(1, 1, 1, 2, 3, 2, 'clay'); // a jug
    s.box(4, 1, 1, 6, 1, 3, 'blueWare'); // bowls, stacked
    s.box(5, 2, 2, 6, 2, 2, 'blueWare');
    for (const [x, colour] of [[1, 'crockery'], [3, 'blueWare'], [5, 'crockery']] as const) s.box(x, 6, 1, x + 1, 8, 1, colour); // plates on edge
    for (const x of [2, 4, 6]) s.box(x, 10, 2, x, 11, 2, 'pewter'); // tankards
  } else if (wares === 'bottles') {
    for (const x of [1, 3, 5]) {
      const colour = x === 3 ? 'bottleBrown' : 'bottleGreen';
      s.box(x, 1, 2, x, 3, 2, colour);
      s.put(x, 4, 2, colour); // the neck
    }
    for (const x of [2, 4, 6]) s.box(x, 6, 2, x, 8, 2, x === 4 ? 'bottleGreen' : 'bottleBrown');
    s.box(1, 10, 1, 3, 12, 3, 'stave'); // a little cask
    s.box(1, 11, 1, 3, 11, 3, 'hoop');
    for (const x of [5, 6]) s.box(x, 10, 2, x, 11, 2, 'pewter');
  } else {
    const colours = ['bookRed', 'bookGreen', 'bookBlue', 'bookTan'] as const;
    for (let x = 1; x <= 6; x++) s.box(x, 1, 1, x, 2 + (x % 2) + (x === 4 ? 1 : 0), 2, colours[x % 4]);
    for (let x = 1; x <= 5; x++) s.box(x, 6, 1, x, 7 + ((x + 1) % 2), 2, colours[(x + 1) % 4]);
    s.box(1, 10, 1, 4, 10, 2, 'bookTan'); // ledgers, lying in a pile
    s.box(1, 11, 1, 4, 11, 2, 'bookRed');
  }
  return s.model({ x: 4, y: 0, z: 4 }, EIGHTH);
}

/** A chest, its back to the wall: iron bands over its front and lid, and a brass lock. */
export function chest(): PropModel {
  const s = kit('chest', 'walnut', 'ironLight', 'gold');
  s.box(1, 0, 1, 6, 3, 5, 'chest');
  s.box(1, 4, 1, 6, 4, 5, 'walnut'); // the lid
  for (const x of [2, 5]) {
    s.box(x, 0, 5, x, 3, 5, 'ironLight');
    s.box(x, 4, 1, x, 4, 5, 'ironLight');
  }
  s.box(3, 2, 5, 4, 3, 5, 'gold'); // the lock
  return s.model({ x: 4, y: 0, z: 4 }, EIGHTH);
}

/**
 * A stone hearth against a wall, two blocks high: a hearthstone out into the room, a fire
 * glowing between the cheeks, a pot hung over it from an iron crane, a mantel shelf, and the
 * chimney breast up to head height (it goes on above, with the roof).
 */
export function hearth(): PropModel {
  const s = kit('stone', 'stoneDark', 'soot', 'ember', 'flame', 'iron', 'timber');
  s.box(0, 0, 0, 7, 0, 6, 'stoneDark'); // the hearthstone
  for (const x of [0, 6]) s.box(x, 1, 0, x + 1, 6, 4, 'stone'); // the cheeks
  s.box(2, 1, 0, 5, 6, 0, 'soot'); // the fireback, blackened
  s.box(2, 1, 1, 5, 1, 3, 'ember'); // the fire's bed
  for (const [x, z] of [[2, 2], [3, 1], [4, 2], [5, 1]]) s.put(x, 2, z, 'flame');
  s.box(2, 6, 2, 4, 6, 2, 'iron'); // the crane
  s.put(4, 5, 2, 'iron'); // its hook
  s.box(3, 3, 2, 4, 4, 3, 'iron'); // the pot
  s.box(0, 7, 0, 7, 7, 4, 'stoneDark'); // the lintel
  s.box(0, 8, 0, 7, 8, 5, 'timber'); // the mantel shelf
  for (let y = 9; y <= 15; y++) for (let x = 1; x <= 6; x++) for (let z = 0; z <= 3; z++) s.put(x, y, z, (x * 3 + y * 5 + z) % 7 === 0 ? 'stoneDark' : 'stone');
  return s.model({ x: 4, y: 0, z: 4 }, EIGHTH);
}

/** A rug two blocks square, a voxel thick: a red field, a gold border and an inner line, a blue diamond. */
export function rug(): PropModel {
  const s = kit('rug', 'rugBorder', 'rugMotif');
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      const edge = Math.min(x, z, 15 - x, 15 - z);
      const d = Math.abs(x - 7.5) + Math.abs(z - 7.5);
      s.put(x, 0, z, edge === 0 || edge === 2 ? 'rugBorder' : d <= 2 || d === 6 ? 'rugMotif' : 'rug');
    }
  }
  return s.model({ x: 8, y: 0, z: 8 }, EIGHTH);
}

/** A runner a block wide and two long, a voxel thick, with three small diamonds down it. */
export function runner(): PropModel {
  const s = kit('rug', 'rugBorder', 'rugMotif');
  for (let x = 0; x < 8; x++) {
    for (let z = 0; z < 16; z++) {
      const edge = Math.min(x, z, 7 - x, 15 - z);
      const motif = [3.5, 7.5, 11.5].some((c) => Math.abs(x - 3.5) + Math.abs(z - c) <= 2);
      s.put(x, 0, z, edge === 0 ? 'rugBorder' : motif ? 'rugMotif' : 'rug');
    }
  }
  return s.model({ x: 4, y: 0, z: 8 }, EIGHTH);
}

/** A block's length of bar: a framed walnut panel to the room (+z), a plinth, and a top over it all. */
function barLength(s: Sketch): void {
  s.box(0, 0, 1, 7, 0, 6, 'timberDark');
  s.box(0, 1, 1, 7, 6, 6, 'walnut');
  for (const x of [0, 7]) s.box(x, 1, 7, x, 6, 7, 'timber'); // the stiles
  for (const y of [1, 6]) s.box(1, y, 7, 6, y, 7, 'timber'); // the rails
  s.box(0, 7, 0, 7, 7, 7, 'plankLight'); // the top
}

/** A length of bar with two tankards of ale and a bottle on it. */
export function bar(): PropModel {
  const s = kit('timberDark', 'walnut', 'timber', 'plankLight', 'pewter', 'foam', 'bottleGreen');
  barLength(s);
  for (const [x, z] of [[2, 4], [5, 2]]) {
    s.put(x, 8, z, 'pewter');
    s.put(x, 9, z, 'foam');
  }
  s.box(6, 8, 6, 6, 9, 6, 'bottleGreen');
  return s.model({ x: 4, y: 0, z: 4 }, EIGHTH);
}

/** A length of bar with a cask on it, its tap on the keeper's side. */
export function barCask(): PropModel {
  const s = kit('timberDark', 'walnut', 'timber', 'plankLight', 'stave', 'hoop', 'iron');
  barLength(s);
  s.box(2, 8, 2, 5, 10, 5, 'stave');
  s.box(2, 9, 2, 5, 9, 5, 'hoop');
  s.put(3, 9, 1, 'iron');
  return s.model({ x: 4, y: 0, z: 4 }, EIGHTH);
}

/**
 * A clerk's desk, its front (+z) to the room: drawers on one side (their pulls on the clerk's
 * side), a panel at the front, and on its top papers, a ledger, an inkwell and quill, and a
 * candle that glows after dark.
 */
export function desk(): PropModel {
  const s = kit('walnut', 'timber', 'gold', 'paper', 'ink', 'linen', 'bookRed', 'wax', 'flame');
  s.box(0, 0, 1, 2, 4, 7, 'walnut'); // the drawers
  for (const y of [1, 3]) s.put(1, y, 0, 'gold');
  s.box(7, 0, 1, 7, 4, 7, 'walnut'); // the other end
  s.box(3, 1, 7, 6, 4, 7, 'timber'); // the front
  s.box(0, 5, 0, 7, 5, 7, 'walnut'); // the top
  s.box(2, 6, 3, 4, 6, 5, 'paper');
  s.box(5, 6, 1, 6, 6, 2, 'paper');
  s.box(1, 6, 5, 2, 6, 6, 'bookRed'); // a ledger
  s.put(6, 6, 5, 'ink'); // the inkwell
  s.put(6, 7, 5, 'linen'); // its quill
  s.put(1, 6, 1, 'gold'); // the candlestick
  s.box(1, 7, 1, 1, 8, 1, 'wax');
  s.put(1, 9, 1, 'flame');
  return s.model({ x: 4, y: 0, z: 4 }, EIGHTH);
}
```

Append to `src/props/market.ts`:

```ts
/** A trestle counter in the market hall, a block square, a sack under it, its goods on it: baskets of produce, or bolts of cloth. */
export function counter(goods: 'produce' | 'cloth'): PropModel {
  const s = kit('timber', 'plank', 'sack', 'wicker', 'wickerDark', 'greens', 'fruit', 'apple', 'clothPurple', 'clothBlue', 'clothOchre', 'linen');
  for (const x of [0, 7]) s.box(x, 0, 1, x, 4, 6, 'timber'); // the trestles
  s.box(0, 5, 0, 7, 5, 7, 'plank'); // the board
  s.box(2, 0, 2, 5, 2, 5, 'sack');
  if (goods === 'produce') {
    basketAt(s, 0, 6, 0, 'greens');
    basketAt(s, 4, 6, 4, 'fruit');
    for (const [x, z] of [[5, 1], [6, 2], [5, 2]]) s.put(x, 6, z, 'apple');
  } else {
    for (const [z, colour] of [[1, 'clothPurple'], [3, 'clothBlue'], [5, 'clothOchre']] as const) {
      s.box(1, 6, z, 6, 7, z + 1, colour);
      s.box(1, 6, z, 1, 7, z + 1, 'linen');
    }
    s.box(2, 8, 3, 5, 8, 4, 'clothBlue'); // one laid on top
  }
  return s.model({ x: 4, y: 0, z: 4 }, EIGHTH);
}
```

In `src/props/catalog.ts`, extend the imports to `import { bar, barCask, barrel, bed, chair, chest, crate, desk, hearth, rug, runner, shelf, stool, table } from './furniture';` and `import { counter, handCart, stall } from './market';`. Add:

```ts
    bed: bed(),
    table: table(),
    stool: stool(),
    chair: chair(),
    shelfCrockery: shelf('crockery'),
    shelfBottles: shelf('bottles'),
    shelfBooks: shelf('books'),
    chest: chest(),
    hearth: hearth(),
    rug: rug(),
    runner: runner(),
    bar: bar(),
    barCask: barCask(),
    desk: desk(),
    counterProduce: counter('produce'),
    counterCloth: counter('cloth'),
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/props src/render/PropsView.test.ts`.

Expected: all PASS. The checks that matter here are "fit every model drawn finer than a block…" (each model's bottom layer is in its cells and it's exactly as tall as its shape says), the four new model tests, and "build every kind…".

If a height fails, fix the model, not the shape. The shapes above are the design.

- [ ] **Step 5: Run everything and commit**

Run: `npx vitest run` and `npx tsc --noEmit -p .`. Expected: all pass.

There's no browser look here: nothing is placed yet. Task 5 shows them in rooms.

```bash
git add src/props/furniture.ts src/props/market.ts src/props/types.ts src/props/shapes.ts src/props/catalog.ts src/props/models.test.ts
git commit -m "$(cat <<'EOF'
Furniture drawn an eighth of a block a voxel: beds, tables, shelves, hearths, the bar, the desk and the market's counters

Claude-Session: https://claude.ai/code/session_01XGX2Zy161PcviqWzCXinMn
EOF
)"
```

---

### Task 5: Rooms furnished by role and size

**Files:**
- Create: `src/worldgen/rooms.ts`, `src/worldgen/rooms.test.ts`
- Modify: `src/worldgen/furnish.ts` (add `furnish`, `Post`), `src/worldgen/furnish.test.ts`
- Modify: `src/worldgen/town.ts`:
  - The building loop (~lines 305–323): furnish every building, the market hall too.
  - `buildMarketHall`: delete its inline stalls loop.
  - Delete the old `furnish` (~lines 1043–1093).
- Modify: `src/worldgen/town.test.ts`

**Interfaces:**
- Consumes:
  - From Task 2: `standProp`, `Cells`.
  - From Task 4: the furniture kinds and `PROP_SHAPES`.
  - `Footprint`, `Door` from `worldgen/buildings.ts`.
- Produces:
  - `rooms.ts`:
    - `interface Room { wide: number; deep: number; door: number }`.
    - `type RoomRole = 'house' | 'tavern' | 'office' | 'market'`.
    - `type Toward = 'in' | 'out' | 'left' | 'right'`.
    - `interface Piece { kind: PropKind; a: number; k: number; wa: number; dk: number; toward: Toward }`.
    - `interface Furnished { pieces: Piece[]; keeper: { a: number; k: number } | null }`.
    - `layRoom(room: Room, role: RoomRole, look = 0): Furnished`.
  - `furnish.ts`:
    - `interface Post { x: number; y: number; z: number; facing: number }` (`facing` is an angle, as a walker's).
    - `furnish(world, fp, door, role: RoomRole, decor, look = 0): Post | null`. It returns the keeper's post: behind the counter, against the back wall, facing the door's wall. It's null for a house.
- **Room coordinates.** Cell (a, k) is `a` across the room and `k` in from the wall with the door. The door is at (`door`, −1). The doorway's two cells, (`door`, 0) and (`door`, 1), are always left clear.

- [ ] **Step 1: Write the failing layout tests**

Create `src/worldgen/rooms.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { PropKind } from '../props/types';
import { layRoom, type Piece, type Room, type RoomRole } from './rooms';

const FLAT = new Set<PropKind>(['rug', 'runner']);
const ROLES: readonly RoomRole[] = ['house', 'tavern', 'office', 'market'];
const cellsOf = (p: Piece): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let a = p.a; a < p.a + p.wa; a++) for (let k = p.k; k < p.k + p.dk; k++) out.push([a, k]);
  return out;
};
/** Every room a town builds: three to five across, `deeps` in, its door in any but a corner column. */
function rooms(deeps: readonly number[]): Room[] {
  const out: Room[] = [];
  for (let wide = 3; wide <= 5; wide++) for (const deep of deeps) for (let door = 1; door <= wide - 2; door++) out.push({ wide, deep, door });
  return out;
}
const label = (r: Room, role: RoomRole) => `${role} ${r.wide}×${r.deep}, door at ${r.door}`;

/** Can someone walk from the door to beside the room's middle, round what stands on the floor? */
function wayIn(r: Room, pieces: readonly Piece[]): boolean {
  const taken = new Set(pieces.filter((p) => !FLAT.has(p.kind)).flatMap(cellsOf).map(([a, k]) => `${a},${k}`));
  const seen = new Set([`${r.door},0`]);
  const queue: Array<[number, number]> = [[r.door, 0]];
  while (queue.length > 0) {
    const [a, k] = queue.shift()!;
    if (Math.abs(a - (r.wide - 1) / 2) <= 1 && Math.abs(k - (r.deep - 1) / 2) <= 1) return true;
    for (const [na, nk] of [[a + 1, k], [a - 1, k], [a, k + 1], [a, k - 1]]) {
      const key = `${na},${nk}`;
      if (na < 0 || nk < 0 || na >= r.wide || nk >= r.deep || taken.has(key) || seen.has(key)) continue;
      seen.add(key);
      queue.push([na, nk]);
    }
  }
  return false;
}

describe('laying out a room', () => {
  it('keeps the door and the way in clear, in every room of every size', () => {
    for (const r of rooms([3, 4, 5])) {
      for (const role of ROLES) {
        const { pieces, keeper } = layRoom(r, role, 0);
        const name = label(r, role);
        const standing = pieces.filter((p) => !FLAT.has(p.kind)).flatMap(cellsOf).map(([a, k]) => `${a},${k}`);
        expect(new Set(standing).size, `${name}: nothing stands on anything else`).toBe(standing.length);
        for (const p of pieces) for (const [a, k] of cellsOf(p)) expect(a >= 0 && k >= 0 && a < r.wide && k < r.deep, `${name}: ${p.kind} in the room`).toBe(true);
        for (const k of [0, 1]) expect(standing.includes(`${r.door},${k}`), `${name}: the doorway, ${k} in`).toBe(false);
        expect(wayIn(r, pieces), `${name}: the way in`).toBe(true);
        if (keeper) expect(standing.includes(`${keeper.a},${keeper.k}`), `${name}: where the keeper stands`).toBe(false);
      }
    }
  });

  it('furnishes a house: a bed in a back corner, a hearth on an end wall, a table with seats, a shelf, a chest and a rug', () => {
    for (const r of rooms([4, 5])) {
      for (const look of [0, 1, 2, 3]) {
        const { pieces, keeper } = layRoom(r, 'house', look);
        const name = `${label(r, 'house')}, look ${look}`;
        const of = (kind: PropKind) => pieces.filter((p) => p.kind === kind);
        expect(keeper, name).toBeNull();
        const [bed] = of('bed');
        expect(bed, `${name}: bed`).toBeDefined();
        expect(bed.k + bed.dk, `${name}: the bed against the back wall`).toBe(r.deep);
        expect(bed.a === 0 || bed.a + bed.wa === r.wide, `${name}: the bed in a corner`).toBe(true);
        const [hearth] = of('hearth');
        expect(hearth, `${name}: hearth`).toBeDefined();
        expect(hearth.a === 0 || hearth.a === r.wide - 1, `${name}: the hearth on an end wall`).toBe(true);
        expect(of('table'), `${name}: table`).toHaveLength(1);
        expect(of('stool').length + of('chair').length, `${name}: seats`).toBeGreaterThanOrEqual(1);
        expect(of('chest'), `${name}: chest`).toHaveLength(1);
        expect(of('shelfCrockery').length + of('shelfBottles').length, `${name}: shelf`).toBe(1);
        expect(of('rug').length + of('runner').length, `${name}: rug`).toBe(1);
      }
    }
  });

  it('sets the tavern’s bar along the back with the keeper behind it, tables with stools, barrels and bottles', () => {
    for (const r of rooms([4, 5])) {
      const { pieces, keeper } = layRoom(r, 'tavern');
      const name = label(r, 'tavern');
      const of = (kind: PropKind) => pieces.filter((p) => p.kind === kind).length;
      expect(keeper!.k, `${name}: the keeper against the back wall`).toBe(r.deep - 1);
      expect(['bar', 'barCask'], `${name}: the bar before the keeper`).toContain(pieces.find((p) => p.a === keeper!.a && p.k === keeper!.k - 1)?.kind);
      expect(of('bar') + of('barCask'), name).toBeGreaterThanOrEqual(2);
      expect(of('barCask'), name).toBe(1);
      for (const kind of ['table', 'stool', 'barrel', 'shelfBottles'] as const) expect(of(kind), `${name}: ${kind}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('sets the office’s desk before the clerk, facing the door, with shelves of ledgers and a chest', () => {
    for (const r of rooms([4, 5])) {
      const { pieces, keeper } = layRoom(r, 'office');
      const name = label(r, 'office');
      expect(keeper!.k, name).toBe(r.deep - 1);
      expect(pieces.find((p) => p.kind === 'desk'), `${name}: desk`).toMatchObject({ a: keeper!.a, k: keeper!.k - 1, toward: 'out' });
      expect(pieces.filter((p) => p.kind === 'shelfBooks').length, name).toBeGreaterThanOrEqual(2);
      expect(pieces.filter((p) => p.kind === 'chest'), name).toHaveLength(1);
    }
  });

  it('sets out the market’s counters with the stallholder behind them', () => {
    for (const r of rooms([4, 5])) {
      const { pieces, keeper } = layRoom(r, 'market');
      const name = label(r, 'market');
      expect(keeper!.k, name).toBe(r.deep - 1);
      expect(pieces.find((p) => p.a === keeper!.a && p.k === keeper!.k - 1)?.kind, name).toMatch(/^counter/);
      expect(pieces.filter((p) => p.kind.startsWith('counter')).length, name).toBeGreaterThanOrEqual(3);
    }
  });

  it('lays the same room out the same way every time', () => {
    for (const role of ROLES) expect(layRoom({ wide: 4, deep: 5, door: 1 }, role, 3)).toEqual(layRoom({ wide: 4, deep: 5, door: 1 }, role, 3));
  });
});
```

Run: `npx vitest run src/worldgen/rooms.test.ts`. Expected: FAIL, "Failed to resolve import './rooms'".

- [ ] **Step 2: Write the layouts**

Create `src/worldgen/rooms.ts`:

```ts
import type { PropKind } from '../props/types';

/**
 * A room's floor as the furnisher sees it: `wide` cells across, and `deep` cells in from the
 * wall with the door, which is `door` across. Cell (a, k) is `a` across and `k` in.
 */
export interface Room {
  wide: number;
  deep: number;
  door: number;
}

/** What the room is for. */
export type RoomRole = 'house' | 'tavern' | 'office' | 'market';

/** Which way a piece's front looks: into the room (away from the door's wall), out toward it, or across to lower or higher `a`. */
export type Toward = 'in' | 'out' | 'left' | 'right';

/** A piece on the floor: what it is, the corner cell it takes, how many cells across and in, and which way it looks. */
export interface Piece {
  kind: PropKind;
  a: number;
  k: number;
  wa: number;
  dk: number;
  toward: Toward;
}

export interface Furnished {
  pieces: Piece[];
  /** Where the keeper stands, behind the counter against the back wall (none in a house). */
  keeper: { a: number; k: number } | null;
}

/** What lies flat on the floor: walked over, and laid under a table. */
const FLAT: ReadonlySet<PropKind> = new Set<PropKind>(['rug', 'runner']);
/** What a rug may lie under. */
const OVER_RUG: ReadonlySet<PropKind> = new Set<PropKind>(['table', 'stool', 'chair']);

const cellsOf = (p: Piece): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let a = p.a; a < p.a + p.wa; a++) for (let k = p.k; k < p.k + p.dk; k++) out.push([a, k]);
  return out;
};

/** A piece a cell square. */
const one = (kind: PropKind, a: number, k: number, toward: Toward): Piece => ({ kind, a, k, wa: 1, dk: 1, toward });

/** The floor as it's furnished: what stands where, and whether the way in is still open. */
class Floor {
  readonly pieces: Piece[] = [];
  private readonly at = new Map<string, PropKind>();
  private readonly flat = new Set<string>();

  constructor(
    readonly room: Room,
    /** Cells kept clear: where the keeper stands. */
    private readonly kept: ReadonlyArray<{ a: number; k: number }> = [],
  ) {}

  /** The first of these that fits; false if none does. */
  first(...options: Piece[]): boolean {
    return options.some((p) => this.put(p));
  }

  /**
   * Puts a piece down if it fits: in the room, on nothing else, off the doorway's two cells and
   * the kept ones, and leaving the way in open. A rug needs only bare floor, or a table's.
   */
  put(p: Piece): boolean {
    const cells = cellsOf(p);
    const { wide, deep, door } = this.room;
    if (cells.some(([a, k]) => a < 0 || k < 0 || a >= wide || k >= deep)) return false;
    if (FLAT.has(p.kind)) {
      if (cells.some(([a, k]) => this.flat.has(`${a},${k}`) || (this.at.has(`${a},${k}`) && !OVER_RUG.has(this.at.get(`${a},${k}`)!)))) return false;
      for (const [a, k] of cells) this.flat.add(`${a},${k}`);
    } else {
      const blocked = ([a, k]: [number, number]) => this.at.has(`${a},${k}`) || (a === door && k <= 1) || this.kept.some((c) => c.a === a && c.k === k);
      if (cells.some(blocked) || !this.wayIn(cells)) return false;
      for (const [a, k] of cells) this.at.set(`${a},${k}`, p.kind);
    }
    this.pieces.push(p);
    return true;
  }

  /** Can someone still walk from the door to beside the room's middle, with these cells taken too? */
  private wayIn(more: ReadonlyArray<[number, number]>): boolean {
    const { wide, deep, door } = this.room;
    const blocked = (a: number, k: number) => a < 0 || k < 0 || a >= wide || k >= deep || this.at.has(`${a},${k}`) || more.some(([ma, mk]) => ma === a && mk === k);
    const middle = (a: number, k: number) => Math.abs(a - (wide - 1) / 2) <= 1 && Math.abs(k - (deep - 1) / 2) <= 1;
    const seen = new Set<string>([`${door},0`]);
    const queue: Array<[number, number]> = [[door, 0]];
    while (queue.length > 0) {
      const [a, k] = queue.shift()!;
      if (middle(a, k)) return true;
      for (const [na, nk] of [[a + 1, k], [a - 1, k], [a, k + 1], [a, k - 1]] as const) {
        if (blocked(na, nk) || seen.has(`${na},${nk}`)) continue;
        seen.add(`${na},${nk}`);
        queue.push([na, nk]);
      }
    }
    return false;
  }
}

/** From a side wall, looking into the room. */
const offWall = (a: number): Toward => (a === 0 ? 'right' : 'left');

/** The side walls: the one further from the door, and the nearer. */
function sides({ wide, door }: Room): { far: number; near: number } {
  const far = door < wide / 2 ? wide - 1 : 0;
  return { far, near: wide - 1 - far };
}

/** Every cell, nearest the room's middle first. */
function byMiddle({ wide, deep }: Room): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  for (let a = 0; a < wide; a++) for (let k = 0; k < deep; k++) cells.push([a, k]);
  const off = ([a, k]: [number, number]) => Math.hypot(a - (wide - 1) / 2, k - (deep - 1) / 2);
  return cells.sort((p, q) => off(p) - off(q) || p[0] - q[0] || p[1] - q[1]);
}

/** A table at the first of `near` that leaves the way in, with up to `seats` of `seat` drawn up to it. */
function tableAt(f: Floor, seat: PropKind, seats: number, near: ReadonlyArray<[number, number]> = byMiddle(f.room)): void {
  for (const [a, k] of near) {
    if (!f.put(one('table', a, k, 'in'))) continue;
    let placed = 0;
    for (const [da, dk, toward] of [[-1, 0, 'right'], [1, 0, 'left'], [0, -1, 'in'], [0, 1, 'out']] as const) {
      if (placed < seats && f.put(one(seat, a + da, k + dk, toward))) placed++;
    }
    return;
  }
}

/** A rug in the middle (under the table, if that's where it is), or a runner where there's no room for one. */
function rugAt(f: Floor): void {
  const { wide, deep } = f.room;
  const options: Piece[] = [];
  for (let a = 0; a + 1 < wide; a++) for (let k = 0; k + 1 < deep; k++) options.push({ kind: 'rug', a, k, wa: 2, dk: 2, toward: 'in' });
  for (let a = 0; a < wide; a++) for (let k = 0; k + 1 < deep; k++) options.push({ kind: 'runner', a, k, wa: 1, dk: 2, toward: 'in' });
  const off = (p: Piece) => Math.hypot(p.a + (p.wa - 1) / 2 - (wide - 1) / 2, p.k + (p.dk - 1) / 2 - (deep - 1) / 2);
  f.first(...options.sort((p, q) => (p.kind === q.kind ? off(p) - off(q) : p.kind === 'rug' ? -1 : 1)));
}

/** A house: a bed in a back corner, the hearth on the end wall across from it, a shelf, a chest, a table with stools (or chairs) and a rug. */
function house(room: Room, look: number): Furnished {
  const back = room.deep - 1;
  const { far, near } = sides(room);
  const f = new Floor(room);
  f.first(
    { kind: 'bed', a: far, k: back - 1, wa: 1, dk: 2, toward: 'out' },
    { kind: 'bed', a: far === 0 ? 0 : far - 1, k: back, wa: 2, dk: 1, toward: far === 0 ? 'right' : 'left' },
    { kind: 'bed', a: near, k: back - 1, wa: 1, dk: 2, toward: 'out' },
  );
  f.first(one('hearth', near, back, offWall(near)), one('hearth', near, back - 1, offWall(near)), one('hearth', far, 0, offWall(far)), one('hearth', near, 0, offWall(near)));
  const shelf: PropKind = look % 2 === 0 ? 'shelfCrockery' : 'shelfBottles';
  const onBack = Array.from({ length: room.wide }, (_, a) => one(shelf, a, back, 'out'));
  f.first(one(shelf, near, back - 1, offWall(near)), ...onBack, one(shelf, far, 0, offWall(far)), one(shelf, near, 0, offWall(near)));
  f.first(one('chest', far, back - 2, 'out'), one('chest', far, 0, offWall(far)), one('chest', near, 0, offWall(near)));
  tableAt(f, look % 3 === 0 ? 'chair' : 'stool', 2);
  rugAt(f);
  return { pieces: f.pieces, keeper: null };
}

/** The tavern: the bar across the back with the keeper behind it, bottles and barrels at the back wall, tables with stools either side of the way in. */
function tavern(room: Room): Furnished {
  const { wide } = room;
  const back = room.deep - 1;
  const keeper = { a: Math.floor((wide - 1) / 2), k: back };
  const f = new Floor(room, [keeper]);
  // In a wide room a gap at either end of the bar, to get behind it; the cask on the end further from the keeper.
  const [b0, b1] = wide >= 4 ? [1, wide - 2] : [0, wide - 1];
  const cask = keeper.a - b0 > b1 - keeper.a ? b0 : b1;
  for (let a = b0; a <= b1; a++) f.put(one(a === cask ? 'barCask' : 'bar', a, back - 1, 'out'));
  for (let a = 0; a < wide; a++) {
    if (a === keeper.a) continue;
    const bottles = a === keeper.a - 1 || (wide >= 5 && a === keeper.a + 1);
    f.put(one(bottles ? 'shelfBottles' : 'barrel', a, back, 'out'));
  }
  const { far, near } = sides(room);
  tableAt(f, 'stool', 2, [[near, 1], [near, 0], [near, 2]]);
  tableAt(f, 'stool', 2, [[far, 1], [far, 0], [far, 2]]);
  return { pieces: f.pieces, keeper };
}

/** The office: the desk facing the door with the clerk behind it, ledgers on shelves along the back and side walls, a chest, a chair for callers and a rug. */
function office(room: Room): Furnished {
  const { wide, door } = room;
  const back = room.deep - 1;
  let a = Math.floor((wide - 1) / 2);
  // The desk mustn't stand in the doorway: in a shallow room, it goes beside it.
  if (back - 1 <= 1 && a === door) a = door + 1 < wide ? door + 1 : door - 1;
  const keeper = { a, k: back };
  const f = new Floor(room, [keeper]);
  f.put(one('desk', a, back - 1, 'out'));
  for (let s = 0; s < wide; s++) if (s !== a) f.put(one('shelfBooks', s, back, 'out'));
  for (const s of [0, wide - 1]) f.put(one('shelfBooks', s, back - 1, offWall(s)));
  const { far, near } = sides(room);
  f.first(one('chest', far, 0, offWall(far)), one('chest', near, 0, offWall(near)));
  f.put(one('chair', a, back - 2, 'in'));
  rugAt(f);
  return { pieces: f.pieces, keeper };
}

/** The market hall: counters across the back with the stallholder behind, crates and barrels by the back wall, counters down both sides at the front. */
function market(room: Room): Furnished {
  const { wide } = room;
  const back = room.deep - 1;
  const keeper = { a: Math.floor((wide - 1) / 2), k: back };
  const f = new Floor(room, [keeper]);
  for (let a = 1; a <= wide - 2; a++) f.put(one(a % 2 ? 'counterProduce' : 'counterCloth', a, back - 1, 'out'));
  for (let a = 0; a < wide; a++) if (a !== keeper.a) f.put(one(a === 0 || a === wide - 1 ? 'barrel' : 'crate', a, back, 'out'));
  for (let k = 0; k < back - 1; k++) for (const a of [0, wide - 1]) f.put(one(k % 2 ? 'counterCloth' : 'counterProduce', a, k, offWall(a)));
  for (const a of [0, wide - 1]) f.put(one('crate', a, back - 1, 'out'));
  return { pieces: f.pieces, keeper };
}

/**
 * Lays out a room's furniture by what it's for and its size, keeping the doorway's two cells
 * clear and a way from the door to beside the room's middle. `look` (from the plot) varies a
 * house a little: crockery or bottles on its shelf, stools or chairs at its table.
 */
export function layRoom(room: Room, role: RoomRole, look = 0): Furnished {
  switch (role) {
    case 'house':
      return house(room, look);
    case 'tavern':
      return tavern(room);
    case 'office':
      return office(room);
    case 'market':
      return market(room);
  }
}
```

Run: `npx vitest run src/worldgen/rooms.test.ts`. Expected: PASS.

If a size fails a "furnishes a house…" check, add a candidate to the failing piece's `first(…)` list. Don't loosen the test.

- [ ] **Step 3: Write the failing `furnish` tests**

In `src/worldgen/furnish.test.ts`, merge the imports:

```ts
import { PROP_SHAPES, shapeCells } from '../props/shapes';
import { buildHouse, type Footprint } from './buildings';
import { furnish, plotCells, standProp } from './furnish';
```

Then add:

```ts
describe('furnishing a building', () => {
  const GROUND = 10;
  const BASE = GROUND + 1;
  /** A two-storey building seven by six on flat grass, its door toward (towardX, towardZ), its floor boarded. */
  function plot(towardX: number, towardZ: number) {
    const world = new VoxelWorld();
    for (let x = -12; x < 20; x++) for (let z = -12; z < 20; z++) for (let y = 0; y <= GROUND; y++) world.setVoxel(x, y, z, Block.Grass);
    const fp: Footprint = { x0: 0, z0: 0, w: 7, d: 6 };
    const door = buildHouse(world, fp, BASE, { walls: Block.Plaster, roof: Block.Thatch }, towardX, towardZ, 2);
    for (let x = 1; x < 6; x++) for (let z = 1; z < 5; z++) world.setVoxel(x, BASE - 1, z, Block.Planks);
    return { world, fp, door };
  }

  it('sets the room’s pieces inside its walls, keeps people out of them, and leaves the doorway clear, whichever way the door looks', () => {
    for (const [tx, tz] of [[3.5, -10], [3.5, 20], [-10, 2.5], [20, 2.5]]) {
      const { world, fp, door } = plot(tx, tz);
      const decor: PropPlacement[] = [];
      furnish(world, fp, door, 'tavern', decor);
      expect(decor.length, `door toward ${tx},${tz}`).toBeGreaterThan(5);
      for (const p of decor) {
        for (const c of shapeCells(p, PROP_SHAPES[p.kind]!)) {
          expect(c.x > fp.x0 && c.x < fp.x0 + fp.w - 1 && c.z > fp.z0 && c.z < fp.z0 + fp.d - 1, `${p.kind} at ${c.x},${c.z} inside`).toBe(true);
          if (PROP_SHAPES[p.kind]!.blocks) expect(world.getVoxel(c.x, BASE, c.z), `${p.kind} at ${c.x},${c.z} keeps people out`).toBe(Block.Blocker);
        }
      }
      const [ix, iz] = [Math.sign(door.x - door.outX), Math.sign(door.z - door.outZ)];
      for (const k of [1, 2]) expect(world.getVoxel(door.x + ix * k, BASE, door.z + iz * k), `${k} in from the door toward ${tx},${tz}`).toBe(Block.Air);
    }
  });

  it('stands the keeper behind the bar, against the back wall, facing the door; and none in a house', () => {
    const { world, fp, door } = plot(3.5, -10); // the door in the north wall
    const decor: PropPlacement[] = [];
    const post = furnish(world, fp, door, 'tavern', decor)!;
    expect(post.y).toBe(BASE);
    expect(Math.floor(post.z)).toBe(fp.z0 + fp.d - 2); // the back row, against the south wall
    expect(world.getVoxel(Math.floor(post.x), BASE, Math.floor(post.z))).toBe(Block.Air);
    expect(Math.cos(post.facing)).toBeCloseTo(-1); // looking north, to the door
    const before = decor.find((d) => Math.floor(d.x) === Math.floor(post.x) && Math.floor(d.z) === Math.floor(post.z) - 1);
    expect(['bar', 'barCask']).toContain(before?.kind);
    expect(furnish(world, fp, door, 'house', [])).toBeNull();
  });
});
```

Run: `npx vitest run src/worldgen/furnish.test.ts`. Expected: FAIL, "furnish is not exported".

- [ ] **Step 4: Write `furnish`**

Append to `src/worldgen/furnish.ts`, adding to its imports `import { FACING_DIRS } from '../voxel/blocks';` (merge with `Block`), `import type { Door } from './buildings';` (merge with `Footprint`) and `import { layRoom, type RoomRole, type Toward } from './rooms';`:

```ts
/** Where someone stands, and which way they look: an angle, as a walker's facing. */
export interface Post {
  x: number;
  y: number;
  z: number;
  facing: number;
}

const facingOf = (dx: number, dz: number): number => FACING_DIRS.findIndex(([fx, fz]) => fx === dx && fz === dz);

/**
 * Furnishes a building's ground floor with props, seen when its roof lifts, laid out by what
 * it's for and its size (`layRoom`), keeping the doorway and the way in clear. Each piece keeps
 * people out of its cells. Returns where the keeper stands: behind the counter against the
 * back wall, looking toward the door's wall (none in a house).
 */
export function furnish(world: VoxelWorld, fp: Footprint, door: Door, role: RoomRole, decor: PropPlacement[], look = 0): Post | null {
  const ix = Math.sign(door.x - door.outX);
  const iz = Math.sign(door.z - door.outZ);
  const deep = ix !== 0 ? fp.w - 2 : fp.d - 2;
  const wide = ix !== 0 ? fp.d - 2 : fp.w - 2;
  /** The cell `k` in from the door's wall and `a` across the room. */
  const cell = (a: number, k: number) =>
    ix !== 0
      ? { x: ix > 0 ? fp.x0 + 1 + k : fp.x0 + fp.w - 2 - k, z: fp.z0 + 1 + a }
      : { x: fp.x0 + 1 + a, z: iz > 0 ? fp.z0 + 1 + k : fp.z0 + fp.d - 2 - k };
  const doorA = ix !== 0 ? door.z - (fp.z0 + 1) : door.x - (fp.x0 + 1);
  // Across the room (+a), and the four ways a piece can look, in the world.
  const [ax, az] = ix !== 0 ? [0, 1] : [1, 0];
  const ways: Record<Toward, readonly [number, number]> = { in: [ix, iz], out: [-ix, -iz], right: [ax, az], left: [-ax, -az] };
  const { pieces, keeper } = layRoom({ wide, deep, door: doorA }, role, look);
  for (const p of pieces) {
    const c0 = cell(p.a, p.k);
    const c1 = cell(p.a + p.wa - 1, p.k + p.dk - 1);
    const [dx, dz] = ways[p.toward];
    standProp(world, decor, p.kind, { x0: Math.min(c0.x, c1.x), z0: Math.min(c0.z, c1.z), x1: Math.max(c0.x, c1.x), z1: Math.max(c0.z, c1.z) }, door.y, facingOf(dx, dz));
  }
  if (!keeper) return null;
  const c = cell(keeper.a, keeper.k);
  return { x: c.x + 0.5, y: door.y, z: c.z + 0.5, facing: Math.atan2(-ix, -iz) };
}
```

Run: `npx vitest run src/worldgen/furnish.test.ts`. Expected: PASS.

- [ ] **Step 5: Write the failing town tests**

In `src/worldgen/town.test.ts`:

(a) In "set the market, tavern and guildhall apart from the houses", replace the market's three block checks (`hall` and its three `expect`s) with:

```ts
      // The market: counters of goods under an open hall, and lanterns at its front.
      const market = plotOf('market');
      const counters = harbour.decor.filter((d) => d.kind.startsWith('counter') && inside(market, Math.floor(d.x), Math.floor(d.z)));
      expect(counters.length, `${name} market counters`).toBeGreaterThanOrEqual(2);
      expect(blocksIn(world, market, place('market').y, place('market').y + 3).get(Block.Lantern) ?? 0, `${name} market lanterns`).toBeGreaterThanOrEqual(2);
```

(b) Replace "furnish the rooms: beds and hearths in the houses, tables and a bar in the tavern, books in the office" with:

```ts
  it('furnish the rooms: a bed and a hearth in every house, the tavern’s bar, the office’s desk, and counters in the market', () => {
    const NEEDS: Record<string, readonly PropKind[]> = {
      house: ['bed', 'hearth', 'table', 'chest'],
      tavern: ['bar', 'barCask', 'barrel', 'shelfBottles', 'table', 'stool'],
      office: ['desk', 'shelfBooks', 'chest'],
      market: ['counterProduce', 'counterCloth'],
    };
    for (const { name, harbour } of PORTS) {
      const placeAt = (f: Footprint) => harbour.places.find((p) => p.kind !== 'shipyard' && outside(f, Math.floor(p.x), Math.floor(p.z)) <= 1)?.kind;
      for (const house of harbour.town.houses) {
        const kind = placeAt(house) ?? 'house';
        const room = { x0: house.x0 + 1, z0: house.z0 + 1, w: house.w - 2, d: house.d - 2 };
        const kinds = new Set(harbour.decor.filter((d) => inside(room, Math.floor(d.x), Math.floor(d.z))).map((d) => d.kind));
        for (const k of NEEDS[kind]) expect(kinds.has(k), `${name} ${kind} at ${house.x0},${house.z0}: ${k}`).toBe(true);
      }
    }
  });

  it('leave every door and the way into each room clear: the captain can walk in from the step to the middle', () => {
    for (const { name, world, harbour } of PORTS) {
      const steps = [...harbour.places.filter((p) => p.kind !== 'shipyard'), ...harbour.spots.filter((s) => s.kind === 'door')];
      for (const house of harbour.town.houses) {
        const step = steps.find((s) => outside(house, Math.floor(s.x), Math.floor(s.z)) === 1);
        if (!step) continue;
        const middle = { x: house.x0 + house.w / 2, z: house.z0 + house.d / 2 };
        expect(findPath(world, { x: step.x, y: step.y, z: step.z }, middle, 1.5), `${name} into the room at ${house.x0},${house.z0}`).not.toBeNull();
      }
    }
  });
```

Run: `npx vitest run src/worldgen/town.test.ts`. Expected: FAIL. There are no furniture props yet, and the market's counters are still blocks.

- [ ] **Step 6: Furnish every building with props**

In `src/worldgen/town.ts`:

1. Change the import of `./furnish` to `import { furnish, plotCells, standProp } from './furnish';`.
2. In the building loop, replace the `let door: Door;` block, from `let door: Door;` to the closing `}` of the `else`, with:

```ts
    // Its rooms, furnished when the roof lifts: how they're set out varies a little by plot.
    const look = Math.floor(hash2(fp.x0, fp.z0, 53) * 1000);
    let door: Door;
    if (lot.role === 'market') {
      door = buildMarketHall(world, fp, base, style, face.x + 0.5, face.z + 0.5);
      furnish(world, fp, door, 'market', decor, look);
    } else {
      const storeys = lot.role === 'house' ? (hash2(fp.x0, fp.z0, 71) < 0.4 ? 2 : 1) : lot.role === 'office' ? (style.officeStoreys ?? 2) : 2;
      door = buildHouse(world, fp, base, style, face.x + 0.5, face.z + 0.5, storeys);
      boardFloor(world, fp, base);
      furnish(world, fp, door, lot.role, decor, look);
      if (lot.role === 'tavern') barrelsBy(world, door);
      if (lot.role === 'office') flagOver(world, fp, style.flag);
    }
```

3. In `buildMarketHall`:
   - Delete the loop under `// Stalls: counters and barrels down both sides, clear down the middle to the front.` (the whole `for (let x = x0 + 1; …)` block, ~lines 754–767).
   - Change its doc comment to "The market: an open hall on posts under a gable roof, a wall at the back; its counters are set out by `furnish`. Returns its way in (the middle of its open front)."
4. Delete the old `furnish` function and its doc comment (~lines 1043–1093).
5. Update the comment over the building loop ("Buildings, doors to the street: …") to end "…every floor boarded and every room furnished."

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/worldgen`.

Expected: all PASS. This includes the walking test "let the captain in at the tavern’s and office’s doors, walking from the porch", "stand every prop that stands on the ground…" (now covering furniture) and "set out the same props from the same seed".

- [ ] **Step 8: Look in the game, and measure**

Reload `/?new` and follow "Looking at it in the game". Screenshot to `.playwright-mcp/t5-NN-*.png`. In Haven, from each building's spot (camera south-east, then north-west):

1. A one-storey house and a two-storey house, by day (`spots` of kind `door`: `game.sea.docked.spots.filter(s => s.kind === 'door')`).
2. The tavern, by day and by night. The hearthless tavern's bar reads, and the bottles and barrels behind it.
3. The office: the desk facing the door, the candle glowing at night, the shelves of ledgers.
4. The market hall: counters across the back and down the sides.
5. One room from inside (`inside('tavern')`). Walk to the bar and the tables: the captain stops at them and doesn't climb.
6. Port Clemency's and Kingsreach's tavern and office from their spots.

Then on Haven's square at night (`tp(-1.5, 18, 42.5)`, `phase = 0.85`), run `await frames()` and compare with Task 1's baseline.
- Expected: the median frame time is within about 10 % of the baseline, and triangles rise by tens of thousands at most.
- If not, report the numbers. Don't trim the models without asking.

Close the browser.

- [ ] **Step 9: Run everything and commit**

Run: `npx vitest run` and `npx tsc --noEmit -p .`. Expected: all pass.

```bash
git add src/worldgen/rooms.ts src/worldgen/rooms.test.ts src/worldgen/furnish.ts src/worldgen/furnish.test.ts src/worldgen/town.ts src/worldgen/town.test.ts
git commit -m "$(cat <<'EOF'
Rooms furnished by what they're for and their size, the way in kept clear

Claude-Session: https://claude.ai/code/session_01XGX2Zy161PcviqWzCXinMn
EOF
)"
```

---

### Task 6: Shopkeepers

**Files:**
- Modify: `src/economy/ports.ts` (`KeeperPost`, `Port.keepers`)
- Modify: `src/worldgen/town.ts` (`Town.keepers`, collecting the posts, the shipwright's post)
- Modify: `src/worldgen/harbour.ts` (`Harbour.keepers`)
- Modify: `src/land/townsfolk.ts`
- Modify: `src/render/PeopleView.ts`
- Modify: `src/land/townsfolk.test.ts`, `src/worldgen/town.test.ts`

**Interfaces:**
- Consumes:
  - From Task 5: `furnish(…): Post | null`.
  - `townDress`, `dressKind`, `isNight`, `hash2`, `createWalker`, `stepWalker`.
- Produces:
  - `interface KeeperPost { kind: PlaceKind; x: number; y: number; z: number; facing: number }` in `economy/ports.ts`.
  - `Port.keepers?: KeeperPost[]`, `Town.keepers: KeeperPost[]`, `Harbour.keepers: KeeperPost[]`.
  - `Townsman.task` gains `{ kind: 'keep'; post: KeeperPost }`.
  - In `land/townsfolk.ts`:
    - `keeping(post: KeeperPost, night: boolean): boolean`.
    - `keeperLook(port: Port, post: KeeperPost): { look: number; dress: Dress }`.
    - A module-private `fixed(f)` and `postedBy(folk, spot)`.

- [ ] **Step 1: Write the failing townsfolk tests**

In `src/land/townsfolk.test.ts`:
- Change the import from `../economy/ports` to `import type { KeeperPost, Port, PortPlace } from '../economy/ports';`. It fails to compile until Step 3.
- Add `keeperLook` to the import from `./townsfolk`.
- Add at the end:

```ts
describe('the shops’ keepers', () => {
  /** In the flat town: the office's behind its desk (inside its walls), and three more out on the grass, well away from the spots townsfolk go to. */
  const KEEPERS: KeeperPost[] = [
    { kind: 'office', x: 28.5, y: FLOOR, z: -2.5, facing: -Math.PI / 2 },
    { kind: 'tavern', x: -30.5, y: FLOOR, z: 30.5, facing: 0 },
    { kind: 'market', x: -30.5, y: FLOOR, z: -30.5, facing: 0 },
    { kind: 'shipyard', x: 30.5, y: FLOOR, z: 30.5, facing: Math.PI },
  ];
  const shops = (where: Port = TOWN): Port => ({ ...where, places: [SHIPYARD, { ...OFFICE }], keepers: KEEPERS });
  const keepers = (land: Land) => land.townsfolk.filter((f) => f.task.kind === 'keep');
  const about = (land: Land) => land.townsfolk.filter((f) => f.task.kind !== 'keep' && f.task.kind !== 'guard');
  const kinds = (land: Land) => keepers(land).map((f) => (f.task.kind === 'keep' ? f.task.post.kind : '')).sort();
  const ALL = ['market', 'office', 'shipyard', 'tavern'];

  it('keep their shops by day: one at each post, standing still, facing the room’s front', () => {
    const { sea, land } = town(shops());
    run(sea, land, 0.1);
    expect(kinds(land)).toEqual(ALL);
    const ids = keepers(land).map((f) => f.id);
    run(sea, land, 30);
    expect(keepers(land).map((f) => f.id)).toEqual(ids);
    for (const f of keepers(land)) {
      if (f.task.kind !== 'keep') continue;
      const { post } = f.task;
      expect(Math.hypot(f.walker.x - post.x, f.walker.z - post.z), post.kind).toBeLessThan(0.05);
      expect(f.walker.y, post.kind).toBe(post.y);
      expect(f.walker.facing, post.kind).toBe(post.facing);
    }
  });

  it('leave only the tavern keeper at night, and are all back in the morning', () => {
    const { sea, land } = town(shops());
    run(sea, land, 1);
    const tavern = keepers(land).find((f) => f.task.kind === 'keep' && f.task.post.kind === 'tavern')!.id;
    sea.clock.phase = phaseOf(23);
    run(sea, land, 1);
    expect(kinds(land)).toEqual(['tavern']);
    expect(keepers(land)[0].id).toBe(tavern);
    sea.clock.phase = phaseOf(8);
    run(sea, land, 1);
    expect(kinds(land)).toEqual(ALL);
  });

  it('are gone when the captain leaves town, and back behind their counters when they land', () => {
    const where = shops();
    const { sea, land } = town(where);
    run(sea, land, 1);
    sea.docked = null;
    land.step(0.05);
    expect(keepers(land)).toHaveLength(0);
    sea.docked = where;
    land.step(0.05);
    expect(kinds(land)).toEqual(ALL);
  });

  it('dress for their port, never as soldiers, and look the same each visit', () => {
    const where = shops(port(2, 'imperial'));
    const { sea, land } = town(where);
    run(sea, land, 1);
    const looks = keepers(land).map((f) => f.look).sort();
    for (const f of keepers(land)) {
      expect(f.dress.soldier ?? false).toBe(false);
      expect(f.dress).toEqual(townDress('imperial', f.look));
      if (f.task.kind === 'keep') expect(keeperLook(where, f.task.post).look).toBe(f.look);
    }
    sea.docked = null;
    land.step(0.05);
    sea.docked = where;
    land.step(0.05);
    expect(keepers(land).map((f) => f.look).sort()).toEqual(looks);
  });

  it('don’t count toward the town’s numbers, and take nothing from its dice: the town goes on just as it would without them', () => {
    const a = town({ ...TOWN, places: [SHIPYARD, { ...OFFICE }] }, 5);
    const b = town(shops(), 5);
    run(a.sea, a.land, 30);
    run(b.sea, b.land, 30);
    const where = (land: Land) => about(land).map((f) => [f.look, f.walker.x, f.walker.z]);
    expect(about(b.land).length).toBeGreaterThanOrEqual(5);
    expect(where(b.land)).toEqual(where(a.land));
  });
});
```

- [ ] **Step 2: Write the failing town test**

In `src/worldgen/town.test.ts`, add:

```ts
  it('post a keeper in each shop with a building of its own: behind its counter, facing the room’s front, clear of every door', () => {
    const COUNTERS = ['bar', 'barCask', 'desk', 'counterProduce', 'counterCloth'];
    for (const { name, world, harbour } of PORTS) {
      const yard = harbour.places.find((p) => p.kind === 'shipyard')!;
      const own = harbour.places.filter((p) => p.kind === 'shipyard' || p.x !== yard.x || p.z !== yard.z);
      expect(harbour.keepers.map((k) => k.kind).sort(), name).toEqual(own.map((p) => p.kind).sort());
      for (const post of harbour.keepers) {
        const label = `${name} ${post.kind}’s keeper`;
        expect(collides(world, post.x, post.y, post.z), `${label}: room to stand`).toBe(false);
        expect(groundBelow(world, post.x, post.z, post.y + 0.5), `${label}: on the floor`).toBe(post.y);
        for (const p of harbour.places) expect(Math.hypot(post.x - p.x, post.z - p.z), `${label}, by the ${p.kind}’s door`).toBeGreaterThanOrEqual(1.5);
        if (post.kind === 'shipyard') {
          expect(inside(harbour.town.shed, Math.floor(post.x), Math.floor(post.z)), `${label}: in the shed`).toBe(true);
          continue;
        }
        const ahead = { x: Math.floor(post.x + Math.sin(post.facing)), z: Math.floor(post.z + Math.cos(post.facing)) };
        const counter = harbour.decor.find((d) => COUNTERS.includes(d.kind) && Math.floor(d.x) === ahead.x && Math.floor(d.z) === ahead.z);
        expect(counter, `${label}: a counter before them`).toBeDefined();
      }
    }
  });
```

Run: `npx tsc --noEmit -p .`. Expected: errors (`KeeperPost`, `keepers` and `keeperLook` don't exist yet).

- [ ] **Step 3: Keepers' posts, from the town to the port**

In `src/economy/ports.ts`, after `PortPlace`, add:

```ts
/**
 * Where a shop's keeper stands: behind its counter (the tavern's bar, the office's desk, the
 * market's back counter), or the shipwright in the shed; and which way they look, an angle
 * as a walker's facing.
 */
export interface KeeperPost {
  kind: PlaceKind;
  x: number;
  y: number;
  z: number;
  facing: number;
}
```

and to `Port`, after `decor`:

```ts
  /** Where the shops' keepers stand (none for a port with no town of its own): from the seed, never saved. */
  keepers?: KeeperPost[];
```

In `src/worldgen/town.ts`:
- Change `import type { SpotKind, TownSpot } from '../economy/ports';` to `import type { KeeperPost, SpotKind, TownSpot } from '../economy/ports';`.
- Add to `Town`, after `decor`:

```ts
  /** Where each shop's keeper stands: behind the tavern's bar, the office's desk and the market's counter, and the shipwright in the shed. */
  keepers: KeeperPost[];
```

- At the top of `buildTown`, after `const lamps…`, add `const keepers: KeeperPost[] = [];`.
- After `const yard = { x: yardAt.x + 0.5, y: low, z: yardAt.z + 0.5 };`, add:

```ts
  // The shipwright, in the shed by the timber, looking out to the square.
  const wright = at(f, shed.u0 + 1, ys * 10);
  keepers.push({ kind: 'shipyard', x: wright.x + 0.5, y: low, z: wright.z + 0.5, facing: Math.atan2(-ys * f.sx, -ys * f.sz) });
```

- In the building loop, change the two `furnish(…)` calls to keep the keeper's post:

```ts
      const post = furnish(world, fp, door, 'market', decor, look);
      if (post) keepers.push({ kind: 'market', ...post });
```

and

```ts
      const post = furnish(world, fp, door, lot.role, decor, look);
      if (post && lot.role !== 'house') keepers.push({ kind: lot.role, ...post });
```

- Add `keepers,` to the returned object, after `decor,`.

In `src/worldgen/harbour.ts`:
- Import `KeeperPost` alongside `PortPlace` from `../economy/ports`.
- Add to `Harbour`:

```ts
  /** Where the shops' keepers stand (see Town.keepers). */
  keepers: KeeperPost[];
```

- Add `keepers: town.keepers` to `buildHarbour`'s returned object.

`buildArchipelago` spreads the harbour into the port, so `Port.keepers` is filled with no change there.

- [ ] **Step 4: The `keep` task**

In `src/land/townsfolk.ts`:

1. Change the ports import to `import type { KeeperPost, Port, PortPlace, SpotKind, TownSpot } from '../economy/ports';`.
2. In `Townsman`'s comment, after "standing guard at the Governor's door", add ", or a shop's keeper behind the counter". Add `| { kind: 'keep'; post: KeeperPost };` to `task`, after `{ kind: 'guard' }`.
3. After the `TURN` constant, add:

```ts
/** A keeper this close to a spot stands in the way of those round it. */
const KEEPER_NEAR = 3;

/** Who stands fixed at a post: the Crown's guards and the shops' keepers. They don't count toward the town's numbers. */
const fixed = (f: Townsman): boolean => f.task.kind === 'guard' || f.task.kind === 'keep';

/** Those at posts who are in the way of anyone standing round a spot: the guards, and a keeper close by. */
function postedBy(folk: readonly Townsman[], spot: TownSpot): Walker[] {
  return folk.filter((f) => f.task.kind === 'guard' || (f.task.kind === 'keep' && Math.hypot(f.walker.x - spot.x, f.walker.z - spot.z) < KEEPER_NEAR)).map((f) => f.walker);
}

/** Is a keeper in their shop? By day, all of them; at night, only the tavern's. */
export const keeping = (post: KeeperPost, night: boolean): boolean => !night || post.kind === 'tavern';

/**
 * A keeper's looks: from where they stand, not a draw from the town's dice, so they look the
 * same each visit and the town's dice roll as they would without them. Dressed for the port,
 * and never as a soldier.
 */
export function keeperLook(port: Port, post: KeeperPost): { look: number; dress: Dress } {
  let tried = { look: 0, dress: townDress(dressKind(port), 0) };
  for (let salt = 0; salt < 32; salt++) {
    const look = Math.floor(hash2(Math.floor(post.x) * 7 + salt, Math.floor(post.z), 0x6b) * 1e6);
    tried = { look, dress: townDress(dressKind(port), look) };
    if (!tried.dress.soldier) return tried;
  }
  return tried;
}
```

4. In `stepTownsfolk`:
   - Replace `const want = isNight(land.sea.clock.phase) ? NIGHT_FOLK : …` with:

```ts
  const night = isNight(land.sea.clock.phase);
  const want = night ? NIGHT_FOLK : port.faction === 'pirate' ? DAY_FOLK - 1 : DAY_FOLK;
```

   - After the guards' block, add:

```ts
  // The shops' keepers, behind their counters: all of them by day, only the tavern's at night.
  for (const post of port.keepers ?? []) {
    const here = land.townsfolk.find((f) => f.task.kind === 'keep' && f.task.post === post);
    if (here && !keeping(post, night)) here.gone = true;
    if (here || !keeping(post, night)) continue;
    const { look, dress } = keeperLook(port, post);
    land.townsfolk.push({ id: land.nextTownsman++, look, dress, walker: createWalker(post.x, post.y, post.z, post.facing), task: { kind: 'keep', post }, home: false });
  }
```

   - Replace the arrival block's condition and its two uses of the guards with:

```ts
  if (land.lastOut === null && !land.townsfolk.some((f) => !fixed(f))) {
    const places = spots.filter((s) => s.kind !== 'door');
    for (let i = 0; i < want && places.length > 0; i++) {
      const spot = pickSpot(places, (s) => standingAt(land.townsfolk, s).length, random)!;
      const at = standAt(land.world, spot, [...standingAt(land.townsfolk, spot), ...postedBy(land.townsfolk, spot)], random);
      const { look, dress } = freshLook(dressKind(port), land.townsfolk.filter((f) => f.task.kind !== 'keep').map((f) => f.dress), random, land.lastOut ?? undefined);
```

   (the rest of that loop is unchanged; delete the old `const guards = …` line).

   - Change `const folk = land.townsfolk.filter((f) => f.task.kind !== 'guard');` to `const folk = land.townsfolk.filter((f) => !fixed(f));`.

5. In `step`:
   - Replace the guard branch with:

```ts
  if (t.kind === 'guard' || t.kind === 'keep') {
    stepWalker(f.walker, 0, 0, land.world, dt); // stands at their post
    return;
  }
```

   - Change the `standAt` call's guards to `postedBy(others, to)`:

```ts
  const at = f.home ? to : standAt(land.world, to, [...standingAt(others, to), ...postedBy(others, to)], random);
```

- [ ] **Step 5: The shipwright's hammer**

In `src/render/PeopleView.ts`, replace:

```ts
      const working = !f.dress.soldier && f.task.kind === 'linger' && f.task.spot.kind === 'yard';
```

with:

```ts
      // At the yard they hammer: the townsfolk lingering there, and the shipwright at his post.
      const shipwright = f.task.kind === 'keep' && f.task.post.kind === 'shipyard';
      const working = !f.dress.soldier && ((f.task.kind === 'linger' && f.task.spot.kind === 'yard') || shipwright);
```

Update the comment above the townsfolk loop: "Townsfolk (by negative keys…), dressed for their port: strolling, lingering, keeping shop, and at the shipyard, hammering."

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/land/townsfolk.test.ts src/worldgen/town.test.ts`. Expected: all PASS, including the existing guards' and townsfolk tests unchanged.

If the dice test fails, something new draws from `random`, or keepers reach `freshLook`'s list or a far spot's `taken` list. Fix that rather than the test.

- [ ] **Step 7: Look in the game**

Reload `/?new` and follow "Looking at it in the game". Screenshot to `.playwright-mcp/t6-NN-*.png`:

1. Haven by day, at each shop's spot (camera south-east). Each keeper is behind the counter, facing the front. The shipwright swings his hammer in the shed.
2. Kingsreach's Governor's House: the clerk behind the desk, and the two guards still outside.
3. Haven at night (`phase = 0.85`), wait 2 s. Only the tavern keeper is there (`game.land.townsfolk.filter(f => f.task.kind === 'keep').map(f => f.task.post.kind)`).
4. Back to day (`phase = 0.3`). All four are back.
5. Stand at each shop's E spot. The prompt shows, E opens the shop's screen as before, and no keeper stands on the spot.

Close the browser.

- [ ] **Step 8: Run everything and commit**

Run: `npx vitest run` and `npx tsc --noEmit -p .`. Expected: all pass.

```bash
git add src/economy/ports.ts src/worldgen/town.ts src/worldgen/harbour.ts src/land/townsfolk.ts src/render/PeopleView.ts src/land/townsfolk.test.ts src/worldgen/town.test.ts
git commit -m "$(cat <<'EOF'
Shopkeepers behind the counters: all four by day, the tavern keeper at night

Claude-Session: https://claude.ai/code/session_01XGX2Zy161PcviqWzCXinMn
EOF
)"
```

---

### Task 7: Browser check and ARCHITECTURE

**Files:**
- Modify: `docs/ARCHITECTURE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the docs, and a screenshot set for the visual-critic loop the controller runs next.

- [ ] **Step 1: The whole check in the browser**

Reload `/?new` and follow "Looking at it in the game". For Haven, Port Clemency and Kingsreach (and Rook's Nest's market and yard), screenshot to `.playwright-mcp/t7-<port>-<what>.png`:

1. Each shop (market hall, tavern, office, shipyard) from its spot, with the camera at each of the four quarter turns. Its roof is lifted, the room shows and nothing hides the captain.
2. Each shop from inside (`inside(kind)`, camera south-east).
3. A one-storey house and a two-storey house from their doors, by day and by night.
4. The square from its middle by day: the stalls and the cart.

Go through every screenshot. Note anything that looks wrong (a prop floating or clipping a wall, a door blocked, a keeper in a wall, a roof left on) and fix it in the task that owns it before going on.

Close the browser.

- [ ] **Step 2: Update ARCHITECTURE**

In `docs/ARCHITECTURE.md`, make the following edits.

**§8, Dressing.** Replace the "Dressing." bullet with:

```markdown
  - **Dressing.** Two stalls stand on the square by the market, either side of the column of
    its door, their fronts to the square's middle and two clear rows between their backs
    and the market's step (`STALL_BACK`). One sells produce and one cloth, under a striped
    awning (blue at the free port, red elsewhere). Benches stand at the square's top, and a
    hand cart of timber by the shipyard. Each port adds its own: net racks and crates of
    fish at Haven, bales at the free port, two guns run out at the seaward edge for the
    Crown, and guns and a gallows (in the cart's place) for the Brethren. Stalls and the
    cart keep two clear cells from every door's step.
  - **Rooms** are furnished with props, since the roof lifter shows them
    (`worldgen/rooms.ts` lays them out as cells; `worldgen/furnish.ts` stands them). The
    layout goes by what the room is for and its size, and always leaves the doorway's two
    cells clear and a way from the door to beside the room's middle.
    - *A house:* a bed in a back corner, the hearth on the end wall across from it, a shelf
      of crockery or bottles, a chest, a table with stools or chairs, and a rug.
    - *The tavern:* the bar across the back with a cask on one end, bottles and barrels at
      the back wall, and tables with stools either side of the way in.
    - *The office:* the desk facing the door, ledgers on shelves along the back and side
      walls, a chest, a chair for callers, and a rug.
    - *The market hall:* counters of produce and cloth across the back and down the sides,
      with crates and barrels.
    - Each layout says where its keeper stands: against the back wall, behind the counter.
```

**§8, Props.** In the "Props" bullet:

- Under *Models*, add: "The town's finer furniture, the stalls, the hand cart and the hall's counters are drawn an eighth of a block a voxel with the colours in `props/kit.ts` (`furniture.ts`, `market.ts`)."
- Replace *Drawing*'s first sentence with: "one `InstancedMesh` a kind a town (props within 150 of a town's first share it), so a town off screen isn't drawn".
- Replace *Reserved cells* with:

```markdown
    - *Reserved cells:* a prop drawn a block a voxel (the ship on the stocks) keeps people
      out of the cells it fills: `reserveProps` writes the blocker into them, once, straight
      after worldgen and before `trackEdits`. A finer prop has a shape in blocks
      (`props/shapes.ts`: across, along the way it faces, and high). The town builder stands
      it with `standProp`, which writes the blocker into its cells three high (the walker
      climbs two), except under stools, chairs and rugs. It anchors the prop at the cell its
      top is in. The lifter sees a blocker as planks, so a stall or the cart in the way
      lifts and goes whole. Furniture is never above head height, so it stays with its
      room. All of it is part of the generated world, never of a save.
```

**§8, Tests.** Add: "`rooms.test.ts` lays out every room size and role. `shopLift.test.ts` (render) lifts every shop of the five ports from its door and every floor cell inside."

**§9, Townsfolk.** After the "Guards." bullet, add:

```markdown
  - **Keepers.** Each shop with a building of its own has a keeper at a post
    (`Port.keepers`, from the town builder): behind the tavern's bar, the office's desk and
    the market's back counter, facing the room's front, and the shipwright in the shed by
    the timber, hammering. They stand still and don't count toward the town's numbers.
    By day all are in; at night only the tavern keeper is, and the others are gone till
    morning. Their looks come from where they stand (never a draw from the town's dice),
    dressed for the port and never as soldiers, so they're the same each visit. They're
    gone when you leave port and back when you land.
```

**§9, The view.**
- In "In the way", replace "Everything from a storey above its floor, or from its eaves if those are lower, lifts" with "Everything from head height (two above its floor), or from its eaves if those are lower, lifts, so a shop's room shows as a house's does".
- After "…it lifts from there.", add "The line of sight then goes on through what it has lifted, through up to three trees or buildings, so a stall's post in front of a shop can't keep the shop's roof on."
- Change "Lanterns go with the wall or post they hang from…" to: "Lanterns go with the wall or post they hang from, a prop hung on a wall goes with its anchor, and a porch's posts go with its canopy (§8)."
- In "Beside you in port", change "Stalls, carts, guns and flags lift only when they're in the way." to "Stalls, the cart, guns and flags lift only when they're in the way; a stall or the cart then goes whole."

**§9, Saves, "Towns in older saves".** Add a sentence: "From the shops-and-interiors work on, rooms, stalls and the cart are props; in such a chunk the old block furniture and stalls stand on beside them, and nobody is kept out of the props' cells there."

**§15, module map.**
- In `props/`, add: "kit (the finer props' colours and helpers), furniture (barrels, crates, beds, tables, shelves, chests, hearths, rugs, the bar, the desk), market (stalls, the hand cart, the hall's counters), shapes (a finer prop's cells)".
- In `worldgen/`, add "rooms (a room's furniture laid out by role and size), furnish (standing props: blockers and anchors; furnishing a building)".

**§16, roadmap.** Under "Asked for after 10.2", mark the four items ✅ and link this plan. In the critic's open points:
- Strike "Lifting a roof shows a bare room".
- Strike Kingsreach's "a roof hides the captain and doesn't lift", if Step 1 confirmed it.

- [ ] **Step 3: Run everything and commit**

Run: `npx vitest run` and `npx tsc --noEmit -p .`. Expected: all pass.

```bash
git add docs/ARCHITECTURE.md
git commit -m "$(cat <<'EOF'
Town shops and interiors in ARCHITECTURE: the head-height cut, finer props that keep people out, rooms by role and size, keepers

Claude-Session: https://claude.ai/code/session_01XGX2Zy161PcviqWzCXinMn
EOF
)"
```

---

## After the plan: the visual-critic loop (run by the controller, not a task)

The spec's gate is overall ≥ 8, every screen ≥ 7, at most 5 passes, stopping when the score is flat. The controller captures these screens with roofs lifted, using "Looking at it in the game": camera at its default (south-east) yaw and distance 36, standing at each shop's spot, or a house's `door` spot.

| # | Screen | Haven | Port Clemency (free) | Kingsreach (Crown) |
|---|---|---|---|---|
| 1 | A house by day (`phase = 0.3`) | ✓ | ✓ | ✓ |
| 2 | The same house by night (`phase = 0.85`) | ✓ | ✓ | ✓ |
| 3 | The tavern by day | ✓ | ✓ | ✓ |
| 4 | The tavern by night | ✓ | ✓ | ✓ |
| 5 | The office | ✓ | ✓ | ✓ |
| 6 | The market hall | ✓ | ✓ | ✓ |
| 7 | The shipyard | ✓ | ✓ | ✓ |

That's 21 screens. Fixes from the critic go in the files above, chiefly the models in `props/furniture.ts` and `props/market.ts` and the layouts in `worldgen/rooms.ts`. Keep the tests green and commit after each pass, by path, with the trailer.
