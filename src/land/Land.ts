import { DOCK_SPEED, type Sea } from '../combat/sea';
import { distanceToBody } from '../combat/vessel';
import { SEA_LEVEL } from '../config';
import { PACK_SIZE } from '../economy/captain';
import { type Cargo, cargoCount, GOOD_INFO, type Good, loadCargo, unload } from '../economy/goods';
import type { PortPlace } from '../economy/ports';
import { Block } from '../voxel/blocks';
import type { VoxelWorld } from '../voxel/VoxelWorld';
import { groundHeight, levelGround, clearSite, overlaps, TREE_BLOCKS, type Footprint } from '../worldgen/buildings';
import { clearCrop, CROP_FOR_SEED, CROPS, type Crop, showCrop, type Stage, stageOf } from './crops';
import { type Building, doorOf, plotFor, raise, raze, type Structure, STRUCTURES } from './structures';
import { createWalker, standable, stepWalker, type Walker } from './walker';

export type Tool = 'axe' | 'pickaxe' | 'shovel' | 'hoe';
export const TOOL_LIST: readonly Tool[] = ['axe', 'pickaxe', 'shovel', 'hoe'];
/** What's in the captain's hands: a tool, or a seed to plant. */
export type Held = Tool | Good;

/** A campfire claims the land this far around it. */
export const CLAIM_RADIUS = 32;
/** A port's town and harbour: nobody digs, fells or builds within this of the berth. */
export const TOWN_RADIUS = 80;
/** How far in front of their feet the captain works. */
const WORK_DISTANCE = 1.25;
/** Reach for a picked cell (the mouse). */
export const REACH = 3.6;
/** How far the ship's side can be from where you land: the boat rows you that far, and back. */
const LANDING_RANGE = 12;
const BOARD_RANGE = LANDING_RANGE + 1;
/** Storehouses, and the ship at anchor, within this of the captain supply building work. */
export const SUPPLY_RANGE = 60;
const INTERACT_RANGE = 2.2;
const TREE_LIMIT = 300;

export type LandEvent =
  | { kind: 'ashore'; x: number; y: number; z: number }
  | { kind: 'aboard'; stowed: number; left: number }
  | { kind: 'work'; action: Action; x: number; y: number; z: number; good?: Good; amount?: number }
  | { kind: 'built'; structure: Structure; x: number; y: number; z: number }
  | { kind: 'razed'; structure: Structure; x: number; y: number; z: number };

export type Action = 'fell' | 'mine' | 'dig' | 'fill' | 'till' | 'plant' | 'harvest' | 'unbuild';

/** What a tool would do if used now: the cell it would work, or why it can't. */
export type Aim = { ok: true; action: Action; x: number; y: number; z: number } | { ok: false; reason: string; x?: number; y?: number; z?: number };

export interface Outcome {
  ok: boolean;
  message: string;
}

export type Interaction =
  | { kind: 'board' }
  | { kind: 'door'; place: PortPlace }
  | { kind: 'rest'; building: Building }
  | { kind: 'store'; building: Building }
  | { kind: 'harvest'; crop: Crop };

export interface LandSnapshot {
  walker: { x: number; y: number; z: number; facing: number } | null;
  buildings: Building[];
  crops: Crop[];
  nextId: number;
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
  nextId = 1;
  private events: LandEvent[] = [];
  private growIn = 0;
  /** The stage each crop is drawn at (redrawn when it grows; everything is redrawn after a load). */
  private readonly shown = new WeakMap<Crop, Stage>();

  constructor(
    readonly world: VoxelWorld,
    readonly sea: Sea,
  ) {}

  /** The camps, fields and the captain on foot, for a save. The voxels themselves are saved with the world. */
  snapshot(): LandSnapshot {
    const w = this.walker;
    return {
      walker: w ? { x: w.x, y: w.y, z: w.z, facing: w.facing } : null,
      buildings: structuredClone(this.buildings),
      crops: structuredClone(this.crops),
      nextId: this.nextId,
    };
  }

