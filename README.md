# Haven's End

A 2.5D voxel pirate RPG in Three.js: naval freedom in the spirit of *Pirates!*,
with island base building you dig and shape yourself.

## Run

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests for the simulation core
npm run build      # typecheck + production bundle in dist/
```

## Controls (Phase 1 sandbox)

| Input | Action |
|---|---|
| W A S D | move the camera focus (Shift = faster) |
| Q / E | rotate the view 90° |
| Mouse wheel | zoom |
| Left click | dig a voxel |
| Right click | place a dirt voxel |
| F3 | toggle the performance readout |

In dev builds the running game is exposed as `game` in the browser console,
e.g. `game.world.setVoxel(40, 20, 45, 5)`.

## Docs

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the stack decisions, world
model, voxel/ocean pipelines, simulation rules and roadmap.
