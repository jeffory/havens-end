import { cargoCount, loadCargo } from '../economy/goods';
import { stepShip } from '../sailing/ship';
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
  | { kind: 'sinking'; vessel: number; name: string }
  | { kind: 'captured'; vessel: number; name: string; joined: number; gold: number; goods: number }
  | { kind: 'boardingFight'; vessel: number; name: string; faction: Faction }
  | { kind: 'jailed'; fine: number; goods: number; port: string }
  | { kind: 'spawned'; vessel: number; name: string }
  | { kind: 'overrun' }
  | { kind: 'respawn'; goods: number; port: string };

/** What the player's helmsman, gun crews and boarding party are told this tick. */
export interface PlayerOrders {
  rudder: number;
  sails: number;
  ammo: Ammo;
  fire: Side[];
  board: boolean;
}

const SINK_SECONDS = 7;
const RESPAWN_SECONDS = 5;
/** Share of the captain's gold it costs to buy your way out of jail. */
export const JAIL_FINE = 0.3;
const STARTING_GOLD = 200;

/** A harbour to come home to. Phase 4 adds more; for now there's Haven, the home island. */
export interface Port {
  name: string;
  x: number;
  z: number;
  heading: number;
}

/** The player as a person rather than a ship: what survives losing the ship. */
export interface Captain {
  gold: number;
  lastPort: Port;
}
const CAPTURED_SECONDS = 1.5;
const BOARDING_GAP = 5;
const BOARDING_SPEED = 4;
const MAX_EVENTS = 500;

/**
 * Everything afloat and everything flying: ships, shots, barrels and the encounter
 * director, advanced together one fixed step at a time. Pure simulation: no rendering,
 * seeded randomness, so the same seed and orders always play out the same way.
 */
export class Sea {
  time = 0;
  readonly vessels: Vessel[] = [];
  readonly shots: Shot[] = [];
  readonly barrels: Barrel[] = [];
  nextId = 1;
  readonly random: () => number;
  readonly encounters = new Encounters();
  private events: SeaEvent[] = [];
  readonly captain: Captain;
  /** The ship the player is fighting their way aboard, while the captains' duel plays out. */
  boarding: number | null = null;

  constructor(
    readonly world: VoxelWorld,
    readonly weather: Weather,
    private readonly classes: Map<ShipType, ShipClass>,
    playerType: ShipType,
    start: { x: number; z: number; heading: number },
    seed: number,
    /** Tests switch the encounter director off to stage exact situations. */
    private readonly spawning = true,
  ) {
    this.random = mulberry32(seed);
    this.captain = { gold: STARTING_GOLD, lastPort: { name: 'Haven', ...start } };
    this.add(createVessel(this.nextId++, 'Your sloop', 'player', this.classFor(playerType), start.x, start.z, start.heading, 0));
  }

  /** The player's ship is always the first vessel. */
  get player(): Vessel {
    return this.vessels[0];
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
      stepShip(v.ship, v.cls.spec, v.helm, this.weather.windAt(v.ship.x, v.ship.z, this.time), this.world, dt);
    }
    this.separate();
    stepShots(this, dt);
    stepBarrels(this, dt);
    this.fates(dt);
    if (this.spawning) this.encounters.step(this, dt);
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
    if (v.status === 'sinking') this.emit({ kind: 'sinking', vessel: v.id, name: v.name });
    if (v.status === 'captured' && v.faction === 'player') this.emit({ kind: 'overrun' });
  }

  /** Being shot at makes a ship (and her whole group) hostile to whoever fired. */
  provoke(v: Vessel, attacker: number): void {
    if (attacker !== this.player.id) return;
    for (const other of this.vessels) if (other.group === v.group && other.ai) other.ai.alerted = true;
  }

  private obey(orders: PlayerOrders): void {
    const p = this.player;
    if (p.status !== 'afloat') return;
    p.helm.rudder = orders.rudder;
    p.helm.sails = orders.sails;
    p.ammo = orders.ammo;
    for (const side of orders.fire) fireBroadside(this, p, side);
    if (orders.board) this.board();
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
    this.emit({ kind: 'captured', vessel: target.id, name: target.name, joined, gold: target.gold, goods: cargoCount(moved) });
    target.gold = 0;
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
    const p = this.player;
    const port = this.captain.lastPort;
    this.vessels[0] = createVessel(p.id, p.name, 'player', p.cls, port.x, port.z, port.heading, 0);
    this.barrels.length = 0;
  }
}

/** Does any of `a`'s waterline outline lie inside `b`'s hull? */
function overlaps(a: Vessel, b: Vessel): boolean {
  const outline = a.cls.spec.outline;
  const s = Math.sin(a.ship.heading);
  const c = Math.cos(a.ship.heading);
  const body = b.cls.body;
  for (let i = 0; i < outline.length; i += 4) {
    const x = a.ship.x + outline[i] * c + outline[i + 1] * s;
    const z = a.ship.z - outline[i] * s + outline[i + 1] * c;
    const [lx, lz] = toLocal(b, x, z);
    if (Math.abs(lx) < body.halfBeam && lz > body.stern && lz < body.bow) return true;
  }
  return false;
}
