import { describe, expect, it } from 'vitest';
import { RECIPES } from '.';
import type { GenOptions, Recipe } from './types';

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `i${i}`, prompt: 'p' }));
const opts = (recipe: Recipe, over: Partial<GenOptions> = {}, flags: Record<string, string | number | boolean> = {}): GenOptions => ({
  model: recipe.defaultModel,
  seed: 1,
  variants: 1,
  ...over,
  flags: { ...Object.fromEntries(Object.entries(recipe.flags).map(([k, f]) => [k, f.default])), ...flags },
});

describe('paidCalls', () => {
  it('counts one paid generation per atlas or sheet for grouped recipes', () => {
    expect(RECIPES.block.paidCalls(items(10), opts(RECIPES.block, { variants: 2 }))).toBe(4); // 2 atlases × 2 runs
    expect(RECIPES.icons.paidCalls(items(5), opts(RECIPES.icons))).toBe(1);
  });

  it('counts nothing for local models', () => {
    expect(RECIPES.sprite.paidCalls(items(3), opts(RECIPES.sprite, { model: 'klein', variants: 4 }))).toBe(0);
  });

  it('counts Tripo for every vox model, plus the concept unless an image or GLB is supplied', () => {
    expect(RECIPES.vox.paidCalls(items(2), opts(RECIPES.vox, { variants: 2 }))).toBe(8);
    expect(RECIPES.vox.paidCalls(items(2), opts(RECIPES.vox, {}, { image: 'x.png' }))).toBe(2);
    expect(RECIPES.vox.paidCalls(items(2), opts(RECIPES.vox, {}, { glb: 'x.glb' }))).toBe(0);
  });
});
