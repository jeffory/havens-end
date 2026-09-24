# Haven's End: Technical Architecture

A 2.5D voxel pirate RPG: Sid Meier's *Pirates!* sailing and combat, Stardew-style
base building on islands you shape yourself. This document records the decisions
behind the codebase and the plan for the phases still to come.

## 1. Stack

| Concern | Choice | Why |
|---|---|---|
| Rendering | **Three.js r186, vanilla, `WebGLRenderer`** | Direct control over the hot paths (chunk meshes, instanced ocean, shadows). WebGL2 runs everywhere. |
| Language / build | **TypeScript (strict) + Vite** | Fast HMR and zero-config TS. `tsc` typechecks; Vite bundles; `tsx` runs asset scripts. |
| Tests | **Vitest** | The simulation core has no rendering dependencies, so it is tested headless. |
| Noise | **simplex-noise** | Tiny, seedable, and well tested. |
| Physics | **Custom (no engine)** | See §5. |
| Ship art | **MagicaVoxel `.vox`**, own parser | Artists work in the standard voxel editor; ships are meshed by our own mesher, so they match the islands. See §8. |
| Character art | **Tripo** (text to 3D, via ComfyUI) → **voxelizer** → `.vox` | Detailed, consistent captains without hand modelling; they end up as named-part `.vox` files you can restyle. See §7. |
| Input | **Keyboard + Gamepad API** (standard mapping) | One `Controls` layer merges both. |
| UI | **Plain DOM overlay** now; React (DOM only) when menus arrive (Phase 4) | Menus are where React pays off; the 3D scene is not. |
| Target | Desktop browsers, including higher-end laptops | Budgets below assume a discrete or recent integrated GPU. |

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
- **Compass.** North is −z and east is +x.
- **Worldgen and weather are deterministic** in their seeds (tested). Saves will
  store seeds + edits, not voxels or weather.

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
- **One mesher for everything.** It takes a palette (colours + solidity): terrain uses
  block colours, ships use their `.vox` palette (`render/voxelGeometry.ts`).
- **Worker-ready seam.** `meshPaddedVolume` is a pure function of a 39 KB array.
  When remeshing needs to leave the main thread, it moves into a Web Worker unchanged.
- **Budgets.** One chunk costs ~3 ms to mesh on the main thread. Startup meshes
  everything; in play, at most 2 chunks are remeshed per frame.
- **Bedrock.** For terrain, space below y = 0 counts as solid, so the world has no
  underside faces (and tools refuse to dig y = 0). Models turn this off.
- **Picking and hit tests** use a voxel DDA raycast (`voxel/raycast.ts`), which reads
  voxel data directly and is never stale.

## 4. Ocean

- A **160×160 grid of instanced 1×1 water columns** follows the camera, snapping to
  whole cells so the columns line up with terrain voxels. Beyond it, a flat plane
  (just below the lowest wave) reaches the horizon, and fog blends the two.
- **Waves** are three sine trains, quantised to 7 heights: stepped, voxel-style waves.
  The function exists **once in TypeScript** (`waveOffset`) and is **generated as
  GLSL** from the same constants (`WAVE_GLSL`). Ships ride exactly the surface that
  is drawn. Phases are wrapped in double precision on the CPU, so the waves stay
  accurate after hours of play.
- **Depth-aware colour.** `SeabedMap` keeps a 256×256 byte map of terrain height,
  uploaded as a texture. The shader uses it for the turquoise-to-navy ramp,
  see-through shallows, beach surf, and to collapse columns inside dry land. It
  follows terrain edits, so digging a channel floods it.
- **Foam.** Ship wakes and shot splashes are points in a pool (`render/Wake.ts`).
  Each frame the ocean stamps them into a 160×160 foam texture aligned with the
  water grid. The shader samples it once and dithers it into blocky foam. (A
  per-pixel loop over every point was the first version; it cost ~20% of frame time
  in battles.)
- Implemented by injecting into `MeshStandardMaterial` (`onBeforeCompile`), so
  lighting, shadows and fog still apply.

## 5. Sailing and weather (Phase 2)

**Ship frame.** Matches three.js `rotation.y = heading`: local +z is the bow, local
+x is **port**. World forward is `(sin h, cos h)`; increasing the heading turns to port.

**Handling** (`sailing/ship.ts`, pure and deterministic, one call per fixed tick):
- **Drive** = acceleration × canvas set × wind strength × a point-of-sail curve of
  the angle off the *true* wind (`pointOfSail.ts`): 6% head to wind ("in irons", a
  crawl), 45% close-hauled, 90% on a beam reach, 100% on a broad reach, 82% running.
