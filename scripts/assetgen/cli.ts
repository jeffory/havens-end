/**
 * assetgen: prompt → game-ready art through the ComfyUI server.
 * Run `npm run asset -- help` for commands, recipes and models.
 */
import { join } from 'node:path';
import { parseArgs } from './args';
import { ComfyClient } from './comfy/client';
import { MODELS, type ModelId } from './comfy/models';
import { comfyConfig, loadEnv, ROOT } from './env';
import { RECIPES } from './recipes';
import type { FlagValue, Item, RecipeId } from './recipes/types';
import { recordingClient } from './recording';
import { resolveId, Store } from './store';

/** Runs making more paid calls than this need --yes. */
const CONFIRM_ABOVE = 8;

async function main(argv: string[]): Promise<void> {
  loadEnv();
  const cmd = parseArgs(argv);
  const store = new Store(ROOT);
  switch (cmd.command) {
    case 'help':
      return printHelp(cmd.topic);
    case 'gen':
      return generate(store, cmd.recipe, cmd.items, { model: cmd.model, seed: cmd.seed, variants: cmd.variants, flags: cmd.flags }, cmd.yes);
    case 'pick': {
      const { installed, warnings } = await store.pick(cmd.name, cmd.variant);
      console.log(`Picked ${cmd.name} #${cmd.variant}:`);
      for (const path of installed) console.log(`  ${path}`);
      for (const warning of warnings) console.log(`  warning: ${warning}`);
      console.log('Recorded in scripts/assetgen/assets.json.');
      return;
    }
    case 'build':
      return rebuild(store, cmd.names, cmd.yes);
    case 'list':
      return list(store);
    case 'doctor':
      return doctor();
  }
}

interface RunOptions {
  model: ModelId;
  seed: number;
  variants: number;
  flags: Record<string, FlagValue>;
}

async function generate(store: Store, recipeId: RecipeId, items: Item[], opts: RunOptions, yes: boolean): Promise<void> {
  const recipe = RECIPES[recipeId];
  const client = new ComfyClient(comfyConfig());
  const paid = recipe.paidCalls(items, opts);
  if (paid > 0 && !client.hasApiKey) {
    throw new Error(
      `This run uses paid partner models (${recipeId === 'vox' ? 'Tripo 3D' : opts.model}) and needs COMFY_API_KEY in .env ` +
        `(create one at https://platform.comfy.org/profile/api-keys).` +
        (recipeId === 'vox' ? '' : ' Free local alternative: --model klein.'),
    );
  }
  console.log(`${recipe.id}: ${items.length} item(s) × ${opts.variants} variant(s) with ${opts.model}, seed ${opts.seed}`);
  console.log(paid ? `  ${paid} paid call(s)${recipeId === 'vox' ? ' (Tripo counts as one)' : ''}, plus any seam repairs` : '  free: local models only');
  if (paid > CONFIRM_ABOVE && !yes) throw new Error(`That is more than ${CONFIRM_ABOVE} paid calls; add --yes to go ahead`);
  const started = Date.now();
  const log = (line: string) => console.log(`  ${line}`);
  const candidates = await recipe.generate(recordingClient(client, join(ROOT, '.assetgen'), log), items, opts, log);
  const { sheet, saved } = await store.saveRun(recipeId, opts, items, candidates);
  console.log(`\nDone in ${Math.round((Date.now() - started) / 1000)} s. Candidates:`);
  for (const [i, s] of saved.entries()) console.log(`  ${s.id} #${s.variant}  ${candidates[i].notes.join(', ')}  (${s.dir})`);
  console.log(`Contact sheet: ${sheet}`);
  console.log(`Pick one with: npm run asset -- pick <name> <variant>   (or <recipe>/<name> if the name is used by several recipes)`);
}

/** Regenerates manifest entries (the named ones, or all with --all) as new candidates. */
async function rebuild(store: Store, names: string[], yes: boolean): Promise<void> {
  const manifest = await store.manifest();
  const ids = names.length ? names.map((n) => resolveId(n, Object.keys(manifest), 'picked assets')) : Object.keys(manifest);
  if (ids.length === 0) throw new Error('Nothing picked yet: scripts/assetgen/assets.json is empty');
  const runs = ids.map((id) => {
    const entry = manifest[id];
    if (!entry) throw new Error(`"${id}" is not in scripts/assetgen/assets.json`);
    const items = [{ name: id.slice(id.indexOf('/') + 1), prompt: entry.prompt }];
    return { recipe: entry.recipe, items, opts: { model: entry.model, seed: entry.seed, variants: 1, flags: entry.flags } };
  });
  const paid = runs.reduce((n, r) => n + RECIPES[r.recipe].paidCalls(r.items, r.opts), 0);
  if (paid > CONFIRM_ABOVE && !yes) throw new Error(`Rebuilding ${ids.length} asset(s) makes ${paid} paid calls; add --yes to go ahead`);
  for (const run of runs) await generate(store, run.recipe, run.items, run.opts, true);
}

async function list(store: Store): Promise<void> {
  const manifest = await store.manifest();
  const candidates = await store.candidates();
  console.log('Picked assets (scripts/assetgen/assets.json):');
  for (const [id, e] of Object.entries(manifest)) console.log(`  ${id.padEnd(28)} ${e.model.padEnd(16)} ${e.files.join(', ')}`);
  if (Object.keys(manifest).length === 0) console.log('  (none yet)');
  console.log('\nCandidates (.assetgen/candidates):');
  for (const [id, variants] of Object.entries(candidates)) console.log(`  ${id.padEnd(28)} #${variants.join(', #')}`);
  if (Object.keys(candidates).length === 0) console.log('  (none yet)');
}

