import { isModelId, MODELS, type ModelId } from './comfy/models';
import { isRecipeId, RECIPES } from './recipes';
import type { FlagSpec, FlagValue, Item, RecipeId } from './recipes/types';

export type Command =
  | { command: 'gen'; recipe: RecipeId; items: Item[]; model: ModelId; variants: number; seed: number; flags: Record<string, FlagValue>; yes: boolean }
  | { command: 'pick'; name: string; variant: number }
  | { command: 'build'; names: string[]; all: boolean; yes: boolean }
  | { command: 'list' }
  | { command: 'doctor' }
  | { command: 'help'; topic?: string };

const NAME = /^[a-z0-9][a-z0-9_-]*$/i;
const MAX_VARIANTS = 20;

export function parseArgs(argv: string[]): Command {
  const [command, ...rest] = argv;
  switch (command) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      return rest[0] ? { command: 'help', topic: rest[0] } : { command: 'help' };
    case 'gen':
      return parseGen(rest);
    case 'pick': {
      const [name, variant = '1'] = rest;
      if (!name) throw new Error('Usage: pick <name> [variant]');
      return { command: 'pick', name, variant: intFlag('variant', variant, {}) };
    }
    case 'build': {
      const names = rest.filter((a) => !a.startsWith('--'));
      const all = rest.includes('--all');
      if (!all && names.length === 0) throw new Error('build regenerates picked assets and spends credits: give their names, or --all for every one');
      return { command: 'build', names, all, yes: rest.includes('--yes') };
    }
    case 'list':
      return { command: 'list' };
    case 'doctor':
      return { command: 'doctor' };
    default:
      throw new Error(`Unknown command "${command}"; commands: gen, pick, build, list, doctor, help`);
  }
}

function parseGen(args: string[]): Command {
  const [recipeId, ...rest] = args;
  if (!recipeId || !isRecipeId(recipeId)) {
    throw new Error(`Unknown recipe "${recipeId ?? ''}"; recipes: ${Object.keys(RECIPES).join(', ')}`);
  }
  const recipe = RECIPES[recipeId];
  const flags: Record<string, FlagValue> = Object.fromEntries(Object.entries(recipe.flags).map(([k, f]) => [k, f.default]));
  const items: Item[] = [];
  let model: ModelId = recipe.defaultModel;
  let variants = 1;
  let seed = Math.floor(Math.random() * 1_000_000_000);
  let yes = false;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = arg.slice(0, eq);
      const prompt = arg.slice(eq + 1).trim();
      if (eq < 1 || !NAME.test(name) || !prompt) throw new Error(`Items are written name="prompt" (name: letters, digits, _ or -); got: ${arg}`);
      if (items.some((it) => it.name === name)) throw new Error(`The item name "${name}" is given twice`);
      items.push({ name, prompt });
      continue;
    }
    let key = arg.slice(2);
    let value: string | undefined;
    if (key.includes('=')) [key, value] = [key.slice(0, key.indexOf('=')), key.slice(key.indexOf('=') + 1)];
    const takeValue = () => {
      if (value !== undefined) return value;
      const next = rest[++i];
      if (next === undefined) throw new Error(`--${key} needs a value`);
      return next;
    };

    if (key === 'model') {
      const m = takeValue();
      if (!isModelId(m)) throw new Error(`Unknown model "${m}"; models: ${Object.keys(MODELS).join(', ')}`);
      model = m;
    } else if (key === 'variants') {
      variants = intFlag('variants', takeValue(), { max: MAX_VARIANTS });
    } else if (key === 'seed') {
      seed = intFlag('seed', takeValue(), { min: 0 });
    } else if (key === 'yes') {
      yes = true;
    } else if (key.startsWith('no-') && typeof recipe.flags[key.slice(3)]?.default === 'boolean') {
      flags[key.slice(3)] = false;
    } else if (recipe.flags[key]) {
      const spec = recipe.flags[key];
      if (typeof spec.default === 'boolean') {
        // --maps, --maps=false, or --maps false
        if (value === undefined && (rest[i + 1] === 'true' || rest[i + 1] === 'false')) value = rest[++i];
        flags[key] = value === undefined ? true : value !== 'false';
      } else if (typeof spec.default === 'number') {
        flags[key] = intFlag(key, takeValue(), spec);
      } else {
        flags[key] = choiceFlag(key, takeValue(), spec);
      }
    } else {
      const known = ['model', 'variants', 'seed', 'yes', ...Object.keys(recipe.flags)];
      throw new Error(`Unknown option --${key} for ${recipeId} (did you mean --${closest(key, known)}?)`);
    }
  }
  if (items.length === 0) throw new Error(`Give at least one item, e.g. ${recipeId} sand="pale beach sand with tiny shells"`);
  return { command: 'gen', recipe: recipeId, items, model, variants, seed, flags, yes };
}

function intFlag(name: string, s: string, { min = 1, max }: Pick<FlagSpec, 'min' | 'max'>): number {
  const n = Number(s);
  const range = max === undefined ? `${min} or more` : `${min} to ${max}`;
  if (!Number.isInteger(n) || n < min || (max !== undefined && n > max)) throw new Error(`--${name} must be a whole number, ${range}; got "${s}"`);
  return n;
}

function choiceFlag(name: string, s: string, spec: FlagSpec): string {
  if (!spec.choices || spec.choices.includes(s)) return s;
  throw new Error(`--${name} "${s}" is not one of ${spec.choices.join(', ')} (did you mean ${closest(s, spec.choices)}?)`);
}

function closest(word: string, options: string[]): string {
  return options.reduce((best, o) => (distance(o, word) < distance(best, word) ? o : best));
}

/** Levenshtein distance, for "did you mean" suggestions. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}