- **Drag** is quadratic plus a small linear term, tuned so full drive settles at
  exactly `topSpeed`, so speeds build and bleed off over seconds (momentum).
- **Leeway.** Wind shoves the hull sideways; a stiff keel lets only a little through.
- **Steering.** Turn rate scales with speed (the rudder needs water flowing past it).
  At rest you keep 35%, so a grounded ship can always turn off.
- **The crew** move the rudder and canvas at finite rates: 2.5 s from furled to full.
- **Heel** (visual) leans away from the wind and outward in turns.
- Sail settings are furled, half and full.

**Collision.** The hull's **waterline footprint comes from the model itself**. Hull
voxels from the keel to one voxel above the water become outline samples every half
voxel. Each tick the proposed pose is checked against solid voxels between keel
depth and just above the water, so **water shallower than the draft grounds you**,
and the shore, docks and anything you build all block. On contact: speed is cut
hard, then the ship tries to slide along the obstacle on one axis, then to push off
it (for turning into the shore). Aground status holds for 0.5 s so it doesn't flicker.

**Weather** (`sailing/weather.ts`) is a pure function of `(seed, x, z, time)`:
- **Trade winds** from the east-north-east, wandering ±20° over minutes.
- **Squalls**: anticlockwise low-pressure spirals (north is up), strongest at ~0.7
  radius, gusty, up to ~27 kn.
- **Calms** smother the wind to a fifth.
- Systems drift downwind at 2.2 u/s across a 3,000-unit region that wraps, so
  weather keeps arriving. Generated systems keep clear of each other and of the home
  island at the start.

Because the field is a function, it costs nothing to save and can be sampled
anywhere: by ships, the HUD, wind streaks, and later AI captains.

**Feedback.** HUD compass: wind, heading and north in screen space, plus speed,
point of sail, local conditions and sail setting. Wind streaks drift with the local
wind. Squalls darken the sky and light. The flag streams with the *apparent* wind.

**Controls** (`core/Controls.ts`) merge keyboard and any standard-mapping gamepad.
Rudder is analog. Button presses are queued until the simulation takes them, so a
tap is never lost on a frame where the sim doesn't step (common on 120–144 Hz displays).

| Action | Keyboard | Gamepad |
|---|---|---|
| Steer | A / D, ← / → | Left stick, d-pad ← → |
| Sails up / down | W / S, ↑ / ↓ | D-pad ↑ ↓, Y / A |
| Fire port / starboard broadside | Q / E | LT / RT |
| Round / chain / grape shot | 1 / 2 / 3 (R cycles) | X cycles |
| Board | B | B |
| *Duel:* move | A / D | Left stick |
| *Duel:* cut / heavy / thrust / kick | J / K / U / I (left click cuts) | X / Y / RB / B |
| *Duel:* block (tap to parry) | hold L or right mouse | LB or LT |
| *Duel:* roll | Space | A |
| Turn view | Z / C | LB / RB |
| Zoom | Mouse wheel | Right stick ↕ |

## 6. Naval combat (Phase 3)

All combat is simulation code in `src/combat/`: no three.js, deterministic (a seeded
RNG lives in the `Sea`), and unit-tested. `Sea.step()` advances, in order: orders,
AI captains, sailing, hull separation, shots, barrels, fates (sinking, capture,
respawn), encounters. It reports what happened as `SeaEvent`s, and the renderer turns
those into smoke, splashes, splinters, explosions and messages.

**Guns.** Broadsides fire straight out of the side at one fixed elevation. You aim
by manoeuvring, and range comes from the charge. Each side reloads separately.
Reload time and the number of guns manned both fall with crew losses.

| Shot | Reach* | Per projectile | Use |
|---|---|---|---|
| Round | ~55 | hull 8 | sinking ships |
| Chain | ~43 | sails 9 | crippling speed: drive scales with rig condition |
| Grape (4 balls/gun) | ~30 | crew 0.6 each | fewer guns manned, slower reloads; she strikes her colours |

\* From a sloop's gun deck; the range dots on the water show it live, and they
light up as each side reloads.

**Damage and outcomes.** Hull ≤ 0 sinks her. An AI ship below 20% hull or crew
**strikes her colours**: she furls sail, hauls down her flag and can be boarded
freely. Boarding needs you alongside (within about 5 voxels) and nearly matched in
speed. A struck ship is taken outright; otherwise the captains duel (§7). Half a
captured crew signs on, if you have room.

