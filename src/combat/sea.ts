import { advanceClock, type Clock, createClock } from '../core/clock';
import { type Captain, createCaptain } from '../economy/captain';
import { type Contract, creditBounties } from '../economy/contracts';
import type { Logbook } from '../economy/logbook';
import type { Standing } from '../economy/reputation';
import { type Upgrade, withUpgrades } from '../economy/shipyard';
import { type Cargo, cargoCount, loadCargo, unload } from '../economy/goods';
import type { Port, PortFaction } from '../economy/ports';
import { applyDeed, type Deed, portOpen } from '../economy/reputation';
import { hullContacts, type ShipSpec, stepShip } from '../sailing/ship';
import type { ShipType } from '../sailing/ships';
import type { Weather } from '../sailing/weather';
import type { VoxelWorld } from '../voxel/VoxelWorld';
import { mulberry32 } from '../worldgen/noise';
import { thinkCaptain } from './ai';
import type { Ammo } from './ammo';
import { type Barrel, stepBarrels } from './barrels';
import { Encounters } from './encounters';
import { fireBroadside, type Shot, stepShots } from './gunnery';
import { createVessel, distanceToBody, type Faction, type ShipClass, type Side, syncCondition, toLocal, type Vessel, type VesselStatus } from './vessel';

export type SeaEvent =
  | { kind: 'fire'; x: number; y: number; z: number; dirX: number; dirZ: number; vessel: number }
  | { kind: 'hit'; x: number; y: number; z: number; ammo: Ammo; vessel: number }
  | { kind: 'splash'; x: number; z: number; ammo: Ammo }
  | { kind: 'thud'; x: number; y: number; z: number }
  | { kind: 'barrel'; x: number; z: number }
  | { kind: 'explosion'; x: number; z: number }
  | { kind: 'struck'; vessel: number; name: string }
  | { kind: 'sinking'; vessel: number; name: string; faction: Faction }
  | { kind: 'captured'; vessel: number; name: string; faction: Faction; joined: number; gold: number; goods: number }
  | { kind: 'boardingFight'; vessel: number; name: string; faction: Faction }
  | { kind: 'jailed'; fine: number; goods: number; port: string }
  | { kind: 'spawned'; vessel: number; name: string }
  | { kind: 'overrun' }
  | { kind: 'respawn'; goods: number; port: string }
  | { kind: 'standing'; faction: PortFaction; from: number; to: number }
  | { kind: 'bounty'; contract: number; target: PortFaction; progress: number; count: number }
  | { kind: 'docked'; port: number }
  | { kind: 'mending' }
  | { kind: 'refused'; port: number; reason: DockProblem };

/** What the player's helmsman, gun crews and boarding party are told this tick. */
export interface PlayerOrders {
  rudder: number;
  sails: number;
  ammo: Ammo;
  fire: Side[];
  /** Board the ship alongside or, in a harbour, go ashore. */
  board: boolean;
}

/** Why the harbour won't take you right now. */
export type DockProblem = 'closed' | 'fast' | 'enemies';

export interface SeaSnapshot {
  time: number;
  /** Time of day (older saves have none: it's worked out from `time`). */
  clock?: { day: number; phase: number };
  encounters: number;
  docked: number | null;
  ashore: boolean;
  ship: {
    design: string;
    name: string;
    upgrades: Upgrade[];
    hull: number;
    sails: number;
    crew: number;
    cargo: Cargo;
    ammo: Ammo;
    x: number;
    z: number;
    heading: number;
  };
  captain: {
    gold: number;
    lastPort: number;
    standing: Standing;
    contracts: Contract[];
    logbook: Logbook;
    pack: Cargo;
    passengers?: number;
  };
}

const SINK_SECONDS = 7;
const RESPAWN_SECONDS = 5;
/** Share of the captain's gold it costs to buy your way out of jail. */
export const JAIL_FINE = 0.3;
/** Within this of a berth you're in the harbour, and can dock. */
export const HARBOUR_RADIUS = 45;
/** Come in slower than this (u/s) to go alongside. */
export const DOCK_SPEED = 3;
/** No docking while a ship that's fighting you is this close. */
const DOCK_CLEARANCE = 90;
const CAPTURED_SECONDS = 1.5;
const BOARDING_GAP = 5;
const BOARDING_SPEED = 4;
const MAX_EVENTS = 500;
/** The carpenter's work with planks from the hold: hull points a second, and hull points a plank. */
const CARPENTER_RATE = 1.5;
const HULL_PER_PLANK = 4;

