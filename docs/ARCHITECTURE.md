# Haven's End: Technical Architecture

A 2.5D voxel pirate RPG: Sid Meier's *Pirates!* sailing and combat, Stardew-style
base building on islands you shape yourself. This document records the decisions
behind the codebase and the plan for the phases after Phase 1.

## 1. Stack

| Concern | Choice | Why |
|---|---|---|
| Rendering | **Three.js r186, vanilla, `WebGLRenderer`** | Direct control over the hot paths (chunk meshes, instanced ocean, shadows). WebGL2 runs everywhere. |
| Language / build | **TypeScript (strict) + Vite** | Fast HMR and zero-config TS. `tsc` typechecks; Vite bundles. |
| Tests | **Vitest** | The simulation core has no rendering dependencies, so it is tested headless. |
| Noise | **simplex-noise** | Tiny, seedable, and well tested. |
| Physics | **Custom (no engine)** | See §5. |
| UI | **Plain DOM overlay** now; React (DOM only) when menus arrive (Phase 4) | Menus are where React pays off; the 3D scene is not. |

### Why not React Three Fiber?
R3F is excellent for declarative scenes. This game's scene is mostly imperative:
- chunk meshes rebuilt whenever terrain is dug,
- a 25,600-column ocean animated in a shader,
- ships and cannonballs moved every tick.

In R3F all of that lives in `useFrame` and refs anyway, so we would pay for the
reconciler without using it. More importantly, the simulation must not depend on
React's mount lifecycle. It needs to be deterministic, run in fixed steps, save and
load, and keep simulating islands that aren't on screen. React stays on the table
for DOM menus (trading, shipyard, crew).

### Why not Rapier?
- **The voxel grid is already the collision structure.** Solidity lookups are O(1)
  and always current. A physics-engine copy of the terrain would have to be rebuilt
  on every dig and flatten.
- **Sailing should be designed, not simulated.** *Pirates!*-style handling (points
  of sail, momentum, turning circles) is a tuned model. Rapier has no buoyancy or
  hydrodynamics, so we would write those forces ourselves either way.
- **Cannonballs are ballistic points.** Segment tests per tick against hull boxes and
  the voxel grid are exact and cheap.

If we later want tumbling wreckage or ragdolls, Rapier can be added for that
subsystem alone without touching the core.

### Why not an existing voxel engine?
The voxel core this game needs is small (~450 lines here). It is also where the art
style lives: ambient occlusion, colour jitter, and how the water meets the sand.
Owning it means the look, the chunk format and the save format are all ours.

## 2. World model

Scale: **1 voxel = 1 world unit** (read it as a metre). Constants are in `src/config.ts`.

- **The sea is not voxels.** The ocean is drawn around the camera (§4), so open water
  costs nothing and the map can be any size.
- **Islands are voxels.** `VoxelWorld` is a *sparse* map of 32³ chunks keyed by
  packed chunk coordinates. Only chunks containing something exist; one island is
  currently 38 chunks.
- **Sea level** is `SEA_LEVEL = 12`: cells below y = 12 are underwater. The water
  surface sits at 11.6 ± 0.3, between voxel boundaries, so it never z-fights terrain.
- **Worldgen is deterministic** in its seed (tested). Saves will store seed + edits,
  not voxels.

## 3. Voxel pipeline

```
setVoxel(x,y,z,id) ─┬─► chunk data changed
                    ├─► owning chunk (+ neighbours, if on a border) marked dirty
                    └─► onChange listeners (e.g. SeabedMap)

per frame: ChunkRenderer.update(budget)
  takeDirty(n) ─► buildPaddedVolume (34³ copy incl. neighbour border)
               ─► meshPaddedVolume  (pure: face culling + AO + colour jitter)
               ─► BufferGeometry swap on that chunk's Mesh
```

- **Chunk size 32** balances draw calls (one mesh per chunk) against remesh cost.
- **Face culling with per-vertex AO**, not greedy meshing. AO and per-voxel colour
  jitter would block most merges anyway, and the island is ~96k triangles.
- **Worker-ready seam.** `meshPaddedVolume` is a pure function of a 39 KB array.
  When remeshing needs to leave the main thread, it moves into a Web Worker unchanged.
- **Budgets.** One chunk costs ~3 ms to mesh on the main thread. Startup meshes
  everything; in play, at most 2 chunks are remeshed per frame.
- **Bedrock.** Space below y = 0 counts as solid, so the world has no underside faces
  (and tools refuse to dig y = 0).
- **Picking and hit tests** use a voxel DDA raycast (`voxel/raycast.ts`), which reads
  voxel data directly and is never stale.

## 4. Ocean

- A **160×160 grid of instanced 1×1 water columns** follows the camera, snapping to
  whole cells so the columns line up with terrain voxels. Beyond it, a flat plane
  reaches the horizon, and fog blends the two.
