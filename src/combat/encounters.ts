import { isNight } from '../core/clock';
import { SEA_LEVEL } from '../config';
import { plunder } from '../economy/goods';
import { hullContacts } from '../sailing/ship';
import { BRIG, MERCHANT_BRIG, MERCHANT_SLOOP, SLOOP, type ShipType } from '../sailing/ships';
import { createAi, sailable } from './ai';
import type { Sea } from './sea';
import type { PortFaction } from '../economy/ports';
import { createVessel, type Faction, type Vessel } from './vessel';

export type Tier = 0 | 1 | 2;
export const REGION_NAMES = ['Home waters', 'Contested waters', 'Imperial waters'] as const;

/** The further from the home island, the more dangerous the sea. */
export function regionTier(x: number, z: number): Tier {
  const d = Math.hypot(x, z);
  return d < 700 ? 0 : d < 1500 ? 1 : 2;
}

export interface GroupMember {
  type: ShipType;
  faction: Faction;
}

/** A group: the first member leads, the rest escort. */
export type GroupPlan = GroupMember[];

const merchant = (type: ShipType): GroupMember => ({ type, faction: 'merchant' });
const imperial = (type: ShipType): GroupMember => ({ type, faction: 'imperial' });
const pirate = (type: ShipType): GroupMember => ({ type, faction: 'pirate' });

/**
 * What sails into view. Near an Imperial port or a pirate haven, `local` makes its own
 * ships likelier: patrols off the Crown's harbours, raiders off the Brethren's.
 */
export function planGroup(tier: Tier, roll: number, local: PortFaction | null = null, localRoll = 1): GroupPlan {
  if (local === 'imperial' && localRoll < 0.5) return tier === 0 ? [imperial(SLOOP)] : tier === 1 ? [imperial(BRIG)] : [imperial(BRIG), imperial(SLOOP)];
  if (local === 'pirate' && localRoll < 0.5) return tier === 0 ? [pirate(SLOOP)] : [pirate(SLOOP), pirate(SLOOP)];
  if (tier === 0) {
    if (roll < 0.5) return [merchant(MERCHANT_SLOOP)];
    if (roll < 0.8) return [pirate(SLOOP)];
    return [imperial(SLOOP)];
  }
  if (tier === 1) {
    if (roll < 0.4) return [merchant(MERCHANT_BRIG), imperial(SLOOP)];
    if (roll < 0.7) return [imperial(BRIG)];
    return [pirate(SLOOP), pirate(SLOOP)];
  }
  if (roll < 0.5) return [merchant(MERCHANT_BRIG), imperial(BRIG), imperial(SLOOP)];
  return [imperial(BRIG), imperial(SLOOP)];
}

/**
 * After dark merchants keep to port and the Brethren go hunting: a merchant sailing
 * alone is replaced by raiders, and pirates are likelier whatever the roll.
 */
export function planNightGroup(tier: Tier, roll: number, local: PortFaction | null = null, localRoll = 1): GroupPlan {
  const raiders = tier === 0 ? [pirate(SLOOP)] : tier === 1 ? [pirate(SLOOP), pirate(SLOOP)] : [pirate(BRIG), pirate(SLOOP)];
  if (roll < 0.45) return raiders;
  const plan = planGroup(tier, (roll - 0.45) / 0.55, local, localRoll);
  return plan[0].faction === 'merchant' && plan.length === 1 ? raiders : plan;
}

/** The first encounters are fixed, so a new captain meets a prize and then a fight. */
const OPENING: GroupPlan[] = [[merchant(MERCHANT_SLOOP)], [pirate(SLOOP)]];
const FIRST_SPAWN = 4;
const SPAWN_INTERVAL = 35;
/** After you go down, the sea stays empty this long: a quiet start from port. */
const LULL = 60;
/** Ships come by more often at night: the raiders are out. */
const NIGHT_SPAWN_INTERVAL = 26;
const SPAWN_DISTANCE = [230, 300] as const;
const DESPAWN_DISTANCE = 520;
/** Escort stations in the leader's frame (x port, z forward): off either quarter. */
const STATIONS: Array<[number, number]> = [
  [14, -12],
  [-14, -12],
];

const NAMES: Record<Exclude<Faction, 'player'>, string[]> = {
  imperial: ['Resolute', 'Dominion', 'Sovereign', 'Valiant', 'Steadfast', 'Vigilant', 'Imperator', 'Crown of Aldmar'],
  merchant: ['Santa Lucia', 'Fair Winds', 'Mariposa', 'Good Fortune', 'Silver Heron', 'Providence', 'Dove', 'Patience'],
  pirate: ['Red Jack', 'Black Gull', 'Sea Wolf', 'Crimson Tide', 'Widowmaker', 'Salt Fang'],
};