/**
 * Everything afloat and everything flying: ships, shots, barrels and the encounter
 * director, advanced together one fixed step at a time. Pure simulation: no rendering,
 * seeded randomness, so the same seed and orders always play out the same way.
 */
export class Sea {
  time = 0;
  /** Time of day, moving with the sea. Its length is the player's setting. */
  readonly clock: Clock = createClock();
  readonly vessels: Vessel[] = [];
  readonly shots: Shot[] = [];
  readonly barrels: Barrel[] = [];
  nextId = 1;
  random: () => number;
  readonly encounters = new Encounters();
  private events: SeaEvent[] = [];
  readonly captain: Captain;
  /** The ship the player is fighting their way aboard, while the captains' duel plays out. */
  boarding: number | null = null;
  /** The port the player's ship is berthed in, if any. */
  docked: Port | null = null;
  /**
   * The captain is off the ship, on foot. She lies at anchor (or at her berth), nobody
   * comes looking for a fight with an empty ship, and the encounter director waits.
   */
  ashore = false;
  /** Planks' worth of hull the carpenter has mended since the last plank was used up. */
  private carpentry = 0;
  private mending = false;

  constructor(
    readonly world: VoxelWorld,
    readonly weather: Weather,
    private readonly classes: Map<ShipType, ShipClass>,
    /** The ship a captain starts with, and is given again after losing one. */
    private readonly starter: ShipType,
    /** Every harbour in the archipelago; the first is home, where the game starts. */
    readonly ports: readonly Port[],
    seed: number,
    /** Tests switch the encounter director off to stage exact situations. */
    private readonly spawning = true,
  ) {
    this.random = mulberry32(seed);
    this.captain = createCaptain(ports[0]);
    const cls = this.classFor(starter);
    const berth = this.berthFor(cls.spec, ports[0]);
    this.add(createVessel(this.nextId++, 'Your sloop', 'player', cls, berth.x, berth.z, berth.heading, 0));
  }

  /** The player's ship is always the first vessel. */
  get player(): Vessel {
    return this.vessels[0];
  }

  /** What a save keeps of the sea: the captain, their ship, and where things stand. Other ships aren't kept. */
  snapshot(): SeaSnapshot {
    const p = this.player;
    const c = this.captain;
    return {
      time: this.time,
      clock: { day: this.clock.day, phase: this.clock.phase },
      encounters: this.encounters.count,
      docked: this.docked?.id ?? null,
      ashore: this.ashore,
      ship: {
        design: p.cls.design.name,
        name: p.name,
        upgrades: [...p.upgrades],
        hull: p.hull,
        sails: p.sails,
        crew: p.crew,
        cargo: { ...p.cargo },
        ammo: p.ammo,
        x: p.ship.x,
        z: p.ship.z,
        heading: p.ship.heading,
      },
      captain: {
        gold: c.gold,
        lastPort: c.lastPort.id,
        standing: { ...c.standing },
        contracts: structuredClone(c.contracts),
        logbook: structuredClone(c.logbook),
        pack: { ...c.pack },
        passengers: c.passengers,
      },
    };
  }

