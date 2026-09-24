# assetgen: prompts to game-ready art

`npm run asset` turns short descriptions into finished assets for Haven's End. It runs
them through a ComfyUI server, mixing paid partner models (Nano Banana Pro, FLUX.2,
GPT Image, Tripo 3D) with free models on the server's GPU (FLUX.2 Klein, SDXL,
BiRefNet, Deep Bump). Generation is only half the job.
The tool also turns "AI pixel art" into true pixel art, makes textures tile, cuts out
sprites, and voxelizes 3D models.

## Setup

1. `npm install` (the tool needs `sharp` and Node 20.12 or newer).
2. Copy `.env.example` to `.env` at the repo root (it's gitignored) and fill it in:
   - `COMFY_URL`: your ComfyUI server. Leave it out for ComfyUI's default,
     `http://127.0.0.1:8188`.
   - `COMFY_API_KEY`: a Comfy platform API key, from
     https://platform.comfy.org/profile/api-keys. Without it only the free local
     models work. Logging in to the ComfyUI web page doesn't help: scripts need the
     key.
3. `npm run asset -- doctor` checks the server, nodes, models and key.

## The loop: generate, look, pick

```sh
npm run asset -- gen block sand="pale beach sand with a few tiny shells" dirt="rich brown dirt"
#  → candidates in .assetgen/candidates/block/<name>/<n>/ and a contact sheet in .assetgen/sheets/
npm run asset -- pick sand 3
#  → public/textures/blocks/sand.png, recorded in scripts/assetgen/assets.json as "block/sand"
```

Assets are identified as `recipe/name`, so a `block/deck` and a `material/deck` can both
exist. A plain name works wherever it's unambiguous; otherwise the tool asks which one.

- Open the contact sheet to choose. Textures are shown tiled 3×3, so seams show.
  Captions carry notes: `seam x/y` (about 1 is invisible, above 3 is a visible seam),
  `busy` (more detail than the size can hold), and whether a seam was repaired.
- Each candidate folder keeps its raw model output and `meta.json`: full prompt,
  model, seed and options.
- `--variants N` makes more candidates. Later runs keep numbering after earlier ones,
  so nothing is overwritten.
- `pick` installs the files and records the recipe, prompt, model, seed and options
  in `assets.json`. A re-pick replaces the previous files; for example, picking a
  material without maps removes the old maps.
- `build <name…>` (or `build --all`) regenerates recorded assets as new candidates.
  This is not an exact replay. Partner models don't promise identical output for a
  seed, and blocks and icons are regenerated on their own rather than in their
  original atlas or sheet.
- `list` shows picked assets and pending candidates.
- Every run first prints how many paid calls it will make. A run of more than 8 needs
  `--yes`. Seam repairs can add a few more calls.
- Nothing paid for is lost. Every graph sent to ComfyUI is saved to
  `.assetgen/graphs/`; drop one into the ComfyUI page to open that run in the node
  editor. Every downloaded output, including the partial outputs of a failed run, is
  saved to `.assetgen/raw/` before any local processing. If one item or variant fails,
  the others are still saved.

## Recipes

`npm run asset -- help <recipe>` lists every option and its default.

| Recipe | What you get | Installs to | Default model |
|---|---|---|---|
| `block` | 16 px (or `--size 32`) tileable block face textures. Nine cells per generation: all your blocks in one image so they match, with spare cells used for extra variations. `--tile x` for side faces that only tile left to right. With Nano Banana, a cell whose seam shows is redrawn by Nano Banana (one extra paid call each; `--repair never` to skip). | `public/textures/blocks/<name>.png`, plus `atlas.png` / `atlas.json` repacked on every pick | nano-banana-pro |
| `pattern` | Per-voxel colour patterns: 1 px = 1 voxel (default 32×32), tileable. `--block sand` tints the average to that block's colour in `src/voxel/blocks.ts`, so the game can paint terrain by world position without textures. | `public/textures/patterns/` | nano-banana-pro |
| `sprite` | Characters and props as pixel art with a transparent background, `--height` px tall. `--ref a.png,b.png` passes reference images for a consistent character or style. | `public/sprites/` | nano-banana-pro |
| `icons` | Up to 16 inventory or UI icons drawn together in one square sheet (2×2, 3×3 or 4×4, so they match), with spare cells used for extra variations. Sliced into `--size` px squares with one shared palette. | `public/sprites/icons/` | nano-banana-pro |
| `material` | HD seamless textures: `color.png` plus `normal.png` and `height.png` (Deep Bump). Seams are repaired by default. | `public/textures/materials/<name>/` | flux-2-max |
| `vox` | Concept art, then a textured 3D model (Tripo v3.1), then a MagicaVoxel `.vox` of `--height` voxels with a `--colors` palette. It is shrunk if any axis would pass MagicaVoxel's 256. `--image my.png` starts from your own drawing. `--glb model.glb` re-voxelizes a model you already have (a candidate's `model.glb` or one in `.assetgen/raw/`) for free, e.g. at another height. Takes about 3 minutes. | `public/models/props/<name>.vox` | nano-banana-pro (concept) |

