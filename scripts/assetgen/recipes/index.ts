import { block } from './block';
import { illustration } from './illustration';
import { icons, sprite } from './sprites';
import { material, pattern } from './surfaces';
import type { Recipe, RecipeId } from './types';
import { vox } from './vox';

export const RECIPES: Record<RecipeId, Recipe> = { block, pattern, sprite, icons, material, vox, illustration };

export const isRecipeId = (s: string): s is RecipeId => s in RECIPES;
