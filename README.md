# Haven's End

A 2.5D voxel pirate RPG in Three.js: naval freedom in the spirit of *Pirates!*,
with island base building you dig and shape yourself.

## Run

```sh
npm install
npm run dev                    # http://localhost:5173
npm test                       # unit tests for the simulation core
npm run build                  # typecheck + production bundle in dist/
npm run make:placeholder-ship  # regenerate public/models/ships/sloop.vox
```

## Controls (Phase 3: naval combat)

| Action | Keyboard | Gamepad |
|---|---|---|
| Steer | A / D, ← / → | Left stick, d-pad ← → |
| Sails up / down (furled, half, full) | W / S, ↑ / ↓ | D-pad ↑ ↓, Y / A |
| Fire port / starboard broadside | Q / E | LT / RT |
| Round / chain / grape shot | 1 / 2 / 3 (R cycles) | X cycles |
| Board a ship alongside | B | B |
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

In dev builds the running game is exposed as `game` in the browser console,
e.g. `game.ship`, `game.sea.vessels` or `game.weather.windAt(0, 0, 0)`.

## Ship art

Ships are MagicaVoxel `.vox` files in `public/models/ships/`. The authoring
conventions (axes, naming the `hull` / `sail` / `flag` objects) are in
[docs/ARCHITECTURE.md §7](docs/ARCHITECTURE.md#7-ship-art-magicavoxel-authoring-guide).

## Docs

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the stack decisions, world
model, voxel/ocean/sailing/combat pipelines, simulation rules and roadmap.