- **Waves** are three sine trains, quantised to 7 heights: stepped, voxel-style waves.
  The function exists **once in TypeScript** (`waveOffset`) and is **generated as
  GLSL** from the same constants (`WAVE_GLSL`). Ships will float on exactly the
  surface that is drawn. Phases are wrapped in double precision on the CPU, so the
  waves stay accurate after hours of play.
- **Depth-aware colour.** `SeabedMap` keeps a 256×256 byte map of terrain height,
  uploaded as a texture. The shader uses it for the turquoise-to-navy ramp,
  see-through shallows, beach surf, and to collapse columns inside dry land. It
  follows terrain edits, so digging a channel floods it.
- Implemented by injecting into `MeshStandardMaterial` (`onBeforeCompile`), so
  lighting, shadows and fog still apply.

## 5. Simulation, physics and time

**Loop.** `GameLoop` runs the **simulation at a fixed 60 Hz** (`FixedStep`,
accumulator with a 250 ms clamp) and **renders at display rate**, interpolating with
`alpha`. The rule, enforced by structure in `Game.ts`:

> State that must be saved, replayed or kept deterministic lives in `sim` and changes
> only in `update(dt)`. Everything in `render()` is derived from it and is disposable.

Camera easing, highlights and HUD are presentation, so they run on frame time.

**Planned physics (Phase 2+):**
- **Ships:** a 2D rigid body on the water plane (position, heading, surge, sway, yaw
  rate). Sail thrust comes from a point-of-sail curve of apparent wind. The keel
  resists sideways drift, the rudder's turning force scales with speed, and drag is
  quadratic. Heel, pitch and heave are visual only, sampled from `waveOffset` at
  bow, stern and both beams. Grounding comes from `SeabedMap`/voxel lookups under the hull.
- **Cannonballs:** point projectiles integrated per tick, inheriting ship velocity.
  Each step's movement segment is tested against hull boxes, the voxel grid (DDA)
  and the water plane (splash).
- **Characters on land:** axis-separated swept AABB against the voxel grid, with
  one-voxel step-up.

**Entities and systems.** Plain, serialisable data in typed stores (`ships`,
`projectiles`, …), with systems as functions called in a fixed order each tick. An
ECS library is only worth adopting once NPC automation (Phase 6) brings many
cross-cutting queries.

**Off-screen islands.** Bases keep producing while you sail. Distant islands run a
coarse *ledger* simulation (rates × elapsed game time, capped by storage and
workers) instead of simulating every NPC. On return, NPCs and crops are placed
consistently with the ledger.

**Saves (designed now, built in Phase 5).** Seed, modified chunks (run-length
encoded) and the `sim` state as JSON, in IndexedDB.

## 6. Module map

```
src/
  config.ts            world constants (SEA_LEVEL, SIM_HZ, …)
  Game.ts              composition root: sim state, update(), render()
  main.ts              entry; exposes `game` on window in dev
  core/                FixedStep (tested), GameLoop, Input
  voxel/               engine-agnostic voxel core, no three.js imports
    blocks.ts          block ids, colours, solidity
    Chunk.ts           32³ storage
    VoxelWorld.ts      sparse chunks, edits, dirty tracking, column queries (tested)
    mesher.ts          padded volume + face-culled AO mesher (tested)
    raycast.ts         voxel DDA (tested)
  worldgen/            seeded noise, island generator (tested for determinism)
  ocean/               waves.ts (CPU+GLSL twin, tested), SeabedMap
  render/              CameraRig, Sun (texel-snapped shadows), ChunkRenderer,
                       OceanRenderer, buoy placeholder
  tools/TerrainTool.ts dig / place dev tool
  ui/Hud.ts            DOM overlay + perf readout
```

Dependency direction: `voxel`, `worldgen`, `ocean` and `core` never import from
`render`, `tools`, `ui` or three.js. Only `Game.ts` knows about everything.

## 7. Roadmap (proposed)

1. ✅ **Foundation:** loop, camera, voxel chunks + mesher, ocean, island, dig/place.
2. **Sailing:** ship entity, wind, sail/rudder model, wave riding, grounding, `.vox` ship models.
3. **Naval combat:** broadsides with per-side reload, ballistic arcs, hull/sail/crew damage, AI ships, sinking.
4. **Ports & economy:** docking, supply/demand trade, shipyard and upgrades, crew hiring; React DOM menus.
5. **On foot & base building:** captain controller, dig/flatten/build with inventory, claiming land, save/load.
6. **Crew automation & farming:** job system, voxel-surface pathfinding, production chains, off-screen ledger, day/night.
7. **Treasure hunting:** hand-drawn-style maps of real terrain, riddles generated from landmarks, dig sites.
8. **Story:** the opening (orphaned, adopted by a merchant captain, the Imperial attack), the black flag, the revenge arc.