const REQUIRED_NODES = [
  'GeminiImage2Node', 'OpenAIGPTImage1', 'ByteDanceSeedreamNode', 'Flux2MaxImageNode', 'Flux2ProImageNode',
  'UNETLoader', 'CLIPLoader', 'EmptyFlux2LatentImage', 'Flux2Scheduler', 'SamplerCustomAdvanced', 'DifferentialDiffusion',
  'SetLatentNoiseMask', 'Model Patch Seamless (mtb)', 'Vae Decode (mtb)', 'BiRefNetRMBG', 'Deep Bump (mtb)',
  'TripoImageToModelNode', 'SaveGLB', 'ImageToMask', 'MaskToImage', 'ImageBatch', 'SplitImageWithAlpha',
];

const REQUIRED_MODELS: Array<[string, string]> = [
  ['diffusion_models', 'flux-2-klein-4b.safetensors'],
  ['text_encoders', 'qwen_3_4b.safetensors'],
  ['vae', 'flux2-vae.safetensors'],
  ['checkpoints', 'juggernautXL_ragnarokBy.safetensors'],
];

async function doctor(): Promise<void> {
  const { url, apiKey } = comfyConfig();
  const client = new ComfyClient({ url, apiKey });
  let problems = 0;
  const check = (ok: boolean, text: string) => {
    if (!ok) problems++;
    console.log(`${ok ? '✓' : '✗'} ${text}`);
  };

  const stats = await client.getJson<any>('/system_stats').catch((e: Error) => e);
  if (stats instanceof Error) {
    check(false, `ComfyUI at ${url} is not reachable: ${stats.message}`);
    process.exitCode = 1;
    return;
  }
  check(true, `ComfyUI ${stats.system?.comfyui_version} at ${url} (${stats.devices?.[0]?.name ?? 'no GPU reported'})`);
  check(Boolean(apiKey), apiKey ? 'COMFY_API_KEY is set (partner models enabled)' : 'COMFY_API_KEY missing in .env: only klein and sdxl-seamless will work');

  const info = await client.getJson<Record<string, unknown>>('/object_info');
  const missing = REQUIRED_NODES.filter((n) => !(n in info));
  check(missing.length === 0, missing.length ? `missing nodes: ${missing.join(', ')}` : `all ${REQUIRED_NODES.length} nodes present`);
  for (const [folder, file] of REQUIRED_MODELS) {
    const files = await client.getJson<string[]>(`/models/${folder}`).catch(() => [] as string[]);
    check(files.includes(file), `${folder}/${file}`);
  }
  console.log(problems ? `\n${problems} problem(s).` : '\nReady.');
  if (problems) process.exitCode = 1;
}

function printHelp(topic?: string): void {
  if (topic && topic in RECIPES) {
    const r = RECIPES[topic as RecipeId];
    console.log(`${r.id}: ${r.summary}\n  default model: ${r.defaultModel}\n  installs to:   ${r.installDir('<name>')}/\n\nOptions:`);
    for (const [k, f] of Object.entries(r.flags)) console.log(`  --${k.padEnd(9)} ${f.help} (default: ${JSON.stringify(f.default)})`);
    console.log('  --model     see `help` for the list\n  --variants  candidates per item (default 1)\n  --seed      fixed seed (default random)\n  --yes       allow runs of more than 8 paid calls');
    return;
  }
  console.log(`assetgen: prompt → game-ready art via ComfyUI (${comfyConfig().url})

Commands:
  gen <recipe> name="prompt"... [options]   make candidates in .assetgen/candidates/
  pick <name> [variant]                      install a candidate into public/ and record it
                                             (name, or recipe/name when several recipes use it)
  build <name...> | --all                    regenerate picked assets from scripts/assetgen/assets.json
  list                                       picked assets and pending candidates
  doctor                                     check the server, nodes, models and API key
  help [recipe]                              this help, or a recipe's options

Recipes:`);
  for (const r of Object.values(RECIPES)) console.log(`  ${r.id.padEnd(9)} ${r.summary}`);
  console.log('\nModels (--model):');
  for (const [id, m] of Object.entries(MODELS)) console.log(`  ${id.padEnd(16)} ${m.partner ? 'paid ' : 'free '} ${m.note}`);
  console.log(`
Examples:
  npm run asset -- gen block grass_top="lush tropical grass" sand="pale beach sand with tiny shells" --variants 2
  npm run asset -- gen block grass_side="grass fringe along the top edge over brown dirt" --tile x
  npm run asset -- gen sprite captain="pirate captain, red coat, tricorn hat, cutlass" --height 64
  npm run asset -- gen icons coin="gold doubloon" rum="rum bottle" map="treasure map scroll"
  npm run asset -- gen pattern sand_ripples="wind ripples in pale sand" --block sand
  npm run asset -- gen material deck="weathered oak ship deck planks, tar seams, iron nails"
  npm run asset -- gen vox chest="wooden treasure chest with iron bands and a gold lock" --height 24
  npm run asset -- pick sand 2`);
}

main(process.argv.slice(2)).catch((error: Error) => {
  console.error(`assetgen: ${error.message}`);
  process.exit(1);
});
