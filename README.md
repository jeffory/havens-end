# Haven's End

A 2.5D voxel pirate RPG in Three.js: naval freedom in the spirit of *Pirates!*,
with island base building you dig and shape yourself.

## Run

```sh
npm install
npm run dev                    # http://localhost:5173
npm test                       # unit tests for the simulation core
npm run build                  # typecheck + production bundle in dist/
npm run make:placeholder-ship  # regenerate the placeholder sloop and brig
npm run duel:balance           # win rates of a scripted player vs each enemy captain

# Captain art (needs COMFY_API_KEY in .env, and the Python venv:
#   python3 -m venv --system-site-packages .venv && .venv/bin/pip install trimesh)
npm run characters:generate    # Tripo via ComfyUI -> art-source/characters/*.glb
npm run characters:voxelize    # -> public/models/characters/*.vox
```

## Controls (Phase 5: on foot and camps)

| Action | Keyboard | Gamepad |
|---|---|---|
| Steer | A / D, ← / → | Left stick, d-pad ← → |
| Sails up / down (furled, half, full) | W / S, ↑ / ↓ | D-pad ↑ ↓, Y / A |
| Fire port / starboard broadside | Q / E | LT / RT |
| Round / chain / grape shot | 1 / 2 / 3 (R cycles) | X cycles |
| Board a ship alongside / dock in a harbour / row ashore | B | B |
| Sea chart | M | View (Back) |
| **Menus:** move / choose | arrows or WASD / Enter | d-pad or left stick / A |
| **Menus:** switch place / back | Q / E, Esc | LB / RB, B |
| Game menu: save, load, new game | Esc | Start |
| **On foot:** walk | WASD / arrows | Left stick |
| **On foot:** use what's in hand / interact | Space or left click / E | X / A |
| **On foot:** axe, pickaxe, shovel, hoe, seed | 1–7, or Q / R to cycle | LB / RB |
| **On foot:** build (Q / R turns a building) | B | Y |
| **Duel:** move | A / D | Left stick |
| **Duel:** cut / heavy / thrust / kick | J / K / U / I (left click cuts) | X / Y / RB / B |
| **Duel:** block, tap to parry | hold L or right mouse | LB or LT |
| **Duel:** roll | Space | A |
| Turn the view 90° | Z / C | LB / RB |
| Zoom | Mouse wheel | Right stick ↕ |
| Dig / place a voxel | Left / right click | |
| Performance readout | F3 | |

Sail with the wind on your beam or quarter; you can't sail straight into it. Water
shallower than your draft runs you aground; turn away to get off. Squalls blow hard
and shift, and calms leave you drifting.

Guns fire straight out of the side; the dots on the water show where they reach.
Round shot sinks ships, chain shot slows them, and grapeshot thins their crews until
they strike their colours. Then come alongside and board. Merchants run, and drop
powder kegs behind them. The further from home you sail, the more warships there
are, and merchants travel in escorted convoys.

The archipelago has five ports: Haven (home, a free port), a second free port, a
pirate haven and two Imperial ports, with the Imperial capital furthest out. Come
into a harbour slowly and press B to go ashore. Each port has a **market** (buy
cheap where a good is produced, sell dear where it's wanted; prices move as you
trade and recover over minutes), a **shipyard** (repairs, refits, new ships in
part-exchange), a **tavern** (sailors for hire, gossip about prices elsewhere for the
price of a round, and a **fixer** who'll mend your name with any faction for gold,
or offer a smuggling run), and the port's **governor** (or guildhall, or pirate lord)
with freight and bounty jobs. Your price book remembers every price you've seen or
heard; the chart (M) shows where everything is and the best runs you know of.

**Reputation:** firing first on a ship, sinking her or taking her changes how every
flag sees you. Outlaws are hunted by Imperial warships; a bad name raises prices and,
at rock bottom, closes a faction's ports. Pirates leave their friends alone, and
merchants stop running from captains they trust. Pirate havens take almost anyone.
Muskets are contraband in Imperial ports: the tavern's back room pays well for them,
but customs officers search holds.

**On foot.** Dock in a port and you step off onto the pier: walk up to a door (the
signs say which is the market, tavern, governor and shipyard) to go in. Anywhere else,
bring the ship close to a beach, slow down and press B to row ashore; she waits at
anchor. The axe fells trees for timber and the pickaxe breaks stone, on any island.
**Build a campfire** (5 timber) to claim the land around it; then you can build huts,
storehouses, fences, paths and torches, reshape the ground with the shovel, and farm:
till with the hoe and plant cane cuttings, tobacco or pepper seed (sold in every port)
for sugar, tobacco and spice to sell. Building draws on your pack, storehouses nearby
and the ship's hold. Rest at a fire or in a hut to save; the game also autosaves every
few minutes and when you dock, and Esc opens the menu for named saves.

Board a ship that hasn't struck and her captain fights you on deck. Watch the ring on
their blade: white can be blocked, and tapped block **as it turns gold** is a parry;
red can only be dodged with a roll. Kicks break a raised guard. Win and she's yours,
with her gold and cargo. Lose and you're jailed: a 30% fine, your hold emptied, and
back to the last port.

In dev builds the running game is exposed as `game` in the browser console,
e.g. `game.ship`, `game.sea.vessels` or `game.weather.windAt(0, 0, 0)`.

## Ship art

Ships are MagicaVoxel `.vox` files in `public/models/ships/`. The authoring
conventions (axes, naming the `hull` / `sail` / `flag` objects) are in
[docs/ARCHITECTURE.md §10](docs/ARCHITECTURE.md#10-ship-art-magicavoxel-authoring-guide).

## Generated art

`npm run asset` generates pixel-art block textures, voxel colour patterns, sprites,
icons, HD materials and `.vox` props through the ComfyUI server. It needs
`COMFY_API_KEY` in `.env` for the paid models. See
[scripts/assetgen/README.md](scripts/assetgen/README.md).

## Docs

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the stack decisions, world
model, voxel/ocean/sailing/combat/duel pipelines, ports and the economy, going ashore, camps and saves, the character art pipeline, simulation rules and roadmap.
