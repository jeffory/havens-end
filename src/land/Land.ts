import { DOCK_SPEED, type Sea } from '../combat/sea';
import { distanceToBody } from '../combat/vessel';
import { SEA_LEVEL } from '../config';
import { isNight } from '../core/clock';
import type { Dress } from '../duel/dress';
import { PACK_SIZE, packLoad, PASSENGER_BERTHS } from '../economy/captain';
import { type Cargo, cargoCount, GOOD_INFO, type Good, loadCargo, unload } from '../economy/goods';
import type { Port, PortPlace } from '../economy/ports';
import { Block, blocksWalker, shapeOf } from '../voxel/blocks';
import type { VoxelWorld } from '../voxel/VoxelWorld';
import { groundHeight, levelGround, clearSite, overlaps, TREE_BLOCKS, type Footprint } from '../worldgen/buildings';
import { mulberry32 } from '../worldgen/noise';
import { WATER_LEVEL } from '../ocean/waves';
import { type Bandit, Bandits, type BanditsSnapshot, FLEE_AT, stepBandits } from './bandits';
import { beds, CLAIM_RADIUS, campStores, fireAt, fireCentre, stepWorkshop, type WorkshopState } from './camps';
import { clearCrop, CROP_FOR_SEED, CROPS, type Crop, type CropKind, type Sapling, saplingStage, showCrop, showSapling, type Stage, stageOf } from './crops';
import { type Creature, type CreatureKind, bolted, CREATURES, harm, stepCreatures, strike } from './creatures';
import { type Drop, DROP_SECONDS, dropItem, stepDrops } from './drops';
import { aimPoint, GUN_LIST, GUNS, type Gun, hitChance, isGun, pickTarget, type Point3, resolveShot, type Shootable } from './firearms';
import { atWork, breakfast, createSettler, type Fallow, type Job, type Settler, stepSettler, think } from './settlers';
import { type Building, doorOf, isWorkshop, PIECES, plotFor, raise, raze, type Structure, STRUCTURES } from './structures';
import { DEPOSITS, Deposits, type DepositsSnapshot } from './deposits';
import { stepTownsfolk, type Townsman } from './townsfolk';
import { createWalker, groundBelow, HALF_WIDTH, HEIGHT, standable, stepWalker, type Walker } from './walker';

export type Tool = 'axe' | 'pickaxe' | 'hoe';
export const TOOL_LIST: readonly Tool[] = ['axe', 'pickaxe', 'hoe'];
/** What's in the captain's hands: a tool, a gun, or a seed to plant. */
export type Held = Tool | Gun | Good;
/** Cartridges the captain takes ashore from the hold, with a gun to fire them. */
export const POUCH = 24;
/** A gun is fired from the chest. */
const MUZZLE = 1.3;
/** The captain's health on foot. Only bandits' shots hurt; beasts don't bite. */
export const HEALTH_MAX = 10;
/** Wounds start to mend once no bandit has fired for this long, a point every HEAL_EVERY seconds. */
const HEAL_AFTER = 15;
const HEAL_EVERY = 6;
/** Brought down, the captain loses this share of their gold, as a guardian takes. */
const DOWNED_TOLL = 0.1;

export { CLAIM_RADIUS } from './camps';
/** A port's town and harbour: nobody digs, fells or builds within this of the berth. */
export const TOWN_RADIUS = 80;
/** How far in front of their feet the captain works. */
const WORK_DISTANCE = 1.25;
/** How far across the captain can reach to work a cell (picked with the mouse). */
export const REACH = 3.6;
/** And how far above and below their feet, in voxels. */
export const REACH_UP = 2;
export const REACH_DOWN = 2;
/** How far the ship's side can be from where you land: the boat rows you that far, and back. */
const LANDING_RANGE = 12;
const BOARD_RANGE = LANDING_RANGE + 1;
/** Storehouses, and the ship at anchor, within this of the captain supply building work. */
export const SUPPLY_RANGE = 60;
const INTERACT_RANGE = 2.2;
const TREE_LIMIT = 300;
/** A tree's leaves hang within this many voxels of its trunk (each way). */
const CANOPY_REACH = 4;
/** Axe blows it takes to fell a tree: more for a taller trunk and a heavier crown, within these. */
const BLOWS = [3, 6] as const;
/** Camps within this of the captain (or their ship) are lived in step by step; further off, walks are just timed. */
const LIVE_RANGE = 160;
/** Woodcutters look this far past the edge of the claim for trees, and fishers for the shore. */
const WORK_MARGIN = 6;
const SHORE_MARGIN = 14;
/** Seconds a camp's list of trees (or fishing spots) is trusted before it's looked over again. */
const SURVEY_SECONDS = 20;

export type LandEvent =
  | { kind: 'ashore'; x: number; y: number; z: number }
  | { kind: 'aboard'; stowed: number; left: number }
  | { kind: 'work'; action: Action; x: number; y: number; z: number; good?: Good; amount?: number; settler?: number; leaves?: number[] }
  | { kind: 'pickup'; good: Good; amount: number }
  | { kind: 'built'; structure: Structure; x: number; y: number; z: number }
  | { kind: 'razed'; structure: Structure; x: number; y: number; z: number }
  | { kind: 'made'; building: number; x: number; y: number; z: number }
  | { kind: 'notice'; text: string; tone: 'info' | 'good' | 'bad' }
  | { kind: 'shot'; gun: Gun | 'musket'; from: Point3; to: Point3; hit: 'creature' | 'bandit' | 'captain' | null }
  | { kind: 'hurt'; x: number; y: number; z: number }
  | { kind: 'downed'; toll: number; pack: boolean }
  /** A camp takes up the fight: where the first bandit stands. */
  | { kind: 'alarm'; x: number; y: number; z: number }
  /** A beast that wasn't fleeing starts to. */
  | { kind: 'bolt'; creature: CreatureKind; x: number; y: number; z: number }
  /** The captain's gun has finished loading. */
  | { kind: 'loaded'; gun: Gun };

export type Action = 'fell' | 'chop' | 'mine' | 'break' | 'dig' | 'till' | 'plant' | 'harvest' | 'unbuild' | 'fish' | 'catch';

/**
 * What a tool is pointed at: a column (the one in front of the captain), or a block
 * picked with the mouse and the face it was picked by.
 */
export interface Target {
  x: number;
  z: number;
  /** The block picked with the mouse, if it was. */
  y?: number;
  /** The face it was picked by (a unit normal). */
  face?: { x: number; y: number; z: number };
}

/** Where the captain can dig for treasure: soft ground. */
const SOFT: readonly number[] = [Block.Grass, Block.Dirt, Block.Sand, Block.Soil];
/** Rock the pickaxe can only break as part of an outcrop. */
const ROCK: readonly number[] = [Block.Stone, Block.IronOre, Block.Boulder, Block.CopperOre, Block.SilverOre, Block.GoldOre];
/** Ground an outcrop grows back on: as the island made it, not dug, tilled or paved. */
const NATURAL_GROUND: readonly number[] = [Block.Grass, Block.Dirt, Block.Stone];
/** Where saplings take root. */
const ROOTING: readonly number[] = [Block.Grass, Block.Dirt, Block.Sand];

type Cell = [number, number, number];

/** What a tool would do if used now: the cell it would work, or why it can't. */
export type Aim = { ok: true; action: Action; x: number; y: number; z: number } | { ok: false; reason: string; x?: number; y?: number; z?: number };

export interface Outcome {
  ok: boolean;
  message: string;
}

export type Interaction =
  | { kind: 'board' }
  | { kind: 'door'; place: PortPlace }
  | { kind: 'camp'; fire: Building; building: Building }
  | { kind: 'rest'; building: Building }
  | { kind: 'store'; building: Building }
  | { kind: 'harvest'; crop: Crop }
  | { kind: 'chest'; camp: number };

export interface LandSnapshot {
  walker: { x: number; y: number; z: number; facing: number } | null;
  buildings: Building[];
  crops: Crop[];
  nextId: number;
  settlers?: Settler[];
  fallow?: Fallow[];
  saplings?: Sapling[];
  drops?: Array<{ good: Good; amount: number; x: number; y: number; z: number; age: number; life?: number }>;
  /** Worked-out outcrops (version 5). */
  deposits?: DepositsSnapshot;
  /** Bandits' camps (version 6). */
  bandits?: BanditsSnapshot;
}

/** A tree a woodcutter could fell: the bottom of its trunk. */
export interface TreeSpot {
  x: number;
  y: number;
  z: number;
}

/** Somewhere to fish from: dry ground at the water's edge, and which way the water is. */
export interface ShoreSpot {
  x: number;
  y: number;
  z: number;
  toward: number;
}

