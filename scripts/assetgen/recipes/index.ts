import { block } from './block';
import { icons, sprite } from './sprites';
import { material, pattern } from './surfaces';
import type { Recipe, RecipeId } from './types';
import { vox } from './vox';

export const RECIPES: Record<RecipeId, Recipe> = { block, pattern, sprite, icons, material, vox };

export const isRecipeId = (s: string): s is RecipeId => s in RECIPES;
