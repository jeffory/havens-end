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
  overlap and reading only the new strip from the world. The shader uses it for the turquoise-to-navy ramp,
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
| Board / go ashore in a harbour | B | B |
| Sea chart | M | View (Back) |
| *Menus:* move / choose | arrows or WASD / Enter | d-pad or left stick / A |
| *Menus:* switch place / back | Q / E, Esc | LB / RB, B |
| Game menu (save, load) | Esc | Start |
| *On foot:* walk | WASD / arrows | Left stick |
| *On foot:* use what's in hand / interact | Space or left click / E | X / A |
| *On foot:* tools, seed and maize | 1–8, Q / R | LB / RB |
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
  past the drop-off.
- **Town.** Built behind the landing, in the faction's style:
  - free ports: plaster and slate;
  - Imperial ports: plaster and terracotta, plus a stone watchtower;
  - the pirate haven: plank shacks with thatch.
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
- Crops are drawn but walkable. A separate `blocksWalker` test sits alongside
  `isSolid`.

**Ports on foot.** The Phase 4 menus are unchanged; you just walk to them.
- **Doors and signs.** Each harbour records its doors: the three houses nearest the
  pier become the market, the tavern and the governor's office. The shipyard is at
  the foot of the pier. Signs hang over them, and walking up to a door opens that
  place's menu.
- **Roads.** Gravel roads graded one voxel per step run from the pier to every door.
- **Reachability test.** Every door can be walked to from the pier, by the walker's
  own rules.

**The view.** The camera closes in (26 units). A cutaway in the terrain shader opens
any tree or building on the camera's side of the captain, above head height. Blocks
opt in through a per-vertex `cutaway` flag (the ground never does, since it would
show hollow), and your own ship fades while you work beside her.

**Tools** (`land/Land.ts`) work the block in front of you, or the one under the mouse
if the captain can reach it. Reach is 3.6 across, and from two blocks below the feet
to two above. The mouse picks through whatever the cutaway hides
(`ChunkRenderer.hides`, the shader's own test). The target is marked, and red means it
won't work; nothing out of reach is marked. Click a hotbar slot, or press 1–9, to take
it up.
- **Axe:** fells a whole tree, first the trunk and then the leaves hanging from it.
  - "Hanging from it" means the leaves nearer that trunk than to any other, so two
    canopies that touch come down one at a time.
  - Blocks touching at an edge or a corner count, so a leaning palm comes down whole.
- **Pickaxe:** breaks natural stone and iron ore, one block at a time.
- **Shovel:** digs the top of the ground within reach, for earth, sand or stone. Into
  a wall, it starts as high as you can reach.
  - F, right click or LT puts earth back down (sand once the earth runs out). It goes
    against the face under the mouse, or on the ground in front. That fills holes,
    raises ground and builds walls.
  - Earth goes as deep as the shovel digs, and no deeper into the sea.
- **Hoe:** tills grass or earth.
- **Seed:** plants in tilled soil. **Saplings** (from felled trees) plant in grass,
  earth or sand, and grow into a tree.

**Finding the ground.** Tools look down the column from the top of reach. Trees
don't count as ground, and neither does the air under their canopies. (Once, a canopy
over a gap made the tools aim at the empty air beneath it.)

**Where tools work.** Felling, mining and digging work on any island outside a port's
town. Tilling and sowing need a claim.

**Dropped items** (`land/drops.ts`, drawn by `render/DropsView.ts`). What the tools
break off doesn't go straight into the pack. Felled trees, stone, ore, earth and sand,
harvested crops and caught beasts all drop this way. Settlers still put their work
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
  berth. Try to dig, build or put earth down on a town's land and that land is
  marked out on the ground for five seconds: stripes across it and a glowing line
  at its edge. The terrain shader draws the marking (`ChunkRenderer.setZone`).
- **Buildings** go on the grid, turned in quarter turns:
  - a hut (rest here to save);
  - a storehouse (150 goods);
  - they're levelled onto ground that varies by up to two voxels, with foundations
    filling the gaps.
- **Free-form pieces** go down one cell at a time: fences, gravel paths and torches.
- **Materials** come from your pack, then any storehouse nearby, then the ship's hold
  if she's anchored within 60. So a hut can be built from timber bought in port.