export interface Placement {
  plot: Footprint;
  y: number;
  ok: boolean;
  reason: string;
}

/**
 * Everything on land: the captain on foot, the camps and farms they build, and the
 * crops growing in them. Pure simulation like the `Sea` it sits beside: it steps with
 * the fixed clock, writes to the voxel world, and reports what happened as events.
 */
export class Land {
  walker: Walker | null = null;
  buildings: Building[] = [];
  crops: Crop[] = [];
  /** The people living and working at the camps. */
  settlers: Settler[] = [];
  /** Plots a farmer will sow as soon as there's seed. */
  fallow: Fallow[] = [];
  saplings: Sapling[] = [];
  /** Night creatures about the captain: not saved (they're gone by morning anyway). */
  creatures: Creature[] = [];
  /** Townsfolk about the town the captain's walking: not saved (they're only there while you are). */
  townsfolk: Townsman[] = [];
  nextTownsman = 1;
  townSpawnIn = 0;
  /** What the last one out of a door wore: kept after they've gone back in, so the next one out never looks like them. */
  lastOut: Dress | null = null;
  nextCreature = 1;
  spawnIn = 0;
  /** What's lying about to be picked up. */
  drops: Drop[] = [];
  nextDrop = 1;
  /** When the captain was last told their pack is full. */
  fullToldAt = -Infinity;
  /** Buried treasure, asked about every spot the captain digs (the ground block): returns what to tell them, if anything. */
  buried: { search(x: number, y: number, z: number): string | null } | null = null;
  /** The islands' outcrops of stone and ore (the game hands over the ones it placed). */
  deposits = new Deposits();
  /** The bandits' camps (the game hands over the ones it placed). */
  bandits = new Bandits();
  nextId = 1;
  /** In port: was the captain in town at the last step? (The pouch goes with them out of it.) */
  private inTownLast = true;
  private events: LandEvent[] = [];
  private readonly random: () => number;
  private growIn = 0;
  /** The stage each crop is drawn at (redrawn when it grows; everything is redrawn after a load). */
  private readonly shown = new WeakMap<Crop | Sapling, Stage>();
  /** The day it was when the camps last had breakfast. */
  private fedOn: number;
  /** What each workshop was doing at the last step, for the camp screen. */
  private readonly workshopStates = new Map<number, WorkshopState>();
  private readonly surveys = new Map<string, { at: number; spots: TreeSpot[] | ShoreSpot[] }>();
  /** Axe blows each tree has taken, by the foot of its trunk: not saved, and forgotten when it falls. */
  private readonly blows = new Map<string, number>();
  /** Seconds each gun has left to load (not saved: loaded again by the time a save is loaded). */
  private readonly loading: Partial<Record<Gun, number>> = {};
  /** The captain's health on foot (full again aboard; not saved). */
  health = HEALTH_MAX;
  /** Seconds since a bandit last fired. */
  private quiet = 0;
  private healIn = HEAL_EVERY;

  constructor(
    readonly world: VoxelWorld,
    readonly sea: Sea,
    /** Names and faces for settlers. */
    private readonly seed = 1,
  ) {
    this.fedOn = sea.clock.day;
    this.random = mulberry32(seed ^ 0xc4ab);
  }

  /** The camps, fields and the captain on foot, for a save. The voxels themselves are saved with the world. */
  snapshot(): LandSnapshot {
    const w = this.walker;
    return {
      walker: w ? { x: w.x, y: w.y, z: w.z, facing: w.facing } : null,
      buildings: structuredClone(this.buildings),
      crops: structuredClone(this.crops),
      nextId: this.nextId,
      settlers: structuredClone(this.settlers),
      fallow: structuredClone(this.fallow),
      saplings: structuredClone(this.saplings),
      drops: this.drops.map(({ good, amount, x, y, z, age, life }) => ({ good, amount, x, y, z, age, life })),
      deposits: this.deposits.snapshot(),
      bandits: this.bandits.snapshot(),
    };
  }

  restore(s: LandSnapshot): void {
    this.walker = s.walker ? createWalker(s.walker.x, s.walker.y, s.walker.z, s.walker.facing) : null;
    this.buildings = structuredClone(s.buildings);
    for (const b of this.buildings) if (isWorkshop(b.kind)) b.work ??= { recipe: 0, progress: 0 };
    this.crops = structuredClone(s.crops);
    this.nextId = s.nextId;
    this.settlers = structuredClone(s.settlers ?? []);
    this.fallow = structuredClone(s.fallow ?? []);
    this.saplings = structuredClone(s.saplings ?? []);
    this.drops = (s.drops ?? []).map((d) => ({ ...d, id: this.nextDrop++, vx: 0, vy: 0, vz: 0, prev: { x: d.x, y: d.y, z: d.z }, life: d.life ?? DROP_SECONDS, still: false }));
    this.growIn = 0;
    this.fedOn = this.sea.clock.day;
    this.surveys.clear();
    if (s.deposits) this.deposits.restore(s.deposits);
    this.deposits.reconcile(this.world, this.day(), (x, z) => this.claimed(x, z));
    if (s.bandits) this.bandits.restore(s.bandits);
    this.bandits.reconcile(this.world, (x, z, r) => this.claimNear(x, z, r));
    // A fight isn't saved: the captain comes back whole, and the bandits at ease.
    this.health = HEALTH_MAX;
  }

  takeEvents(): LandEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  get pack(): Cargo {
    return this.sea.captain.pack;
  }

  /** The captain on foot takes a step. */
  move(dt: number, moveX: number, moveZ: number): void {
    if (this.walker) stepWalker(this.walker, moveX, moveZ, this.world, dt);
  }

  /**
   * One fixed step of life on land, ashore or not: crops and saplings grow, settlers go
   * about their day, workshops work, and at sunrise the camps eat. `watched` false
   * treats every camp as out of sight (while the captain sleeps).
   */
  step(dt: number, watched = true): void {
    this.growIn -= dt;
    if (this.growIn <= 0) {
      this.growIn = 1;
      this.grow();
    }
    if (this.sea.clock.day !== this.fedOn) {
      this.fedOn = this.sea.clock.day;
      this.dawn();
    }
    const focus = this.walker ?? this.sea.player.ship;
    for (const s of this.settlers) {
      const fire = this.building(s.camp);
      const live = watched && !!fire && Math.hypot(fireCentre(fire).x - focus.x, fireCentre(fire).z - focus.z) < LIVE_RANGE;
      stepSettler(this, s, dt, live);
    }
    this.work(dt);
    for (const gun of GUN_LIST) {
      const left = this.loading[gun];
      if (!left) continue;
      this.loading[gun] = Math.max(0, left - dt);
      if (left > 0 && this.loading[gun] === 0) this.events.push({ kind: 'loaded', gun });
    }
    this.pouchInPort();
    if (this.walker && this.health < HEALTH_MAX) {
      this.quiet += dt;
      if (this.quiet >= HEAL_AFTER && (this.healIn -= dt) <= 0) {
        this.health += 1;
        this.healIn = HEAL_EVERY;
      }
    } else this.healIn = HEAL_EVERY;
    stepDrops(this, dt);
    if (watched) stepCreatures(this, dt, this.random);
    else this.creatures.length = 0;
    if (watched) stepBandits(this, dt, this.random);
    else Object.assign(this.bandits, { live: [], liveCamp: null });
    stepTownsfolk(this, dt, this.random);
  }

  /** Torches and fires: night creatures keep out of their light. */
  lights(): Array<{ x: number; z: number }> {
    const lit: Array<{ x: number; z: number }> = [];
    for (const b of this.buildings) {
      if (b.kind === 'torch' || b.kind === 'campfire' || b.kind === 'forge' || b.kind === 'smokehouse') lit.push({ x: b.x0 + b.w / 2, z: b.z0 + b.d / 2 });
    }
    return lit;
  }

  /** A creature got at a crop: a crab nibbles it back to a shoot, a boar tramples it flat. */
  spoilCrop(crop: Crop, by: Creature): void {
    const label = CROPS[crop.kind].label.toLowerCase();
    const tell = (text: string) => {
      if (!by.told) this.events.push({ kind: 'notice', text, tone: 'bad' });
      by.told = true;
    };
    if (by.kind === 'crab') {
      crop.planted = this.sea.time;
      tell(`A land crab is nibbling your ${label}! Torches keep them off.`);
    } else {
      this.removeCrop(crop);
      if (this.fireAt(crop.x + 0.5, crop.z + 0.5)) this.fallow.push({ x: crop.x, y: crop.y, z: crop.z, kind: crop.kind });
      tell(`A wild boar has trampled your ${label}! Fence your fields.`);
    }
  }

  emit(e: LandEvent): void {
    this.events.push(e);
  }

