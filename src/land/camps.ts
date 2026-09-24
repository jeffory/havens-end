import { type Cargo, cargoCount, type Good, unload } from '../economy/goods';
import { type Building, isWorkshop, type Recipe, STORE_SIZE, STRUCTURES } from './structures';

/** A campfire claims the land this far around it. */
export const CLAIM_RADIUS = 32;

/** Where a campfire's claim is centred. */
export const fireCentre = (fire: Building): { x: number; z: number } => ({ x: fire.x0 + 1.5, z: fire.z0 + 1.5 });

const centre = (b: Building) => ({ x: b.x0 + b.w / 2, z: b.z0 + b.d / 2 });

/** The campfire whose claim a point lies in (the nearest, where claims overlap). */
export function fireAt(buildings: readonly Building[], x: number, z: number): Building | undefined {
  return nearestFire(buildings.filter((b) => b.kind === 'campfire'), x, z);
}

function nearestFire(fires: readonly Building[], x: number, z: number): Building | undefined {
  let best: Building | undefined;
  let bestDistance = CLAIM_RADIUS;
  for (const b of fires) {
    const c = fireCentre(b);
    const d = Math.hypot(c.x - x, c.z - z);
    if (d <= bestDistance) {
      best = b;
      bestDistance = d;
    }
  }
  return best;
}

/** The buildings (not fences, paths or torches) that belong to a camp: built within its fire's claim, and nearer it than any other fire. */
export function campBuildings(buildings: readonly Building[], fire: Building): Building[] {
  const fires = buildings.filter((b) => b.kind === 'campfire');
  return buildings.filter((b) => {
    if (STRUCTURES[b.kind].freeform) return false;
    const c = centre(b);
    return nearestFire(fires, c.x, c.z) === fire;
  });
}

/** A camp's storehouses: what its settlers eat and its workshops draw on and fill. */
export function campStores(buildings: readonly Building[], fire: Building): Cargo[] {
  return campBuildings(buildings, fire)
    .filter((b) => b.store)
    .map((b) => b.store!);
}

export const campWorkshops = (buildings: readonly Building[], fire: Building): Building[] => campBuildings(buildings, fire).filter((b) => isWorkshop(b.kind));

export const campHuts = (buildings: readonly Building[], fire: Building): Building[] => campBuildings(buildings, fire).filter((b) => (STRUCTURES[b.kind].beds ?? 0) > 0);

export const beds = (buildings: readonly Building[], fire: Building): number => campHuts(buildings, fire).reduce((n, b) => n + (STRUCTURES[b.kind].beds ?? 0), 0);

/** Everything in a camp's storehouses, added up. */
export function stock(stores: readonly Cargo[]): Cargo {
  const total: Cargo = {};
  for (const store of stores) for (const [good, n] of Object.entries(store) as Array<[Good, number]>) total[good] = (total[good] ?? 0) + n;
  return total;
}

/** Free space across a camp's storehouses. */
export const storeRoom = (stores: readonly Cargo[]): number => stores.reduce((n, s) => n + STORE_SIZE - cargoCount(s), 0);

export const hasAll = (stores: readonly Cargo[], cost: Cargo): boolean => {
  const have = stock(stores);
  return (Object.entries(cost) as Array<[Good, number]>).every(([good, n]) => (have[good] ?? 0) >= n);
};

/** Takes a whole cost out of the stores, or nothing if it isn't all there. */
export function take(stores: readonly Cargo[], cost: Cargo): boolean {
  if (!hasAll(stores, cost)) return false;
  for (const [good, n] of Object.entries(cost) as Array<[Good, number]>) {
    let owed = n;
    for (const store of stores) owed -= unload(store, good, owed);
  }
  return true;
}

/** Puts goods away, filling the storehouses in turn; returns how many went in (the rest didn't fit). */
export function put(stores: readonly Cargo[], good: Good, amount: number): number {
  let left = amount;
  for (const store of stores) {
    const n = Math.min(left, STORE_SIZE - cargoCount(store));
    if (n <= 0) continue;
    store[good] = (store[good] ?? 0) + n;
    left -= n;
  }
  return amount - left;
}

/** Puts a whole batch away, or nothing if there isn't room for all of it. */
export function putAll(stores: readonly Cargo[], goods: Cargo): boolean {
  if (storeRoom(stores) < cargoCount(goods)) return false;
  for (const [good, n] of Object.entries(goods) as Array<[Good, number]>) put(stores, good, n);
  return true;
}

export const recipeOf = (b: Building): Recipe => STRUCTURES[b.kind].recipes![b.work?.recipe ?? 0];

export type WorkshopState = 'working' | 'no-worker' | 'coming' | 'off-duty' | 'no-store' | 'short' | 'full';

/**
 * One step of a workshop with its worker at the bench: start a batch when the inputs
 * are in store (taking them), work it, and put the goods away when it's done (holding
 * a finished batch until there's room). Returns what it's doing.
 */
export function stepWorkshop(b: Building, stores: readonly Cargo[], dt: number): WorkshopState {
  const work = (b.work ??= { recipe: 0, progress: 0 });
  const recipe = recipeOf(b);
  if (stores.length === 0) return 'no-store';
  if (work.progress === 0) {
    if (!take(stores, recipe.inputs)) return 'short';
    work.progress = 1e-6;
  }
  work.progress = Math.min(1, work.progress + dt / recipe.seconds);
  if (work.progress < 1) return 'working';
  if (!putAll(stores, recipe.outputs)) return 'full';
  work.progress = 0;
  return 'working';
}