  restore(s: SeaSnapshot): void {
    this.time = s.time;
    this.clock.day = s.clock?.day ?? 1 + Math.floor(s.time / this.clock.length);
    this.clock.phase = s.clock?.phase ?? (s.time / this.clock.length) % 1;
    this.random = mulberry32(Math.floor(s.time * 1000) ^ 0x5a17);
    this.encounters.count = s.encounters;
    const design = [...this.classes.keys()].find((t) => t.name === s.ship.design);
    if (!design) throw new Error(`Sea.restore: unknown ship design "${s.ship.design}"`);
    const cls = withUpgrades(this.classFor(design), s.ship.upgrades);
    const v = createVessel(this.player.id, s.ship.name, 'player', cls, s.ship.x, s.ship.z, s.ship.heading, 0);
    Object.assign(v, { hull: s.ship.hull, sails: s.ship.sails, crew: s.ship.crew, cargo: { ...s.ship.cargo }, ammo: s.ship.ammo, upgrades: [...s.ship.upgrades] });
    syncCondition(v);
    this.vessels.length = 0;
    this.vessels.push(v);
    this.shots.length = 0;
    this.barrels.length = 0;
    this.boarding = null;
    const c = s.captain;
    Object.assign(this.captain, {
      gold: c.gold,
      lastPort: this.ports[c.lastPort] ?? this.ports[0],
      standing: { ...c.standing },
      contracts: structuredClone(c.contracts),
      logbook: structuredClone(c.logbook),
      pack: { ...c.pack },
      passengers: c.passengers ?? 0,
    });
    this.docked = s.docked === null ? null : (this.ports[s.docked] ?? null);
    this.ashore = s.ashore;
  }

  classFor(type: ShipType): ShipClass {
    const cls = this.classes.get(type);
    if (!cls) throw new Error(`Sea: no model loaded for ship type "${type.name}"`);
    return cls;
  }

  vessel(id: number): Vessel | undefined {
    return this.vessels.find((v) => v.id === id);
  }

  add(v: Vessel): void {
    this.vessels.push(v);
    if (v.faction !== 'player') this.emit({ kind: 'spawned', vessel: v.id, name: v.name });
  }

  remove(gone: Vessel[]): void {
    for (const v of gone) {
      const i = this.vessels.indexOf(v);
      if (i > 0) this.vessels.splice(i, 1);
    }
  }

  emit(event: SeaEvent): void {
    if (this.events.length < MAX_EVENTS) this.events.push(event);
  }

  /** Hands the events since the last call to the presentation layer. */
  takeEvents(): SeaEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  step(dt: number, orders: PlayerOrders): void {
    this.time += dt;
    advanceClock(this.clock, dt);
    for (const v of this.vessels) {
      v.prev.x = v.ship.x;
      v.prev.z = v.ship.z;
      v.prev.heading = v.ship.heading;
      v.reload.port = Math.max(0, v.reload.port - dt);
      v.reload.starboard = Math.max(0, v.reload.starboard - dt);
      v.barrelCooldown = Math.max(0, v.barrelCooldown - dt);
    }

    this.obey(orders);
    for (const v of this.vessels) if (v.ai && v.status !== 'sinking' && v.status !== 'captured') thinkCaptain(this, v, dt);

    for (const v of this.vessels) {
      if (v.status === 'sinking' || v.status === 'captured') {
        v.helm.sails = 0;
        v.helm.rudder = 0;
      }
      if (v === this.player && this.ashore) {
        // At anchor: she rides the swell but goes nowhere.
        Object.assign(v.ship, { surge: 0, sway: 0, yawRate: 0, rudder: 0, sail: 0 });
        continue;
      }
      stepShip(v.ship, v.cls.spec, v.helm, this.weather.windAt(v.ship.x, v.ship.z, this.time), this.world, dt);
    }
    this.separate();
    stepShots(this, dt);
    stepBarrels(this, dt);
    this.fates(dt);
    this.carpenter(dt);
    if (this.spawning) this.encounters.step(this, dt);
  }

  /**
   * Time passing while nothing happens at sea (the captain asleep ashore): the clock and
   * the sea's time move on, and the ships wait where they are.
   */
  pass(seconds: number): void {
    this.time += seconds;
    advanceClock(this.clock, seconds);
  }

  /** Out of a fight, the carpenter mends her hull with planks from the hold. */
  private carpenter(dt: number): void {
    const p = this.player;
    const full = p.cls.type.hull;
    const working = p.status === 'afloat' && p.hull < full && (p.cargo.planks ?? 0) > 0 && !this.hunted();
    if (working && !this.mending) this.emit({ kind: 'mending' });
    this.mending = working;
    if (!working) return;
    const mend = Math.min(full - p.hull, CARPENTER_RATE * dt);
    p.hull += mend;
    this.carpentry += mend / HULL_PER_PLANK;
    if (this.carpentry >= 1) {
      unload(p.cargo, 'planks', 1);
      this.carpentry -= 1;
    }
    syncCondition(p);
  }