  restore(s: LandSnapshot): void {
    this.walker = s.walker ? createWalker(s.walker.x, s.walker.y, s.walker.z, s.walker.facing) : null;
    this.buildings = structuredClone(s.buildings);
    this.crops = structuredClone(s.crops);
    this.nextId = s.nextId;
    this.growIn = 0;
  }

  takeEvents(): LandEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  get pack(): Cargo {
    return this.sea.captain.pack;
  }

  step(dt: number, moveX: number, moveZ: number): void {
    if (this.walker) stepWalker(this.walker, moveX, moveZ, this.world, dt);
    this.growIn -= dt;
    if (this.growIn <= 0) {
      this.growIn = 1;
      this.grow();
    }
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
    this.events.push({ kind: 'ashore', ...spot });
    return done('You row ashore; the crew keep her at anchor.');
  }

  /** Docked in a port: the captain steps off onto the pier. */
  landAtPort(): void {
    const port = this.sea.docked;
    if (!port) return;
    this.walker = createWalker(port.pier.x, port.pier.y, port.pier.z, port.heading + Math.PI);
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
    this.walker = null;
    if (this.sea.docked) this.sea.undock();
    else this.sea.ashore = false;
    const stowed = cargoCount(moved);
    this.events.push({ kind: 'aboard', stowed, left: cargoCount(this.pack) });
    return done(stowed > 0 ? `Back aboard; ${stowed} goods stowed in the hold.` : 'Back aboard.');
  }

  // ---- Working the land ----

  /** The column in front of the captain's feet. */
  front(): { x: number; z: number } | null {
    const w = this.walker;
    if (!w) return null;
    return { x: Math.floor(w.x + Math.sin(w.facing) * WORK_DISTANCE), z: Math.floor(w.z + Math.cos(w.facing) * WORK_DISTANCE) };
  }

  /** What using `held` on the column (x, z) would do. */
  aim(held: Held, x: number, z: number): Aim {
    const w = this.walker;
    if (!w) return { ok: false, reason: 'You’re aboard ship.' };
    const feet = Math.round(w.y);
    const top = groundHeight(this.world, x, z); // first empty cell above the ground (trees aside)
    const ground = this.world.getVoxel(x, top - 1, z);
    const cell = (reason: string, y = top - 1): Aim => ({ ok: false, reason, x, y, z });
    if (this.inTown(x, z)) return cell('This is the town’s land: work it in your own camp.');

    const crop = this.cropAt(x, z);
    if (crop && stageOf(crop, this.sea.time) === 2) return { ok: true, action: 'harvest', x, y: crop.y, z };

    if (held === 'axe' || held === 'pickaxe') {
      // A tree or rock in front, from the feet up.
      for (let y = feet - 1; y <= feet + 3; y++) {
        const id = this.world.getVoxel(x, y, z);
        const mine = this.buildingAt(x, y, z);
        if (mine) return STRUCTURES[mine.kind].freeform ? { ok: true, action: 'unbuild', x, y, z } : cell('Take buildings down from the build menu (B).', y);
        if (held === 'axe' && TREE_BLOCKS.has(id)) return { ok: true, action: 'fell', x, y, z };
        if (held === 'pickaxe' && id === Block.Stone && y >= feet - 1) return { ok: true, action: 'mine', x, y, z };
      }
      return cell(held === 'axe' ? 'No tree there to fell.' : 'No rock there to break.');
    }

    if (!this.claimed(x, z)) return cell('Build a campfire first: it claims the land around it.');
    if (this.buildingAt(x, top - 1, z) || this.buildingAt(x, top, z)) return cell('A building stands there.');
    if (crop) return cell('Something’s growing there.', crop.y);

    if (held === 'shovel') {
      // Level the ground toward your feet; on level ground, dig.
      if (top < SEA_LEVEL) return cell('Too wet to dig.');
      if (top < feet) return { ok: true, action: 'fill', x, y: top, z };
      if (top - 1 <= 0) return cell('Bedrock.');
      if (![Block.Grass, Block.Dirt, Block.Sand, Block.Soil, Block.Stone, Block.Gravel].includes(ground as never)) return cell('The shovel won’t shift that.');
      return { ok: true, action: 'dig', x, y: top - 1, z };
    }
    if (held === 'hoe') {
      if (ground === Block.Soil) return cell('Already tilled.');
      if (ground !== Block.Grass && ground !== Block.Dirt) return cell('Only grass or earth can be tilled.');
      if (top < SEA_LEVEL + 1) return cell('Too close to the sea to farm.');
      return { ok: true, action: 'till', x, y: top - 1, z };
    }
    // A seed.
    if (!CROP_FOR_SEED[held]) return cell('That won’t grow.');
    if (ground !== Block.Soil) return cell('Till the ground with the hoe first.');
    if (this.world.getVoxel(x, top, z) !== Block.Air) return cell('No room to plant.');
    if (this.available(held) < 1) return cell(`You have no ${GOOD_INFO[held].label.toLowerCase()}.`);
    return { ok: true, action: 'plant', x, y: top, z };
  }