Items are written `name="description"`. Names become file names, so use letters,
digits, `_` and `-`. Recipes add the art direction themselves: the shared look lives
in `style.ts`, so describe only the thing.

## Models

`--model` picks the generator. `npm run asset -- help` lists all of them.

| Model | Cost | Best for |
|---|---|---|
| `nano-banana-pro` | paid | Pixel art, sprites, icons, block atlases: the best at following layout and pixel-scale instructions |
| `nano-banana-2` | paid, cheaper | Drafts of the above |
| `gpt-image-2` | paid | Detailed sprites (slow) |
| `seedream-4.5` | paid | Painterly, high-resolution images |
| `flux-2-max` / `flux-2-pro` | paid | Realistic HD materials |
| `klein` | free (local GPU, about 15 s) | Drafts of anything; also the seam-repair inpainter |
| `sdxl-seamless` | free (local GPU) | Truly seamless (circular padding) but plainer textures |

The `vox` recipe always spends Tripo credits for the 3D step.

## How the pieces work

- **True pixel art.** Diffusion "pixel art" has soft, off-grid pixels, and its grid
  can't be detected reliably. Each output pixel therefore takes a k-means cluster of
  its source cell, and a k-means palette follows. There are two cluster rules
  (`--downscale`):
  - `dominant` (sprites, icons): the biggest cluster wins. Clean and flat.
  - `detail` (blocks, patterns): a strongly contrasting cluster covering at least a
    fifth of the cell wins, darker first. Mortar lines, plank gaps and specks survive.
- **Seamless textures.** A texture is rolled by half so its wrap seams meet in a cross
  at the centre. A feathered band over the cross is then repainted, and the result is
  composited at the texture's own size, so nothing outside the band changes. Pixel
  textures (blocks, patterns) are redrawn by the generating model when it can edit
  images, since Nano Banana keeps its own pixel style; otherwise FLUX.2 Klein inpaints
  on the local GPU. HD materials always use Klein, which is free and good at photo
  textures. `--repair auto` only repairs when the seam score says a seam shows. If a
  repair fails, the unrepaired texture is kept with a note.
- **Cutouts.** BiRefNet (local) masks the subject; the tool crops, scales and
  hardens the alpha.
- **Same results as the web page.** The ComfyUI page always sends every widget value,
  but API calls send only what you set, and some custom nodes break on a missing
  input (BiRefNet, Deep Bump). The client fetches each node's schema from
  `/object_info` and fills in the declared defaults before submitting.
- **Voxels.** The Tripo GLB is parsed by `voxel/glb.ts` and sampled triangle by
  triangle at half-voxel spacing, with each voxel averaging its texture colour.
  Axes change from glTF Y-up to MagicaVoxel Z-up. `--turns` rotates the model in
  quarter turns: Tripo models face +x, so the default of 1 turns them to face the
  viewer (−y).

## Layout

```
scripts/assetgen/
  cli.ts, args.ts     commands, argument parsing and validation, spend summary
  env.ts              .env loading, server URL, paths relative to where you ran npm
  recording.ts        saves every graph and downloaded output under .assetgen/
  style.ts            art direction and prompt builders
  store.ts            candidates, contact sheets, pick, manifest, block atlas
  assets.json         provenance of every picked asset (commit this)
  comfy/              HTTP client (fills widget defaults), graph builder, model registry, pipeline graphs
  image/              raster ops: pixelate, palette, seams, grid slicing, compose, sheets
  voxel/              GLB reader, voxelizer, .vox packing, isometric preview
  recipes/            block, pattern, sprite, icons, material, vox
.assetgen/            candidates, sheets, graphs, raw outputs (gitignored)
```

Everything under `image/` and `voxel/`, plus the recipes, client and CLI parsing, is
unit-tested with Vitest (`npm test`). The recipe tests run against a stub ComfyUI, so
they cost nothing.

## Troubleshooting

- **"Unauthorized: Please login first"**: `COMFY_API_KEY` is missing or wrong.
- **A run failed after a paid step**: its outputs are in `.assetgen/raw/`. For a vox
  run, pass the saved `.glb` to `--glb` to voxelize it without paying again.
- **"Lost contact while submitting"**: the job may be queued anyway. Look at the
  ComfyUI queue before running it again, so you don't pay twice.
- **A node error**: the message names the failing node. `doctor` lists missing nodes
  and models.
- **A texture looks flat**: try `--downscale detail`, `--size 32`, or more variants.
- **A 3D model faces the wrong way**: `--turns 0…3`.
- **The server's PixelOE node is broken** (a missing Python module). assetgen does
  its pixel work locally, so it doesn't use it.