  /** Who the player could board right now, if anyone: alongside, and not racing past. */
  boardingTarget(): Vessel | null {
    const p = this.player;
    if (p.status !== 'afloat') return null;
    let best: Vessel | null = null;
    let bestGap = BOARDING_GAP;
    for (const v of this.vessels) {
      if (v === p || (v.status !== 'afloat' && v.status !== 'struck')) continue;
      const gap = distanceToBody(v, p.ship.x, 0, p.ship.z) - p.cls.body.halfBeam;
      const vx = Math.sin(v.ship.heading) * v.ship.surge - Math.sin(p.ship.heading) * p.ship.surge;
      const vz = Math.cos(v.ship.heading) * v.ship.surge - Math.cos(p.ship.heading) * p.ship.surge;
      if (gap < bestGap && Math.hypot(vx, vz) < BOARDING_SPEED) {
        best = v;
        bestGap = gap;
      }
    }
    return best;
  }

  /** Announces a vessel striking her colours or starting to sink, given her status before the damage. */
  reportStatusChange(v: Vessel, before: VesselStatus): void {
    if (v.status === before) return;
    if (v.status === 'struck') this.emit({ kind: 'struck', vessel: v.id, name: v.name });
    if (v.status === 'sinking') {
      this.emit({ kind: 'sinking', vessel: v.id, name: v.name, faction: v.faction });
      // Only ships the player had fired on count as the player's work.
      if (v.ai?.alerted) this.deed(v, 'sink');
    }
    if (v.status === 'captured' && v.faction === 'player') this.emit({ kind: 'overrun' });
  }

  /**
   * Being shot at makes a ship (and her whole group) hostile to whoever fired. Firing
   * first on a ship that wasn't already fighting you is an attack, and word gets round.
   */
  provoke(v: Vessel, attacker: number): void {
    if (attacker !== this.player.id) return;
    const group = this.vessels.filter((o) => o.group === v.group && o.ai);
    const unprovoked = group.some((o) => !o.ai!.alerted) && group.every((o) => o.ai!.mode !== 'engage');
    for (const o of group) o.ai!.alerted = true;
    if (unprovoked) this.deed(v, 'attack');
  }

  /** What the world makes of what the captain did: standing with every flag, and bounties. */
  private deed(v: Vessel, deed: Deed): void {
    if (v.faction === 'player') return;
    for (const change of applyDeed(this.captain.standing, v.faction, deed)) this.emit({ kind: 'standing', ...change });
    if (deed === 'attack') return;
    for (const b of creditBounties(this.captain.contracts, v.faction)) {
      this.emit({ kind: 'bounty', contract: b.id, target: b.target, progress: b.progress, count: b.count });
    }
  }

  /** The harbour the player is in, if any. */
  harbour(): Port | null {
    const { x, z } = this.player.ship;
    return this.ports.find((port) => Math.hypot(port.x - x, port.z - z) < HARBOUR_RADIUS) ?? null;
  }

  /** What's stopping the player going alongside in this port, if anything. */
  dockProblem(port: Port): DockProblem | null {
    const p = this.player.ship;
    if (!portOpen(this.captain.standing, port.faction)) return 'closed';
    if (Math.abs(p.surge) > DOCK_SPEED) return 'fast';
    return this.hunted() ? 'enemies' : null;
  }

  /** Is a ship that's fighting the player close by? (No docking or going ashore then.) */
  hunted(): boolean {
    const p = this.player.ship;
    return this.vessels.some((v) => v.ai?.mode === 'engage' && v.status === 'afloat' && Math.hypot(v.ship.x - p.x, v.ship.z - p.z) < DOCK_CLEARANCE);
  }