/** How often the director looks around; it needn't run every tick. */
const REVIEW_INTERVAL = 1;
/** A port's own ships are commoner within this distance of it. */
const PORT_WATERS = 500;

export class Encounters {
  private timer = FIRST_SPAWN;
  private review = 0;
  private spawned = 0;
  private nextGroup = 1;

  /** How many groups have come (so a loaded game doesn't replay the opening encounters). */
  get count(): number {
    return this.spawned;
  }

  set count(n: number) {
    this.spawned = n;
  }

  /** No new ships for a while (the player has just gone down). */
  lull(): void {
    this.timer = LULL;
  }

  step(sea: Sea, dt: number): void {
    this.timer -= dt;
    this.review -= dt;
    if (this.review > 0) return;
    this.review = REVIEW_INTERVAL;
    const player = sea.player;
    // Groups that have fallen far astern, untouched, sail off the map.
    for (const group of new Set(sea.vessels.filter((v) => v.faction !== 'player').map((v) => v.group))) {
      const members = sea.vessels.filter((v) => v.group === group);
      const far = members.every((v) => Math.hypot(v.ship.x - player.ship.x, v.ship.z - player.ship.z) > DESPAWN_DISTANCE);
      if (far && members.every((v) => !v.ai?.alerted)) sea.remove(members);
    }

    if (this.timer > 0 || player.status !== 'afloat' || sea.ashore) return;
    const night = isNight(sea.clock.phase);
    this.timer = night ? NIGHT_SPAWN_INTERVAL : SPAWN_INTERVAL;
    const tier = regionTier(player.ship.x, player.ship.z);
    const groups = new Set(sea.vessels.filter((v) => v.faction !== 'player').map((v) => v.group)).size;
    if (groups >= 2 + tier) return;
    const local = sea.ports.find((p) => Math.hypot(p.x - player.ship.x, p.z - player.ship.z) < PORT_WATERS)?.faction ?? null;
    const plan = this.spawned < OPENING.length ? OPENING[this.spawned] : (night ? planNightGroup : planGroup)(tier, sea.random(), local, sea.random());
    if (this.spawnGroup(sea, plan)) this.spawned++;
  }

  /** Places a group out of sight, on a course that crosses the player's waters. Returns false if no open water was found. */
  spawnGroup(sea: Sea, plan: GroupPlan): boolean {
    const player = sea.player.ship;
    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = sea.random() * Math.PI * 2;
      const distance = SPAWN_DISTANCE[0] + sea.random() * (SPAWN_DISTANCE[1] - SPAWN_DISTANCE[0]);
      const x = player.x + Math.sin(angle) * distance;
      const z = player.z + Math.cos(angle) * distance;
      // Bound for a point near the player, so the paths cross.
      const destX = player.x + (sea.random() - 0.5) * 160;
      const destZ = player.z + (sea.random() - 0.5) * 160;
      const heading = sailable(Math.atan2(destX - x, destZ - z), sea.weather.windAt(x, z, sea.time));
      const s = Math.sin(heading);
      const c = Math.cos(heading);
      const places = plan.map((_, i) => {
        const [ox, oz] = i === 0 ? [0, 0] : STATIONS[(i - 1) % STATIONS.length];
        return { x: x + ox * c + oz * s, z: z - ox * s + oz * c };
      });
      const open = plan.every((member, i) => {
        const cls = sea.classFor(member.type);
        const p = places[i];
        return hullContacts(sea.world, cls.spec, p.x, p.z, heading) === 0 && sea.world.surfaceHeight(Math.floor(p.x), Math.floor(p.z)) < SEA_LEVEL - 4;
      });
      if (!open) continue;

      const group = this.nextGroup++;
      let leader: Vessel | null = null;
      plan.forEach((member, i) => {
        const v = createVessel(sea.nextId++, this.name(sea, member), member.faction, sea.classFor(member.type), places[i].x, places[i].z, heading, group);
        v.helm.sails = 0.5;
        v.ship.sail = 0.5;
        Object.assign(v, plunder(member.type, member.faction, sea.random));
        v.ai = createAi(destX + (destX - x), destZ + (destZ - z), heading);
        if (leader) {
          v.ai.leader = leader.id;
          [v.ai.stationX, v.ai.stationZ] = STATIONS[(i - 1) % STATIONS.length];
        } else {
          leader = v;
        }
        sea.add(v);
      });
      return true;
    }
    return false;
  }

  private name(sea: Sea, member: GroupMember): string {
    const names = NAMES[member.faction as Exclude<Faction, 'player'>];
    const faction = member.faction === 'imperial' ? 'Imperial' : member.faction === 'merchant' ? 'Merchant' : 'Pirate';
    const kind = member.type.name.replace('merchant ', '');
    return `${faction} ${kind} ${names[Math.floor(sea.random() * names.length)]}`;
  }
}
