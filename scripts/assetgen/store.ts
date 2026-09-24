import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModelId } from './comfy/models';
import { packAtlas } from './image/compose';
import { encodePng, readImage } from './image/io';
import { contactSheet } from './image/sheet';
import { RECIPES } from './recipes';
import type { Candidate, FlagValue, Item, RecipeId } from './recipes/types';

export interface CandidateMeta {
  recipe: RecipeId;
  name: string;
  variant: number;
  /** The short description given on the command line. */
  itemPrompt: string;
  /** The full prompt sent to the model. */
  prompt: string;
  model: ModelId;
  seed: number;
  flags: Record<string, FlagValue>;
  notes: string[];
  /** Files installed by `pick` (the rest of the folder is reference material). */
  files: string[];
  createdAt: string;
}

export interface ManifestEntry {
  recipe: RecipeId;
  prompt: string;
  model: ModelId;
  seed: number;
  flags: Record<string, FlagValue>;
  files: string[];
  pickedFrom: number;
  pickedAt: string;
}

export type Manifest = Record<string, ManifestEntry>;

const CANDIDATES = '.assetgen/candidates';
const SHEETS = '.assetgen/sheets';
const MANIFEST = 'scripts/assetgen/assets.json';
const BLOCKS = 'public/textures/blocks';

/**
 * Where generated assets live: candidates under .assetgen/ (gitignored), picked assets
 * under public/, and the provenance of every picked asset in scripts/assetgen/assets.json.
 */
export class Store {
  constructor(readonly root: string) {}

