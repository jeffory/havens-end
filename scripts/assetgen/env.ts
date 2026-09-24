import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** The repository root (this file lives in scripts/assetgen/). */
export const ROOT = resolve(import.meta.dirname, '../..');

/** ComfyUI's own default address; set `COMFY_URL` in .env to use another server. */
export const DEFAULT_COMFY_URL = 'http://127.0.0.1:8188';

/** Loads the gitignored .env at the repo root, if present. Variables already set win. */
export function loadEnv(root = ROOT): void {
  const path = join(root, '.env');
  if (existsSync(path)) process.loadEnvFile(path);
}

/** A path typed by the user: relative to the directory `npm run` was started from (npm's INIT_CWD). */
export function userPath(path: string): string {
  return resolve(process.env.INIT_CWD ?? process.cwd(), path);
}

export function comfyConfig(): { url: string; apiKey?: string } {
  return { url: process.env.COMFY_URL || DEFAULT_COMFY_URL, apiKey: process.env.COMFY_API_KEY || undefined };
}