  /** Uses what's in hand on a column (the one in front, by default). */
  use(held: Held, target = this.front()): Outcome {
    if (!target) return fail('You’re aboard ship.');
    const aim = this.aim(held, target.x, target.z);
    if (!aim.ok) return fail(aim.reason);
    const { x, y, z } = aim;
    const world = this.world;
    switch (aim.action) {
      case 'harvest':
        return this.harvest(this.cropAt(x, z)!);
      case 'fell': {
        if (this.packRoom() < 1) return fail('Your pack is full.');
        const { wood, leaves } = this.fellTree(x, y, z);
        const timber = Math.min(this.packRoom(), wood + Math.floor(leaves / 12));
        this.stow('timber', timber);
        this.events.push({ kind: 'work', action: 'fell', x, y, z, good: 'timber', amount: timber });
        return done(`Felled: ${timber} timber.`);
      }
      case 'mine':
        if (this.packRoom() < 1) return fail('Your pack is full.');
        world.setVoxel(x, y, z, Block.Air);
        this.stow('stone', 1);
        this.events.push({ kind: 'work', action: 'mine', x, y, z, good: 'stone', amount: 1 });
        return done('Broke off 1 stone.');
      case 'unbuild': {
        const b = this.buildingAt(x, y, z)!;
        return this.demolish(b.id);
      }
      case 'dig':
        world.setVoxel(x, y, z, Block.Air);
        break;
      case 'fill':
        world.setVoxel(x, y, z, Block.Dirt);
        break;
      case 'till':
        world.setVoxel(x, y, z, Block.Soil);
        break;
      case 'plant': {
        const kind = CROP_FOR_SEED[held as Good]!;
        this.spend({ [held]: 1 });
        const crop: Crop = { x, y, z, kind, planted: this.sea.time };
        this.crops.push(crop);
        this.shown.set(crop, 0);
        showCrop(world, crop, 0);
        break;
      }
    }
    this.events.push({ kind: 'work', action: aim.action, x, y, z });
    return done('');
  }

  harvest(crop: Crop): Outcome {
    if (stageOf(crop, this.sea.time) < 2) return fail('Not ripe yet.');
    const spec = CROPS[crop.kind];
    if (this.packRoom() < spec.amount) return fail('Your pack is full.');
    clearCrop(this.world, crop);
    this.crops.splice(this.crops.indexOf(crop), 1);
    this.stow(spec.harvest, spec.amount);
    this.events.push({ kind: 'work', action: 'harvest', x: crop.x, y: crop.y, z: crop.z, good: spec.harvest, amount: spec.amount });
    return done(`Harvested ${spec.amount} ${GOOD_INFO[spec.harvest].label.toLowerCase()}.`);
  }