  /** Where a ship of this hull lies at a port: the berth, or as near it as she fits. */
  berthFor(spec: ShipSpec, port: Port): { x: number; z: number; heading: number } {
    const fx = Math.sin(port.heading);
    const fz = Math.cos(port.heading);
    let x = port.x;
    let z = port.z;
    const clear = () => [-3, 0, 3].every((d) => hullContacts(this.world, spec, x + fx * d, z + fz * d, port.heading) === 0);
    for (let i = 0; i < 100 && !clear(); i++) {
      x += fx;
      z += fz;
    }
    return { x, z, heading: port.heading };
  }

  /** Back to sea from the berth. */
  undock(): void {
    this.docked = null;
    this.ashore = false;
  }

  /**
   * The shipyard's work: the player's ship replaced by one of `cls`, lying at the berth.
   * Crew and cargo come across as far as they fit; the caller checks the cargo does.
   */
  refit(cls: ShipClass, name: string, upgrades: Vessel['upgrades'] = []): Vessel {
    const old = this.player;
    const port = this.docked ?? this.captain.lastPort;
    const berth = this.berthFor(cls.spec, port);
    const v = createVessel(old.id, name, 'player', cls, berth.x, berth.z, berth.heading, 0);
    v.crew = Math.min(cls.type.crew, Math.floor(old.crew));
    v.hull = Math.min(cls.type.hull, old.cls.design === cls.design ? old.hull : cls.type.hull);
    v.sails = old.cls.design === cls.design ? Math.min(cls.type.sails, old.sails) : cls.type.sails;
    v.cargo = old.cargo;
    v.ammo = old.ammo;
    v.upgrades = upgrades;
    syncCondition(v);
    this.vessels[0] = v;
    return v;
  }

  private obey(orders: PlayerOrders): void {
    const p = this.player;
    if (p.status !== 'afloat' || this.ashore) return;
    p.helm.rudder = orders.rudder;
    p.helm.sails = orders.sails;
    p.ammo = orders.ammo;
    for (const side of orders.fire) fireBroadside(this, p, side);
    if (orders.board) {
      if (this.boardingTarget()) this.board();
      else this.dock();
    }
  }

  /** Goes alongside in the harbour the player is in, if it'll have them. */
  private dock(): void {
    const port = this.harbour();
    if (!port) return;
    const problem = this.dockProblem(port);
    if (problem) {
      this.emit({ kind: 'refused', port: port.id, reason: problem });
      return;
    }
    const p = this.player;
    const berth = this.berthFor(p.cls.spec, port);
    Object.assign(p.ship, { x: berth.x, z: berth.z, heading: berth.heading, surge: 0, sway: 0, yawRate: 0, rudder: 0, sail: 0 });
    Object.assign(p.prev, { x: berth.x, z: berth.z, heading: berth.heading });
    p.helm.sails = 0;
    p.helm.rudder = 0;
    this.docked = port;
    this.ashore = true;
    this.captain.lastPort = port;
    this.emit({ kind: 'docked', port: port.id });
  }

  /**
   * Boarding. A ship that has struck is taken without a fight. Otherwise the captains
   * duel on her deck: the sim waits (the game stops stepping it) until finishBoarding().
   */
  private board(): void {
    const target = this.boardingTarget();
    if (!target) return;
    if (target.status === 'struck') {
      this.capture(target);
      return;
    }
    this.boarding = target.id;
    this.provoke(target, this.player.id);
    this.emit({ kind: 'boardingFight', vessel: target.id, name: target.name, faction: target.faction });
  }

  /** The duel is over: take the ship, or be taken. */
  finishBoarding(won: boolean): void {
    const target = this.boarding === null ? undefined : this.vessel(this.boarding);
    this.boarding = null;
    if (!target) return;
    if (won) {
      // The crews fought too: some of ours fall even in victory.
      const p = this.player;
      p.crew = Math.max(1, p.crew - Math.round(target.crew * 0.1));
      syncCondition(p);
      this.capture(target);
    } else {
      this.jail();
    }
  }