- **Taking things down.** The axe or pickaxe takes up fences, paths and torches.
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
    mesh, alongside the cutaway flag.
  - Six point lights, a fixed pool so shaders never recompile, go to the nearest
    campfires, torches, forges, pier lamps, Imperial beacons, your ship, and the
    lantern the captain carries ashore.
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
  - they're gone by dawn, and they aren't saved.
- **For the look of it** (`render/NightLife.ts`):
  - Bats flit over the captain's head.
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
| Forge | 30 timber, 30 stone | 2 ore + 2 timber → 1 iron; 1 iron + 1 timber → 1 cutlass; 2 iron + 1 planks → 1 musket | 20–30 s |

**New goods.**
- **Where they come from:**
  - planks, iron, cutlasses, molasses and provisions are made in workshops;
  - cane, tobacco leaf and maize come off your fields;
  - iron ore comes from veins in the bare rock of the hills, broken with the pickaxe;
  - fish and meat come from the shore and the night's creatures.
- **Where they sell.** They're appended to every market, so older saves' stocks still
  line up. Each is drawn from its own seeded numbers:
  - pirate havens want cutlasses, iron, molasses and provisions;
  - the Crown's yards want planks, and its mines sell iron;
  - free ports grow maize.
  - Fish and meat aren't traded.
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

**Digging** (`Treasure.dig`, called by the `Land` after every block the shovel
digs out):
- **What the shovel turns up.** Within a block of the X at chest depth, a chest.
  Above it, "soft and loose: keep digging". Within three blocks, loose earth, "as if
  it has been dug before".
- **What's in the chest.** A `Chest` block is left in the hole. Goods pop out in
  piles of five as dropped items. Gold and unique finds go straight to the captain.
- **Cursed hoards.** By day they won't give. At night the chest raises a `guardian`
  event, and the loot waits until it's beaten (`guardianBeaten`). A guardian that
  wins takes a tenth of your gold (`guardianWon`), and you wake at dawn with the map
  still in your case.
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
                       models (.vox parts → joints), cutlass; settlerModel
                       (settlers built from code, same joints); ghostModel
  economy/             goods and cargo, markets, reputation, contracts, the price
                       book, the shipyard, the captain; Economy ties them together
  treasure/            treasure maps: sites and landmarks, clues, the Treasure
                       sim (offers, prizes, rumours, digging, guardians), finds
  story/               the main story: its words (script.ts) and the Story sim
                       (who's where, the thread, the journal, the Sovereign)
  DuelScene.ts         runs a duel from boarding to verdict (sim + presentation)
  worldgen/            seeded noise, island generator, archipelago plan, harbours
  ocean/               waves.ts (CPU + GLSL twin), SeabedMap
  render/              CameraRig, Sun, ChunkRenderer, OceanRenderer, FleetView,
                       ShipView, ShotsView, BarrelsView, RangeArcs, Effects,
                       Wake, WindStreaks, voxelGeometry, DuelView, CharacterView,
                       LandView (the captain on foot, tool marker, build ghost),
                       toolModels, PeopleView (settlers, creatures), NightLights,
                       NightLife (bats, ghost lights), glow
  land/                on foot: the walker, tools, camps and buildings, crops,
                       settlers and their paths, workshops, night creatures
  save/                save format, IndexedDB slots, chunk run-length encoding
  Shore.ts             the captain on foot: controls to land orders, the view and HUD
  ui/                  Hud (help, compass, combat panel, prompts, messages),
                       ShipLabels (name tags over ships), DuelHud; Overlay and
                       menuNav (React menus, controller focus), port/ (the port
                       screen and its tabs), ChartView / ChartScreen, FootHud,
                       WorldLabels (signs), BuildMenu, StoreScreen, SystemMenu,
                       CampScreen, settings, MapsView and treasureMap (the
                       treasure maps on parchment), buildStamp; story/ (the
                       painted panels, the journal); port/People
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
`tools`, `ui` or three.js. Only `Game.ts` knows about everything.

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

**Later:** docks and building over water. Jetties from your camps where the ship can
moor, and walkways or huts on stilts. Notes and open questions:
[later-docks-and-water.md](later-docks-and-water.md).
