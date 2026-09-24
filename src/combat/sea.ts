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
import { createVessel, distanceToBody, type ShipClass, type Side, syncCondition, toLocal, type Vessel, type VesselStatus } from './vessel';

export type SeaEvent =
  | { kind: 'fire'; x: number; y: number; z: number; dirX: number; dirZ: number; vessel: number }
  | { kind: 'hit'; x: number; y: number; z: number; ammo: Ammo; vessel: number }
  | { kind: 'splash'; x: number; z: number; ammo: Ammo }
  | { kind: 'thud'; x: number; y: number; z: number }
  | { kind: 'barrel'; x: number; z: number }
  | { kind: 'explosion'; x: number; z: number }
  | { kind: 'struck'; vessel: number; name: string }
  | { kind: 'sinking'; vessel: number; name: string }
  | { kind: 'captured'; vessel: number; name: string; joined: number }
  | { kind: 'repelled'; vessel: number; name: string; lost: number }
  | { kind: 'spawned'; vessel: number; name: string }
  | { kind: 'overrun' }
  | { kind: 'respawn' };

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
  private readonly home: { x: number; z: number; heading: number };

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
    this.home = { ...start };
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
   * Boarding. A ship that has struck is taken without a fight; otherwise the crews fight
   * it out, weighted by numbers. (Phase 3b replaces the dice with a captains' duel.)
   */
  private board(): void {
    const target = this.boardingTarget();
    if (!target) return;
    const p = this.player;
    let won = target.status === 'struck';
    if (!won) {
      const ours = p.crew * (0.75 + this.random() * 0.5);
      const theirs = target.crew * (0.75 + this.random() * 0.5);
      won = ours > theirs;
      if (!won) {
        const lost = Math.round(p.crew * 0.25);
        p.crew -= lost;
        target.crew *= 0.9;
        syncCondition(p);
        syncCondition(target);
        this.provoke(target, p.id);
        this.emit({ kind: 'repelled', vessel: target.id, name: target.name, lost });
        return;
      }
      p.crew = Math.max(1, p.crew - Math.round(target.crew * 0.15));
    }
    // Half the prize crew sign on, as far as there are hammocks for them.
    const joined = Math.min(p.cls.type.crew - Math.floor(p.crew), Math.floor(target.crew * 0.5));
    p.crew += Math.max(0, joined);
    syncCondition(p);
    target.status = 'captured';
    target.fate = 0;
    this.emit({ kind: 'captured', vessel: target.id, name: target.name, joined: Math.max(0, joined) });
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
        if (v.fate > RESPAWN_SECONDS) this.respawn(v);
      } else if (v.fate > (v.status === 'sinking' ? SINK_SECONDS : CAPTURED_SECONDS)) {
        gone.push(v);
      }
    }
    this.remove(gone);
  }

  /** A new ship at the home island, patched up and crewed. */
  private respawn(p: Vessel): void {
    const fresh = createVessel(p.id, p.name, 'player', p.cls, this.home.x, this.home.z, this.home.heading, 0);
    this.vessels[0] = fresh;
    this.barrels.length = 0;
    this.emit({ kind: 'respawn' });
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