  /** Takes a prize: her coin, as much cargo as fits, and half her crew if there's room. */
  private capture(target: Vessel): void {
    const p = this.player;
    const joined = Math.max(0, Math.min(p.cls.type.crew - Math.floor(p.crew), Math.floor(target.crew * 0.5)));
    p.crew += joined;
    syncCondition(p);
    this.captain.gold += target.gold;
    const moved = loadCargo(p.cargo, target.cargo, p.cls.type.hold - cargoCount(p.cargo));
    target.status = 'captured';
    target.fate = 0;
    this.emit({ kind: 'captured', vessel: target.id, name: target.name, faction: target.faction, joined, gold: target.gold, goods: cargoCount(moved) });
    target.gold = 0;
    this.deed(target, 'capture');
  }

  /** Beaten and taken: pay your way out of jail and start over from the last port, hold empty. */
  private jail(): void {
    const fine = Math.round(this.captain.gold * JAIL_FINE);
    const goods = cargoCount(this.player.cargo);
    this.captain.gold -= fine;
    this.newShip();
    this.emit({ kind: 'jailed', fine, goods, port: this.captain.lastPort.name });
  }

  /** Keeps hulls from passing through each other: overlapping ships are eased apart. */
  private separate(): void {
    const vs = this.vessels;
    for (let i = 0; i < vs.length; i++) {
      for (let j = i + 1; j < vs.length; j++) {
        const a = vs[i];
        const b = vs[j];
        const dx = b.ship.x - a.ship.x;
        const dz = b.ship.z - a.ship.z;
        const reach = (a.cls.body.bow - a.cls.body.stern + b.cls.body.bow - b.cls.body.stern) / 2;
        if (dx * dx + dz * dz > reach * reach || !(overlaps(a, b) || overlaps(b, a))) continue;
        // Ease them apart quickly, and take the way off both: hulls grind, they don't bounce.
        const d = Math.hypot(dx, dz) || 1;
        const push = 0.25;
        a.ship.x -= (dx / d) * push;
        a.ship.z -= (dz / d) * push;
        b.ship.x += (dx / d) * push;
        b.ship.z += (dz / d) * push;
        a.ship.surge *= 0.92;
        b.ship.surge *= 0.92;
      }
    }
  }

  private fates(dt: number): void {
    const gone: Vessel[] = [];
    for (const v of this.vessels) {
      if (v.status !== 'sinking' && v.status !== 'captured') continue;
      v.fate += dt;
      if (v.faction === 'player') {
        // Sunk: wash up at the last port. Overrun: the enemy takes you to jail.
        if (v.fate > RESPAWN_SECONDS) v.status === 'sinking' ? this.respawn() : this.jail();
      } else if (v.fate > (v.status === 'sinking' ? SINK_SECONDS : CAPTURED_SECONDS)) {
        gone.push(v);
      }
    }
    this.remove(gone);
  }

  /** Her cargo went down with her; the captain's purse didn't. */
  private respawn(): void {
    const goods = cargoCount(this.player.cargo);
    this.newShip();
    this.emit({ kind: 'respawn', goods, port: this.captain.lastPort.name });
  }

  /** A fresh sloop, crewed and with an empty hold, waiting at the last port. */
  private newShip(): void {
    this.captain.pack = {};
    this.ashore = false;
    this.docked = null;
    const p = this.player;
    const cls = this.classFor(this.starter);
    const berth = this.berthFor(cls.spec, this.captain.lastPort);
    this.vessels[0] = createVessel(p.id, 'Your sloop', 'player', cls, berth.x, berth.z, berth.heading, 0);
    this.barrels.length = 0;
  }
}

/** Does any of `a`'s waterline footprint lie inside `b`'s hull? (Every other sample is plenty.) */
function overlaps(a: Vessel, b: Vessel): boolean {
  const footprint = a.cls.spec.footprint;
  const s = Math.sin(a.ship.heading);
  const c = Math.cos(a.ship.heading);
  const body = b.cls.body;
  for (let i = 0; i < footprint.length; i += 4) {
    const x = a.ship.x + footprint[i] * c + footprint[i + 1] * s;
    const z = a.ship.z - footprint[i] * s + footprint[i + 1] * c;
    const [lx, lz] = toLocal(b, x, z);
    if (Math.abs(lx) < body.halfBeam && lz > body.stern && lz < body.bow) return true;
  }
  return false;
}