**AI captains** (`combat/ai.ts`) decide four times a second and steer every tick:
- *Merchants* cruise, run from the player (within 110 or once provoked), and drop
  **explosive barrels** when a pursuer is close astern (2–4 per ship). Barrels arm
  after 2 s, blow when a hull touches them or a shot hits them, and set off
  neighbours in a chain.
- *Warships* (Imperial and rival pirates) close to range, then turn to bring a loaded
  broadside to bear. They hold the fight at about 60% of reach and pick their shot:
  grape when close, chain against a faster target, round otherwise.
- *Escorts* keep station off the convoy leader's quarters until anyone in the group
  is attacked.
- Everyone keeps out of the no-go zone, probes ahead for land, and gives way to other
  ships (to starboard when head-on).

**Encounters** (`combat/encounters.ts`) spawn groups out of sight (230–300 away) on
courses that cross yours. Groups that fall far astern untouched leave the map.
Difficulty rises with distance from home:

| Region | Distance | Groups |
|---|---|---|
| Home waters | < 700 | lone merchant, pirate or Imperial sloop |
| Contested waters | < 1500 | merchant brig with an escort, Imperial brig, pirate pairs |
| Imperial waters | beyond | escorted convoys (brig + 2 escorts), warship pairs |

The first two encounters are fixed (a merchant, then a pirate) so new players meet
a prize and then a fight.

**Factions** show in their flags: the ship's own flag object is recoloured by faction
(crimson and gold Imperial, white and blue merchant, dark red pirate). The player's
black flag is drawn as authored. Floating labels name each ship and show her hull
and intent.

## 7. The captains' duel (Phase 3b)

Boarding a ship that hasn't struck her colours becomes a sword fight between the
captains on her deck, seen from the side. The sea waits: the `Sea` holds its
`boarding` target and the game stops stepping it until `finishBoarding(won)`.

**Simulation** (`src/duel/`, pure and deterministic like the rest): two fighters on a
line, stepped at 60 Hz.

| Move | Windup | Notes |
|---|---|---|
| Light cut | 0.30 s | chains into a 3-hit combo; follow-ups come out faster (0.22 s) and the third hits harder |
| Heavy | 0.65 s | big damage, drains a blocker's stamina |
| Thrust (red) | 0.75 s | **can't be blocked or parried**: roll through it or step out of reach |
| Kick | 0.30 s | no warning, little damage, **breaks a raised guard** |

- **Block** (hold): 15–20% of the damage gets through and each blow costs stamina.
  An empty stamina bar means a guard break (stagger).
- **Parry** (the first 0.2 s of raising the guard, on a white blow): no damage, the
  attacker staggers, and you get a 1.6× riposte for a second. A missed parry can't be
  retried for 0.45 s, so mashing doesn't work.
- **Roll**: invincible from 0.04 to 0.32 s, covers 2.6 units, and passes through the
  other fighter to swap sides.
- **Stamina** powers everything; winded fighters can't attack.
- **Crew advantage** tilts the fight: the bigger crew gives its captain up to +25%
  health and +15% damage.
- **Enemy captains** (`duelAi.ts`) have a reaction time, parry/block/roll chances,
  aggression, a guard kept up between attacks, and a chance to get the guard up
  between combo hits. Merchants are soft, pirates aggressive, Imperial officers sharp.
  `npm run duel:balance` pits a scripted player against each over 40 seeds. Current
  numbers: a sloppy player beats merchants ~80%, pirates ~30% and Imperials ~5%; a
  competent one wins 85–98% across the board.

**Presentation** (`DuelScene.ts`, `render/DuelView.ts`, `render/CharacterView.ts`,
`ui/DuelHud.ts`):
- The stage is parented to the prize's deck, so the fight rides her motion. It's
  framed from the side away from your ship, looking down about 30° onto a flat run of
  deck found from the ship's voxels, clear of the mast and quarterdeck. A fill light
  from the camera side keeps dark coats readable.
- Captains are animated from code: limb directions per pose (guard, walk, block,
  parry snap, three attack phases per move, roll somersault, hitstun, stagger, fall),
  eased toward each frame. Fighters are mirrored as needed so the sword arm always
  faces the camera.
- **The parry cue:** a ring closes on the enemy's sword hand as a blow winds up. White
  means block or parry, red means roll, and it turns **gold inside the parry window**.
