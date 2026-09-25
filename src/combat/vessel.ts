import type { Cargo } from '../economy/goods';
import type { Upgrade } from '../economy/shipyard';
import { createShip, type Helm, type ShipSpec, type ShipState } from '../sailing/ship';
import type { ShipType } from '../sailing/ships';
import type { AiState } from './ai';
import type { Ammo } from './ammo';

export type Faction = 'player' | 'imperial' | 'pirate' | 'merchant';
export type Side = 'port' | 'starboard';
/** `struck` = has struck her colours (surrendered) and can be boarded without a fight. */
export type VesselStatus = 'afloat' | 'struck' | 'sinking' | 'captured';

/** Hit volume in ship-local space (x port, z bow, y up from the waterline): a box from keel to masthead. */
export interface HullBody {
  halfBeam: number;
  bow: number;
  stern: number;
  draft: number;
  deck: number;
  top: number;
}

/** What the simulation needs to know about a class of ship; the art stays with the renderer. */
export interface ShipClass {
  /** Stats in force, refits included. */
  type: ShipType;
  /** The ship as designed: her art, her price, and the base for refits. */
  design: ShipType;
  spec: ShipSpec;
  body: HullBody;
}

export interface Vessel {
  id: number;
  name: string;
  faction: Faction;
  cls: ShipClass;
  ship: ShipState;
  /** Pose at the previous step, for render interpolation. */
  prev: { x: number; z: number; heading: number };
  helm: Helm;
  hull: number;
  sails: number;
  crew: number;
  /** Seconds until each broadside is loaded. */
  reload: Record<Side, number>;
  ammo: Ammo;
  barrels: number;
  barrelCooldown: number;
  status: VesselStatus;
  /** Seconds since she began to sink, or was taken. */
  fate: number;
  /** Ships spawned together (a convoy and its escorts) share a group. */
  group: number;
  /** An admiral's flagship: she's never taken without a duel with the admiral himself, struck or not. */
  admiral?: boolean;
  ai: AiState | null;
  /** Coin aboard (for AI ships: plunder; the player's purse lives on the captain). */
  gold: number;
  cargo: Cargo;
  /** Shipyard refits, already folded into `cls`. */
  upgrades: Upgrade[];
}

export function shipClass(type: ShipType, footprint: Float32Array, deck: number, top: number): ShipClass {
  let halfBeam = 0;
  let bow = -Infinity;
  let stern = Infinity;
  for (let i = 0; i < footprint.length; i += 2) {
    halfBeam = Math.max(halfBeam, Math.abs(footprint[i]));
    bow = Math.max(bow, footprint[i + 1]);
    stern = Math.min(stern, footprint[i + 1]);
  }
  return {
    type,
    design: type,
    spec: { ...type, footprint },
    body: { halfBeam, bow, stern, draft: type.draft, deck, top },
  };
}

export function createVessel(
  id: number,
  name: string,
  faction: Faction,
  cls: ShipClass,
  x: number,
  z: number,
  heading: number,
  group: number,
): Vessel {
  return {
    id,
    name,
    faction,
    cls,
    ship: createShip(x, z, heading),
    prev: { x, z, heading },
    helm: { rudder: 0, sails: 0 },
    hull: cls.type.hull,
    sails: cls.type.sails,
    crew: cls.type.crew,
    reload: { port: 0, starboard: 0 },
    ammo: 'round',
    barrels: cls.type.barrels,
    barrelCooldown: 0,
    status: 'afloat',
    fate: 0,
    group,
    ai: null,
    gold: 0,
    cargo: {},
    upgrades: [],
  };
}

/** Takes damage and updates everything that depends on it: speed, sail handling, surrender, sinking. */
export function applyDamage(v: Vessel, hull: number, sails: number, crew: number): void {
  if (v.status === 'sinking' || v.status === 'captured') return;
  const type = v.cls.type;
  v.hull = Math.max(0, v.hull - hull);
  v.sails = Math.max(0, v.sails - sails);
  v.crew = Math.max(0, v.crew - crew);
  syncCondition(v);
  if (v.hull <= 0) {
    v.status = 'sinking';
    v.fate = 0;
  } else if (v.faction === 'player' && v.crew < 1) {
    // Nobody left to fight her: the enemy swarms aboard.
    v.status = 'captured';
    v.fate = 0;
  } else if (v.faction !== 'player' && v.status === 'afloat' && (v.hull < 0.2 * type.hull || v.crew < 0.2 * type.crew)) {
    v.status = 'struck';
  }
}

/** Pushes hull, sail and crew numbers into the sailing model. */
export function syncCondition(v: Vessel): void {
  v.ship.rig = v.sails / v.cls.type.sails;
  v.ship.crewing = v.crew / v.cls.type.crew;
}

export const crewFraction = (v: Vessel): number => v.crew / v.cls.type.crew;

/** Guns with enough hands to work them: a ship can fight on at reduced strength until about 70% of her crew is gone. */
export function gunsManned(v: Vessel): number {
  const guns = v.cls.type.gunsPerSide;
  if (v.crew < 1) return 0;
  return Math.min(guns, Math.ceil(guns * Math.min(1, crewFraction(v) * 1.4)));
}

export function reloadTime(v: Vessel): number {
  return v.cls.type.reload / (0.35 + 0.65 * crewFraction(v));
}

/** Unit vector (x, z) pointing out of a side of the ship. Port is local +x. */
export function sideVector(heading: number, side: Side): [number, number] {
  const sign = side === 'port' ? 1 : -1;
  return [Math.cos(heading) * sign, -Math.sin(heading) * sign];
}

/** World (x, z) to ship-local (x port, z bow). */
export function toLocal(v: Vessel, x: number, z: number): [number, number] {
  const dx = x - v.ship.x;
  const dz = z - v.ship.z;
  const s = Math.sin(v.ship.heading);
  const c = Math.cos(v.ship.heading);
  return [dx * c - dz * s, dx * s + dz * c];
}

/** Distance from a world point to the vessel's hit box (0 when inside). `y` is height above the waterline. */
export function distanceToBody(v: Vessel, x: number, y: number, z: number): number {
  const [lx, lz] = toLocal(v, x, z);
  const b = v.cls.body;
  const dx = Math.max(Math.abs(lx) - b.halfBeam, 0);
  const dz = Math.max(b.stern - lz, lz - b.bow, 0);
  const dy = Math.max(-b.draft - y, y - b.top, 0);
  return Math.hypot(dx, dy, dz);
}