  /** Cuts down a whole tree (trunk and canopy) from any part of it. */
  private fellTree(x: number, y: number, z: number): { wood: number; leaves: number } {
    const seen = new Set<string>();
    const queue: Array<[number, number, number]> = [[x, y, z]];
    let wood = 0;
    let leaves = 0;
    while (queue.length > 0 && seen.size < TREE_LIMIT) {
      const [cx, cy, cz] = queue.pop()!;
      const key = `${cx},${cy},${cz}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const id = this.world.getVoxel(cx, cy, cz);
      if (!TREE_BLOCKS.has(id) || this.buildingAt(cx, cy, cz)) continue;
      if (id === Block.Wood) wood++;
      else leaves++;
      this.world.setVoxel(cx, cy, cz, Block.Air);
      queue.push([cx + 1, cy, cz], [cx - 1, cy, cz], [cx, cy + 1, cz], [cx, cy - 1, cz], [cx, cy, cz + 1], [cx, cy, cz - 1]);
    }
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
      const door = doorOf(b);
      const range = b.kind === 'campfire' ? 1 : 0;
      if (Math.hypot(door.x - w.x, door.z - w.z) > INTERACT_RANGE + range) continue;
      if (b.kind === 'storehouse') return { kind: 'store', building: b };
      if (b.kind === 'hut' || b.kind === 'campfire') return { kind: 'rest', building: b };
    }
    const front = this.front();
    const crop = front && this.cropAt(front.x, front.z);
    if (crop && stageOf(crop, this.sea.time) === 2) return { kind: 'harvest', crop };
    return null;
  }

  claimed(x: number, z: number): boolean {
    return this.buildings.some((b) => b.kind === 'campfire' && Math.hypot(b.x0 + 1.5 - x, b.z0 + 1.5 - z) <= CLAIM_RADIUS);
  }

  inTown(x: number, z: number): boolean {
    return this.sea.ports.some((p) => Math.hypot(p.x - x, p.z - z) < TOWN_RADIUS);
  }

  cropAt(x: number, z: number): Crop | undefined {
    return this.crops.find((c) => c.x === x && c.z === z);
  }

  /** The building standing on this cell, if any (roof overhangs included). */
  buildingAt(x: number, y: number, z: number): Building | undefined {
    return this.buildings.find((b) => {
      const pad = b.kind === 'hut' || b.kind === 'storehouse' ? 1 : 0;
      const top = b.kind === 'hut' || b.kind === 'storehouse' ? 8 : b.kind === 'torch' ? 2 : 1;
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
    if (this.inTown(cx, cz)) return verdict(false, 'Not in town: build on your own land.');
    if (kind !== 'campfire' && !this.claimed(cx, cz)) return verdict(false, 'Build a campfire first: it claims the land around it.');
    if (this.buildings.some((b) => overlaps(b, plot, spec.freeform ? 0 : 1))) return verdict(false, 'Too close to another building.');
    if (this.crops.some((c) => c.x >= plot.x0 - 1 && c.x <= plot.x0 + plot.w && c.z >= plot.z0 - 1 && c.z <= plot.z0 + plot.d)) return verdict(false, 'There are crops in the way.');
    let y: number;
    if (spec.freeform) {
      y = groundHeight(this.world, cx, cz);
      const ground = this.world.getVoxel(cx, y - 1, cz);
      if (y < SEA_LEVEL) return verdict(false, 'Too wet.', y);
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
    if (b.store && cargoCount(b.store) > 0) return fail('Empty the storehouse first.');
    raze(this.world, b);
    this.buildings.splice(this.buildings.indexOf(b), 1);
    for (const [good, n] of Object.entries(spec.cost) as Array<[Good, number]>) {
      this.stow(good, Math.min(this.packRoom(), spec.freeform ? n : Math.floor(n / 2)));
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

  packRoom(): number {
    return PACK_SIZE - cargoCount(this.pack);
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
  }
}

const done = (message: string): Outcome => ({ ok: true, message });
const fail = (message: string): Outcome => ({ ok: false, message });
