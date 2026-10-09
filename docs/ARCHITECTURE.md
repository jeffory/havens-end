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
| Ship art | **MagicaVoxel `.vox`**, own parser | Artists work in the standard voxel editor; ships are meshed by our own mesher, so they match the islands. See §13. |
| Character art | **Tripo** (text to 3D, via ComfyUI) → **voxelizer** → `.vox` | Detailed, consistent captains without hand modelling; they end up as named-part `.vox` files you can restyle. See §7. |
| Input | **Keyboard + Gamepad API** (standard mapping) | One `Controls` layer merges both. |
| UI | **Plain DOM** for the HUD; **React (DOM only)** for menus: ports, the chart, building, the game menu | Menus are where React pays off (and it keeps focus across re-renders, which controller navigation needs); the 3D scene is not. |
| Saves | **IndexedDB**: the seed plus what's changed | The world regenerates from its seed; a save is the sim state and the edited chunks, run-length encoded (§9). |
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
  packed chunk coordinates. Only chunks containing something exist: the whole
  archipelago (5 port islands and ~14 islets across ~4,000 units) is ~230 chunks.
- **Sea level** is `SEA_LEVEL = 12`: cells below y = 12 are underwater. The water
  surface sits at 11.6 ± 0.3, between voxel boundaries, so it never z-fights terrain.
- **Compass.** North is −z and east is +x.
- **Worldgen, markets and weather are deterministic** in their seeds (tested). Saves will
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
- **Stairs and slabs** are ordinary block ids (60–74): gravel, stone and planks, each
  cut into a slab and four stairs, one for each way it climbs (`FACING_DIRS`). So
  chunks, edits and saves are unchanged. The terrain palette's `shapes` gives each its
  boxes, in cell units (`voxel/blocks.ts`); colour and flags come from the material
  (`baseOf`). The mesher draws a box's face unless it lies on the cell's side against a
  whole cube; a face inside the cell (a stair's riser) always shows. It shades the face
  by blending the cube face's corner occlusion across the box. A whole cube is drawn as
  it always was, and only a whole cube hides a neighbour's face. Heights on foot are in
  `voxel/shapes.ts` (§9).
- **The blocker** (75) is solid to walkers and ships, but never drawn, never picked
  (`isPickable`) and casts no shade. `surfaceHeight` skips it, so the sea under the ship
  on the stocks is still drawn. It keeps people out of a prop (§8), and nobody stands
  on one or walks onto it from above (§9, "The walker").

## 4. Ocean

- A **160×160 grid of instanced 1×1 water columns** follows the camera, snapping to
  whole cells so the columns line up with terrain voxels. Beyond it, a flat plane
  (just below the lowest wave) reaches the horizon, and fog blends the two.
- **Waves** are three sine trains, quantised to 7 heights: stepped, voxel-style waves.
  The function exists **once in TypeScript** (`waveOffset`) and is **generated as
  GLSL** from the same constants (`WAVE_GLSL`). Ships ride exactly the surface that
  is drawn. Phases are wrapped in double precision on the CPU, so the waves stay
  accurate after hours of play.
- **Depth-aware colour.** `SeabedMap` keeps a 256×256 byte map of terrain height
  around the camera, uploaded as a texture. It re-centres as you sail, keeping the
  overlap and reading only the new strip from the world. The shader uses it for beach
  surf, and to collapse columns inside dry land. It follows terrain edits, so digging a
  channel floods it.
- **See-through water.** Each frame the scene is first drawn without the sea into a
  colour + depth target (`OceanRenderer.renderBelow`); then the normal render draws
  the water, which looks into it. From the depth it knows how much water lies between
  the eye and whatever is below, and fades that toward the water's colour: red is
  soaked up first, so sand turns turquoise, then blue, then is lost. So the shallows
  show the stepped seabed, and hulls and waders show below the waterline. The water
  is opaque (it does its own blending), so nothing depends on draw order.
  - Each cell bends the view by the swell's slope across it, so the seabed wobbles in
    blocks. It never bends in something standing out of the water in front.
  - Where something breaks the surface out in open water (a hull, a post, a wader's
    legs), the water is thin, and it foams in a dithered ring.
  - Shadows are drawn once, for the first pass (`shadowMap.autoUpdate` is off), and
    the stats count both passes. On a Radeon 890M the extra pass costs about 1 ms of
    CPU a frame; the GPU time didn't measurably change.
- **Glints and reflections.** Each cell's top tilts with the slope of the swell (and
  shivers a little), so the sun and the moon glint off the sea in blocks: a patch of
  glitter under the moon at night. Each cell also reflects the sky and a layer of
  drifting clouds, looked up along its own tilt; the cells work that out once a corner,
  in the vertex shader, not for every pixel. Lamps and lanterns (the point lights,
  §10) shine back off the water as broken streaks running down the screen: a cell
  is lit if it's near the line from a lamp's mirror image toward the viewer, twinkling.
- **Caustics** (`ChunkRenderer`). Under the water, light on the seabed is focused into
  a drifting web of bright lines, four spots to a voxel: brightest just under the
  surface and gone about eight down. They scale the direct light, so they follow the
  sun, the moon and the lamps, and never show in shadow.
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

**Collision.** The hull's **waterline footprint comes from the model itself**:
- **Samples.** Hull voxels from the keel to one voxel above the water become samples
  every half voxel along the edge, plus the middle of every cell inside. Without the
  interior samples a thin obstacle (a pier, a post) could end up inside the hull
  unnoticed.
- **Checking.** Each tick the proposed pose is checked against solid voxels between
  keel depth and just above the water. So **water shallower than the draft grounds
  you**, and the shore, piers and anything you build all block.
- **On contact.** The first fallback that works, in order:
  1. If she's scraping along something beside her, she carries on straight ahead with
     a little friction: the leeway pressing her onto it is what gets blocked.
  2. Otherwise speed is cut hard, and she slides along the obstacle on whichever axis
     gets her further.
  3. If that barely moves her (a corner caught on a post), she's pushed off: sideways
     from a touch along her side, astern from one on her bow.
- **Aground status** holds for 0.5 s so it doesn't flicker.

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
wind, over open water only: they float just above it, so over a beach or a quay they
lay on the ground as white lines. Squalls darken the sky and light. The flag streams
with the *apparent* wind.

**Controls** (`core/Controls.ts`) merge keyboard and any standard-mapping gamepad.
Rudder is analog. Button presses are queued until the simulation takes them, so a
tap is never lost on a frame where the sim doesn't step (common on 120–144 Hz displays).

| Action | Keyboard | Gamepad |
|---|---|---|
| Steer | A / D, ← / → | Left stick, d-pad ← → |
| Sails up / down | W / S, ↑ / ↓ | D-pad ↑ ↓, Y / A |
| Fire port / starboard broadside | Q / E | LT / RT |
| Round / chain / grape shot | 1 / 2 / 3 (R cycles) | X cycles |
| Board / go ashore in a harbour | B | B |
| Sea chart | M | View (Back) |
| *Menus:* move / choose | arrows or WASD / Enter | d-pad or left stick / A |
| *Menus:* switch place / back | Q / E, Esc | LB / RB, B |
| Game menu (save, load) | Esc | Start |
| *On foot:* walk | WASD / arrows | Left stick |
| *On foot:* use what's in hand / interact | Space or left click / E | X / A |
| *On foot:* tools, guns, seed and maize | 1–9 and 0, Q / R | LB / RB |
| *On foot:* build (turn: Q / R, LB / RB) | B | Y |
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
- **Gun places** (`gunSlots`) are fixed along each side, `gunsPerSide` of them. A short
  crew works an even spread of them (`mannedSlots`), so the guns don't bunch up as
  hands fall.
- **The barrels** are drawn by `ShipView` in the painted gun ports, a little below
  where the shot leaves. They fly back inboard as a side fires, stay in while it
  loads, and are hauled out over the last 0.6 s (`gunsRunOut`). Unmanned guns, and
  every gun on a ship that has struck or is sinking, stay in.

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
- **After you go down,** sunk or jailed, every ship at sea is cleared away except the
  story's (`Vessel.story`; the story sends its own home). Then no new ships come for
  60 s (`Encounters.lull`), so nobody is waiting off the port when you put out again.
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
last port; the cargo goes down with the ship, but your purse survives. Either way the
come-to card (§9, Phase 10.2) says what happened.

**Plunder:** merchants carry 2–3 kinds of goods and warships a paymaster's chest.
What you do with it is §8.

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
4. Your own captain is dressed at load (`duel/captainDress.ts`), ashore and in the duel
   alike: the Tripo figure came out charcoal from hat to coat tails, lost at night and
   against dark-clad guards. Its charcoal becomes a deep red coat (its shading kept),
   gold at the lapels, cuffs and hem, and a brown hat with gold braid round the brim's
   edge, which is most of what shows from above; the shirt is lightened and the red
   sash becomes a belt. Face, hands, hair, breeches and boots are untouched.

To restyle a captain, open its `.vox` in MagicaVoxel, keep the six object names and
the T-pose, and save. Known limit: a model with its arms up by its ears (the pirate)
keeps its lower face in the torso part; head motion is a small nod, so it doesn't show.

## 8. Ports, trade and reputation (Phase 4)

**The archipelago** (`worldgen/archipelago.ts`, `harbour.ts`) is planned from the
world seed:
- Haven at the centre, a free port on the home-waters ring, a pirate haven and an
  Imperial outpost in contested waters, and the Imperial capital beyond.
- About 14 uninhabited islets as landmarks.
- Ports at least 380 apart, and islets kept clear of harbours.

Each port island gets a harbour:
- **Pier.** The builder walks out from the island's centre (square to the grid first,
  then diagonals, so piers come out clean). It picks a spot where deep water comes
  close to the beach with open sea beyond, then runs a pier of planks on pilings out
  past the drop-off. Lamp posts stand at its head and every 6 voxels down its sides.