- Pop-up text (PARRY!, BLOCK, GUARD BREAK, DODGE, damage, RIPOSTE), sparks, camera
  shake on heavy blows, and slow motion on parries and the final blow.

**Outcome:** win and the prize is yours (her gold, as much cargo as your hold takes,
half her crew if there's room). Lose, or have your crew overrun at sea, and you're
**jailed**: pay 30% of your gold to get out, lose everything in the hold, and start
again at your **last port** with a fresh sloop. Sinking also puts you back at the
last port; the cargo goes down with the ship, but your purse survives.

**Economy stub, until Phase 4:** the captain carries gold (starting at 200). Each ship
type has a hold capacity (sloop 30, brig 60, merchant brig 80). Merchants carry 2–3
kinds of goods (sugar, rum, tobacco, cloth, spice) and warships a paymaster's chest.
The only port so far is Haven, the home island; Phase 4 adds ports, prices and docking.

### Character pipeline

1. `npm run characters:generate`: `scripts/generate-characters.py` sends a text
   prompt per captain to Tripo through your ComfyUI server's partner nodes (key from
   `.env`) and saves textured T-pose models to `art-source/characters/*.glb`. That
   folder is gitignored: the files are large, and regenerating costs credits.
2. `npm run characters:voxelize`: `scripts/voxelize-character.py` (in the project
   `.venv`, with trimesh) samples the textured surface, finds the facing (from where
   skin sits on the head, else the boot toes) and voxelizes to 32 voxels tall. It
   reduces the palette to 20 colours and splits the model into
   `head / torso / arm_l / arm_r / leg_l / leg_r` using the T-pose. The splits are the
   arm band (the widest rows), the neck (the narrowest central rows above the
   shoulders) and the hips (the gap between the legs, never below 42% of the height).
   It writes `public/models/characters/*.vox`. `--preview out.png` draws front/side
   views and the part colouring.
3. The game builds joints from part bounds (shoulders at the inner end of each arm,
   hips at the top of each leg, and so on) and gives every captain a generated cutlass.

To restyle a captain, open its `.vox` in MagicaVoxel, keep the six object names and
the T-pose, and save. Known limit: a model with its arms up by its ears (the pirate)
keeps its lower face in the torso part; head motion is a small nod, so it doesn't show.

## 8. Ship art: MagicaVoxel authoring guide

Ships live in `public/models/ships/*.vox`; handling and combat stats are in
`sailing/ships.ts`. `npm run make:placeholder-ship` regenerates the placeholder sloop
and brig, which are also templates: open one in MagicaVoxel and restyle it. Painted
gun ports are cosmetic: guns are spaced along the hull from `gunsPerSide`.

1. **Axes:** Z up, **bow toward +Y**, starboard toward +X.
2. **One object per moving part**, named in the world editor:
   - `hull` (or any other name): everything fixed to the deck, meaning the hull,
     masts, rails and, later, guns.
   - `sail…` (`sail`, `sail_fore`, …): a flat panel square to the keel, hung on the
     **forward face** of its mast. It swings about its aft face and furls upward
     toward its top edge.
   - `flag…`: streaming **aft** from where it meets the mast. It turns about its
     forward top edge. Its most-used colour becomes the faction's field colour and
     every other colour on it becomes the emblem colour.
3. **Hidden objects and layers are ignored**, handy for reference geometry.
4. **Waterline:** nothing to mark. Set `draft` in the ship type (voxels from the keel
   up to the waterline). It positions the model in the water and sets the grounding depth.
5. **Palette:** colours come straight from the file. Every non-empty voxel is solid.

**To verify with the first real export:** MagicaVoxel places each object by its
pivot. The loader assumes the pivot is the voxel corner at `floor(size / 2)`, the
only choice that keeps voxels on the grid, and our writer uses the same rule. If a
real file shows parts offset by one voxel, the fix is in `instanceVoxels()`.

## 9. Simulation, physics and time

**Loop.** `GameLoop` polls input (`beginFrame`), runs the **simulation at a fixed
60 Hz** (`FixedStep`, accumulator with a 250 ms clamp), then **renders at display
rate**, interpolating with `alpha`. The rule, enforced by structure in `Game.ts`:

> State that must be saved, replayed or kept deterministic lives in `sim` and changes
> only in `update(dt)`. Everything in `render()` is derived from it and is disposable.

Camera easing, wave riding, sail bracing, the wake, streaks and the HUD are
presentation, so they run on frame time.

