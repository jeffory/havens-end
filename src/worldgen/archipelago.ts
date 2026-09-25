import type { Port, PortFaction } from '../economy/ports';
import type { VoxelWorld } from '../voxel/VoxelWorld';
import { buildHarbour } from './harbour';
import { generateIsland, type IslandParams } from './island';
import { hash2 } from '../util/hash';
import { mulberry32 } from './noise';

export interface PortPlan {
  name: string;
  faction: PortFaction;
}

export interface IslandPlan extends IslandParams {
  /** The port on this island, if it has one. */
  port: PortPlan | null;
  /** An islet sailors won't go near: ghost lights hang over it at night. */
  cursed?: boolean;
  /** What sailors call an islet (a port island goes by its port's name). */
  name?: string;
}

/** How many of the islets are cursed. */
const CURSED = 3;

/**
 * The ports, from home outward. Rings are distances from Haven; they line up with the
 * danger regions (home waters < 700, contested < 1500, Imperial beyond), so the free
 * port is an easy first run, the pirate haven and the Imperial outpost sit in contested
 * waters, and the Imperial capital is deep in patrolled seas.
 */
const ROSTER: ReadonlyArray<{ faction: PortFaction; ring: readonly [number, number]; radius: readonly [number, number] }> = [
  { faction: 'merchant', ring: [480, 660], radius: [42, 52] },
  { faction: 'pirate', ring: [780, 1100], radius: [36, 46] },
  { faction: 'imperial', ring: [950, 1300], radius: [42, 52] },
  { faction: 'imperial', ring: [1600, 1850], radius: [50, 58] },
];

const NAMES: Record<PortFaction, string[]> = {
  merchant: ['Port Clemency', 'Saltmarsh', 'Brightwater', 'Marigold Bay', 'Freehold'],
  pirate: ["Rook's Nest", 'Blackwater Cove', 'Gallows Key', 'Scupper Bay'],
  imperial: ['Fort Aldmar', 'San Cristóbal', 'Kingsreach', 'Port Regent', 'Castell Sorn', 'Aldmar Royal'],
};

const ISLET_NAMES = [
  'Gull Cay', 'Pelican Key', 'Turtle Rock', 'Mangrove Isle', 'Coral Head', 'Parrot Cay', 'Brandy Key', 'Driftwood Cay',
  'Saltpan Isle', 'Heron Key', 'Lantern Cay', 'Cutlass Key', 'Barracuda Cay', 'Conch Isle', 'Palmetto Key', 'Sandpiper Cay',
];
const CURSED_NAMES = ["Dead Man's Cay", 'Wraith Key', 'Weeping Isle', 'Hollow Cay', 'Bonefire Key'];

const HOME: IslandPlan = { seed: 0, centerX: 0, centerZ: 0, radius: 58, peak: 22, port: { name: 'Haven', faction: 'merchant' } };
const ISLETS = 14;
const ISLET_RING = [200, 2000] as const;

/**
 * Lays out the archipelago: Haven at the centre, four more ports on rings around it,
 * and a scatter of small uninhabited islets for landmarks. Deterministic in `seed`.
 */
export function planArchipelago(seed: number): IslandPlan[] {
  const random = mulberry32(seed ^ 0xa4c1);
  const between = (range: readonly [number, number]) => range[0] + random() * (range[1] - range[0]);
  const islands: IslandPlan[] = [{ ...HOME, seed }];
  const names = Object.fromEntries(Object.entries(NAMES).map(([faction, list]) => [faction, shuffle(list, random)])) as Record<PortFaction, string[]>;

  const place = (ring: readonly [number, number], radius: number, gap: (other: IslandPlan) => number): { x: number; z: number } | null => {
    for (let attempt = 0; attempt < 400; attempt++) {
      const angle = random() * Math.PI * 2;
      const distance = between(ring);
      const x = Math.round(Math.sin(angle) * distance);
      const z = Math.round(Math.cos(angle) * distance);
      if (islands.every((o) => Math.hypot(o.centerX - x, o.centerZ - z) >= o.radius + radius + gap(o))) return { x, z };
    }
    return null;
  };

  // Ports keep well apart, so each has its own waters and the runs between them take a while.
  for (const entry of ROSTER) {
    const radius = Math.round(between(entry.radius));
    const spot = place(entry.ring, radius, () => 380);
    if (!spot) throw new Error(`planArchipelago: no room for a ${entry.faction} port (seed ${seed})`);
    islands.push({
      seed: Math.floor(random() * 2 ** 31),
      centerX: spot.x,
      centerZ: spot.z,
      radius,
      peak: Math.round(12 + random() * 10),
      port: { name: names[entry.faction].shift()!, faction: entry.faction },
    });
  }

  // Islets stay clear of harbours so they never block the way in.
  for (let i = 0; i < ISLETS; i++) {
    const radius = Math.round(12 + random() * 14);
    const spot = place(ISLET_RING, radius, (o) => (o.port ? 170 : 90));
    if (!spot) continue;
    islands.push({ seed: Math.floor(random() * 2 ** 31), centerX: spot.x, centerZ: spot.z, radius, peak: Math.round(4 + random() * 8), port: null });
  }
  // A few islets are shunned. Chosen by their own seeds, so the rest of the plan is as it was.
  const islets = islands.filter((i) => !i.port).sort((a, b) => hash2(a.seed, 7, seed) - hash2(b.seed, 7, seed));
  for (const islet of islets.slice(0, CURSED)) islet.cursed = true;
  // Names from their own numbers too.
  const naming = mulberry32(seed ^ 0x15e7);
  const plain = shuffle(ISLET_NAMES, naming);
  const grim = shuffle(CURSED_NAMES, naming);
  for (const islet of islands.filter((i) => !i.port)) islet.name = (islet.cursed ? grim : plain).shift() ?? `Islet ${islands.indexOf(islet)}`;
  return islands;
}

/** An island's name: its port's, or the islet's own. */
export const islandName = (plan: IslandPlan): string => plan.port?.name ?? plan.name ?? 'an unnamed islet';

/**
 * Writes the whole archipelago into the world: every island, and a harbour and town on
 * each port island. Returns the ports, Haven first.
 */
export function buildArchipelago(world: VoxelWorld, plans: readonly IslandPlan[]): Port[] {
  const ports: Port[] = [];
  for (const plan of plans) {
    generateIsland(world, plan);
    if (!plan.port) continue;
    // The town's layout stays behind: a port needs its berth, pier, doors and lamps.
    const { town, ...berth } = buildHarbour(world, plan, plan.port.faction, plan === plans[0]);
    ports.push({ id: ports.length, ...plan.port, ...berth, islandX: plan.centerX, islandZ: plan.centerZ });
  }
  return ports;
}

function shuffle<T>(list: readonly T[], random: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