  /** Writes candidates (numbered after earlier ones of the same asset) and a contact sheet. */
  async saveRun(
    recipe: RecipeId,
    run: { model: ModelId; flags: Record<string, FlagValue> },
    items: Item[],
    candidates: Candidate[],
  ): Promise<{ sheet: string; saved: Array<{ id: string; variant: number; dir: string }> }> {
    const next = new Map<string, number>();
    const saved = [];
    const entries = [];
    for (const c of candidates) {
      const id = `${recipe}/${c.name}`;
      const variant = next.get(id) ?? (await this.lastVariant(id)) + 1;
      next.set(id, variant + 1);
      const dir = join(CANDIDATES, id, String(variant));
      await mkdir(join(this.root, dir), { recursive: true });
      for (const [file, bytes] of Object.entries({ ...c.extras, ...c.files })) await writeFile(join(this.root, dir, file), bytes);
      const meta: CandidateMeta = {
        recipe,
        name: c.name,
        variant,
        itemPrompt: items.find((i) => i.name === c.name)?.prompt ?? '',
        prompt: c.prompt,
        model: run.model,
        seed: c.seed,
        flags: run.flags,
        notes: c.notes,
        files: Object.keys(c.files),
        createdAt: new Date().toISOString(),
      };
      await writeFile(join(this.root, dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
      saved.push({ id, variant, dir });
      entries.push({ label: [`${c.name} #${variant}`, ...c.notes].join(' · '), image: c.preview });
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const sheet = join(SHEETS, `${stamp}-${recipe}.png`);
    await mkdir(join(this.root, SHEETS), { recursive: true });
    await writeFile(join(this.root, sheet), await contactSheet(entries, { cell: 256, columns: Math.min(4, Math.max(1, entries.length)) }));
    return { sheet, saved };
  }

  /**
   * Installs a candidate into public/ and records it in the manifest. `ref` is
   * "recipe/name", or just "name" when only one recipe has candidates of that name.
   */
  async pick(ref: string, variant: number): Promise<{ installed: string[]; warnings: string[] }> {
    const id = resolveId(ref, Object.keys(await this.candidates()), 'candidates');
    const dir = join(CANDIDATES, id, String(variant));
    let meta: CandidateMeta;
    try {
      meta = JSON.parse(await readFile(join(this.root, dir, 'meta.json'), 'utf8'));
    } catch {
      throw new Error(`${id} has no #${variant} (see ${join(CANDIDATES, id)}/)`);
    }
    const installDir = RECIPES[meta.recipe].installDir(meta.name);
    await mkdir(join(this.root, installDir), { recursive: true });
    const installed = [];
    for (const file of meta.files) {
      await copyFile(join(this.root, dir, file), join(this.root, installDir, file));
      installed.push(`${installDir}/${file}`);
    }

    const manifest = await this.manifest();
    // Files of the previous pick this one lacks (e.g. maps) would no longer match: remove them.
    for (const old of manifest[id]?.files ?? []) {
      if (!installed.includes(old)) await rm(join(this.root, old), { force: true });
    }
    manifest[id] = {
      recipe: meta.recipe,
      prompt: meta.itemPrompt,
      model: meta.model,
      seed: meta.seed,
      flags: meta.flags,
      files: installed,
      pickedFrom: variant,
      pickedAt: new Date().toISOString(),
    };
    const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
    await mkdir(join(this.root, 'scripts/assetgen'), { recursive: true });
    await writeFile(join(this.root, MANIFEST), `${JSON.stringify(sorted, null, 2)}\n`);

    const warnings: string[] = [];
    if (meta.recipe === 'block') {
      const atlas = await this.repackBlockAtlas();
      installed.push(...atlas.files);
      warnings.push(...atlas.warnings);
    }
    return { installed, warnings };
  }

  /** Picked assets by "recipe/name". */
  async manifest(): Promise<Manifest> {
    try {
      return JSON.parse(await readFile(join(this.root, MANIFEST), 'utf8'));
    } catch {
      return {};
    }
  }

  /** Candidate variants on disk, by "recipe/name". */
  async candidates(): Promise<Record<string, number[]>> {
    const out: Record<string, number[]> = {};
    for (const recipe of await safeReaddir(join(this.root, CANDIDATES))) {
      for (const name of await safeReaddir(join(this.root, CANDIDATES, recipe))) {
        const variants = (await safeReaddir(join(this.root, CANDIDATES, recipe, name))).map(Number).filter(Number.isInteger);
        out[`${recipe}/${name}`] = variants.sort((a, b) => a - b);
      }
    }
    return out;
  }

  /** Packs every block texture of the most common size into atlas.png + atlas.json for the renderer. */
  private async repackBlockAtlas(): Promise<{ files: string[]; warnings: string[] }> {
    const dir = join(this.root, BLOCKS);
    const names = (await safeReaddir(dir)).filter((f) => f.endsWith('.png') && f !== 'atlas.png').sort();
    const tiles = [];
    for (const file of names) tiles.push({ name: file.slice(0, -4), image: await readImage(join(dir, file)) });
    const counts = new Map<number, number>();
    for (const t of tiles) if (t.image.width === t.image.height) counts.set(t.image.width, (counts.get(t.image.width) ?? 0) + 1);
    const size = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
    const same = tiles.filter((t) => t.image.width === size && t.image.height === size);
    const left = tiles.filter((t) => !same.includes(t)).map((t) => `${t.name} (${t.image.width}×${t.image.height})`);
    const warnings = left.length ? [`block atlas is ${size} px; left out: ${left.join(', ')}`] : [];
    if (same.length === 0) return { files: [], warnings };
    const { image, layout } = packAtlas(same);
    await writeFile(join(dir, 'atlas.png'), await encodePng(image));
    await writeFile(join(dir, 'atlas.json'), `${JSON.stringify(layout, null, 2)}\n`);
    return { files: [`${BLOCKS}/atlas.png`, `${BLOCKS}/atlas.json`], warnings };
  }

  private async lastVariant(id: string): Promise<number> {
    const variants = (await safeReaddir(join(this.root, CANDIDATES, id))).map(Number).filter(Number.isInteger);
    return variants.length ? Math.max(...variants) : 0;
  }
}

/**
 * The "recipe/name" id `ref` stands for among `ids`: `ref` itself when qualified, else
 * the one id ending in "/ref". Ambiguous and unknown refs throw with the choices.
 */
export function resolveId(ref: string, ids: string[], what: string): string {
  if (ref.includes('/')) return ref;
  const matches = ids.filter((id) => id.endsWith(`/${ref}`));
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new Error(`No ${what} named "${ref}"`);
  throw new Error(`"${ref}" is ambiguous: ${matches.join(', ')}. Say which, e.g. ${matches[0]}`);
}

async function safeReaddir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}