  building(id: number): Building | undefined {
    return this.buildings.find((b) => b.id === id);
  }

  // ---- Camps: settlers and workshops ----

  /** The camp fire whose claim a point is in. */
  fireAt(x: number, z: number): Building | undefined {
    return fireAt(this.buildings, x, z);
  }

  settlersAt(fire: Building): Settler[] {
    return this.settlers.filter((s) => s.camp === fire.id);
  }

  freeBeds(fire: Building): number {
    return beds(this.buildings, fire) - this.settlersAt(fire).length;
  }

  /** Brings settlers ashore from the ship to live at a camp, as many as there are beds for. */
  settle(fire: Building, count: number): Outcome {
    const aboard = this.sea.captain.passengers;
    if (aboard <= 0) return fail('You have no settlers aboard: hire them in a tavern.');
    const free = this.freeBeds(fire);
    if (free <= 0) return fail(beds(this.buildings, fire) === 0 ? 'Settlers need a hut to sleep in. Build one first.' : 'Every bed is taken: build another hut.');
    const n = Math.min(count, aboard, free);
    const c = fireCentre(fire);
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2;
      const x = c.x + Math.sin(angle) * 2.5;
      const z = c.z + Math.cos(angle) * 2.5;
      const s = createSettler(this.nextId++, this.seed, fire, { x, y: standable(this.world, x, z, fire.y + 4) ?? fire.y, z });
      this.settlers.push(s);
    }
    this.sea.captain.passengers -= n;
    return done(`${n} settler${n > 1 ? 's' : ''} come${n > 1 ? '' : 's'} ashore to live here. Give them work at the campfire.`);
  }

  /** A settler goes back aboard, to be settled somewhere else. */
  sendAboard(id: number): Outcome {
    const s = this.settlers.find((o) => o.id === id);
    if (!s) return fail('No such settler.');
    if (this.sea.captain.passengers >= PASSENGER_BERTHS) return fail(`There are berths aboard for only ${PASSENGER_BERTHS} settlers.`);
    this.settlers.splice(this.settlers.indexOf(s), 1);
    this.sea.captain.passengers++;
    return done(`${s.name} goes back aboard.`);
  }

  /** Gives a settler a job (a workshop hand works at `post`). */
  assign(id: number, job: Job, post: number | null = null): Outcome {
    const s = this.settlers.find((o) => o.id === id);
    if (!s) return fail('No such settler.');
    if (job === 'worker') {
      const b = post === null ? undefined : this.building(post);
      if (!b || !isWorkshop(b.kind)) return fail('That’s not a workshop.');
      for (const o of this.settlers) if (o !== s && o.post === b.id) Object.assign(o, { job: 'idle', post: null });
    }
    s.job = job;
    s.post = job === 'worker' ? post : null;
    think(this, s);
    return done('');
  }

  /** What a workshop's doing, for the camp screen. */
  workshopState(b: Building): WorkshopState {
    const hand = this.settlers.find((s) => s.post === b.id);
    if (!hand) return 'no-worker';
    if (!atWork(hand, b)) return isNight(this.sea.clock.phase) ? 'off-duty' : 'coming';
    return this.workshopStates.get(b.id) ?? 'working';
  }

  /** Workshops with their hand at the bench make things, drawing on and filling their camp's storehouses. */
  private work(dt: number): void {
    for (const b of this.buildings) {
      if (!b.work) continue;
      if (!this.settlers.some((s) => atWork(s, b))) continue;
      const fire = this.fireAt(b.x0 + b.w / 2, b.z0 + b.d / 2);
      const before = b.work.progress;
      const state = stepWorkshop(b, fire ? campStores(this.buildings, fire) : [], dt);
      this.workshopStates.set(b.id, state);
      if (before > 0 && b.work.progress === 0) this.events.push({ kind: 'made', building: b.id, x: b.x0 + b.w / 2, y: b.y + 2, z: b.z0 + b.d / 2 });
    }
  }

  /** Sunrise: every settler eats, and any who've gone hungry too long leave. */
  private dawn(): void {
    for (const s of breakfast(this)) {
      this.settlers.splice(this.settlers.indexOf(s), 1);
      this.events.push({ kind: 'notice', text: `${s.name} has left your camp: there's been nothing to eat.`, tone: 'bad' });
    }
    const hungry = this.settlers.filter((s) => s.hungry > 0).length;
    if (hungry > 0) this.events.push({ kind: 'notice', text: `${hungry} of your settlers went without breakfast. Stock the storehouse with food.`, tone: 'bad' });
  }

  /** Trees a woodcutter from this camp could fell, from a survey taken now and then. */
  trees(fire: Building): TreeSpot[] {
    return this.survey(`trees-${fire.id}`, () => {
      const c = fireCentre(fire);
      const r = CLAIM_RADIUS + WORK_MARGIN;
      const spots: TreeSpot[] = [];
      for (let x = Math.floor(c.x - r); x <= c.x + r; x++) {
        for (let z = Math.floor(c.z - r); z <= c.z + r; z++) {
          if (Math.hypot(x + 0.5 - c.x, z + 0.5 - c.z) > r) continue;
          const y = groundHeight(this.world, x, z);
          if (this.world.getVoxel(x, y, z) === Block.Wood && !TREE_BLOCKS.has(this.world.getVoxel(x, y - 1, z)) && !this.buildingAt(x, y, z)) spots.push({ x, y, z });
        }
      }
      return spots;
    }) as TreeSpot[];
  }

  /** Places at the water's edge near a camp to fish from. */
  shore(fire: Building): ShoreSpot[] {
    return this.survey(`shore-${fire.id}`, () => {
      const c = fireCentre(fire);
      const r = CLAIM_RADIUS + SHORE_MARGIN;
      const spots: ShoreSpot[] = [];
      const wet = (x: number, z: number) => groundBelow(this.world, x + 0.5, z + 0.5, SEA_LEVEL + 2) < WATER_LEVEL - 1;
      for (let x = Math.floor(c.x - r); x <= c.x + r; x++) {
        for (let z = Math.floor(c.z - r); z <= c.z + r; z++) {
          if (Math.hypot(x + 0.5 - c.x, z + 0.5 - c.z) > r || wet(x, z)) continue;
          const y = standable(this.world, x + 0.5, z + 0.5, SEA_LEVEL + 3);
          if (y === null || y < SEA_LEVEL) continue;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (!wet(x + dx, z + dz) || !wet(x + dx * 2, z + dz * 2)) continue;
            spots.push({ x: x + 0.5, y, z: z + 0.5, toward: Math.atan2(dx, dz) });
            break;
          }
        }
      }
      return spots;
    }) as ShoreSpot[];
  }

  private survey(key: string, look: () => TreeSpot[] | ShoreSpot[]): TreeSpot[] | ShoreSpot[] {
    const cached = this.surveys.get(key);
    if (cached && this.sea.time - cached.at < SURVEY_SECONDS) return cached.spots;
    const spots = look();
    this.surveys.set(key, { at: this.sea.time, spots });
    return spots;
  }

  /** A woodcutter's felling: the whole tree, as timber (and where its leaves were, to see them fall). Null if it's gone. */
  fellTreeAt(x: number, y: number, z: number): { timber: number; leaves: number[] } | null {
    if (this.world.getVoxel(x, y, z) !== Block.Wood) return null;
    const { wood, leaves } = this.fellTree(x, y, z);
    return { timber: wood.length + Math.floor(leaves.length / 12), leaves: leaves.flat() };
  }

  /** A sapling where a tree came down, to grow into the next one. */
  plantSapling(x: number, y: number, z: number): void {
    const ground = this.world.getVoxel(x, y - 1, z);
    if (![Block.Grass, Block.Dirt, Block.Sand].includes(ground as never) || this.world.getVoxel(x, y, z) !== Block.Air) return;
    const sapling: Sapling = { x, y, z, planted: this.sea.time };
    this.saplings.push(sapling);
    this.shown.set(sapling, 0);
    showSapling(this.world, sapling, 0);
  }

  plantCrop(x: number, y: number, z: number, kind: CropKind): void {
    const crop: Crop = { x, y, z, kind, planted: this.sea.time };
    this.crops.push(crop);
    this.shown.set(crop, 0);
    showCrop(this.world, crop, 0);
  }

  removeCrop(crop: Crop): void {
    clearCrop(this.world, crop);
    this.crops.splice(this.crops.indexOf(crop), 1);
  }

  /** Is this still tilled soil, ready to sow? */
  tilled(plot: { x: number; y: number; z: number }): boolean {
    return this.world.getVoxel(plot.x, plot.y - 1, plot.z) === Block.Soil && this.world.getVoxel(plot.x, plot.y, plot.z) === Block.Air;
  }

  // ---- Going ashore and back aboard ----

  /** Where the captain would step ashore from the ship as she lies, or why they can't. */
  landing(): { x: number; y: number; z: number } | string {
    const sea = this.sea;
    const p = sea.player;
    if (p.status !== 'afloat' || sea.ashore) return 'You can’t go ashore now.';
    if (Math.abs(p.ship.surge) > DOCK_SPEED) return 'Take in sail and slow down to go ashore.';
    if (sea.hunted()) return 'Not with enemies on your tail.';
    let best: { x: number; y: number; z: number } | null = null;
    let bestDistance = Infinity;
    const span = LANDING_RANGE + 6;
    for (let dz = -span; dz <= span; dz++) {
      for (let dx = -span; dx <= span; dx++) {
        const x = Math.floor(p.ship.x) + dx + 0.5;
        const z = Math.floor(p.ship.z) + dz + 0.5;
        const d = distanceToBody(p, x, 0, z);
        if (d > LANDING_RANGE || d >= bestDistance) continue;
        const y = standable(this.world, x, z, SEA_LEVEL + 16);
        if (y === null || y < SEA_LEVEL - 0.5) continue; // wading ashore is fine; landing in the water isn't
        best = { x, y, z };
        bestDistance = d;
      }
    }
    return best ?? 'There’s no beach close enough: bring her nearer the shore.';
  }

  goAshore(): Outcome {
    const spot = this.landing();
    if (typeof spot === 'string') return fail(spot);
    const p = this.sea.player.ship;
    this.walker = createWalker(spot.x, spot.y, spot.z, Math.atan2(spot.x - p.x, spot.z - p.z));
    this.sea.ashore = true;
    this.fillPouch();
    this.events.push({ kind: 'ashore', ...spot });
    return done('You row ashore; the crew keep her at anchor.');
  }

  /** Docked in a port: the captain steps off onto the pier. */
  landAtPort(): void {
    const port = this.sea.docked;
    if (!port) return;
    // No pouch in town: the cartridges stay in the hold, where the market sees them (see pouchInPort).
    this.walker = createWalker(port.pier.x, port.pier.y, port.pier.z, port.heading + Math.PI);
    this.inTownLast = true;
    this.events.push({ kind: 'ashore', ...port.pier });
  }

  /** Close enough to the ship to climb aboard? */
  nearShip(): boolean {
    const w = this.walker;
    return !!w && distanceToBody(this.sea.player, w.x, 0, w.z) < BOARD_RANGE;
  }

  /** Back aboard: the pack is stowed in the hold, and she's under your command again. */
  goAboard(): Outcome {
    if (!this.walker) return fail('You’re already aboard.');
    const hold = this.sea.player.cargo;
    const moved = loadCargo(hold, { ...this.pack }, this.sea.player.cls.type.hold - cargoCount(hold));
    for (const [good, n] of Object.entries(moved) as Array<[Good, number]>) unload(this.pack, good, n);
    this.health = HEALTH_MAX;
    this.quiet = 0;
    this.walker = null;
    if (this.sea.docked) this.sea.undock();
    else this.sea.ashore = false;
    const stowed = cargoCount(moved);
    this.events.push({ kind: 'aboard', stowed, left: cargoCount(this.pack) });
    return done(stowed > 0 ? `Back aboard; ${stowed} goods stowed in the hold.` : 'Back aboard.');
  }

  // ---- The captain's health ----

  /** A bandit fired: wounds don't mend while they're under fire. */
  underFire(): void {
    this.quiet = 0;
  }

  /** The captain is hit. At no health left, they're brought down. */
  hurt(amount: number): void {
    const w = this.walker;
    if (!w) return;
    this.health = Math.max(0, this.health - amount);
    this.events.push({ kind: 'hurt', x: w.x, y: w.y + 1.2, z: w.z });
    if (this.health <= 0) this.bringDown();
  }

  /**
   * Brought down by bandits: they take a share of the gold, the pack's goods lie where the
   * captain fell (a full day, not the usual ten minutes), and the crew carry them back
   * aboard. The ship is where she lay at anchor.
   */
  private bringDown(): void {
    const w = this.walker!;
    const captain = this.sea.captain;
    const toll = Math.round(captain.gold * DOWNED_TOLL);
    captain.gold -= toll;
    const goods = Object.entries(this.pack) as Array<[Good, number]>;
    for (const [good, n] of goods) this.drop(good, w.x, w.y + 0.5, w.z, n, Math.max(DROP_SECONDS, this.sea.clock.length));
    for (const [good] of goods) delete this.pack[good];
    this.goAboard();
    this.events.push({ kind: 'downed', toll, pack: goods.length > 0 });
  }

  /** With a gun, the captain rows ashore with a pouch of cartridges from the hold (going aboard stows it again). */
  private fillPouch(): void {
    if (this.sea.captain.guns.length === 0) return;
    const want = POUCH - (this.pack.cartridges ?? 0);
    if (want > 0) Land.transfer(this.sea.player.cargo, this.pack, 'cartridges', want, this.roomFor('cartridges'));
  }

  /**
   * In port, the pouch is filled as the captain walks out of town (to hunt the island), and
   * its cartridges go back in the hold as they walk in again: the market, reached only in
   * town, sees and sells them all.
   */
  private pouchInPort(): void {
    const w = this.walker;
    if (!w || !this.sea.docked) return;
    const inTown = this.inTown(w.x, w.z);
    if (inTown === this.inTownLast) return;
    this.inTownLast = inTown;
    if (!inTown) return this.fillPouch();
    const hold = this.sea.player.cargo;
    Land.transfer(this.pack, hold, 'cartridges', this.pack.cartridges ?? 0, this.sea.player.cls.type.hold - cargoCount(hold));
  }

  // ---- Guns ----

  /** How much of a gun's loading is still to go: 1 just fired, 0 ready. */
  reloadLeft(gun: Gun): number {
    return (this.loading[gun] ?? 0) / GUNS[gun].reload;
  }

  /** What a shot would be aimed at: at the cursor (`toward`), or else the nearest target ahead. */
  gunTarget(gun: Gun, toward: Point3 | null): Shootable | null {
    const w = this.walker;
    return w ? pickTarget(w, this.shootables(), GUNS[gun].range, toward) : null;
  }

  /**
   * Fires a gun: at what's under the mouse (`toward`), or else the nearest target within
   * the cone ahead, or straight ahead. It costs a cartridge, and the gun loads again by itself.
   */
  fire(gun: Gun, toward: Point3 | null = null): Outcome {
    const w = this.walker;
    if (!w) return fail('You’re aboard ship.');
    const spec = GUNS[gun];
    if (!this.sea.captain.guns.includes(gun)) return fail(`You have no ${spec.label.toLowerCase()}.`);
    if ((this.loading[gun] ?? 0) > 0) return fail('Still loading.');
    if (this.available('cartridges') < 1) return fail('No cartridges to hand: buy some in port, or make them at a forge.');
    this.spend({ cartridges: 1 });
    this.loading[gun] = spec.reload;
    const target = pickTarget(w, this.shootables(), spec.range, toward);
    const from = { x: w.x, y: w.y + MUZZLE, z: w.z };
    const at = target ? aimPoint(target) : (toward ?? { x: w.x + Math.sin(w.facing) * spec.range, y: from.y, z: w.z + Math.cos(w.facing) * spec.range });
    w.facing = Math.atan2(at.x - w.x, at.z - w.z);
    const distance = Math.hypot(at.x - from.x, at.z - from.z);
    const shot = resolveShot(this.world, from, at, spec.range, target, target ? hitChance(gun, distance) : 0, this.random());
    this.events.push({ kind: 'shot', gun, from, to: shot.end, hit: shot.hit ? shot.hit.kind : null });
    const result = shot.hit ? this.wound(shot.hit, spec.damage) : done('');
    // Heard, by whoever's left: a shot that fells the last of them warns no one.
    if (this.bandits.hears(from.x, from.z)) this.alertBandits();
    return result;
  }

  /** What a shot could hit round the captain: the beasts, and the bandits. */
  private shootables(): Shootable[] {
    const beasts = this.creatures.map((c) => ({ kind: 'creature' as const, id: c.id, x: c.walker.x, y: c.walker.y, z: c.walker.z }));
    const bandits = this.bandits.live.map((b) => ({ kind: 'bandit' as const, id: b.id, x: b.walker.x, y: b.walker.y, z: b.walker.z }));
    return [...beasts, ...bandits];
  }

  /** A shot lands on something. */
  private wound(t: Shootable, damage: number): Outcome {
    const w = this.walker!;
    if (t.kind === 'bandit') {
      const b = this.bandits.live.find((o) => o.id === t.id);
      return b ? this.shootBandit(b, damage) : done('');
    }
    const c = this.creatures.find((o) => o.id === t.id);
    if (!c) return done('');
    const calm = c.fleeing <= 0;
    const caught = harm(c, damage, w.x, w.z);
    if (calm && !caught) bolted(this, c); // one brought down doesn’t run
    return this.landed(c, caught, 'Shot');
  }

  /** A shot lands on a bandit: the camp takes up the fight; badly hurt they run; down, they leave cartridges and a few gold. */
  private shootBandit(b: Bandit, damage: number): Outcome {
    b.hp -= damage;
    if (b.hp <= 0) {
      const camp = this.bandits.camps.find((c) => c.id === b.camp)!;
      const { x, y, z } = b.walker;
      this.banditGone(b, 'fell');
      const gold = 3 + Math.floor(this.random() * 6) + camp.tier * 3;
      this.sea.captain.gold += gold;
      this.drop('cartridges', x, y + 0.4, z, 2 + Math.floor(this.random() * 2));
      this.alertBandits(); // the rest of them, if any are left
      return done(`The bandit falls: ${gold} gold in their purse.`);
    }
    this.alertBandits();
    if (b.hp <= FLEE_AT) {
      Object.assign(b, { mode: 'flee', path: null });
      return done('The bandit breaks and runs!');
    }
    return done('A hit!');
  }

  /** The captain is seen, heard or shot at: the camp takes up the fight, and if that starts one, the captain is warned. */
  alertBandits(): void {
    if (!this.bandits.alertAll()) return;
    this.events.push({ kind: 'notice', text: 'Bandits! They’ve seen you.', tone: 'bad' });
    const first = this.bandits.live.find((b) => b.mode === 'fight');
    if (first) this.events.push({ kind: 'alarm', x: first.walker.x, y: first.walker.y, z: first.walker.z });
  }

  /** A bandit is gone from their camp, fallen or fled: the last of them clears it. */
  banditGone(b: Bandit, how: 'fell' | 'fled'): void {
    this.bandits.live = this.bandits.live.filter((o) => o !== b);
    const camp = this.bandits.camps.find((c) => c.id === b.camp);
    if (camp && this.bandits.lose(camp, this.day())) {
      this.events.push({ kind: 'notice', text: `The bandits’ camp is cleared${how === 'fled' ? ', the last of them fled' : ''}. They’ll be back in five days, unless you claim the ground.`, tone: 'good' });
    }
  }

  // ---- Working the land ----

  /** The sea clock's day with its fraction: what outcrops time their growing back by. */
  day(): number {
    return this.sea.clock.day + this.sea.clock.phase;
  }

  /** The column in front of the captain's feet. */
  front(): Target | null {
    const w = this.walker;
    if (!w) return null;
    return { x: Math.floor(w.x + Math.sin(w.facing) * WORK_DISTANCE), z: Math.floor(w.z + Math.cos(w.facing) * WORK_DISTANCE) };
  }

  /** Can the captain reach this cell from where they stand? */
  reaches(x: number, y: number, z: number): boolean {
    const w = this.walker;
    if (!w) return false;
    const feet = Math.round(w.y);
    return y >= feet - REACH_DOWN && y <= feet + REACH_UP && Math.hypot(x + 0.5 - w.x, z + 0.5 - w.z) <= REACH;
  }

  /** Ground, as a tool sees it: not a tree, a crop or thin air. */
  private isGround(x: number, y: number, z: number): boolean {
    const id = this.world.getVoxel(x, y, z);
    return blocksWalker(id) && !TREE_BLOCKS.has(id);
  }

  /**
   * The ground a tool works in a column: the block picked, if that's ground within
   * reach, or else the top of the ground within reach. Trees, and the air under their
   * leaves, don't count. `wall`: the ground rises on above it, out of reach. `deeper`
   * looks that much further down (for earth, which goes on top of what's found).
   */
  private groundAt(t: Target, deeper = 0): { y: number; wall: boolean } | null {
    const feet = Math.round(this.walker!.y);
    const at = (y: number) => ({ y, wall: this.isGround(t.x, y + 1, t.z) });
    if (t.y !== undefined && this.isGround(t.x, t.y, t.z) && this.reaches(t.x, t.y, t.z)) return at(t.y);
    for (let y = feet + REACH_UP; y >= feet - REACH_DOWN - deeper; y--) if (this.isGround(t.x, y, t.z)) return at(y);
    return null;
  }

  /** Why the ground at (x, y, z) can't be dug, tilled or planted, if it can't. */
  private occupied(x: number, y: number, z: number): string | null {
    if (this.buildingAt(x, y, z) || this.buildingAt(x, y + 1, z)) return 'A building stands there.';
    const above = this.world.getVoxel(x, y + 1, z);
    if (TREE_BLOCKS.has(above)) return 'A tree stands there: fell it first.';
    if (above !== Block.Air && !blocksWalker(above)) return 'Something’s growing there.';
    return null;
  }

  /** What using `held` on a target (a column, or a block picked with the mouse) would do. */
  aim(held: Held, t: Target): Aim {
    const w = this.walker;
    if (!w) return { ok: false, reason: 'You’re aboard ship.' };
    if (isGun(held)) return { ok: false, reason: 'Fire it with Space or a click.' };
    const { x, z } = t;
    if (this.inTown(x, z)) return { ok: false, reason: 'This is the town’s land (marked on the ground): work it in your own camp.' };

    const crop = this.cropAt(x, z);
    if (crop && stageOf(crop, this.sea.time) === 2 && this.reaches(x, crop.y, z)) return { ok: true, action: 'harvest', x, y: crop.y, z };
    const ground = this.groundAt(t);
    const cell = (reason: string, y = ground?.y): Aim => (y === undefined ? { ok: false, reason } : { ok: false, reason, x, y, z });
    const block = ground ? this.world.getVoxel(x, ground.y, z) : Block.Air;

    if (held === 'axe' || held === 'pickaxe') {
      // A tree, an outcrop or a fence: the block picked, or the first in the column from the ground in front up.
      const feet = Math.round(w.y);
      const column = t.y !== undefined && this.reaches(x, t.y, z) ? [t.y] : Array.from({ length: REACH_UP + 2 }, (_, i) => feet - 1 + i);
      for (const y of column) {
        const mine = this.buildingAt(x, y, z);
        if (mine) return STRUCTURES[mine.kind].freeform ? { ok: true, action: 'unbuild', x, y, z } : cell('Take buildings down from the build menu (B).', y);
        if (held === 'axe' && TREE_BLOCKS.has(this.world.getVoxel(x, y, z))) return { ok: true, action: 'fell', x, y, z };
        if (held === 'pickaxe' && this.deposits.at(x, y, z)) return { ok: true, action: 'mine', x, y, z };
      }
      if (held === 'axe') return cell('No tree there to fell.');
      if (!ground) return cell('Nothing within reach to break.');
      if (ROCK.includes(block)) return cell('Only outcrops can be broken: look for stone and ore.');
      return cell('No outcrop there to break.');
    }

    const sapling = held === 'sapling';
    if (held !== 'hoe' && !sapling && !CROP_FOR_SEED[held]) return cell('That won’t grow.');
    if (!sapling && !this.claimed(x, z)) return cell('Build a campfire first: it claims the land around it.');
    if (!ground) return cell(`Nothing within reach to ${held === 'hoe' ? 'till' : 'plant in'}.`);
    const why = this.occupied(x, ground.y, z);
    if (why) return cell(why);
    if (ground.wall) return cell(held === 'hoe' ? 'Only open ground can be tilled.' : 'No room to plant.');

    if (held === 'hoe') {
      if (block === Block.Soil) return cell('Already tilled.');
      if (block !== Block.Grass && block !== Block.Dirt) return cell('Only grass or earth can be tilled.');
      if (ground.y < SEA_LEVEL) return cell('Too close to the sea to farm.');
      return { ok: true, action: 'till', x, y: ground.y, z };
    }
    // Seed or a sapling.
    if (sapling ? !ROOTING.includes(block) : block !== Block.Soil) return cell(sapling ? 'Saplings take root in grass, earth or sand.' : 'Till the ground with the hoe first.');
    if (ground.y + 1 < SEA_LEVEL) return cell('Too wet to plant.');
    if (this.available(held) < 1) return cell(sapling ? 'You have no saplings: fell a tree for some.' : `You have no ${GOOD_INFO[held].label.toLowerCase()}.`);
    return { ok: true, action: 'plant', x, y: ground.y + 1, z };
  }

  /** Uses what's in hand on a target (the column in front, by default). */
  use(held: Held, target: Target | null = this.front()): Outcome {
    if (!target) return fail('You’re aboard ship.');
    if (isGun(held)) return this.fire(held);
    const beast = this.creatureAt(target.x + 0.5, target.z + 0.5);
    if (beast && (TOOL_LIST as readonly Held[]).includes(held)) return this.hit(beast, held as Tool);
    const aim = this.aim(held, target);
    if (!aim.ok) return fail(aim.reason);
    const { x, y, z } = aim;
    const world = this.world;
    switch (aim.action) {
      case 'harvest':
        return this.harvest(this.cropAt(x, z)!);
      case 'fell':
        this.chop(x, y, z);
        return done('');
      case 'unbuild':
        return this.demolish(this.buildingAt(x, y, z)!.id);
      case 'mine':
        return this.quarry(x, y, z);
      case 'till':
        world.setVoxel(x, y, z, Block.Soil);
        break;
      case 'plant':
        this.spend({ [held]: 1 });
        if (held === 'sapling') {
          this.plantSapling(x, y, z);
          break;
        }
        this.fallow = this.fallow.filter((f) => f.x !== x || f.z !== z);
        this.plantCrop(x, y, z, CROP_FOR_SEED[held as Good]!);
        break;
    }
    this.events.push({ kind: 'work', action: aim.action, x, y, z });
    return done('');
  }

  /** Where the captain would dig for treasure: the ground under their feet, or why they can't. */
  digAim(): Aim {
    const w = this.walker;
    if (!w) return { ok: false, reason: 'You’re aboard ship.' };
    const x = Math.floor(w.x);
    const z = Math.floor(w.z);
    const y = Math.round(w.y) - 1;
    const no = (reason: string): Aim => ({ ok: false, reason, x, y, z });
    if (this.inTown(x, z)) return { ok: false, reason: 'This is the town’s land (marked on the ground): nobody digs here.' };
    if (this.buildingAt(x, y, z) || this.buildingAt(x, y + 1, z)) return no('Not under a building.');
    if (!SOFT.includes(this.world.getVoxel(x, y, z))) return no('The ground’s too hard to dig here.');
    if (y + 1 < SEA_LEVEL) return no('Too wet to dig.');
    return { ok: true, action: 'dig', x, y, z };
  }

  /** Digs where the captain stands, for buried treasure. The ground is left as it was: it's the chest that comes up. */
  dig(): Outcome {
    const aim = this.digAim();
    if (!aim.ok) return fail(aim.reason);
    const { x, y, z } = aim;
    const found = this.buried?.search(x, y, z) ?? null;
    this.events.push({ kind: 'work', action: 'dig', x, y, z });
    return done(found ?? 'Nothing here but earth and roots.');
  }

  /** Something comes loose here, to be picked up. */
  drop(good: Good, x: number, y: number, z: number, amount = 1, life = DROP_SECONDS): void {
    dropItem(this, good, amount, x, y, z, this.random, life);
  }

  /** Puts what's picked up in the pack, as much as there's room for; returns how much went in. */
  pocket(good: Good, amount: number): number {
    const n = Math.min(amount, this.roomFor(good));
    this.stow(good, n);
    return n;
  }

  /** A night creature within reach of this point, if there's one. */
  creatureAt(x: number, z: number): Creature | undefined {
    return this.creatures.find((c) => Math.hypot(c.walker.x - x, c.walker.z - z) < 1.3);
  }

  private hit(c: Creature, tool: Tool): Outcome {
    const w = this.walker!;
    const calm = c.fleeing <= 0;
    const caught = strike(c, tool, w.x, w.z);
    if (calm && !caught) bolted(this, c); // one brought down doesn’t run
    return this.landed(c, caught, 'Caught');
  }

  /** A blow or a shot landed on a creature: it bolts, or it's down and what it gives falls where it lay. */
  private landed(c: Creature, caught: Cargo | null, verb: string): Outcome {
    const label = CREATURES[c.kind].label;
    if (!caught) return done(`The ${label} bolts!`);
    this.creatures.splice(this.creatures.indexOf(c), 1);
    const { x, y, z } = c.walker;
    const goods = Object.entries(caught) as Array<[Good, number]>;
    for (const [good, n] of goods) for (let i = 0; i < n; i++) this.drop(good, x, y + 0.3, z);
    this.events.push({ kind: 'work', action: 'catch', x, y, z, good: goods[0]?.[0], amount: cargoCount(caught) });
    return done(`${verb} a ${label}!`);
  }

  /** Picks a ripe crop: what it yields falls at your feet, and the camp's farmers will sow it again. */
  harvest(crop: Crop): Outcome {
    if (stageOf(crop, this.sea.time) < 2) return fail('Not ripe yet.');
    const spec = CROPS[crop.kind];
    this.removeCrop(crop);
    if (this.fireAt(crop.x + 0.5, crop.z + 0.5)) this.fallow.push({ x: crop.x, y: crop.y, z: crop.z, kind: crop.kind });
    for (let i = 0; i < spec.amount; i++) this.drop(spec.harvest, crop.x + 0.5, crop.y + 0.3, crop.z + 0.5);
    this.events.push({ kind: 'work', action: 'harvest', x: crop.x, y: crop.y, z: crop.z, good: spec.harvest, amount: spec.amount });
    return done('');
  }

  /** The captain's axe bites: the tree takes a blow, and comes down with the last one it can stand. */
  private chop(x: number, y: number, z: number): void {
    const { wood, leaves } = this.treeAt(x, y, z);
    const foot = footOf(wood);
    const blows = foot === null ? Infinity : (this.blows.get(foot) ?? 0) + 1;
    if (blows >= blowsToFell(wood.length, leaves.length)) return this.fell(x, y, z);
    this.blows.set(foot!, blows);
    // A few leaves shaken loose from the crown.
    const shaken = Array.from({ length: Math.min(3, leaves.length) }, () => leaves[Math.floor(this.random() * leaves.length)]);
    this.events.push({ kind: 'work', action: 'chop', x, y, z, leaves: shaken.flat() });
  }

  /** A pickaxe blow on an outcrop: it takes the blow, and breaks up with the last one it can stand. */
  private quarry(x: number, y: number, z: number): Outcome {
    const d = this.deposits.at(x, y, z);
    if (!d) return fail('No outcrop there to break.');
    const spec = DEPOSITS[d.kind];
    if (this.deposits.blow(d) < spec.blows) {
      this.events.push({ kind: 'work', action: 'mine', x, y, z });
      return done('');
    }
    const cells = this.deposits.workOut(this.world, d, this.day());
    const amount = spec.yield[0] + Math.floor(this.random() * (spec.yield[1] - spec.yield[0] + 1));
    for (let i = 0; i < amount; i++) {
      const [cx, cy, cz] = cells[i % cells.length];
      this.drop(spec.good, cx + 0.5, cy + 0.5, cz + 0.5);
    }
    this.events.push({ kind: 'work', action: 'break', x, y, z });
    return done('');
  }

  /** A miner's work: the whole outcrop broken up at once, its yield for the camp's stores. Null if it's gone. */
  mineDeposit(id: number): { good: Good; amount: number; x: number; y: number; z: number } | null {
    const d = this.deposits.byId(id);
    if (!d || !this.deposits.standing(d)) return null;
    const spec = DEPOSITS[d.kind];
    const [[x, y, z]] = this.deposits.workOut(this.world, d, this.day());
    const amount = spec.yield[0] + Math.floor(this.random() * (spec.yield[1] - spec.yield[0] + 1));
    return { good: spec.good, amount, x, y, z };
  }

  /** Is anyone (the captain, a settler, a beast) in the way of this cell? */
  private bodyIn(x: number, y: number, z: number): boolean {
    const walkers = [this.walker, ...this.settlers.map((s) => s.walker), ...this.creatures.map((c) => c.walker)];
    return walkers.some(
      (w) => !!w && w.x + HALF_WIDTH > x && w.x - HALF_WIDTH < x + 1 && w.z + HALF_WIDTH > z && w.z - HALF_WIDTH < z + 1 && w.y + HEIGHT > y && w.y < y + 1,
    );
  }

  /** The captain fells a tree: it comes apart into timber, and a sapling or two from its leaves. */
  private fell(x: number, y: number, z: number): void {
    const { wood, leaves } = this.fellTree(x, y, z);
    const drop = (good: Good, [cx, cy, cz]: Cell) => this.drop(good, cx + 0.5, cy + 0.5, cz + 0.5);
    for (const cell of wood) drop('timber', cell);
    const somewhere = () => leaves[Math.floor(this.random() * leaves.length)];
    if (leaves.length > 0) {
      for (let i = Math.floor(leaves.length / 12); i > 0; i--) drop('timber', somewhere());
      for (let i = this.random() < 0.5 ? 2 : 1; i > 0; i--) drop('sapling', somewhere());
    }
    this.events.push({ kind: 'work', action: 'fell', x, y, z, leaves: leaves.flat() });
  }

  /** Cuts down a whole tree from any part of it (see `treeAt`). Returns where its wood and leaves were. */
  private fellTree(x: number, y: number, z: number): { wood: Cell[]; leaves: Cell[] } {
    const tree = this.treeAt(x, y, z);
    for (const [cx, cy, cz] of [...tree.wood, ...tree.leaves]) this.world.setVoxel(cx, cy, cz, Block.Air);
    this.surveys.delete(`trees-${this.fireAt(x, z)?.id}`);
    const foot = footOf(tree.wood);
    if (foot !== null) this.blows.delete(foot);
    return tree;
  }

  /**
   * A whole tree, from any part of it: its trunk, then the leaves that hang from it
   * (closer to it than to any other tree's trunk). Blocks touching at an edge or a
   * corner count, as a palm's trunk leans and its fronds droop that way.
   */
  private treeAt(x: number, y: number, z: number): { wood: Cell[]; leaves: Cell[] } {
    const world = this.world;
    const key = ([cx, cy, cz]: Cell) => `${cx},${cy},${cz}`;
    const is = (c: Cell, ids: (id: number) => boolean) => ids(world.getVoxel(c[0], c[1], c[2])) && !this.buildingAt(c[0], c[1], c[2]);
    const wooden = (id: number) => id === Block.Wood;
    const leafy = (id: number) => TREE_BLOCKS.has(id) && id !== Block.Wood;
    /** Everything reachable from `from` through blocks that `take` accepts, `from` included. */
    const spread = (from: Cell[], take: (c: Cell) => boolean): Cell[] => {
      const seen = new Set(from.map(key));
      const found = [...from];
      for (let i = 0; i < found.length && found.length < TREE_LIMIT; i++) {
        const [cx, cy, cz] = found[i];
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
              const n: Cell = [cx + dx, cy + dy, cz + dz];
              if (seen.has(key(n))) continue;
              seen.add(key(n));
              if (take(n)) found.push(n);
            }
          }
        }
      }
      return found;
    };

    // The trunk: from the block hit, or the nearest wood to the leaves hit.
    let start: Cell = [x, y, z];
    if (!is(start, wooden)) {
      const nearest = spread([start], (c) => is(c, (id) => TREE_BLOCKS.has(id))).find((c) => is(c, wooden));
      if (nearest) start = nearest;
    }
    const wood = is(start, wooden) ? spread([start], (c) => is(c, wooden)) : [];
    const ours = new Set(wood.map(key));
    // Its leaves: those nearer its trunk than any other.
    const hangsHere = ([lx, ly, lz]: Cell): boolean => {
      let mine = Infinity;
      let theirs = Infinity;
      for (let dx = -CANOPY_REACH; dx <= CANOPY_REACH; dx++) {
        for (let dy = -CANOPY_REACH; dy <= CANOPY_REACH; dy++) {
          for (let dz = -CANOPY_REACH; dz <= CANOPY_REACH; dz++) {
            const c: Cell = [lx + dx, ly + dy, lz + dz];
            if (world.getVoxel(c[0], c[1], c[2]) !== Block.Wood) continue;
            const d = dx * dx + dy * dy + dz * dz;
            if (ours.has(key(c))) mine = Math.min(mine, d);
            else theirs = Math.min(theirs, d);
          }
        }
      }
      return mine <= theirs;
    };
    const seeds = wood.length > 0 ? wood : [start];
    const leaves = spread(seeds, (c) => is(c, leafy) && hangsHere(c)).slice(seeds.length);
    if (wood.length === 0 && is(start, leafy)) leaves.unshift(start); // a bush of leaves with no trunk left
    return { wood, leaves };
  }

  // ---- What's around ----

  /** What E / A would do: something right at hand (a door, a fire, a store, a ripe crop), or else the ship if she's in reach. */
  interaction(): Interaction | null {
    const w = this.walker;
    if (!w) return null;
    const close = this.closeInteraction(w);
    if (close) return close;
    return this.nearShip() ? { kind: 'board' } : null;
  }

  private closeInteraction(w: Walker): Interaction | null {
    const near = (x: number, z: number) => Math.hypot(x - w.x, z - w.z) < INTERACT_RANGE;
    for (const place of this.sea.docked?.places ?? []) if (near(place.x, place.z)) return { kind: 'door', place };
    for (const b of this.buildings) {
      if (STRUCTURES[b.kind].freeform) continue;
      const door = doorOf(b);
      const range = b.kind === 'campfire' ? 1 : 0;
      if (Math.hypot(door.x - w.x, door.z - w.z) > INTERACT_RANGE + range) continue;
      if (b.kind === 'storehouse') return { kind: 'store', building: b };
      if (b.kind === 'hut') return { kind: 'rest', building: b };
      const fire = b.kind === 'campfire' ? b : this.fireAt(b.x0 + b.w / 2, b.z0 + b.d / 2);
      if (fire) return { kind: 'camp', fire, building: b };
    }
    const chest = this.bandits.chestAt(w.x, w.z);
    if (chest) return { kind: 'chest', camp: chest.id };
    const front = this.front();
    const crop = front && this.cropAt(front.x, front.z);
    if (crop && stageOf(crop, this.sea.time) === 2) return { kind: 'harvest', crop };
    return null;
  }

  claimed(x: number, z: number): boolean {
    return this.fireAt(x, z) !== undefined;
  }

  /** Is one of the captain's campfires within `r` of (x, z)? */
  private claimNear(x: number, z: number, r: number): boolean {
    return this.buildings.some((b) => b.kind === 'campfire' && Math.hypot(fireCentre(b).x - x, fireCentre(b).z - z) < r);
  }

  /** Opens a bandits' chest: its gold in the purse, its goods spilling out beside it. */
  openChest(id: number): Outcome {
    const camp = this.bandits.camps.find((c) => c.id === id);
    if (!camp || this.bandits.state(id).looted) return fail('It’s empty.');
    const { gold, goods } = this.bandits.loot(camp, this.random);
    this.sea.captain.gold += gold;
    for (const [good, n] of Object.entries(goods) as Array<[Good, number]>) this.drop(good, camp.chest.x + 0.5, camp.chest.y + 1.2, camp.chest.z + 0.5, n);
    return done(`The bandits’ chest: ${gold} gold${cargoCount(goods) > 0 ? ', and goods spill out' : ''}.`);
  }

  inTown(x: number, z: number): boolean {
    return this.townAt(x, z) !== undefined;
  }

  /** The port whose town this point is in, if any. */
  townAt(x: number, z: number): Port | undefined {
    return this.sea.ports.find((p) => Math.hypot(p.x - x, p.z - z) < TOWN_RADIUS);
  }

  cropAt(x: number, z: number): Crop | undefined {
    return this.crops.find((c) => c.x === x && c.z === z);
  }

  /** The building standing on this cell, if any (roof overhangs included). */
  buildingAt(x: number, y: number, z: number): Building | undefined {
    return this.buildings.find((b) => {
      const { pad, height: top } = STRUCTURES[b.kind];
      const bottom = b.kind === 'path' ? b.y - 1 : b.y;
      return x >= b.x0 - pad && x < b.x0 + b.w + pad && z >= b.z0 - pad && z < b.z0 + b.d + pad && y >= bottom && y < b.y + top;
    });
  }

  // ---- Building ----

  /** Whether a structure can go here, and the plot and floor height it would get. */
  placement(kind: Structure, cx: number, cz: number, rot: number): Placement {
    const spec = STRUCTURES[kind];
    const plot = plotFor(kind, cx, cz, rot);
    const verdict = (ok: boolean, reason: string, y = groundHeight(this.world, cx, cz)): Placement => ({ plot, y, ok, reason });
    if (!this.walker) return verdict(false, 'Go ashore to build.');
    if (this.inTown(cx, cz)) return verdict(false, 'Not in town (its land is marked on the ground): build on your own.');
    // Measured from where the fire's claim would be centred, as a loaded game measures it.
    const fire = fireCentre(plot);
    if (kind === 'campfire' && this.bandits.holds(fire.x, fire.z)) return verdict(false, 'Bandits hold this ground: clear their camp first.');
    if (kind !== 'campfire' && !this.claimed(cx, cz)) return verdict(false, 'Build a campfire first: it claims the land around it.');
    if (this.buildings.some((b) => overlaps(b, plot, spec.freeform ? 0 : 1))) return verdict(false, 'Too close to another building.');
    if (this.deposits.inPlot(plot, spec.freeform ? 0 : 1)) return verdict(false, 'An outcrop is in the way: mine it first.');
    if (this.crops.some((c) => c.x >= plot.x0 - 1 && c.x <= plot.x0 + plot.w && c.z >= plot.z0 - 1 && c.z <= plot.z0 + plot.d)) return verdict(false, 'There are crops in the way.');
    let y: number;
    if (spec.freeform) {
      y = groundHeight(this.world, cx, cz);
      const ground = this.world.getVoxel(cx, y - 1, cz);
      if (y < SEA_LEVEL) return verdict(false, 'Too wet.', y);
      if (PIECES[kind] && (shapeOf(ground) !== null || !blocksWalker(ground))) return verdict(false, 'Stairs and slabs go on solid ground.', y);
      // A fence or a torch fills its whole cell from the foot: on a stair or a slab it would
      // float half a block over the step. (A path wants grass, earth or sand, below.)
      if (kind !== 'path' && shapeOf(ground) !== null) return verdict(false, 'That won’t stand on a slab or a stair.', y);
      if (kind === 'path' ? ![Block.Grass, Block.Dirt, Block.Sand].includes(ground as never) : this.world.getVoxel(cx, y, cz) !== Block.Air) {
        return verdict(false, kind === 'path' ? 'Paths go on grass, earth or sand.' : 'Something’s in the way.', y);
      }
    } else {
      const level = levelGround(this.world, plot, 2);
      if (level === null) return verdict(false, 'The ground here is too steep or too wet.');
      y = level;
    }
    const short = this.shortfall(spec.cost);
    if (short) return verdict(false, short, y);
    return verdict(true, '', y);
  }

  build(kind: Structure, cx: number, cz: number, rot: number): Outcome {
    const where = this.placement(kind, cx, cz, rot);
    if (!where.ok) return fail(where.reason);
    const spec = STRUCTURES[kind];
    this.spend(spec.cost);
    const b: Building = { id: this.nextId++, kind, ...where.plot, y: where.y, rot };
    if (kind === 'storehouse') b.store = {};
    if (isWorkshop(kind)) b.work = { recipe: 0, progress: 0 };
    if (!spec.freeform) clearSite(this.world, b, b.y, 1);
    raise(this.world, b);
    this.buildings.push(b);
    this.events.push({ kind: 'built', structure: kind, x: cx, y: where.y, z: cz });
    return done(kind === 'campfire' ? 'The fire catches. This land is your camp now.' : spec.freeform ? '' : `${spec.label} built.`);
  }

  /** Takes a building down: half its materials back (all of them for fences and paths), and a storehouse's contents into the pack or the ground. */
  demolish(id: number): Outcome {
    const b = this.buildings.find((o) => o.id === id);
    if (!b) return fail('Nothing there.');
    const spec = STRUCTURES[b.kind];
    if (b.kind === 'campfire' && this.buildings.some((o) => o !== b && o.kind !== 'campfire' && this.claimedBy(o, b))) {
      return fail('Other buildings stand on this claim: take them down first.');
    }
    if (b.kind === 'campfire' && this.settlersAt(b).length > 0) return fail('Your settlers live here: send them aboard first.');
    for (const s of this.settlers) if (s.post === b.id) Object.assign(s, { job: 'idle', post: null });
    if (b.store && cargoCount(b.store) > 0) return fail('Empty the storehouse first.');
    raze(this.world, b);
    this.buildings.splice(this.buildings.indexOf(b), 1);
    for (const [good, n] of Object.entries(spec.cost) as Array<[Good, number]>) {
      this.stow(good, Math.min(this.roomFor(good), spec.freeform ? n : Math.floor(n / 2)));
    }
    this.events.push({ kind: 'razed', structure: b.kind, x: b.x0, y: b.y, z: b.z0 });
    return done(spec.freeform ? '' : `${spec.label} taken down.`);
  }

  /** Does campfire `fire` hold the claim `b` stands on, with no other fire to keep it? */
  private claimedBy(b: Building, fire: Building): boolean {
    const inside = (f: Building) => Math.hypot(f.x0 + 1.5 - (b.x0 + b.w / 2), f.z0 + 1.5 - (b.z0 + b.d / 2)) <= CLAIM_RADIUS;
    return inside(fire) && !this.buildings.some((f) => f !== fire && f.kind === 'campfire' && inside(f));
  }

  // ---- Materials: the pack, storehouses nearby, and the ship at anchor ----

  /** Room left in the pack (the pouch's cartridges take none of it). */
  packRoom(): number {
    return PACK_SIZE - packLoad(this.pack);
  }

  /** Room for `good` in what the captain carries: cartridges go in the pouch, with no limit. */
  roomFor(good: Good): number {
    return good === 'cartridges' ? Infinity : this.packRoom();
  }

  private stow(good: Good, amount: number): void {
    if (amount > 0) this.pack[good] = (this.pack[good] ?? 0) + amount;
  }

  /** Where materials can come from right now, pack first. */
  supplies(): Cargo[] {
    const w = this.walker;
    if (!w) return [];
    const list: Cargo[] = [this.pack];
    for (const b of this.buildings) if (b.store && Math.hypot(b.x0 - w.x, b.z0 - w.z) < SUPPLY_RANGE) list.push(b.store);
    const ship = this.sea.player.ship;
    if (Math.hypot(ship.x - w.x, ship.z - w.z) < SUPPLY_RANGE) list.push(this.sea.player.cargo);
    return list;
  }

  available(good: Good): number {
    return this.supplies().reduce((sum, c) => sum + (c[good] ?? 0), 0);
  }

  /** What's missing to pay for something, or null if it can be paid. */
  shortfall(cost: Cargo): string | null {
    const missing = (Object.entries(cost) as Array<[Good, number]>).filter(([good, n]) => this.available(good) < n);
    if (missing.length === 0) return null;
    return `Needs ${missing.map(([good, n]) => `${n - this.available(good)} more ${GOOD_INFO[good].label.toLowerCase()}`).join(' and ')}.`;
  }

  private spend(cost: Cargo): void {
    for (const [good, n] of Object.entries(cost) as Array<[Good, number]>) {
      let owed = n;
      for (const source of this.supplies()) owed -= unload(source, good, owed);
    }
  }

  /** Moves goods between two containers (pack, storehouse, hold), within the receiver's room. */
  static transfer(from: Cargo, to: Cargo, good: Good, amount: number, room: number): number {
    const n = Math.min(amount, from[good] ?? 0, Math.max(0, room));
    if (n <= 0) return 0;
    unload(from, good, n);
    to[good] = (to[good] ?? 0) + n;
    return n;
  }

  // ---- Growing ----

  private grow(): void {
    for (const crop of this.crops) {
      const stage = stageOf(crop, this.sea.time);
      if (this.shown.get(crop) === stage) continue;
      this.shown.set(crop, stage);
      showCrop(this.world, crop, stage);
    }
    for (const sapling of [...this.saplings]) {
      const stage = saplingStage(sapling, this.sea.time);
      if (this.shown.get(sapling) === stage) continue;
      this.shown.set(sapling, stage);
      showSapling(this.world, sapling, stage);
      if (stage === 2) {
        this.saplings.splice(this.saplings.indexOf(sapling), 1);
        this.surveys.delete(`trees-${this.fireAt(sapling.x, sapling.z)?.id}`);
      }
    }
    // Outcrops due back grow where nothing stands in the way.
    const clear = (x: number, y: number, z: number) => this.world.getVoxel(x, y, z) === Block.Air && !this.buildingAt(x, y, z) && !this.bodyIn(x, y, z);
    // Only on the ground as it lay: not over a hole, a field or a path.
    const firm = (x: number, y: number, z: number) => NATURAL_GROUND.includes(this.world.getVoxel(x, y, z));
    this.deposits.regrow(this.world, this.day(), clear, firm);
    this.bandits.reman(this.day(), (x, z, r) => this.claimNear(x, z, r));
  }
}

const done = (message: string): Outcome => ({ ok: true, message });
const fail = (message: string): Outcome => ({ ok: false, message });

/** The foot of a trunk (its lowest block), which names the tree; null if there's no trunk. */
function footOf(wood: readonly Cell[]): string | null {
  if (wood.length === 0) return null;
  const [x, y, z] = wood.reduce((low, c) => (c[1] < low[1] || (c[1] === low[1] && (c[0] < low[0] || (c[0] === low[0] && c[2] < low[2]))) ? c : low));
  return `${x},${y},${z}`;
}

/** Axe blows a tree stands: a young palm three, the tallest palms and broadest crowns five or six. */
export function blowsToFell(wood: number, leaves: number): number {
  return Math.min(BLOWS[1], Math.max(BLOWS[0], wood + Math.round(leaves / 4) - 7));
}