**Cannonballs** are ballistic points integrated per tick, inheriting the firing
ship's velocity. Each step's segment is tested against every other hull's box
(keel to masthead), floating barrels, the voxel terrain (DDA) and the water.

**Still to build:** characters on land (Phase 5), as an axis-separated swept AABB
against the voxel grid with a one-voxel step-up.

**Entities and systems.** Plain, serialisable data (`Vessel`, `Shot`, `Barrel` in
the `Sea`), with systems as functions called in a fixed order each tick. An ECS
library is only worth adopting once NPC automation (Phase 6) brings many
cross-cutting queries.

**Off-screen islands.** Bases keep producing while you sail. Distant islands run a
coarse *ledger* simulation (rates × elapsed game time, capped by storage and
workers) instead of simulating every NPC. On return, NPCs and crops are placed
consistently with the ledger.

**Saves (designed now, built in Phase 5).** Seeds, modified chunks (run-length
encoded) and the `sim` state as JSON, in IndexedDB.

## 10. Module map

```
src/
  config.ts            world constants (SEA_LEVEL, SIM_HZ, …)
  Game.ts              composition root: sim state, update(), render()
  main.ts              entry: loads the ship, starts the game; `game` on window in dev
  core/                FixedStep, GameLoop, Input, Controls (keyboard + gamepad)
  voxel/               engine-agnostic voxel core, no three.js imports
    blocks.ts          block ids, colours, solidity
    palette.ts         colour + solidity tables for the mesher
    Chunk.ts           32³ storage
    VoxelWorld.ts      sparse chunks, edits, dirty tracking, column queries
    mesher.ts          padded volume + face-culled AO mesher
    raycast.ts         voxel DDA
  vox/                 MagicaVoxel .vox parser (scene graph) and writer
  sailing/             ship handling, hull outline, point of sail, weather,
                       ship types, .vox → ship parts
  combat/              Sea (the combat sim), vessels, ammo, gunnery, barrels,
                       AI captains, encounters
  duel/                captains' duel: moves, fighters, AI swordsmen, character
                       models (.vox parts → joints), cutlass
  economy/             goods, cargo and plunder (Phase 4 builds on this)
  DuelScene.ts         runs a duel from boarding to verdict (sim + presentation)
  worldgen/            seeded noise, island generator
  ocean/               waves.ts (CPU + GLSL twin), SeabedMap
  render/              CameraRig, Sun, ChunkRenderer, OceanRenderer, FleetView,
                       ShipView, ShotsView, BarrelsView, RangeArcs, Effects,
                       Wake, WindStreaks, voxelGeometry, DuelView, CharacterView
  tools/TerrainTool.ts dig / place dev tool
  ui/                  Hud (help, compass, combat panel, prompts, messages),
                       ShipLabels (name tags over ships), DuelHud
  util/                hash, small math helpers
scripts/               asset generators (placeholder ships, captains via Tripo,
                       voxelizer) and the duel balance harness
public/models/         ship and character .vox files
```

`voxel`, `vox`, `sailing`, `combat`, `duel`, `economy`, `worldgen`, `ocean` and `core` are unit-tested (`*.test.ts`
next to the code). The browser-bound `Input` and `GameLoop`, and `SeabedMap`, are
verified in the running game. None of those directories import from `render`,
`tools`, `ui` or three.js. Only `Game.ts` knows about everything.

## 11. Roadmap (proposed)

1. ✅ **Foundation:** loop, camera, voxel chunks + mesher, ocean, island, dig/place.
2. ✅ **Sailing:** ship handling, regional weather, grounding, `.vox` ships, gamepad, wake and wind streaks.
3. ✅ **Naval combat:** broadsides, three shot types, damage and surrender, boarding, merchant barrels, AI captains, regional encounters and convoys.
   - ✅ **3b. Captains' duel:** side-view sword fight on deck (parries with a cue, blocks, rolls, kicks, red thrusts), Tripo-generated voxel captains, jail and plunder.
4. **Ports & economy:** docking, supply/demand trade, shipyard and upgrades, crew hiring; React DOM menus.
5. **On foot & base building:** captain controller, dig/flatten/build with inventory, claiming land, save/load.
6. **Crew automation & farming:** job system, voxel-surface pathfinding, production chains, off-screen ledger, day/night.
7. **Treasure hunting:** hand-drawn-style maps of real terrain, riddles generated from landmarks, dig sites.
8. **Story:** the opening (orphaned, adopted by a merchant captain, the Imperial attack), the black flag, the revenge arc.
