import type { RunResult } from '../comfy/client';
import type { Graph } from '../comfy/graph';
import type { ModelId } from '../comfy/models';
import type { Raster } from '../image/raster';

export type RecipeId = 'block' | 'pattern' | 'sprite' | 'icons' | 'material' | 'vox' | 'illustration';

/** What recipes need from ComfyClient (a stub in tests). */
export interface Client {
  run(graph: Graph): Promise<RunResult>;
  uploadImage(bytes: Uint8Array): Promise<string>;
}

/** One asset to make: its file name and what it should look like. */
export interface Item {
  name: string;
  prompt: string;
}

export type FlagValue = number | string | boolean;

export interface GenOptions {
  model: ModelId;
  seed: number;
  variants: number;
  /** Recipe flags, already typed by the recipe's `flags` defaults. */
  flags: Record<string, FlagValue>;
}

export interface Candidate {
  name: string;
  variant: number;
  /** Files installed on `pick`, relative to the recipe's install directory. */
  files: Record<string, Uint8Array>;
  /** Kept beside the candidate for reference (raw model output, concept art, GLB). */
  extras: Record<string, Uint8Array>;
  /** Shown on the contact sheet. */
  preview: Raster;
  /** Short facts for the caption and log, e.g. "seam repaired". */
  notes: string[];
  prompt: string;
  seed: number;
}

export interface FlagSpec {
  default: FlagValue;
  help: string;
  /** Allowed values of a string flag; anything else is rejected before spending. */
  choices?: string[];
  /** Bounds of a number flag (default min 1). */
  min?: number;
  max?: number;
}

export interface Recipe {
  id: RecipeId;
  summary: string;
  defaultModel: ModelId;
  flags: Record<string, FlagSpec>;
  /** Where picked files go, relative to the repo root. */
  installDir(name: string): string;
  /** Paid partner calls this run makes, before optional seam repairs (which can add some). */
  paidCalls(items: Item[], opts: GenOptions): number;
  generate(client: Client, items: Item[], opts: GenOptions, log: (line: string) => void): Promise<Candidate[]>;
}
