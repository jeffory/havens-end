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

## Controls (Phase 2: sailing)

| Action | Keyboard | Gamepad |
|---|---|---|
| Steer | A / D, ← / → | Left stick, d-pad ← → |
| Sails up / down (furled, half, full) | W / S, ↑ / ↓ | D-pad ↑ ↓, Y / A |
| Turn the view 90° | Q / E | LB / RB |
| Zoom | Mouse wheel | Right stick ↕ |
| Dig / place a voxel | Left / right click | |
| Performance readout | F3 | |

Sail with the wind on your beam or quarter; you can't sail straight into it. Water
shallower than your draft runs you aground; turn away to get off. Squalls blow hard
and shift, and calms leave you drifting.

In dev builds the running game is exposed as `game` in the browser console,
e.g. `game.ship` or `game.weather.windAt(0, 0, 0)`.

## Ship art

Ships are MagicaVoxel `.vox` files in `public/models/ships/`. The authoring
conventions (axes, naming the `hull` / `sail` / `flag` objects) are in
[docs/ARCHITECTURE.md §6](docs/ARCHITECTURE.md#6-ship-art-magicavoxel-authoring-guide).

## Docs

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the stack decisions, world
model, voxel/ocean/sailing pipelines, simulation rules and roadmap.
