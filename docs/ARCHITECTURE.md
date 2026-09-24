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
| Ship art | **MagicaVoxel `.vox`**, own parser | Artists work in the standard voxel editor; ships are meshed by our own mesher, so they match the islands. See §10. |
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
| *On foot:* tools and seed | 1–7, Q / R | LB / RB |
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

**Tools** (`land/Land.ts`) work the cell in front of you, or the one under the mouse
if it's within reach. The target is marked, and red means it won't work:
- **Axe:** fells a whole tree (trunk and canopy) for timber.
- **Pickaxe:** breaks natural stone, one block at a time.
- **Shovel:** levels the ground toward your feet, cutting or filling, and digs when
  the ground is already level.
- **Hoe:** tills grass or earth.
- **Seed:** plants in tilled soil.

Gathering (axe and pickaxe) works on any island outside a port's town. Shaping and
farming need a claim.

**Camps** (`land/structures.ts`):
- **Claims.** A campfire (5 timber) claims everything within 32 voxels of it.
  Nothing else can be built without one, and nothing at all within 80 of a port's
  berth.
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
| Sugar cane | cane cuttings | 3 min | 2 sugar |
| Tobacco | tobacco seed | 4 min | 2 tobacco |
| Pepper | pepper seed | 5 min | 1 spice |

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

## 10. Ship art: MagicaVoxel authoring guide

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

## 11. Simulation, physics and time

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
the `Sea`), with systems as functions called in a fixed order each tick. An ECS
library is only worth adopting once NPC automation (Phase 6) brings many
cross-cutting queries.

**Off-screen islands.** Bases keep producing while you sail. Distant islands run a
coarse *ledger* simulation (rates × elapsed game time, capped by storage and
workers) instead of simulating every NPC. On return, NPCs and crops are placed
consistently with the ledger.

**Saves** (Phase 5): the seed, the edited chunks (run-length encoded) and the sim
state as JSON, in IndexedDB (§9).

## 12. Module map

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
  economy/             goods and cargo, markets, reputation, contracts, the price
                       book, the shipyard, the captain; Economy ties them together
  DuelScene.ts         runs a duel from boarding to verdict (sim + presentation)
  worldgen/            seeded noise, island generator, archipelago plan, harbours
  ocean/               waves.ts (CPU + GLSL twin), SeabedMap
  render/              CameraRig, Sun, ChunkRenderer, OceanRenderer, FleetView,
                       ShipView, ShotsView, BarrelsView, RangeArcs, Effects,
                       Wake, WindStreaks, voxelGeometry, DuelView, CharacterView,
                       LandView (the captain on foot, tool marker, build ghost),
                       toolModels
  land/                on foot: the walker, tools, camps and buildings, crops
  save/                save format, IndexedDB slots, chunk run-length encoding
  Shore.ts             the captain on foot: controls to land orders, the view and HUD
  ui/                  Hud (help, compass, combat panel, prompts, messages),
                       ShipLabels (name tags over ships), DuelHud; Overlay and
                       menuNav (React menus, controller focus), port/ (the port
                       screen and its tabs), ChartView / ChartScreen, FootHud,
                       WorldLabels (signs), BuildMenu, StoreScreen, SystemMenu
  util/                hash, small math helpers
scripts/               asset generators (placeholder ships, captains via Tripo,
                       voxelizer) and the duel balance harness
  assetgen/            prompt → art via ComfyUI: pixel textures, sprites, icons,
                       HD materials, .vox models (see its README)
public/models/         ship and character .vox files
```

`voxel`, `vox`, `sailing`, `combat`, `duel`, `economy`, `land`, `save`, `worldgen`, `ocean` and `core` are unit-tested (`*.test.ts`
next to the code). The browser-bound `Input`, `GameLoop` and the React menus are
verified in the running game. None of those directories import from `render`,
`tools`, `ui` or three.js. Only `Game.ts` knows about everything.

## 13. Roadmap (proposed)

1. ✅ **Foundation:** loop, camera, voxel chunks + mesher, ocean, island, dig/place.
2. ✅ **Sailing:** ship handling, regional weather, grounding, `.vox` ships, gamepad, wake and wind streaks.
3. ✅ **Naval combat:** broadsides, three shot types, damage and surrender, boarding, merchant barrels, AI captains, regional encounters and convoys.
   - ✅ **3b. Captains' duel:** side-view sword fight on deck (parries with a cue, blocks, rolls, kicks, red thrusts), Tripo-generated voxel captains, jail and plunder.
4. ✅ **Ports & economy:** a seeded five-port archipelago with harbours and towns; supply-and-demand markets, the price book and rumours; freight, bounties and smuggling; reputation with three factions and a fixer; shipyard refits and ships; crew hiring; the chart; React menus driven by keyboard or controller.
5. ✅ **On foot & camps:** walking ashore anywhere and around ports (signed doors, graded roads); axe, pickaxe, shovel and hoe; campfire claims; huts, storehouses, fences, paths, torches; sugar cane, tobacco and pepper; timber, stone and seed as trade goods; a cutaway view; autosave and named saves.
6. **Crews & production:** hands who work your camps (job system, voxel-surface pathfinding), production chains, the off-screen ledger, day and night.
7. **Treasure hunting:** hand-drawn-style maps of real terrain, riddles generated from landmarks, dig sites.
8. **Story:** the opening (orphaned, adopted by a merchant captain, the Imperial attack), the black flag, the revenge arc.
