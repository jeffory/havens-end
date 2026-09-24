# Asset generation tooling (assetgen): design

Date: 2026-09-24. Status: approved; building on branch `asset-tooling`.

## Goal

A command-line tool that turns prompts into finished, game-ready art for Haven's End,
using the user's self-hosted ComfyUI (its address set as `COMFY_URL` in `.env`). It mixes free
local models with paid partner models, aiming at "Higgsfield-level" quality. Candidates
are picked by a human.

What the user asked for (2026-09-24):
- voxel textures in three senses: block face textures, per-voxel colour patterns, and
  concept art → MagicaVoxel `.vox` models;
- pixel-art sprites and icons;
- HD seamless materials.

Out of scope: making the game render block textures or patterns (mesher/renderer work
belongs to the game's phases).

## Research findings that shaped the design

- Partner nodes on the self-hosted server need `extra_data.api_key_comfy_org`. A
  browser login does not reach scripts. The key lives in the gitignored `.env`.
- Nano Banana Pro gives the best pixel sprites and 16×16 block atlases: it draws all
  nine blocks of a 3×3 atlas in one call and one style. FLUX.2 Max gives the best HD
  material, but not seamless.
- FLUX.2 Klein 4B (local, about 15 s) is good for drafts and for the seam-repair pass:
  roll the image by half, then inpaint a feathered cross with differential diffusion.
- SDXL with `Model Patch Seamless (mtb)` gives truly seamless, plainer drafts for free.
- Diffusion "pixel art" has no consistent pixel grid, so grid detection is unreliable.
  Downscale to a chosen size with k-centroid (dominant cluster per cell), then apply a
  k-means palette.
- The server's PixelOE node is broken, so all pixel processing happens client-side.

## Architecture

TypeScript under `scripts/assetgen/`, run with `npm run asset -- <command>` (tsx).

| Module | Responsibility |
|---|---|
| `env.ts` | Loads `.env`; `COMFY_URL` (default ComfyUI's local `http://127.0.0.1:8188`), `COMFY_API_KEY` |
| `comfy/graph.ts` | Tiny builder for ComfyUI API-format graphs |
| `comfy/client.ts` | Upload, submit (with the key), poll history, download outputs, surface node errors |
| `comfy/pipelines.ts` | Graph builders: text-to-image per model, seam repair, background removal, normal/height, upscale, image→3D |
| `comfy/models.ts` | Model registry: `nano-banana-pro`, `gpt-image-2`, `seedream-4.5`, `flux-2-max`, `klein`, `sdxl-seamless` |
| `image/*` | Pure raster ops: k-centroid, palette, seams, grid slicing, alpha, contact sheets; PNG I/O via sharp |
| `voxel/*` | Pure: GLB parse, surface voxelizer, palette → `.vox` (reuses `src/vox/writeVox.ts`) |
| `recipes/*` | `block`, `pattern`, `sprite`, `icons`, `material`, `vox` |
| `style.ts` | Shared art direction and per-recipe prompt rules |
| `store.ts` | Candidates, contact sheets, `pick`, and `scripts/assetgen/assets.json` (recipe, prompt, model, seed and options of every shipped asset, keyed `recipe/name`) |
| `recording.ts` | Saves every submitted graph and every downloaded output (even from failed runs) under `.assetgen/` before local processing |
| `cli.ts`, `args.ts` | `gen`, `pick`, `build`, `list`, `doctor`; flag validation; paid-call summary (more than 8 needs `--yes`) |

### Recipes

| Recipe | Pipeline | Output |
|---|---|---|
| block | Atlas prompt (up to 3×3 blocks per call) → slice → optional seam repair → k-centroid to 16/32 px → palette | `public/textures/blocks/<name>.png` |
| pattern | Top-down pattern → seam repair → k-centroid to N×N (1 px = 1 voxel) → palette → tint to a block's colour | `public/textures/patterns/<name>.png` |
| sprite | Prompt on flat white → BiRefNet mask → k-centroid to target height → palette → hard alpha | `public/sprites/<name>.png` |
| icons | Square icon grid (spare cells hold extra takes) → BiRefNet → slice → sprite pipeline per cell, one palette | `public/sprites/icons/<name>.png` |
| material | FLUX.2 Max (default) → seam repair → Deep Bump normal and height | `public/textures/materials/<name>/{color,normal,height}.png` |
| vox | Concept image (generated or supplied) → Tripo v3.1 image→3D GLB → voxelize to N tall → palette | `public/models/props/<name>.vox` |

### Flow

`gen <recipe> <name> --prompt … [--variants N]` writes candidates to
`.assetgen/candidates/<recipe>/<name>/<i>/` along with `meta.json`, the raw model output, and a
contact sheet (textures are shown tiled 3×3). `pick <name> <i>` copies the chosen
candidate into `public/` and records its spec in the manifest. `build <names…>` or `build --all`
regenerates from the manifest.

### Errors

- A ComfyUI `execution_error` is thrown with the node type and message, and the run fails fast.
- A missing key only blocks partner models.
- HTTP calls have timeouts and one retry on a network error.

## Testing

Vitest covers every pure module with synthetic rasters and a synthetic GLB, plus the
graph builders and client response parsing. Live ComfyUI behaviour is checked with
`doctor` and one smoke generation per recipe.

## Build order

1. Pure raster ops.
2. Comfy client and graphs.
3. Recipes block, sprite, icons, pattern, material.
4. GLB, voxelizer, vox recipe.
5. CLI.
6. Docs, then live smoke runs.

## Changes after review (2026-09-24)

An independent code review, plus live smoke runs on the server, led to the following:

- Paid outputs are persisted the moment they are downloaded (`.assetgen/raw/`), recipes
  keep sibling results when one job fails (`collect`), and seam repairs are optional
  steps whose failure keeps the unrepaired texture.
- The client never retries `POST /prompt`, since a lost response may mean the job is
  already queued and billed. It polls through 5xx responses and dropped connections,
  times every request out, returns partial outputs of a failed run, and fills omitted
  widget inputs from `/object_info` defaults, because some custom nodes crash without
  them.
- Seam repair composites at native resolution.
- Flags declare choices and bounds.
- `vox` seeds Tripo per variant, shrinks to 256 per axis, and gains `--glb`.
- Icons and blocks always use square grids. On square images, models draw square grids
  whatever they are asked.