- **Town** (`worldgen/town.ts`, reworked before 10.2). Laid out on a grid square to
  the pier: u runs inland from the pier's foot, v across it.
  - **Streets.** A ramp climbs from the pier to a paved square (15 across, 10 deep,
    with a well in it: a blocker over its ring and down to its water keeps everyone off
    the rim, and paths go round it). A main street runs inland from the square, with a cross
    street 22 along. Streets are gravel. The main street is level across the
    crossing and climbs at most a block a cell. Where a paved cell stands a block
    above exactly one of its paved neighbours, its paving becomes a gravel stair
    climbing away from that neighbour (`laySteps`), so the ramp is a flight of
    half-steps. At a corner or a crossing (a block above two) the whole-block rise
    stays.
  - **Lots.** The market, tavern and office face the square. Houses line both
    streets, at least 4 apart, each on a pad levelled to its street's height. Stone
    quay is filled over the sea round the pads and the square. The land blends back
    into the hills over 4 blocks, with stone retaining walls where it drops away.
    Trees in and round the town are cleared whole (flood-filled from the trunk), so
    no stray trunk or floating leaf is left.
  - **Buildings.** Houses have one or two storeys. The tavern has two storeys and
    barrels by the door. The market is an open hall of stalls. The office (the
    Guildhall, the Governor's House or the Pirate Lord's Hall) is two storeys, three
    in Imperial ports, and flies the faction's flag. Floors are boarded.
  - **Shipyard.** A slipway seven wide runs down into the water, with a ship on the
    stocks being built (a prop, below, `props/yard.ts`), stern to the land and bow to
    the sea. She's drawn in frame an eighth of a block a voxel: keel, stem and
    sternpost in dark timber, frames a block apart, her bottom planked to a dark wale
    and the strakes under her sheer laid from aft, beams across her here and there, and
    no deck or mast, so from above you look down into her. (The sloop's own hull, a
    block a voxel, read from above as a hollow crate, and her mast as a beam across the
    view.) She never lifts on foot (a prop with no anchor) and is never cut. Above her
    planking the captain shows between her frames; down the slipway under her bottom she
    can still hide him (his ring shows). Lifted whole, she'd vanish whenever he walked
    beside her, since her blockers join the slipway and the shed, which lift for being
    near. Stocks stand under her keel every third cell. She's
    18 long and outruns every slipway, so past its end they carry on out over the
    water, standing on the seabed. A timber shed stands beside the slipway, dressed as
    a workshop on a floor of packed sand (on planks it read as brown on brown): a rack
    of timber along its back wall, a workbench with a saw, a mallet and an adze against
    its end wall, a sawhorse with a plank half sawn, a coil of rope and a pitch pot,
    and the shipwright among them. The
    berth is on the pier's other side.
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
      the back wall, tables either side of the way in (with chairs in the Crown's and the
      free port's, stools elsewhere), and a runner inside the door.
    - *The office:* the desk facing the door with the port's chest beside it, ledgers on
      shelves along the back wall, a chair for callers, a chart spread on a table by a side
      wall, a rug, and the owners' banner on the back wall over the clerk's head. The banner
      is anchored to that wall's second course, so it goes with the wall when it's cut low
      (it faces the camera) and shows when it stands to head height. Nothing tall stands
      against the door's wall or a side wall: cut low, such a wall showed a chest or a
      shelf's back over it as a stray block.
    - *Dressed by the port* (`TownStyle.dress`, passed to `layRoom`): rugs and runners in its
      colours (Haven's sea green and sand, the Guild's blue, the Crown's crimson and gold,
      the Brethren's tar and bone), and its banner (the Guild's, the Crown's, the
      Brethren's). The Governor's House has a grander desk (gilt, crimson leather) and a
      strongbox, a Guildhall a chest of ledgers, the Pirate Lord's Hall a chest of plunder.
    - *The market hall:* counters of produce and cloth across the back and down the sides,
      with crates and barrels.
    - Each layout says where its keeper stands: against the back wall, behind the counter.
  - **Doors you can enter.** Each has a timber frame, a stone step and a lantern
    beside it. The market hall has lanterns at its front corners, and the shed at
    its front posts. Each sign hangs just out from its door.
  - **Porches.** The tavern and the office have one where there's dry pad before the
    door: a deck of plank slabs three wide and two deep (one where the street comes
    closer), a plank-slab canopy a storey up, posts at the deck's front corners and a
    rail either side of the way in. The deck is a half-step up from the pad, and the
    place (`Door.outY`) and the townsfolk's spots on it are at deck height. From the
    deck, a lintel two up from the door's foot would stop anyone walking in (and the
    Crown's guards, posted from the doorway, would find no door). So over a porch the
    doorway is open a storey high: no lintel, and the jambs carried up to where it was,
    holding the lantern and the signboard. A door with no porch keeps its lintel.
  - **Props** (`props/`, drawn by `render/PropsView.ts`) are decoration finer than a
    block. The town builder returns them with the town (`Town.decor`), and they reach
    the game as `Port.decor`. Like the rest of the town they come from the seed and
    aren't saved.
    - *Lanterns,* an eighth of a block a voxel: glass all round between an iron base
      and roof (bars across it made two lit panes, which read as eyes at night). One
      stands on every lamp post (the streets and the pier) and one hangs on a bracket
      beside each door with a frame. The glass glows after dark, and each one's light
      is in `Port.lamps`, so when it's among the nearest it gets a point light and a
      halo.
    - *Signs:* the tavern and the office hang a signboard with their device (a
      tankard, a seal) on a bracket beside the door. The market's open hall and the
      shipyard's shed have no wall there, so they get a signpost (scales, an anchor)
      whose post stands in three blocker cells. It's 2.75 blocks tall, and with two
      the captain scrambled up on top and paths went over it. At the shipyard the
      top cell is the shed's eave already, which keeps anyone off just as well.
    - *The clock,* two blocks across, over the office door, standing on the porch's
      canopy. It goes up only where the wall is behind the whole of it and nothing is
      in front of its face (the Pirate Lord's Hall's eave is, so it has none). The
      porches' posts and rails. The ship on the stocks.
    - *Models* are drawn in code with a `Sketch` (`props/models.ts`), a quarter of a
      block a voxel unless said otherwise, or read from a `.vox` file
      (`propFromVox`). All are meshed with `meshCells`, as ships are. The town's finer
      furniture, the stalls, the hand cart, the hall's counters, the ship on the stocks
      and the shed's workshop are drawn an eighth of a block a voxel with the colours in
      `props/kit.ts` (`furniture.ts`, `market.ts`, `yard.ts`).
    - *Drawing:* one `InstancedMesh` a kind a town (props within 150 of a town's
      first share it), so a town off screen isn't drawn: each per-town mesh keeps
      its own small bounding sphere and is frustum-culled like any other mesh, so
      only the towns actually in view cost a draw call, never all five at once (the
      shadow map and the water's reflection draw them too). At Haven at night the
      frame time stayed within the noise of the build before them. A prop hung
      on a wall names that block as its anchor, and the shader discards it while
      the anchor is lifted away on foot (the lift test in `render/lifts.ts`, shared
      with the terrain). So a sign, a door lantern or the clock goes with its wall,
      and street furniture, with no anchor, never lifts.
    - *Reserved cells:* a prop that stands on no floor of its own (the ship on the
      stocks) keeps people out of the cells its voxels lie in: `reserveProps` writes the
      blocker into them, once, straight after worldgen and before `trackEdits`. A finer prop
      has a shape in blocks (`props/shapes.ts`: across, along the way it faces, and
      high). The town builder stands it with `standProp`, which writes the blocker
      into its cells three high (the walker climbs two), except under stools,
      chairs and rugs. It anchors the prop at the cell its top is in: a stall or
      the cart goes whole when its anchor lifts away, since the lifter sees a
      blocker as planks. Furniture is anchored at the floor instead
      (`worldgen/furnish.ts`): a room's own cut can run as low as half a block
      over the floor, and a top-cell anchor there would hide a hearth or a shelf
      along with the wall behind it. Furniture is never above head height anyway,
      so it stays with its room either way. All of it is part of the generated
      world, never of a save.
  - **Banners.** Five by three, on a pole: the Brethren's black with a skull over two
    bones, the Crown's crimson with a gold cross, the Guild's blue with a white band
    and a gold boss.
  - **Street lamps** stand at the square's inland corners and down the main street.
  - **Styles.** Haven: plaster and thatch, ten houses. Free ports: plaster and
    slate, goods stacked on the quay, a blue flag. Imperial ports: plaster and
    terracotta, a stone watchtower, a crimson flag. The pirate haven: plank shacks
    under tarred roofs, with black flags at the top of the ramp.
  - **Tests** (`town.test.ts`) build all five real ports and check the spacing, the
    flat square and gentle streets, the stairs at the rises, level pads, no trees in
    town, the slipway and the sloop on it, the market on the square, the roofs, flags
    and floors of each style, the porches, and signs, lanterns and the clock where
    they belong. The props' own tests (`props/*.test.ts`) check the models, the
    placement maths and the reserved cells. `rooms.test.ts` lays out every room
    size and role. `shopLift.test.ts` (render) lifts every shop of the five ports
    from its door and every floor cell inside.
- **Berth.** Alongside the pier head, bow out to sea: where ships dock, leave and
  respawn.

The whole world generates in about 0.3 s. The home island is meshed before the first
frame; the rest follows nearest-first, two chunks a frame.

**Docking.** In a harbour (within 45 of a berth), slower than 3 u/s, and with nobody
fighting you within 90, B puts you alongside; the same button boards ships. The port
must also be open to you. Ashore, the sea waits, as it does in a duel. The menus act
on the simulation directly: each order is a discrete command, and nothing ticks until
you set sail.

**Markets** (`economy/market.ts`):
- **Routes.** Each staple (sugar, rum, tobacco, cloth, spice) is produced in two
  ports (0.62× its base price, big stocks) and wanted in two others (1.5×, thin
  stocks). The roles are assigned from the seed so every good has somewhere to go:
  those pairings are the trade routes.
- **Pricing.** Price follows stock: `base × (target / stock)^0.45`. Every unit
  bought or sold moves the stock, so a full hold moves the price. Stocks recover over
  about 4 minutes, and buying costs 10% more than selling fetches.
- **Shocks.** Every few minutes a shortage or a glut may hit one port's good for
  9 minutes.
- **Contraband.** Muskets are made in free ports and wanted in pirate havens. In
  Imperial ports they are contraband: only the tavern's back room buys them, at about
  1.9×.
- **Customs.** An Imperial port searches a hold carrying muskets 40% of the time
  (60% if the Crown dislikes you). If found, the muskets are seized, the fine is 15
  gold a musket, and standing with the Crown drops by 8.
- **The gunsmith's counter** (Phase 10.2). A free port's or the pirate haven's market
  sells the captain a pistol and a rifle, below the goods (§9). The Crown's markets
  say arms are its monopoly, but sell cartridges like everyone else.

**The price book** (`logbook.ts`) records every price the captain sees (each visit,
each trade) or hears (tavern rumours). The market shows the best known price
elsewhere for each good. The harbour tab and the chart list the most profitable runs
the book knows of.

**Reputation** (`reputation.ts`) is kept with the Crown, the Guild (merchants) and the
Brethren (pirates), from -100 to 100. You start at Crown 0, Guild +15, Brethren -30.
Firing first on a ship that wasn't already fighting you is an attack (returning fire
isn't). Sinking or taking her counts again:

| Victim | Attack | Sink | Take |
|---|---|---|---|
| Imperial | Crown -12, Brethren +4 | Crown -8, Brethren +4 | Crown -8, Brethren +6 |
| Merchant | Guild -8, Crown -4, Brethren +2 | Guild -8, Crown -3, Brethren +2 | Guild -6, Crown -3, Brethren +3 |
| Pirate | Brethren -5 | Brethren -5, Crown and Guild +5 | Brethren -5, Crown and Guild +6 |

| Standing | Effect |
|---|---|
| ≤ -50 (pirates: ≤ -80) | that faction's ports turn you away |
| below 0 | up to 18% worse prices in its ports (never in pirate havens: they take anyone's gold) |
| ≥ 20 / ≥ 50 | 3% / 6% better prices |
| Crown ≤ -25 | Imperial warships attack on sight |
| Brethren ≥ 20 | pirates leave you alone |
| Guild ≥ 20 | merchants stop running from you |

Crossing any of these lines is announced.

**The fixer** in every tavern mends your name with any faction: +15 per favour, up to
+25. Each favour costs 150 gold plus 8 per point your standing is from neutral. A
port that's closed to you can be reopened from another port's tavern.

**Jobs** (`contracts.ts`), three at most at once:
- **Freight** (governor, guildhall or pirate lord): goods loaded here for another
  friendly port. The captain posts a bond worth the cargo, returned with the fee on
  delivery, so the goods can't simply be sold off.
- **Bounties:** sink or take one or two pirate ships (Imperial and free ports), or
  merchant or Imperial ships (the pirate lord). Collected where they were posted.
- **Smuggling runs** (from the fixer, in free ports and the haven): muskets into an
  Imperial port's back room. Bonded like freight, and paying more for the customs risk.

Missing a deadline costs 5 standing with the issuer, plus any bond. Boards are
refreshed every 5 minutes.

**The shipyard** (`shipyard.ts`):
- **Repairs:** 3 gold a hull point, 2 a sail point.
- **Refits:** copper sheathing, a reinforced hull, an expanded hold, and gun drill.
  They produce a derived ship class (`withUpgrades`); the design, and so the art, is
  unchanged.
- **New ships** in part-exchange: sloops everywhere, brigs in Imperial and pirate
  yards, merchant brigs in free ports. Losing your ship always leaves you a plain
  sloop.

**The tavern:** sailors drift in over time, and the haven has the most and the
cheapest. A round for the house (10 gold) brings two rumours.

**Encounters** near a port favour its own ships: Imperial patrols off the Crown's
harbours, raiders off the haven.

**Menus** are React, DOM only, drawn over the 3D view (`ui/Overlay.ts`, `ui/port/*`,
`ui/ChartView.tsx`):
- Arrow keys and the controller move focus spatially (`menuNav.ts`: the nearest
  button in that direction). When a button disables itself, focus lands nearby.
- A or Enter clicks; LB/RB or Q/E switch places; B or Esc goes back.
- React keeps the DOM nodes across re-renders, so focus survives every purchase.

**The chart** (M, or a tab in port) draws the coastlines from the voxel world once,
into an offscreen canvas. Over that it draws the ports (crossed out if they're closed
to you), your ship, the danger rings and your course. Choosing a port sets the
course: the compass shows a gold pointer, and the nav panel its distance and bearing.

## 9. On foot: ports, camps and farms (Phase 5)

**Going ashore.** B does the obvious thing for where you are:
- **Alongside another ship:** you board her.
- **In a harbour:** you go alongside the pier and step off onto it.
- **Anywhere else near a beach:** you row ashore, if the ship is slow and nobody is
  fighting you.

While you're ashore the ship rides at anchor. Nobody attacks an empty ship, and the
encounter director waits. Time goes on, so markets recover, crops grow and jobs run
down. E (A on a controller) near the ship takes you back aboard, and whatever is in
your pack is stowed in the hold.

**The walker** (`land/walker.ts`, pure and tested):
- An axis-separated box, 0.6 wide and 1.7 tall, under gravity.
- It scrambles up ledges of up to two voxels, but not a three-voxel wall. It wades
  into water up to a voxel deep, and no further.
- **Heights come in half-block steps.** The walker's box is tested against a stair's
  or slab's own boxes (`voxel/shapes.ts`), not the whole cell, and it climbs half a
  block at a time: a stair or a slab is one half-step, a whole block two. Each is a
  one-tick move, as a whole step always was. Pathfinding (`land/paths.ts`, used by
  settlers and townsfolk; creatures only step, with `stepWalker`) stands each node on
  the ground under its cell's middle, under the same rise limits. On a slab that's its
  half-block top. On a stair it's the whole block: the middle lies on the line between
  the two steps, and `topIn` gives the higher there. Dropped items come to rest on a
  slab or a stair's step.
- Crops are drawn but walkable. A separate `blocksWalker` test sits alongside
  `isSolid`.
- **A prop's blocker isn't ground, and the air over one is walled.** Nobody stands on
  a prop's blocker (`blockerGround`), however they got up beside it: a ledge, a
  corner, a bench, a roof's edge. A horizontal move is also refused
  into any column whose first walker-blocking cell below the feet, within
  `BLOCKER_REACH` (64), is a blocker (`blockerColumn`): so nobody walks, steps or
  drops onto a stall, the cart or the ship on the stocks from a roof, a bank or a
  corner either — they stop at its edge, or fall beside it. A floor or a roof over a
  prop is ground of its own, so the air above that stays open. Someone already over
  a prop (a save made where one now stands) can still walk off it.

**Ports on foot.** The Phase 4 menus are unchanged; you just walk to them.
- **Doors and signs.** Each harbour records its doors: the market, the tavern and
  the office on the square, and the shipyard's shed. A sign hangs over each door,
  and walking up to a door opens that place's menu. The prompt names the building
  ("enter the Guildhall"), and that building's sign hides while the prompt shows.
- **Streets.** The town's own streets (section 8) join every door to the pier.
- **Reachability test.** Every door can be walked to from the pier, by the walker's
  own rules.
- **Townsfolk** (`land/townsfolk.ts`, not saved). While the captain is ashore in a
  docked port, up to 8 townsfolk (7 in the pirate haven, 3 at night) come out of the
  houses' doors. Each goes to a spot the town lists: the square, a stall, the well,
  out before the tavern, the head of the slipway, a street corner or a doorstep. They linger there
  a while and move on, walking the settlers' paths. At night most go home to the
  nearest door. They're gone when you leave port. At the yard they swing a hammer.
  - **Dress** (`duel/dress.ts`). Clothes follow the port. Haven's fisherfolk wear
    oilskins and smocks; the free port's folk wear straw hats and aprons; the
    Brethren wear bandanas, the odd tricorn, and striped or ragged shirts with a
    sash; the Crown's ports are soberer, with the odd soldier (red coat, white
    cross-belts, tricorn, musket). A tricorn's crown is a shade lighter than its brim,
    with a brass cockade on the brim, so from above it reads as a hat, not a dark
    shape. No one comes out dressed like the last one out.
    Hired settlers keep the looks they always had.
  - **Guards.** Two Crown soldiers stand either side of the Governor's door, two along
    the wall from where the captain stands to go in, facing out, day and night. They
    don't count toward the town's numbers.
  - **Keepers.** Each shop with a building of its own has a keeper at a post
    (`Port.keepers`, from the town builder): behind the tavern's bar, the office's desk and
    the market's back counter, facing the room's front, and the shipwright in the shed by
    the timber, hammering. They stand still and don't count toward the town's numbers.
    By day all are in; at night only the tavern keeper is, and the others are gone till
    morning. Their looks come from where they stand (never a draw from the town's dice),
    dressed for the port and never as soldiers, so they're the same each visit. They're
    gone when you leave port and back when you land. A lingering place within 0.8 of any
    keeper's post is hard-clear of it (`KEEPER_CLEAR`), whether the keeper is in or out, so
    nobody ever lingers inside the shipwright or the tavern keeper's bar.
  - **Spread out.** Folk at the same spot stand in a ring round it, and a spot
    where two already are is less often picked.
  - **Off the doorways** (`offLimits`). Nobody lingers within 1.2 (`DOOR_CLEAR`) of a
    doorway, where the captain stands to go in at a shop or a house's step: a crowd
    there merged with the captain as they went in. No spot but a doorstep's own is on
    one. Nor within 1 of the captain (`CAPTAIN_CLEAR`): one he walks onto steps aside to
    another place round the same spot, or moves on if there's none.

**The view.** The camera closes in (36 units). A roof lifter (`render/RoofLifter.ts`)
opens up whatever hides the captain, as in a doll's house.
- **In the way.** Six rays run from the captain toward the camera. A ray that starts
  inside solid (a prop at the captain's own feet) is re-cast ignoring that starting
  cell first, so walking into a stall or the cart doesn't lift it away from under
  itself. The first tree or building a ray hits is flood-filled whole, from the
  captain's feet up (never the boards they stand on). The fill follows edges as
  well as faces, because the courses of an open shed's stepped roof meet only at
  their edges — except a prop's blocker, which only joins what it meets face to
  face, so a stall or the cart grazing a building's corner doesn't drag the whole
  building in with it. Everything from head height (two above its floor), or from
  its eaves if those are lower, lifts, so a shop's room shows as a house's does. A
  roofed building's room is its walls' footprint (where it stands a second course
  and a third over it, so a lamp post or a barrel against it isn't), and its walls
  facing the camera, and whatever stands in front of them, lift from one course up
  (never below their own first course): the room shows from the camera as a doll's
  house does, the far walls at head height. A wall faces the camera when the camera
  stands beyond its outer face, so the near walls follow the camera's quarter turns.
  If the line of sight passes through lower down (the captain just behind a tall
  building's wall) where it isn't cut anyway, it lifts from there. The line of sight then goes on through
  what it has lifted, through up to three trees or buildings, so a stall's post in
  front of a shop can't keep the shop's roof on. Lanterns go with the wall or post
  they hang from, a prop hung on a wall goes with its anchor, and a porch's posts go
  with its canopy (§8). It's held for 0.6 s after the captain moves clear.
- **Beside you in port.** With the camera nearer than 60, a roofed building within
  2 of the captain lifts too (the one whose door they're at, say), so you see in; the
  rest of the town keeps its roofs. (Lifting every roof within 12 made the town read
  as ruins.) The scan runs four times a second, and a building stays lifted until
  the captain is 4 away, so nothing flickers at the edge. Stalls, the cart, guns and
  flags lift only when they're in the way; a stall or the cart then goes whole.
- **The room framed.** At the door of a building lifted for being near, or in it
  (within 1.5 of its walls: `RoofLifter.roomNear`), the camera frames its room
  (`render/roomFrame.ts`): it eases in to 26/36 of the player's zoom (less close for a
  room too big to fit, never closer than 12), and its focus shifts 0.9 of the way to
  the room's middle (never more than 6) and looks 2.5 lower, so the room sits
  mid-screen above the prompt and the hotbar, wherever the door is. It eases back out
  when the captain walks off. A fight's framing (§9, bandits) wins: no room is framed
  while one's on. Out in the street, past a building's wall, nothing is framed, so
  the view doesn't swing from house to house.
- **In the shader.** Up to twelve boxes lift at once, what's in the way first, with
  their rooms and the camera (`render/lifts.ts`: `liftedBy`, and the same test in
  GLSL for the terrain and the props). The terrain shader discards lifted voxels
  whole, testing the voxel's middle, as `ChunkRenderer.hides` does. Each fragment
  finds its voxel a quarter block in from its vertex's corner of it (the mesher marks
  each vertex's corner), so a fragment on a face's very edge never lands in the
  voxel beside (flooring the fragment's own position did, and left a lifted box's
  edges drawn as dotted lines). Blocks opt in through a per-vertex `cutaway` flag.
  The ground never does, since it would show hollow. Shadows are cut the same way:
  the chunks a lift reaches, and the props, cast theirs through a depth material that
  discards what's lifted, so a lifted roof leaves no shade in its room (a discard
  costs the shadow pass its early depth test, so other chunks use the plain one).
- **Furniture against the near walls.** A prop anchored in a room within a block of a
  wall facing the camera is cut as low as that wall (`propTop`, in TypeScript and in
  the props' shader): a shelf there stood two high against a one-course wall and hid
  the keeper at his post beside it. Its cut shows its inside, drawn from its back faces
  in the walls' cap colour, so it reads as solid; elsewhere a prop goes whole or not
  at all, by its anchor. Both go by the anchor, so the props' shader works them out
  once a vertex: a back face outside a cut is thrown away at once, and drawing both
  sides costs next to nothing.
- **The cut's top.** The mesher draws the top of a cutaway block under another, so a
  lifted wall has a clean top, and marks it: it's only ever seen as the top of a cut,
  and it's drawn in one dark timber colour, never glowing, on every building alike (a
  canopy cut through stays leaves).
  After dark, a face looking into a lifted room (its walls' insides, its floor) and a
  prop standing in one get a warm lamplight, so the room reads as lit, not as navy
  holes, and a lit window glows outward only.

A light ring on a dark one marks the captain's feet, scaled with the camera's
distance. Your own ship fades while you work beside her.

**Tools** (`land/Land.ts`) work the block in front of you, or the one under the mouse
if the captain can reach it. Reach is 3.6 across, and from two blocks below the feet
to two above. The mouse picks through whatever the cutaway hides
(`ChunkRenderer.hides`, the shader's own test). The target is marked, and red means it
won't work; nothing out of reach is marked. Click a hotbar slot, or press 1–9 or 0, to
take it up.
- **Axe:** a tree takes several blows (`blowsToFell`): 3 for a young palm, up to 5 or
  6 for the tallest trunks and broadest crowns. Blows are counted by the foot of the
  trunk, so it doesn't matter where on the tree they land. Each one throws chips and
  shakes a few leaves from the crown (a `chop` work event). The count isn't saved.
  Settler woodcutters are unchanged: their felling already takes time. The last blow fells the whole tree,
  first the trunk and then the leaves hanging from it.
  - "Hanging from it" means the leaves nearer that trunk than to any other, so two
    canopies that touch come down one at a time.
  - Blocks touching at an edge or a corner count, so a leaning palm comes down whole.
- **Pickaxe:** breaks outcrops (below), and nothing else: the island's own rock stays.
- **No shovel** (retired in Phase 9, to move away from digging the voxels). F, right
  click or LT digs for treasure where the captain stands (`Land.dig`): 1.5 s of
  swinging a spade, given up if they walk off. It works on grass, earth, sand or
  tilled soil outside town, and never changes the ground. Earth and sand already in a
  pack are still goods to sell. The ground leveller planned for Phase 11 takes over
  shaping the land.
- **Hoe:** tills grass or earth.
- **Seed:** plants in tilled soil. **Saplings** (from felled trees) plant in grass,
  earth or sand, and grow into a tree.

**Finding the ground.** Tools look down the column from the top of reach. Trees
don't count as ground, and neither does the air under their canopies. (Once, a canopy
over a gap made the tools aim at the empty air beneath it.)

**Where tools work.** Felling, mining and digging for treasure work on any island outside a port's
town. Tilling and sowing need a claim.

**Outcrops** (Phase 10; `land/deposits.ts`, placed by `worldgen/deposits.ts`). Small
lumps of stone and ore, 3–5 blocks on a 2 × 2 footprint, placed from the seed after the
archipelago is built and before the world tracks edits.
- **Where.** About one per 700 square voxels of island, at least 7 apart, on dry grass,
  earth or rock clear of trees, beaches and town land, and never in a hollow (with the
  ground about it higher, an outcrop looks like paving). Every islet gets its share;
  hilly ground and town land thin them out (the game's world has 39, 7 on Haven).
- **Numbered by island.** Each island draws its spots from numbers of its own, and
  island i's outcrops are numbered i × 1000 + 1, + 2, …, so changing one island (or
  tuning it) leaves every other island's outcrops, and a save's record of them, as
  they were.
- **Kinds** (blows, yield): stone 3, 3–4 stone (all `Boulder`); iron 4, 2–3 ore; copper
  4, 2–3; silver 5, 1–2; gold 6, 1. Home waters have no silver or gold; the mix gets
  richer further out. Kinds are dealt out per region (whichever is furthest behind its
  share goes next), so the world follows the mix even with only a few outcrops an
  island. Ore shows in about 4 in 10 of an outcrop's other blocks (by place, not by a
  draw) and always in its last-laid one. There are no iron veins in the terrain any
  more.
- **Mining.** Blows count per outcrop (not saved); the last breaks it up into dropped
  items. Work events: `mine` for each blow, `break` for the last.
- **Growing back.** 3 days on the sea clock after it was worked out, once no block,
  building or body is in the way and every block rests on the ground as it lay (grass,
  earth or rock: not over a hole, a field or a path). Saved (version 5).
- **On load** (`Deposits.reconcile`), the record is squared with the world. One saved
  as worked out whose blocks all stand counts as standing. A save's edited chunks can
  wipe out outcrops placed since (an older save): one wiped out on a claim is retired
  for good, so none grows up in a camp; anywhere else it counts as worked out then,
  and grows back.
- **Around them.** Buildings can't go over a standing outcrop; treasure is buried at
  least 3 from any.
- **Miners** (a settler job) work the nearest outcrop within the claim plus 16, 20 s
  each, the yield straight to the stores. With none standing, they cut wood, and the
  camp screen says when the next grows back.

**Guns, hunting and bandits** (Phase 10.2; `land/firearms.ts`, `land/bandits.ts`,
`worldgen/bandits.ts`). The design is in
[phase-10-deposits-guns-sound.md](phase-10-deposits-guns-sound.md). What follows is
what was built, with the numbers tuned after the first fights.

**The guns.** The captain can buy a pistol and a rifle at a gunsmith's counter, below
the goods in a free port's or the pirate haven's market (`Economy.buyGun`). The Crown's
markets say arms are its monopoly. A gun is bought once and kept for good
(`Captain.guns`, saved), whatever becomes of the ship. Bandits carry muskets.

| | Pistol | Rifle | Bandit's musket |
|---|---|---|---|
| Price | 120 gold | 350 gold | |
| Range | 12 | 30 | 24 |
| Damage | 2 | 4 | 2 |
| Reload | 2.5 s | 5 s | 7 s |
| Chance to hit at distance d | 0.9 − 0.55·d/12: 0.9 close in, 0.35 at 12 | 0.45 + 0.08·d inside 5 (a long barrel is slow to bring round), then 0.85 − 0.15·(d − 5)/25: 0.7 at 30 | 0.5 − 0.3·d/24: 0.4 at 8, 0.3 at 16 |

- Prices are scaled, as the market's are, by the captain's standing with the port's
  faction.
- Beyond its range a gun can't hit.
- Health: a bandit has 4, a boar 3, a goat 2, a crab 1 and the captain 10. So one
  rifle hit brings a bandit down, or two pistol hits.

**Cartridges and the pouch.**
- **The good.** Cartridges cost 2 gold and are listed with the arms. Every market sells
  them, the Crown's too. The forge's last recipe makes 12 from 1 iron in 20 s.
- **Spending.** A shot spends one, and with none to hand the gun won't fire. "To hand"
  is what the captain could build with (`Land.available`): the pack, storehouses, and
  the hold if the ship is within 60. That's the number on a gun's hotbar slot.
- **The pouch.** With a gun, the captain rows ashore to a wild islet with a pouch: up
  to 24 cartridges from the hold go into the pack, so a fight far from the ship
  doesn't leave them empty-handed. Going back aboard stows them with the rest of the
  pack.
- **In port** the pouch fills only as the captain walks out of town, to hunt the
  island, and goes back into the hold on the way in. So the market, which reads only
  the hold, sees and sells them all.

**Firing** (`Land.fire`). Space, a click or X with a gun in hand.
- **Loading.** The gun loads again by itself, and a shade falls across its slot as it
  does (not saved). Pressed while loading, or with no cartridges, it doesn't fire,
  spends nothing and doesn't restart the load.
- **Aiming with keys or a pad.** The shot goes at the nearest beast or bandit within
  range and within 36° of the way the captain faces (`AIM_CONE`), or straight ahead
  if there's none.
- **Aiming with the mouse.** The shot goes at whatever is within 1.5 of the cursor, or
  else toward the spot under it.
- **The marker.** While a gun is in hand, what it would hit is marked. Digging for
  treasure shows the dig's marker instead, whatever is in hand.
- **The shot** (`resolveShot`) is an instant line from the captain's chest (1.3 up) to
  the target's aim point: a bandit's chest, or a beast's flank. It hits if nothing
  solid is in the way and a roll beats the chance at that distance. A miss flies on to
  the end of the gun's range, or into whatever it meets.
- **Cover.** A voxel raycast stops a shot at the first solid block: rock, a trunk or
  leaves, a wall, or the brow of the hill you're shooting down from. Bandits see the
  captain by the same test (`clearLine`, eye to chest).
- **How it looks.** Each shot is a `shot` event:
  - a puff of smoke just ahead of the muzzle;
  - a faint cream streak for 0.16 s (`render/Tracers.ts`);
  - dust where it ends, or a red spurt on a hit.

  The captain brings the gun up for 0.6 s (the aiming pose), and a bandit levels their
  musket, bayonet and all. The pistol, rifle and levelled musket are voxel models in
  `render/toolModels.ts`.
- **Clubs.** The tools still club beasts as before.

**Wild goats** are day game (`land/creatures.ts`, beside the night's crabs and boar).
- **Where.** By day, every 3 s, a herd of 2–4 may come over a brow 14–34 from the
  captain, up to 4 goats about at once. They need upland grass: at least 4 above the
  sea, off town and camp land, and 18 or more from any light.
- **Grazing.** They graze at a quarter of their running pace (4.2), and wander only to
  grass they can climb to.
- **Bolting.** When the captain comes within 8, the goat that sees them bolts, and the
  rest of the herd within 8 goes with it, for 5 s.
- **Keeping to the upland.** A fleeing goat veers along the brow rather than off it.
  A step that would take any goat from its upland to lower ground is undone, so it
  stands at the drop instead.
- **Day only.** They're gone at nightfall unless they're fleeing, and they aren't
  saved.
- **Loot.** 2 hp: two pistol hits, one rifle hit, or two blows. A goat that's brought
  down drops 2 meat and 1 hide. Hides are a good (8 gold, camp produce), wanted by the
  Guild's tanners in the free ports.

**The captain's health** (`Land.health`, out of 10).
- Only bandits' musket balls hurt, 2 a hit. Beasts don't bite.
- Wounds mend a point every 6 s once no bandit has fired for 15 s.
- Health is full again aboard, and on loading a game (a fight isn't saved).
- The on-foot HUD shows it as ten pips over the pack line, only while the captain is
  hurt or in a fight.

**Bandit camps.**
- **Where** (`placeBanditCamps`). Camps are placed at world generation, after the
  outcrops and before the props are reserved and the world tracks edits.
  - About a third of the wild islets hold one; never a port's island, never a cursed
    isle. The islets are ranked by `hash2` of their seeds, and taken in that order
    until round(n / 3) camps stand.
  - Each islet draws from a stream of its own (`seed ^ 0xba4d` and its index), trying
    up to 80 spots within 0.65 of its radius.
  - A spot needs its 9 × 9 footprint clear of town land and outcrops, and the ground
    within 2 of the fire level to within 2 and dry. An islet with no such spot falls
    through to the next in rank.
  - The game's world has 4, on islets 5, 10, 14 and 16: two in home waters, two in
    contested waters.
- **What's in one.** A camp is built from existing blocks:
  - embers ringed with stones;
  - a plank lean-to on two posts, its roof sloping to the ground behind, with a canvas
    bedroll under it;
  - a chest and a keg.

  The lean-to's footprint is levelled first: stone below, cleared above. Every tree
  standing over the plot is felled whole, trunk and canopy, so nothing hangs over the
  roof. A camp holds 2 bandits in home waters, 3 in contested waters and 4 in
  Imperial waters.
- **The bandits** (`stepBandits`).
  - Only the camp on the islet the captain walks (within its radius plus 25) is
    stepped. Elsewhere camps wait, and their bandits aren't saved.
  - The first step the captain is there, they muster round the fire, at ease.
  - They're ragged figures in the pirate haven's dress, with muskets shouldered and
    4 hp each. They walk with the settlers' walker and pathfinding.
- **How they behave:**
  1. **At ease** they amble. Every 3–8 s each picks somewhere new: within 6 of the
     fire, or by day, a third of the time, anywhere on the islet. At night they keep
     within 3 of the fire.
  2. **Alerted.** One bandit is enough to bring the whole camp into the fight: one
     that sees the captain, hears a shot within 30, or is shot at. Seeing means within
     18 by day or 9 at night, with a clear line. Shots heard include the captain's
     hunting shots.
     - The notice "Bandits! They’ve seen you." comes once a fight.
     - Their muskets come to bear one after another, the first 2 s on.
  3. **Fighting,** they keep 8–16 off. Each picks a spot at that distance on its own
     side of the captain. It picks again when it's too near, too far or out of sight
     (at most every 0.5 s), and after 1.5 s held up on its path.
     - They fire when loaded and in sight, within 24. A miss passes 0.8 wide of the
       captain.
     - Out of sight for 20 s, a bandit goes back to ease.
  4. **Fleeing.** Wounded to 2 hp (a pistol hit), a bandit breaks and runs straight
     away from the captain. It limps at 0.8 of a walk, so the captain can run it down.
     It's gone (fled) once it's 40 off, or 20 off and out of sight, or at the water's
     edge rather than wading in.
  - **Fallen.** A fallen bandit's 3–8 gold (3 more in contested waters, 6 more in
    Imperial) goes straight to the purse, and 2–3 cartridges fall where it lay.
  - **Cleared.** When the last of a camp is gone, fallen or fled, the notice says:
    "The bandits’ camp is cleared. They’ll be back in five days, unless you claim the
    ground."
  - Shooting bandits changes nobody's standing.
- **Holding ground.**
  - No campfire goes down whose claim would be centred within 60 of a manned camp's
    fire (`Bandits.holds`): "Bandits hold this ground: clear their camp first."
  - Bandits never set foot on the captain's claimed ground. They plan their ways round
    it, with a berth of 1.5. A runaway veers round it.
  - A bandit that finds a claim made round it steps off it, away from the nearest
    fire. Pinned for 1.5 s, it gives up and goes about its business where it stands.
- **Coming back** (`Bandits.reman`).
  - A cleared camp is manned again 5 days (sea clock) after it was cleared.
  - If a campfire of the captain's now claims ground within 60 of it, it stays empty
    for good (`gone`).
  - On loading (`Bandits.reconcile`), a camp is gone too if an older save's own edits
    wiped out its embers, or if a save's camp already claims its ground within 60.
  - Treasure is buried at least 12 from any camp that isn't gone.
- **The chest** opens with E from within 2.2 (`Land.openChest`). Its gold goes to the
  purse, and goods spill out beside it. It stays looted until the camp is manned again.

  | Waters | Gold | Goods |
  |---|---|---|
  | Home | 40–100 | 3 rum, 6 cartridges |
  | Contested | 90–180 | 3 rum, 2 tobacco, 8 cartridges |
  | Imperial | 160–300 | 2 spice, 1 musket, 10 cartridges |
- **Saved** (version 6, the Land snapshot's `bandits`): for each camp, how many
  bandits are left, the day it was cleared, and whether it's looted or gone. A save
  made mid-fight loads with the camp's bandits at ease, as many as were left, and the
  captain whole.

**Brought down** (`Land.bringDown`, at 0 health).
- The bandits take a tenth of the captain's gold, as a guardian does.
- Each good in the pack drops as its own stack where the captain fell. The stacks lie
  for a full day: the clock's day length, never less than the usual ten minutes.
  Each drop keeps its own life, and it's saved. A pile keeps the longer life when
  another merges into it.
- The crew carry the captain back aboard with full health (`goAboard`). The ship lies
  where she was anchored.
- A `downed` event puts the game to sea, under the card.

**The come-to card** (`ui/comeTo.ts` words it, `ui/Fade.ts` shows it).
- **What happens.** Every way of going down fades to black with a title and a line of
  what happened. It holds 3 s (a key or a click cuts it short), then fades back in
  wherever the captain came to. The camera moves while the screen is dark.
- **The fade.** It grew out of the sleep fade, which is the same `Fade` with a line and
  no title. The fade is modal: the sim waits, and the menu keys pressed while it's up
  are drained, not acted on.

| When | Title | Line (an example) |
|---|---|---|
| Sunk (after 5 s of watching her go) | Lost at sea | Your sloop went down, and 13 goods with her. You wash ashore at Haven, where the harbourmaster finds you another. |
| Jailed | In irons | Your freedom costs 300 gold, and your 12 goods are seized. You’re released at Haven with a fresh sloop. |
| Brought down by bandits | Left for dead | Your crew carries you back aboard. The bandits took 72 gold, and your pack lies where you fell. |
| A guardian wins | The dead keep their gold | You come to at dawn beside the hole, 80 gold lighter. The hoard, and its guardian, are still there. |

- **The port** is the captain's last port, not always Haven.
- **The ship** is the kind that sank: the `respawn` event names her.
- **Clauses drop out** when there were no goods, or no pack.
- **The guardian's card** shows while the night is slept through.

**The hotbar** gains the guns after the tools, once they're bought. With both guns
there are ten slots, the tenth on 0 (`item10`). A gun's slot shows the cartridges to
hand and the reload shade.

**Saves** are version 6. It adds the captain's guns (in the Sea snapshot), the bandit
camps, and each dropped pile's own life. Older saves load with no guns, every camp
manned (unless reconciled away), and ten-minute piles.

**Dropped items** (`land/drops.ts`, drawn by `render/DropsView.ts`). What the tools
break off doesn't go straight into the pack. Felled trees, stone, ore,
harvested crops, caught beasts and treasure all drop this way. Settlers still put their work
straight into the storehouses.
- **How they look.** Each item is a 12-pixel picture cut out one voxel deep
  (`render/itemIcons.ts`). It pops out, falls, and lies there turning and bobbing.
- **Picking up.** Once an item has landed, walk within about two blocks and it flies
  to hand. The hint keeps a running count of what you've picked up ("+3 timber, +1
  sapling").
- **A full pack.** Items stay on the ground, and the game tells you so now and then.
- **Piles.** Items of the same kind lying together become one pile.
- **The sea.** Items that land in the sea float.
- **How long they last.** Anything left lying goes after ten minutes. They're saved.

**Camps** (`land/structures.ts`):
- **Claims.** A campfire (5 timber) claims everything within 32 voxels of it.
  Nothing else can be built without one, and nothing at all within 80 of a port's
  berth. Try to fell, mine, dig or build on a town's land and that land is
  marked out on the ground for five seconds: stripes across it and a glowing line
  at its edge. The terrain shader draws the marking (`ChunkRenderer.setZone`).
- **Buildings** go on the grid, turned in quarter turns:
  - a hut (rest here to save);
  - a storehouse (150 goods);
  - they're levelled onto ground that varies by up to two voxels, with foundations
    filling the gaps.
- **Free-form pieces** go down one cell at a time: fences, gravel paths and torches,
  and plank and stone stairs and slabs (a timber or a stone each). Q and R turn a
  stair to climb the way you want. Stairs and slabs go on a whole solid block, so a
  flight can be built up a slope. A fence or a torch won't go on a stair or a slab
  either: it fills its cell from the foot, so it would float half a block over the
  step.
- **Materials** come from your pack, then any storehouse nearby, then the ship's hold
  if she's anchored within 60. So a hut can be built from timber bought in port.
- **Taking things down.** The axe or pickaxe takes up fences, paths, torches, stairs
  and slabs.
  Buildings come down from the build menu, for half their materials back.

**Farms** (`land/crops.ts`):

| Crop | Seed | Grows in | Yields |
|---|---|---|---|
| Sugar cane | cane cuttings | 3 min | 3 cane (a sugar mill makes it sugar and molasses) |
| Tobacco | tobacco seed | 4 min | 3 tobacco leaf (a curing shed makes it tobacco) |
| Pepper | pepper seed | 5 min | 1 spice |
| Maize (Phase 6) | maize | 2.5 min | 3 maize: food for settlers, and its own seed |

- **Growing.** Each crop sprouts, grows and ripens as voxels. Harvest it with E or
  any tool; the soil stays tilled for the next seed.
- **Seed and materials are goods.** Timber, stone and seed trade in every market:
  - seed is cheapest where its crop grows;
  - the pirate haven sells timber cheaply and the Crown's quarries sell stone;
  - Imperial shipyards pay well for timber.

**Saves** (`save/`):
- **What's stored.** A save is the world seed, plus `snapshot()` from the `Sea`, the
  `Economy` and the `Land`, plus the voxel chunks changed since generation. The world
  tracks edits from the moment worldgen finishes. Chunks are run-length encoded: a
  32 KB chunk is usually a few hundred bytes.
- **What isn't.** Other ships aren't saved; the encounter director brings new ones.
- **Where.** Saves go to IndexedDB: an autosave slot plus any number of named slots.
- **When the game saves itself.** Every 3 minutes, whenever you dock, and whenever
  you rest at a fire or in a hut.
- **The game menu** (Esc or Start) saves to a named slot, loads, or starts a new game.
- **Loading** reloads the page with `?load=<slot>` and applies the save to the freshly
  generated world. That keeps restoring simple: nothing from the old session has to
  be unwound.
- **At startup,** if there's an autosave, the menu offers to continue it.
- **Versions.** The format's version goes up when the snapshot changes, and every
  older version still loads (`READABLE_VERSIONS`):
  1. Phase 5: the first format, as above.
  2. Phase 6: the clock, passengers, settlers, fallow plots, saplings and workshop
     batches (§10).
  3. Phase 7: treasure maps and finds (§11).
  4. Phase 8: the story (§12).
  5. Phase 10: worked-out outcrops.
  6. Phase 10.2: the captain's guns, bandit camps, and each dropped pile's own life
     (above).
- **Towns in older saves.** Nobody builds or digs in a town, but a chunk that reaches
  out past a town's land can be changed there, and it's saved whole, town blocks and
  all. So in a save from before the stairs and props, such a chunk keeps the town as
  it was: full-block rises in the streets (they still work), no porch deck or
  canopy, and the old `Lantern` blocks where the lantern props now stand. That's only
  for the look of it: a porch's posts and rails over the bare pad, a prop lantern
  inside an old one. The ship on the stocks is never in such a chunk. At seed 1717
  it's Haven's tavern porch, and a few street lamps in each port. From the
  shops-and-interiors work on, rooms, stalls and the cart are props; in such a
  chunk the old block furniture and stalls stand on beside them, and nobody is
  kept out of the props' cells there.

## 10. Crews, production and night (Phase 6)

**The clock** (`core/clock.ts`). A day runs from sunrise to sunrise:
- **Length.** 12 minutes by default. The game menu's settings offer 6, 12, 20, 30 or 60
  minutes; the choice is kept in the browser and applies to every save.
- **Night** is about a third of it. The clock reads 06:00 at sunrise and 19:00 at
  sunset, so night hours pass faster than daylight ones.
- **State.** The clock lives on the `Sea` and moves with the fixed step, so it pauses
  with menus and duels, and it's saved.
- **Sleeping.** Late in the day, a hut or the camp's rest button sleeps you until
  07:00. A room above a tavern (5 gold) sleeps until morning, or until dusk if it's
  day. Time then passes in one-second steps while the sea waits; crops grow, markets
  recover, jobs run down, and the game saves on waking.

**Night** changes what you see and what's about:
- **Light** (`render/Sun.ts`, `render/NightLights.ts`):
  - The sun rises in the east and sets in the west, warm and low at either end; by
    night the moon's cold light comes from the north-west.
  - The sky and fog darken, and the fog closes in by about half.
  - Blocks can glow: embers, lanterns and the new glass windows carry a flag in the
    mesh, alongside the cutaway flag. A window carries a glass flag too: the terrain
    shader draws its faces as four panes between glazing bars, and after dark lights
    the panes a warm amber, brightest in the middle of each, so it reads as lit glass.
  - Six point lights, a fixed pool so shaders never recompile, go to the nearest
    campfires, torches, forges, pier lamps, Imperial beacons, your ship, and the
    lantern the captain carries ashore. They fall off gently (decay 1) rather than
    in a hot spot, so a door's lantern doesn't burn out whoever stands beneath it.
    Pier lamps and beacons get a small halo, and every light in the pool shines back
    off the water as a streak (§4).
  - Every ship shows a stern lantern with a halo, which is how you spot her in the dark.
- **At sea:**
  - Lookouts see 55% as far.
  - Ships come by every 26 s instead of 35.
  - 45% of groups are raiders, and a merchant never sails alone: she's replaced by
    raiders (`planNightGroup`).
  - Name tags show within 120, not 220.
- **In port:**
  - The fixer, and the back room of an Imperial tavern, only do business after dark.
  - A round buys three rumours instead of two.
  - Customs search 20% less often.
- **Creatures** (`land/creatures.ts`) come out around the captain on foot:
  - land crabs off the beaches, and wild boar from the grass;
  - they go for any crop that isn't in torchlight: a crab nibbles it back to a shoot,
    a boar tramples it flat;
  - they keep 6 away from torches, fires, forges and smokehouses, and can't climb a
    fence (a beast climbs one voxel, and a fence counts as two high);
  - a tool swing sends them running, and enough of them catches one: a crab for 1
    fish, a boar (3 blows, or 2 with the axe or pickaxe) for 3 meat;
  - since Phase 10.2 they can be shot as well, and by day wild goats graze the uplands
    (§9);
  - they're gone by dawn, and they aren't saved.
- **For the look of it** (`render/NightLife.ts`):
  - Bats flit over the captain's head: small, shaded blue-brown, the leading edges of
    their wings lighter. One the camera would see over a lifted room keeps away (gone
    at once, back gently), so none seems to fly round inside it.
  - Ghost lights hang over three cursed islets, visible from 700 away through the fog.
    They're a lure for Phase 7's treasure hunting.

**Settlers** (`land/settlers.ts`):
- **Hiring.** Taverns have people who'd go out to a camp:

  | Port | Up to | Fee | A new one every |
  |---|---|---|---|
  | Free port | 6 | 50 g | 90 s |
  | Pirate haven | 4 | 40 g | 120 s |
  | Imperial port | 3 | 70 g | 150 s |

- **Aboard.** They sail as passengers, 8 at most, over and above the crew.
- **The camp screen.** E at the campfire (or a workshop's door) opens it:
  - bring settlers ashore, as many as there are beds (a hut has two);
  - give each a job, or send them back aboard to settle somewhere else;
  - a Workshops tab and a Stores tab.
- **Jobs:**

  | Job | What they do |
  |---|---|
  | Farmer | Harvests ripe crops in the camp into the storehouse and sows them again with seed from it. With no seed, the plot waits until there is some. Plots the captain harvests are resown too. |
  | Woodcutter | Fells the nearest tree within the claim (plus 6) for timber, and plants a sapling in its place; it's a full tree again in 7 minutes. |
  | Miner (Phase 10) | Breaks up the nearest outcrop within the claim (plus 16), 20 s each, into the stores. With none standing, cuts wood until one grows back. |
  | Fisher | Fishes from the shore near the camp: 1 to 3 fish every 24 s. |
  | Workshop hand | Works one workshop; nothing is made without them. |

- **The day.** They work by day and go home to their hut at night (by the fire if
  there's no bed).
- **Food.** At sunrise each eats one food from the camp's storehouses: provisions,
  fish, meat or maize. A settler who finds none won't work, and leaves after a third
  hungry morning.
- **Walking.** `land/paths.ts` is an A* search over the surface by the walker's own
  rules:
  - scramble up two, drop up to four, wade but never swim;
  - diagonals only where both cells beside them are passable;
  - a search gives up after 3,000 cells.
  - Anyone held up for 1.5 s is helped on to the next cell.
- **Unwatched camps.** Camps more than 160 from the captain (or their ship) aren't
  walked step by step; each walk just takes as long as it would. Everything else
  runs exactly the same: crops grow by the clock, workshops run their batches, and
  breakfast comes at sunrise. The whole thing is cheap enough to run for every camp
  all the time, so it replaced the coarse ledger the plan had proposed.
- **Storage.** A camp's storehouses (those within its fire's claim) are pooled:
  workshops draw from them and fill them, and settlers eat from them.

**Production** (`land/structures.ts`, `land/camps.ts`). A workshop makes nothing
until its hand is at the bench:
- **Batches.** A batch takes its inputs from the storehouses when it starts, and puts
  its goods back when it's done. A finished batch waits if there's no room.
- **Several recipes.** A workshop with more than one switches between them on the
  camp screen, between batches.

| Workshop | Cost | Makes | Batch |
|---|---|---|---|
| Sawpit | 20 timber, 5 stone | 3 timber → 2 planks | 12 s |
| Sugar mill | 30 timber, 25 stone | 3 cane → 2 sugar + 1 molasses | 15 s |
| Distillery | 25 timber, 20 stone, 4 iron | 2 molasses + 1 timber → 2 rum | 20 s |
| Curing shed | 25 timber, 5 stone | 3 leaf → 2 tobacco | 30 s |
| Smokehouse | 15 timber, 15 stone | 3 fish + 1 timber, or 2 meat + 1 timber → 3 provisions | 15 s |
| Forge | 30 timber, 30 stone | 2 ore + 2 timber → 1 iron; 1 iron + 1 timber → 1 cutlass; 2 iron + 1 planks → 1 musket; 1 iron → 12 cartridges (Phase 10.2) | 20–30 s |

**New goods.**
- **Where they come from:**
  - planks, iron, cutlasses, molasses and provisions are made in workshops;
  - cane, tobacco leaf and maize come off your fields;
  - iron ore comes from outcrops (Phase 10; it came from veins in the rock before);
  - fish and meat come from the shore and the night's creatures (and goats, by day);
  - hides come from goats, and cartridges from the forge (Phase 10.2).
- **Where they sell.** They're appended to every market, so older saves' stocks still
  line up. Each is drawn from its own seeded numbers:
  - pirate havens want cutlasses, iron, molasses and provisions;
  - the Crown's yards want planks, and its mines sell iron;
  - free ports grow maize;
  - Phase 10's ores come next: the free ports' foundries want copper ore, the Crown's
    mint silver and gold ore, the pirate haven gold ore.
  - Phase 10.2's cartridges and hides come last. Every market trades cartridges (the
    Crown keeps the guns, not the shot), and the free ports' tanners want hides.
  - Fish and meat aren't traded; hides are.
- **The market** lists goods in groups: cargoes, arms, building materials, camp
  produce, food and seed.

**The carpenter.** Out of a fight, with planks in the hold, the ship's carpenter mends
the hull at 1.5 points a second, using a plank for every 4 points.

**Saves** are version 2 (the clock, passengers, settlers, fallow plots, saplings and
workshop batches). Version 1 saves still load: the clock is worked out from the sea's
time, and there are no settlers yet.

## 11. Treasure hunting (Phase 7)

The design, and the player's answers it came from, are in
[phase-7-treasure.md](phase-7-treasure.md). This section covers what was built.

**Islets have names** (`planArchipelago`): plain ones like "Gull Cay", grim ones for
the three cursed isles. Names come from their own seeded numbers, so the islands
don't move. The sea chart labels every islet, and marks with a red X each one a map
of yours leads to.

**Sites** (`treasure/sites.ts`, pure):
- **Where.** `planSite` picks open ground on an islet for a landmark: a 3 × 3 patch
  within a block of level, with no trees. The chest lies a walk of one or two legs
  of 4 to 9 paces from it.
- **The walk.** A second leg always turns a corner. The X must be dry, open earth
  with no tree on it, and the chest lies `DEPTH` (2) blocks under it.
- **Kept clear.** Sites keep off your camps' claims and the ports' towns.
- **The landmark** is a skull rock (bone-white, dark eyes, grinning south), a cairn
  or a dead tree. `raiseLandmark` builds it into the world, with footings on a
  slope, only once the map is the captain's. It's saved with the other edited
  chunks, and nothing can dig, mine or fell it.
- **Clues** get plainer the nearer home. "7 paces west" further out becomes "seven
  paces toward the sunset" far out: the sun rises at +x, and north is −z, as on the
  chart.

**Maps** (`treasure/Treasure.ts`):
- **Tiers** go by distance from Haven: near (< 700), mid (< 1500), far, and cursed.
  - The style follows the tier (`MAP_STYLES`): a coastline with an X, then a
    coastline with directions, then a riddle.
  - The loot is rolled when the map is made: gold, one staple, the chance of a
    unique find, and for a cursed hoard a piece of Blackwood's chart.
- **Where they come from:**
  - **The fixer** (`offersFor`), after dark: two maps a night per port, fixed for the
    night. At a pirate haven the first is always a cursed one; elsewhere a quarter
    of the time.
  - **A prize's papers** (`prize`, when a ship is captured): 40% of pirates, 25% of
    merchants, 15% of the Crown's ships.
  - **Tavern talk** (`rumour`), through `Economy.rumourSources`: up to 45% of rounds
    at night, at most once a day per port. The rumour is written straight into the
    case as a map.
- **One chest at a time.** An islet has at most one waiting, in the case or on
  offer.
- **The case holds 8.**

**Digging** (`Treasure.search`, asked by `Land.dig` about the ground block the
captain stands on):
- **What digging turns up.** Within a block of the X, a chest; depth doesn't matter.
  Within three blocks, loose earth, "as if it has been dug before". Anywhere else,
  nothing.
- **What's in the chest.** The ground block where the captain dug becomes a `Chest`. Goods pop out in
  piles of five as dropped items. Gold and unique finds go straight to the captain.
- **Cursed hoards.** By day they won't give. At night the chest raises a `guardian`
  event, and the loot waits until it's beaten (`guardianBeaten`). A guardian that
  wins takes a tenth of your gold (`guardianWon`), and you wake at dawn with the map
  still in your case. Since Phase 10.2 a card says so while the night passes (§9).
- **The ghost lights** of an isle gather low over a cursed hoard you hold the map
  for.
- **Blackwood's chart.** With the third piece, the pieces join into a legendary map
  to the islet farthest from Haven. That hoard holds every unique find not yet found,
  and the sealed letter that will open the Phase 8 story.

**The guardian's duel.** Duels take a `DuelSetup`: where, who, how strong, and what's
said.
- **`boardingDuel`** is the old boarding fight, on the prize's `deckStage`.
- **`guardianDuel`** is fought on a `groundStage`: a group set down where the captain
  stands, turned so the fight runs across the view the walking camera had.
- **The ghost** is the pirate captain's model washed pale sea-green (`ghostModel`),
  drawn see-through and faintly glowing (`CharacterView` with `ghost`). It fights
  with its own `DUEL_SKILLS.ghost`: tireless and hard-hitting, but slow to parry,
  and it never kicks.

**Unique finds** (`treasure/relics.ts`) belong to the captain:

| Find | Where it acts |
|---|---|
| The Admiral's Spyglass | ship names read 1.75× further off (`Game.shipLabels`) |
| Blackwood's Cutlass | +25% damage in any duel (both setups) |
| The Lodestone | on foot within 20 paces of a chest you have a map for, the HUD says which way it tugs |
| The Smuggler's Ledger | customs never find muskets (`Economy.arrive`) |
| The Lucky Doubloon | captured ships give up 25% more gold (`Sea.capture`) |

**On screen:**
- **The chart has two views** (`ChartView`): the sea chart and the treasure maps. Q/E
  switches between them on the chart screen, and tabs do it in a port's chart.
- **Each map is drawn on parchment** (`ui/treasureMap.ts`): stains, a torn edge, a
  north arrow.
  - Near and mid maps sketch the islet from the world's own heights, with the
    landmark, and the X near home.
  - Riddles are words and a doodle.
  - The finds and the chart pieces are listed beside.
- **A compass on foot** shows north for counting paces.

**Saves:** the captain's maps, finds, pieces and letter go in the `Sea` snapshot.
The night's offers, the taken hoards and the rumour days are the `Treasure`
snapshot. Save version 3; older saves still load.

## 12. The story (Phase 8)

The design, and the player's answers it came from, are in
[phase-8-story.md](phase-8-story.md). This section covers what was built.

**The words are data** (`story/script.ts`), apart from the logic:
- **The characters:** Nell Brandt, Jonas Quill, Tobias Finch and Red Mary Kincaid, and
  where each is found (`WHERE`): which port by role, which door, and Finch only after
  dark.
- **Their talks** (`TALKS`): which stages each belongs to, what must come first,
  whether it needs Blackwood's letter or a given choice, which journal entry its words
  are filed under, the stage it moves the thread to, and any answers that decide
  something.
- **The journal entries** (`ENTRIES`), and the intro and epilogue pictures with their
  words.
- **Placeholders.** Lines take the world's names (the pirate haven, the Crown's
  outpost, the capital). The admiral is "the admiral" until Finch reads the letter.

**The thread** (`story/Story.ts`, pure) runs through seven stages: nell, quill,
chart, cipher, flag, sovereign, done.
- **Who's at a door.** `talksAt(port, place)` gives the first open talk of each
  character there.
- **Talking.** `talk(id, answer)` hears one out, and applies the choice if there's an
  answer. A talk that offers a choice stays open until it's answered.
- **Moving on by itself.** `step()` moves the thread from Blackwood's chart to the
  cipher once the captain holds the letter.
- **The journal.** `journal()` builds its entries: text with the names as they stand,
  objectives with their progress, and the words heard, filed under each entry.
- **The choice.** It changes standing (with the usual standing news), fits a free
  refit (gun drill under the black flag, a stronger hull with the letter of marque),
  and makes up the crew.

**The *Sovereign*:**
- **The ship.** A three-masted frigate, a new ship type (`FRIGATE`), not for sale.
  `npm run make:placeholder-ship frigate` generates her model alongside the sloop and
  brig; that command can now make one design at a time.
- **Her station.** She keeps station off the capital, on the side facing Haven: deep
  water found from its island's middle. The chart marks it once the thread reaches
  her.
- **Coming out.** Within 650 of the station she and two brigs come out, already
  alerted. Beyond 1,100, or once the captain is jailed, they leave until next time.
  Vessels aren't saved, so after a load she comes out again the same way.
- **Harrow.** She's an admiral's flagship (`Vessel.admiral`), so she's never taken
  without the duel, struck or not. Harrow fights with `DUEL_SKILLS.admiral`: quick to
  parry, 210 hit points.
  - **Taken:** the thread ends with the duel ending.
  - **Sunk:** he goes down with her.
  - **Either way,** the epilogue shows once the verdict and any menu have cleared.

**Allies.** Under the black flag, Red Mary's *Revenge* and *Gull* come out with the
*Sovereign* (`AiState.ally`).
- **Formation.** An ally keeps station on the player the way escorts keep station on
  a convoy's leader.
- **Fighting.** It goes for the nearest ship within 260 of the player that's engaging
  or flying an admiral's flag. `engage` now takes any target ship, where it used to
  assume the player.
- **After Harrow,** allies sail for home.

**On screen:**
- **The intro** (`ui/story/StoryPanels`) plays on a new game: the `?new` reload, the
  title menu's New game, or a first start. A loaded game has seen it. Its pictures
  were painted with the asset tool's new `illustration` recipe (Nano Banana Pro, the
  first panel the reference for the rest), and are in `public/story/` as WebP.
- **Conversations.** People to see appear at the top of the tavern and Guildhall tabs
  (`ui/port/People`). Talking shows their words, and choices have "Not yet".
- **The journal** (`ui/story/JournalScreen`) opens on J, or from the game menu for
  controllers. It lists the entries, their objectives and what people said, and can
  replay the story so far.

**Saves:** version 4 adds the story's snapshot: stage, talks heard, choice, the day
each stage began, whether the intro was seen, and how it ended. A save from before
Phase 8 has lived through the intro, so it doesn't play again.

## 13. Ship art: MagicaVoxel authoring guide

Ships live in `public/models/ships/*.vox`; handling and combat stats are in
`sailing/ships.ts`. `npm run make:placeholder-ship` regenerates the placeholder sloop
and brig, which are also templates: open one in MagicaVoxel and restyle it. Painted
gun ports are only paint, but the guns (spaced along the hull from `gunsPerSide`,
see §6) are drawn in them on the placeholder hulls, so keep the ports at the stripe
height if you restyle one.

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

## 14. Simulation, physics and time

**Loop.** `GameLoop` polls input (`beginFrame`), runs the **simulation at a fixed
60 Hz** (`FixedStep`, accumulator with a 250 ms clamp), then **renders at display
rate**, interpolating with `alpha`. The rule, enforced by structure in `Game.ts`:

> State that must be saved, replayed or kept deterministic lives in `sim` and changes
> only in `update(dt)`. Everything in `render()` is derived from it and is disposable.

Camera easing, wave riding, sail bracing, the wake, streaks and the HUD are
presentation, so they run on frame time.

Orders given in the port menus (buy, sell, hire, take a job) are the one place sim
state changes from outside `update()`. They arrive as DOM events while the sea is
paused, and each is a discrete command, like an order at the helm. Nothing
time-dependent happens until you set sail.

**Cannonballs** are ballistic points integrated per tick, inheriting the firing
ship's velocity. Each step's segment is tested against every other hull's box
(keel to masthead), floating barrels, the voxel terrain (DDA) and the water.

**On foot** (Phase 5): an axis-separated box against the voxel grid, stepping and
scrambling up to two voxels (§9).

**Entities and systems.** Plain, serialisable data (`Vessel`, `Shot`, `Barrel` in
the `Sea`; `Settler`, `Building`, `Crop` in the `Land`), with systems as functions
called in a fixed order each tick. Settlers' tasks are plain data too, so they save
as they are. Phase 6 didn't need an ECS: a camp has tens of entities, not thousands.

**Off-screen islands.** Camps keep working while you sail. The same settler and
workshop simulation runs everywhere; camps nobody is near just time their settlers'
walks instead of stepping them (§10). The coarse ledger planned here wasn't needed.

**Saves** (Phase 5): the seed, the edited chunks (run-length encoded) and the sim
state as JSON, in IndexedDB (§9).

## 15. Module map

```
src/
  config.ts            world constants (SEA_LEVEL, SIM_HZ, …)
  Game.ts              composition root: sim state, update(), render()
  main.ts              entry: loads the ship, starts the game; `game` on window in dev
  core/                FixedStep, GameLoop, Input, Controls (keyboard + gamepad),
                       clock (time of day)
  audio/               the music (made as in docs/music.md): the tracks, a Playlist
                       (the shanties on N at sea, a shuffled round that resumes
                       mid-song; Ashore on foot), a LoopPlayer (Broadsides, which
                       crossfades its end into its start) and the Soundtrack that
                       picks one: a fight (Sea.inBattle, or a duel) over the rest
  voxel/               engine-agnostic voxel core, no three.js imports
    blocks.ts          block ids, colours, solidity, the stair and slab shapes
    palette.ts         colour + solidity tables for the mesher
    Chunk.ts           32³ storage
    VoxelWorld.ts      sparse chunks, edits, dirty tracking, column queries
    mesher.ts          padded volume + face-culled AO mesher
    shapes.ts          heights and collision on stairs and slabs
    raycast.ts         voxel DDA
  vox/                 MagicaVoxel .vox parser (scene graph) and writer
  sailing/             ship handling, hull outline, point of sail, weather,
                       ship types, .vox → ship parts
  combat/              Sea (the combat sim), vessels, ammo, gunnery, barrels,
                       AI captains, encounters
  duel/                captains' duel: moves, fighters, AI swordsmen, character
                       models (.vox parts → joints), cutlass; settlerModel
                       (settlers built from code, same joints); ghostModel;
                       captainDress (your captain's red coat and hat)
  economy/             goods and cargo, markets, reputation, contracts, the price
                       book, the shipyard, the captain; Economy ties them together
  treasure/            treasure maps: sites and landmarks, clues, the Treasure
                       sim (offers, prizes, rumours, digging, guardians), finds
  story/               the main story: its words (script.ts) and the Story sim
                       (who's where, the thread, the journal, the Sovereign)
  DuelScene.ts         runs a duel from boarding to verdict (sim + presentation)
  worldgen/            seeded noise, island generator, archipelago plan, harbours,
                       deposits (where outcrops go), bandits (where bandit camps
                       go, and raising them), rooms (a room's furniture laid out
                       by role and size), furnish (standing props: blockers and
                       anchors; furnishing a building)
  props/               the towns' decoration finer than a block: types, sketch
                       (drawing a model voxel by voxel), models (lanterns, signs,
                       the clock, porch posts and rails), catalog (every kind, the
                       sloop's hull among them), place (a placement's matrix),
                       reserve (the blocker in a prop's cells), kit (the finer
                       props' colours and helpers), furniture (barrels, crates,
                       beds, tables, shelves, chests, hearths, rugs, the bar, the
                       desk), market (stalls, the hand cart, the hall's counters),
                       shapes (a finer prop's cells)
  ocean/               waves.ts (CPU + GLSL twin), SeabedMap
  render/              CameraRig, Sun, ChunkRenderer, OceanRenderer, FleetView,
                       ShipView, ShotsView, BarrelsView, RangeArcs, Effects,
                       Wake, WindStreaks, voxelGeometry, DuelView, CharacterView,
                       LandView (the captain on foot, tool marker, build ghost),
                       toolModels, PeopleView (settlers, townsfolk, bandits,
                       creatures), NightLights, NightLife (bats, ghost lights),
                       glow, PropsView (the props, one instanced mesh a kind),
                       lifts (the roof lift's shader test, shared by the terrain
                       and the props), fightFrame and roomFrame (framing a fight
                       or a room on foot), Tracers (a shot's faint streak)
  land/                on foot: the walker, tools, camps and buildings, crops,
                       settlers and their paths, workshops, creatures (the night's
                       and the goats), deposits (outcrops of stone and ore),
                       firearms (the guns, the chance to hit, aim and cover),
                       bandits (the camps' state, and the bandits themselves)
  save/                save format, IndexedDB slots, chunk run-length encoding
  Shore.ts             the captain on foot: controls to land orders, the view and HUD
  ui/                  Hud (help, compass, combat panel, prompts, messages),
                       ShipLabels (name tags over ships), DuelHud; Overlay and
                       menuNav (React menus, controller focus), port/ (the port
                       screen and its tabs), ChartView / ChartScreen, FootHud,
                       WorldLabels (signs), BuildMenu, StoreScreen, SystemMenu,
                       CampScreen, settings, MapsView and treasureMap (the
                       treasure maps on parchment), buildStamp; story/ (the
                       painted panels, the journal); port/People; comeTo (the
                       card's words for going down) and Fade (the fade to black,
                       for sleep and the card)
  util/                hash, small math helpers
scripts/               asset generators (placeholder ships, captains via Tripo,
                       voxelizer) and the duel balance harness
  assetgen/            prompt → art via ComfyUI: pixel textures, sprites, icons,
                       HD materials, .vox models (see its README)
public/models/         ship and character .vox files
```

`voxel`, `vox`, `sailing`, `combat`, `duel`, `economy`, `land`, `treasure`, `story`, `save`, `worldgen`, `ocean` and `core` are unit-tested (`*.test.ts`
next to the code). The browser-bound `Input`, `GameLoop` and the React menus are
verified in the running game. None of those directories import from `render`,
`tools`, `ui` or three.js. `props` is unit-tested too; it imports nothing from
`render` or `ui`, and three.js only for a placement's matrix (`place.ts`). Only
`Game.ts` knows about everything.

## 16. Roadmap (proposed)

1. ✅ **Foundation:** loop, camera, voxel chunks + mesher, ocean, island, dig/place.
2. ✅ **Sailing:** ship handling, regional weather, grounding, `.vox` ships, gamepad, wake and wind streaks.
3. ✅ **Naval combat:** broadsides, three shot types, damage and surrender, boarding, merchant barrels, AI captains, regional encounters and convoys.
   - ✅ **3b. Captains' duel:** side-view sword fight on deck (parries with a cue, blocks, rolls, kicks, red thrusts), Tripo-generated voxel captains, jail and plunder.
4. ✅ **Ports & economy:** a seeded five-port archipelago with harbours and towns; supply-and-demand markets, the price book and rumours; freight, bounties and smuggling; reputation with three factions and a fixer; shipyard refits and ships; crew hiring; the chart; React menus driven by keyboard or controller.
5. ✅ **On foot & camps:** walking ashore anywhere and around ports (signed doors, graded roads); axe, pickaxe, shovel and hoe; campfire claims; huts, storehouses, fences, paths, torches; sugar cane, tobacco and pepper; timber, stone and seed as trade goods; a cutaway view; autosave and named saves.
6. ✅ **Crews, production & night:** settlers hired in taverns who farm, cut wood, fish and work six workshops (sawpit, sugar mill, distillery, curing shed, smokehouse, forge), fed each morning and housed in huts; voxel-surface pathfinding; maize, iron ore, planks and a carpenter; a configurable day and night with moonlight, lanterns and glowing windows, night raiders, slack customs, a fixer who works after dark, crabs and boar after your crops, bats and ghost lights; sleeping through the night.
7. ✅ **Treasure hunting:** named islets; maps from the fixer, prizes and tavern talk, drawn on parchment from the real coastline (an X near home, directions further out, sun-riddles far out); landmarks and chests two spades down; cursed hoards guarded at night by a ghost captain in the duel; five unique finds; Blackwood's chart in three pieces, leading to his hoard and the letter that opens Phase 8.
8. ✅ **Story:** a painted intro (the foundling, the *Good Hope*, the Imperial attack); a journal whose entries gather what people tell you; Nell, Quill, Finch and Red Mary; Blackwood's letter naming Lord Admiral Harrow; the choice of the black flag or the Guild's letter of marque; the *Sovereign*, a frigate with two brigs (and the Brethren's ships beside you under the black flag), and a last duel with Harrow; an epilogue.

9. 🔄 **Quick wins:** going down (sunk or jailed) clears the sea and keeps it quiet for a minute, so nobody camps the port; the shovel retired (dig for treasure with F where you stand, and the ground is never changed); trees that take several axe blows; cannons that fly back when fired and run out when loaded.
10. 🔄 **Deposits, guns & sound** ([phase-10-deposits-guns-sound.md](phase-10-deposits-guns-sound.md)): outcrops of stone, iron, copper, silver and gold that grow back, and settler miners; a pistol and a rifle for the captain on foot, wild goats, and bandit camps on wild islets; a "come to" card for going down; sound effects from ElevenLabs on Comfy Cloud, with sea ambience.
    - ✅ **Before 10.2: the towns.** Every port was rebuilt as a real town
      (section 8). There's a paved square with stalls, and streets on levelled
      ground. Houses of one or two storeys are spaced out and furnished. The doors
      you can enter are framed and lit. There's a ship on the stocks, and banners
      and dressing for each faction. On foot there are townsfolk dressed for their
      port and Crown guards at the Governor's door. Roofs lift where they're in the
      way or you're beside them. The captain gets a ring (and a pin when zoomed
      out), the camera pulls back to 36, and the HUD is clearer, with help that
      hides after two days (H shows it). The visual critic ran four passes. It
      stayed at 4/10, held back by the on-foot art, so the rest is below.
    - ✅ **Stairs, slabs and props**
      ([design](superpowers/specs/2026-09-25-block-shapes-and-props-design.md)).
      Gravel, stone and plank stairs and slabs, walked in half-steps by the captain,
      settlers, creatures and townsfolk. Town streets climb by stairs, and camps can
      build them. The towns have props finer than a block: lanterns on the posts and
      by the doors, signboards and signposts, a clock on the office, porches before
      the tavern and the office, and the sloop on the stocks.
    - ✅ **10.2: guns, hunting and bandits** (§9;
      [plan](superpowers/plans/2026-09-30-phase-10-2-guns-bandits.md)). A pistol and a
      rifle from the gunsmith's counter in the free ports and the pirate haven, firing
      cartridges, with a pouch of 24 taken ashore. Wild goats on the uplands, for meat
      and hides. Bandit camps on four wild islets: their bandits see, hear, fight and
      flee, the camp has a chest to loot, and it's manned again five days after it's
      cleared. The captain's health on foot, and a come-to card for every way of going
      down. Save version 6. Still to come in 10: 10.3, the sound.
    - **Next: a town art pass.** The critic's open points from its last pass
      (`.playwright-mcp/critic-town-4/report.md`, not in git):
      - ✅ The Tavern, Guildhall and Governor's House have a porch, a hanging
        signboard and (the last two) a clock. Still open: columns, and shapes of their
        own rather than the house every dwelling uses.
      - Each faction lays its town out its own way, not one kit re-roofed.
      - ✅ The ship on the stocks reads as a ship from above: she's drawn in frame,
        being built (the sloop's own hull, which she was before, read as a hollow crate).
      - ✅ The captain reads at a glance: a deep red coat trimmed gold and a gold-edged
        hat (§7, "Character pipeline").
      - Night: ~~bats read as debris~~ (fixed: shaded, smaller), and moonlit plaster
        turns royal blue.

      The critic's pass after the props (`.playwright-mcp/critic-town-5/report.md`,
      3/10 from another model, so not to be set against the 4/10 above) read the night
      lanterns as dark figures with glowing eyes; their glass now runs unbroken round
      them. Still open, from that pass and from the look at the game that went with it:
      - ~~Lifting a roof shows a bare room~~ (fixed: rooms are furnished, §8), and
        on foot the square is ringed with roofless boxes (as before).
      - The tool's red target outline, half hidden, reads as stray debug lines.
      - Wind streaks read as white glitches over ~~the town~~ (fixed: over open water
        only) and the water.
      - The broadside range dots show in port, a dotted line across the sea.
      - The ports look alike from the sea, and the HUD's text is small. Place labels
        (serif on cream) and prompts (sans on white) look like two kits, and the
        prompt at a door sits over the captain.
      - From the sea at night a lantern is a point of light, where the old lantern
        block was a whole glowing cube, so the pier reads less well.
      - Haven's market signpost stands in the gap at a stall's end, hidden by the
        awnings from most views.
      - The ship on the stocks never lifts on foot (a prop with no anchor), so at the
        yard she can stand between the camera and the captain. Since the critic's pass
        on the interiors she has no mast, and above her planking the captain shows
        between her frames; under her bottom, on the slipway, she still hides him.
      - ~~At Kingsreach, in the street between the tavern and the Governor's House with
        the camera from the south-west, a roof hides the captain and doesn't lift~~
        (fixed: the head-height cut and the line of sight going on through what it's
        lifted, §9 "The view").
    - **Asked for after 10.2**, with the town art pass
      ([plan](superpowers/plans/2026-10-09-town-shops-and-interiors.md); GitHub issues):
      - ✅ Shopkeepers behind the counters in the port shops, dressed for the port
        ([#1](https://github.com/jeffory/havens-end/issues/1)).
      - ✅ Shop roofs that lift away to show the inside, as house roofs do
        ([#2](https://github.com/jeffory/havens-end/issues/2)).
      - ✅ The small cart-like stalls in front of the shops, which read badly at play
        zoom, reworked into a clear stall or a proper cart
        ([#3](https://github.com/jeffory/havens-end/issues/3)).
      - ✅ House interiors dressed (beds, tables, shelves, hearths and the rest), checked
        with a visual-critic pass
        ([#4](https://github.com/jeffory/havens-end/issues/4)).
11. **Terrain & UI:** building near a town shown by a red dithered border; a ground leveller in place of the shovel; caves carved into the islands, with the new ores in them.
12. **Farming:** growth cycles, seeds, the hoe, watering and harvest yields, built on the crops already there.

**Later:** docks and building over water. Jetties from your camps where the ship can
moor, and walkways or huts on stilts. Notes and open questions:
[later-docks-and-water.md](later-docks-and-water.md).
