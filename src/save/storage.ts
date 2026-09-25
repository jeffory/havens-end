import type { SeaSnapshot } from '../combat/sea';
import type { EconomySnapshot } from '../economy/economy';
import type { LandSnapshot } from '../land/Land';
import type { StorySnapshot } from '../story/Story';
import type { TreasureSnapshot } from '../treasure/Treasure';

/**
 * Bumped when the format changes. Version 2 (Phase 6) added the clock, settlers and
 * workshops; version 3 (Phase 7) treasure maps and finds; version 4 (Phase 8) the
 * story; version 5 (Phase 10) worked-out outcrops. Older saves still load.
 */
export const SAVE_VERSION = 5;
export const READABLE_VERSIONS: readonly number[] = [1, 2, 3, 4, 5];
export const AUTOSAVE = 'autosave';

/** One saved game: the world seed plus everything that has changed since it was generated. */
export interface SaveData {
  version: number;
  seed: number;
  sea: SeaSnapshot;
  economy: EconomySnapshot;
  land: LandSnapshot;
  /** Maps on offer and hoards taken (version 3). */
  treasure?: TreasureSnapshot;
  /** The main story's thread and journal (version 4). */
  story?: StorySnapshot;
  course: number | null;
  /** Voxel chunks changed since the world was generated, run-length encoded. */
  edits: Array<{ cx: number; cy: number; cz: number; data: string }>;
}

/** What the load list shows about a save without reading all of it. */
export interface SaveSummary {
  gold: number;
  ship: string;
  place: string;
  /** Seconds played. */
  time: number;
}

export interface SaveRecord {
  /** The key: 'autosave', or a name the player chose. */
  slot: string;
  savedAt: number;
  summary: SaveSummary;
  data: SaveData;
}

export type SaveListing = Omit<SaveRecord, 'data'>;

const DB = 'havens-end';
const STORE = 'saves';

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'slot' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Couldn’t open the save store'));
  });
  opening.catch(() => (opening = null));
  return opening;
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = work(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Save store request failed'));
  });
}

/** Every save, newest first, without their contents. */
export async function listSaves(): Promise<SaveListing[]> {
  const all = await run<SaveRecord[]>('readonly', (store) => store.getAll());
  return all.map(({ slot, savedAt, summary }) => ({ slot, savedAt, summary })).sort((a, b) => b.savedAt - a.savedAt);
}

export const readSave = (slot: string): Promise<SaveRecord | undefined> => run('readonly', (store) => store.get(slot));

export async function writeSave(record: SaveRecord): Promise<void> {
  await run('readwrite', (store) => store.put(record));
}

export async function deleteSave(slot: string): Promise<void> {
  await run('readwrite', (store) => store.delete(slot));
}
