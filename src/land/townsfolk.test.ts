import { describe, expect, it } from 'vitest';
import { Sea } from '../combat/sea';
import { shipClass } from '../combat/vessel';
import { SEA_LEVEL } from '../config';
import { phaseOf } from '../core/clock';
import { alike, type Dress, townDress } from '../duel/dress';
import type { KeeperPost, Port, PortPlace } from '../economy/ports';
import { footprintSamples } from '../sailing/hull';
import { BRIG, MERCHANT_BRIG, MERCHANT_SLOOP, SLOOP } from '../sailing/ships';
import { Weather } from '../sailing/weather';
import { Block } from '../voxel/blocks';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { Land } from './Land';
import { keeperLook, pickSpot, type SpotKind, standAt, type TownSpot } from './townsfolk';
import { collides } from './walker';

const CLASSES = new Map(
  [SLOOP, BRIG, MERCHANT_SLOOP, MERCHANT_BRIG].map((type) => {
    const cells: Array<[number, number]> = [];
    for (let x = 0; x < 5; x++) for (let z = 0; z < 15; z++) cells.push([x - 2.5, z - 7.5]);
    return [type, shipClass(type, footprintSamples(cells), 2.5, 16)] as const;
  }),
);

/** A town on a flat grassy island: its spots laid out round the middle. */
const spot = (x: number, z: number, kind: SpotKind) => ({ x, y: SEA_LEVEL + 1, z, kind });
const TOWN: Port = {
  id: 0,
  name: 'Haven',
  faction: 'merchant',
  x: 50,
  z: 0,
  heading: Math.PI / 2,
  islandX: 0,
  islandZ: 0,
  pier: { x: 45, y: SEA_LEVEL + 1, z: 0 },
  places: [],
  lamps: [],
  spots: [
    spot(0.5, 0.5, 'square'),
    spot(4.5, 0.5, 'square'),
    spot(-10.5, 5.5, 'stall'),
    spot(-10.5, -4.5, 'stall'),
    spot(8.5, 8.5, 'well'),
    spot(15.5, -12.5, 'yard'),
    spot(-5.5, 15.5, 'tavern'),
    spot(0.5, -20.5, 'street'),
    spot(-20.5, 20.5, 'door'),
    spot(20.5, 20.5, 'door'),
    spot(-20.5, -20.5, 'door'),
  ],
};

/**
 * The seat of power, off to the east of the square: walls three high round x 24..30,
 * z −6..0, with its door in the west wall at (24, −3). You stand at (23, −3) to go in.
 */
const FLOOR = SEA_LEVEL + 1;
const SHIPYARD: PortPlace = { kind: 'shipyard', x: 15.5, y: FLOOR, z: -14.5 };
const OFFICE: PortPlace = { kind: 'office', x: 23.5, y: FLOOR, z: -2.5, sign: { x: 27.5, y: FLOOR + 5, z: -2.5 } };
/** Either side of the Governor's door, just outside the wall, a step clear of where the captain stands to go in. */
const POSTS = [
  { x: 23.5, z: -4.5 },
  { x: 23.5, z: -0.5 },
];

/** The same town under another flag (the free port, the Crown's, the Brethren's), with its shipyard and office. */
const port = (id: number, faction: Port['faction']): Port => ({ ...TOWN, id, name: `Port ${id}`, faction, places: [SHIPYARD, { ...OFFICE }] });

function town(where: Port = TOWN, seed = 3) {
  const world = new VoxelWorld();
  for (let x = -40; x < 40; x++) for (let z = -40; z < 40; z++) for (let y = 0; y <= SEA_LEVEL; y++) world.setVoxel(x, y, z, y === SEA_LEVEL ? Block.Grass : Block.Dirt);
  for (let x = 24; x <= 30; x++) {
    for (let z = -6; z <= 0; z++) {
      const wall = x === 24 || x === 30 || z === -6 || z === 0;
      const door = x === 24 && z === -3;
      for (let y = FLOOR; y < FLOOR + 3; y++) if (wall && !(door && y < FLOOR + 2)) world.setVoxel(x, y, z, Block.Plaster);
    }
  }
  const sea = new Sea(world, new Weather({ cells: [] }), CLASSES, SLOOP, [where], 1, false);
  sea.clock.phase = phaseOf(10);
  const land = new Land(world, sea, seed);
  sea.docked = where;
  land.goAshore();
  Object.assign(land.walker!, { x: 0.5, z: 0.5, y: SEA_LEVEL + 1 });
  return { world, sea, land };
}

const guards = (land: Land) => land.townsfolk.filter((f) => f.task.kind === 'guard');
const folk = (land: Land) => land.townsfolk.filter((f) => f.task.kind !== 'guard');

function run(sea: Sea, land: Land, seconds: number) {
  for (let t = 0; t < seconds; t += 1 / 20) {
    sea.pass(1 / 20);
    land.step(1 / 20);
  }
}

describe('townsfolk', () => {
  it('come out of their doors into a town the captain walks, and go about it', () => {
    const { sea, land } = town();
    expect(land.townsfolk).toHaveLength(0);
    run(sea, land, 30);
    expect(land.townsfolk.length).toBeGreaterThanOrEqual(5);
    // They've gone out from the doors into the town.
    const doors = TOWN.spots!.filter((s) => s.kind === 'door');
    const out = land.townsfolk.filter((f) => doors.every((d) => Math.hypot(f.walker.x - d.x, f.walker.z - d.z) > 3));
    expect(out.length).toBeGreaterThanOrEqual(3);
  });

  it('are already about the town when the captain arrives, not all still to come out of doors', () => {
    const { sea, land } = town();
    run(sea, land, 0.1);
    const about = land.townsfolk.filter((f) => f.task.kind !== 'guard');
    expect(about.length).toBeGreaterThanOrEqual(7);
    // Out at the town's places: the square, the stalls, the well and so on.
    const out = about.filter((f) => f.task.kind === 'linger' && f.task.spot.kind !== 'door');
    expect(out.length).toBeGreaterThanOrEqual(6);
    // No two stood on the same place.
    for (const a of about) for (const b of about) if (a !== b) expect(Math.hypot(a.walker.x - b.walker.x, a.walker.z - b.walker.z)).toBeGreaterThan(0.5);
  });

  it('visit the town’s places: the stalls, the well, the yard, the tavern', () => {
    const { sea, land } = town();
    const visited = new Set<SpotKind>();
    for (let i = 0; i < 240; i++) {
      run(sea, land, 1);
      for (const f of land.townsfolk) if (f.task.kind === 'linger') visited.add(f.task.spot.kind);
    }
    expect(visited.size).toBeGreaterThanOrEqual(4);
  });

  it('mostly go home at night', () => {
    const { sea, land } = town();
    run(sea, land, 30);
    expect(land.townsfolk.length).toBeGreaterThan(3);
    sea.clock.phase = phaseOf(23);
    run(sea, land, 90);
    expect(land.townsfolk.length).toBeLessThanOrEqual(3);
  });

  it('are gone once the captain leaves the town', () => {
    const { sea, land } = town();
    run(sea, land, 20);
    expect(land.townsfolk.length).toBeGreaterThan(0);
    sea.docked = null;
    land.step(0.05);
    expect(land.townsfolk).toHaveLength(0);
  });

  it('dress for their port: Haven’s as fisherfolk, the free port’s, the Crown’s and the Brethren’s each their own', () => {
    for (const [where, kind] of [[TOWN, 'haven'], [port(3, 'merchant'), 'merchant'], [port(2, 'imperial'), 'imperial'], [port(4, 'pirate'), 'pirate']] as const) {
      const { sea, land } = town(where);
      run(sea, land, 30);
      expect(folk(land).length, kind).toBeGreaterThanOrEqual(5);
      for (const f of folk(land)) expect(f.dress, kind).toEqual(townDress(kind, f.look));
    }
  });

  it('never come out one after another looking alike', () => {
    for (const [where, seed] of [TOWN, port(3, 'merchant'), port(2, 'imperial'), port(4, 'pirate')].flatMap((p) => [[p, 3], [p, 11]] as const)) {
      const { sea, land } = town(where, seed);
      const seen = new Map<number, Dress>();
      for (let i = 0; i < 240; i++) {
        run(sea, land, 1);
        if (i === 120) sea.clock.phase = phaseOf(23); // off home, and out again in the morning
        if (i === 180) sea.clock.phase = phaseOf(8);
        for (const f of folk(land)) seen.set(f.id, f.dress);
      }
      const ids = [...seen.keys()].sort((a, b) => a - b);
      expect(ids.length, where.faction).toBeGreaterThan(10);
      for (let i = 1; i < ids.length; i++) if (ids[i] === ids[i - 1] + 1) expect(alike(seen.get(ids[i])!, seen.get(ids[i - 1])!), `${where.name} #${ids[i]}`).toBe(false);
    }
  }, 20_000); // eight towns for 240 s each: slow under a full parallel run

  it('stand spread round a spot they share, not stacked on it', () => {
    const { sea, land } = town();
    let shared = 0;
    for (let i = 0; i < 240; i++) {
      run(sea, land, 1);
      const lingering = folk(land).filter((f) => f.task.kind === 'linger');
      for (const a of lingering) {
        for (const b of lingering) {
          if (a.id >= b.id || a.task.kind !== 'linger' || b.task.kind !== 'linger' || a.task.spot !== b.task.spot) continue;
          shared++;
          expect(Math.hypot(a.walker.x - b.walker.x, a.walker.z - b.walker.z)).toBeGreaterThan(0.8);
        }
      }
    }
    expect(shared).toBeGreaterThan(0);
  });

  it('find each newcomer to a spot a place of their own round it, clear of walls', () => {
    const { world } = town();
    const spot: TownSpot = { x: 22.5, y: FLOOR, z: -2.5, kind: 'square' }; // beside the office wall
    const taken: Array<{ x: number; z: number }> = [];
    for (let i = 0; i < 4; i++) {
      const at = standAt(world, spot, taken, () => 0.3)!;
      expect(Math.hypot(at.x - spot.x, at.z - spot.z)).toBeLessThan(1.6);
      expect(collides(world, at.x, at.y, at.z)).toBe(false);
      for (const t of taken) expect(Math.hypot(at.x - t.x, at.z - t.z)).toBeGreaterThan(1);
      taken.push(at);
    }
  });

  it('linger clear of every doorway: a step from each place you go in at and each house’s door, whatever spot they’re at', () => {
    // The tavern's step one from where its drinkers gather, and a house's door two from the square's middle.
    const step: PortPlace = { kind: 'tavern', x: -5.5, y: FLOOR, z: 14.5 };
    const where: Port = { ...TOWN, places: [SHIPYARD, { ...OFFICE }, step], spots: [...TOWN.spots!, spot(2.5, 0.5, 'door')] };
    const doorways = [...where.places, ...where.spots!.filter((s) => s.kind === 'door')];
    const { sea, land } = town(where, 7);
    const seen = new Set<SpotKind>();
    for (let t = 0; t < 240; t += 1 / 20) {
      sea.pass(1 / 20);
      land.step(1 / 20);
      for (const f of land.townsfolk) {
        if (f.task.kind !== 'linger') continue;
        seen.add(f.task.spot.kind);
        const { at } = f.task;
        for (const d of doorways) expect(Math.hypot(at.x - d.x, at.z - d.z), `lingerer#${f.id} at the ${f.task.spot.kind}, by the doorway at ${d.x},${d.z}`).toBeGreaterThanOrEqual(1.2);
      }
    }
    expect(seen.has('tavern') && seen.has('yard') && seen.has('square')).toBe(true);
  }, 20_000); // four minutes of the town's comings and goings: slow under a full parallel run

  it('step aside when the captain walks onto where they stand, and keep a step from him', () => {
    const { sea, land } = town(TOWN, 3);
    run(sea, land, 5);
    const f = folk(land).find((o) => o.task.kind === 'linger' && Math.hypot(o.walker.x - land.walker!.x, o.walker.z - land.walker!.z) > 3)!;
    expect(f).toBeDefined();
    if (f.task.kind === 'linger') f.task.left = 100; // in no hurry to move on
    // The captain walks right up to them, and stands there.
    Object.assign(land.walker!, { x: f.walker.x + 0.2, y: f.walker.y, z: f.walker.z, vx: 0, vz: 0 });
    run(sea, land, 4);
    const captain = land.walker!;
    expect(Math.hypot(f.walker.x - captain.x, f.walker.z - captain.z)).toBeGreaterThanOrEqual(1);
    for (const o of folk(land)) if (o.task.kind === 'linger') expect(Math.hypot(o.walker.x - captain.x, o.walker.z - captain.z), `lingerer#${o.id}`).toBeGreaterThanOrEqual(1);
  });

  it('are less likely to linger where two are already', () => {
    const quiet: TownSpot = { x: 0.5, y: FLOOR, z: 0.5, kind: 'square' };
    const busy: TownSpot = { x: 4.5, y: FLOOR, z: 0.5, kind: 'square' };
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    let toBusy = 0;
    for (let i = 0; i < 1000; i++) if (pickSpot([quiet, busy], (s) => (s === busy ? 2 : 0), random) === busy) toBusy++;
    expect(toBusy).toBeLessThan(300);
    expect(toBusy).toBeGreaterThan(50);
  });
});

describe('the Crown’s guards', () => {
  it('stand either side of the Governor’s door, a step clear of it, facing out, day and night, and don’t count as townsfolk', () => {
    const { sea, land } = town(port(2, 'imperial'));
    run(sea, land, 5);
    const posted = guards(land);
    expect(posted).toHaveLength(2);
    // Never shoulder to shoulder with the captain going in.
    for (const g of posted) expect(Math.hypot(g.walker.x - OFFICE.x, g.walker.z - OFFICE.z)).toBeGreaterThanOrEqual(1.2);
    const where = () =>
      guards(land)
        .map((g) => ({ x: g.walker.x, z: g.walker.z }))
        .sort((a, b) => a.z - b.z);
    const check = () => {
      expect(guards(land).map((g) => g.id)).toEqual(posted.map((g) => g.id));
      where().forEach((p, i) => {
        expect(p.x).toBeCloseTo(POSTS[i].x, 1);
        expect(p.z).toBeCloseTo(POSTS[i].z, 1);
      });
      for (const g of guards(land)) {
        expect(g.dress.soldier).toBe(true);
        // Facing out of the door, west.
        expect(Math.sin(g.walker.facing)).toBeCloseTo(-1, 2);
      }
    };
    check();
    run(sea, land, 30);
    check();
    expect(folk(land).length).toBeGreaterThanOrEqual(5);
    expect(folk(land).length).toBeLessThanOrEqual(8);
    sea.clock.phase = phaseOf(23);
    run(sea, land, 90);
    check();
    expect(folk(land).length).toBeLessThanOrEqual(3);
    sea.docked = null;
    land.step(0.05);
    expect(land.townsfolk).toHaveLength(0);
  });

  it('keep to the Crown’s ports', () => {
    for (const where of [TOWN, port(3, 'merchant'), port(4, 'pirate')]) {
      const { sea, land } = town({ ...where, places: [SHIPYARD, { ...OFFICE }] });
      run(sea, land, 30);
      expect(guards(land), where.name).toHaveLength(0);
      expect(land.townsfolk.some((f) => f.dress.soldier)).toBe(false);
    }
  });

  it('don’t stand guard where the office has no door of its own (it shares the shipyard’s)', () => {
    const { sea, land } = town({ ...port(2, 'imperial'), places: [SHIPYARD, { ...SHIPYARD, kind: 'office' }] });
    run(sea, land, 10);
    expect(guards(land)).toHaveLength(0);
  });
});

describe('the shops’ keepers', () => {
  /** In the flat town: the office's behind its desk (inside its walls), and three more out on the grass, well away from the spots townsfolk go to. */
  const KEEPERS: KeeperPost[] = [
    { kind: 'office', x: 28.5, y: FLOOR, z: -2.5, facing: -Math.PI / 2 },
    { kind: 'tavern', x: -30.5, y: FLOOR, z: 30.5, facing: 0 },
    { kind: 'market', x: -30.5, y: FLOOR, z: -30.5, facing: 0 },
    { kind: 'shipyard', x: 30.5, y: FLOOR, z: 30.5, facing: Math.PI },
  ];
  const shops = (where: Port = TOWN): Port => ({ ...where, places: [SHIPYARD, { ...OFFICE }], keepers: KEEPERS });
  const keepers = (land: Land) => land.townsfolk.filter((f) => f.task.kind === 'keep');
  const about = (land: Land) => land.townsfolk.filter((f) => f.task.kind !== 'keep' && f.task.kind !== 'guard');
  const kinds = (land: Land) => keepers(land).map((f) => (f.task.kind === 'keep' ? f.task.post.kind : '')).sort();
  const ALL = ['market', 'office', 'shipyard', 'tavern'];

  it('keep their shops by day: one at each post, standing still, facing the room’s front', () => {
    const { sea, land } = town(shops());
    run(sea, land, 0.1);
    expect(kinds(land)).toEqual(ALL);
    const ids = keepers(land).map((f) => f.id);
    run(sea, land, 30);
    expect(keepers(land).map((f) => f.id)).toEqual(ids);
    for (const f of keepers(land)) {
      if (f.task.kind !== 'keep') continue;
      const { post } = f.task;
      expect(Math.hypot(f.walker.x - post.x, f.walker.z - post.z), post.kind).toBeLessThan(0.05);
      expect(f.walker.y, post.kind).toBe(post.y);
      expect(f.walker.facing, post.kind).toBe(post.facing);
    }
  });

  it('leave only the tavern keeper at night, and are all back in the morning', () => {
    const { sea, land } = town(shops());
    run(sea, land, 1);
    const tavern = keepers(land).find((f) => f.task.kind === 'keep' && f.task.post.kind === 'tavern')!.id;
    sea.clock.phase = phaseOf(23);
    run(sea, land, 1);
    expect(kinds(land)).toEqual(['tavern']);
    expect(keepers(land)[0].id).toBe(tavern);
    sea.clock.phase = phaseOf(8);
    run(sea, land, 1);
    expect(kinds(land)).toEqual(ALL);
  });

  it('are gone when the captain leaves town, and back behind their counters when they land', () => {
    const where = shops();
    const { sea, land } = town(where);
    run(sea, land, 1);
    sea.docked = null;
    land.step(0.05);
    expect(keepers(land)).toHaveLength(0);
    sea.docked = where;
    land.step(0.05);
    expect(kinds(land)).toEqual(ALL);
  });

  it('dress for their port, never as soldiers, and look the same each visit', () => {
    const where = shops(port(2, 'imperial'));
    const { sea, land } = town(where);
    run(sea, land, 1);
    const looks = keepers(land).map((f) => f.look).sort();
    for (const f of keepers(land)) {
      expect(f.dress.soldier ?? false).toBe(false);
      expect(f.dress).toEqual(townDress('imperial', f.look));
      if (f.task.kind === 'keep') expect(keeperLook(where, f.task.post).look).toBe(f.look);
    }
    sea.docked = null;
    land.step(0.05);
    sea.docked = where;
    land.step(0.05);
    expect(keepers(land).map((f) => f.look).sort()).toEqual(looks);
  });

  it('don’t count toward the town’s numbers, and take no draws from its dice (moving a lingering place off a post isn’t a draw)', () => {
    const a = town({ ...TOWN, places: [SHIPYARD, { ...OFFICE }] }, 5);
    const b = town(shops(), 5);
    run(a.sea, a.land, 30);
    run(b.sea, b.land, 30);
    const where = (land: Land) => about(land).map((f) => [f.look, f.walker.x, f.walker.z]);
    expect(about(b.land).length).toBeGreaterThanOrEqual(5);
    // The fixture's posts all stand well clear of every spot (see KEEPERS above), so no
    // lingering place ever moves off one here: this stays byte-for-byte what it would be
    // without the keepers, witnessing that they draw nothing from the town's dice.
    expect(where(b.land)).toEqual(where(a.land));
  });

  it('keep every lingering place clear of a post, whether its keeper’s there or not', () => {
    // The yard spot's ring has six places; wall off five of them (as the real shipyard's
    // shed walls leave a yard spot only a couple open), so every visit must use the one
    // left — right beside a post, as close as the real shipyard's stands to its own (≈1.41
    // from the spot, 0.17–0.64 from that one ring place).
    const CLOSE: KeeperPost = { kind: 'shipyard', x: 16.1, y: FLOOR, z: -11.6, facing: 0 };
    const WALLED_OFF: ReadonlyArray<readonly [number, number]> = [
      [16.72, -12.24],
      [16.33, -13.43],
      [15.11, -13.69],
      [14.28, -12.76],
      [14.67, -11.57],
    ];
    const where: Port = { ...TOWN, places: [SHIPYARD, { ...OFFICE }], keepers: [CLOSE] };
    const { sea, land, world } = town(where, 11);
    for (const [x, z] of WALLED_OFF) world.setVoxel(Math.floor(x), FLOOR, Math.floor(z), Block.Stone);
    const clear = () => {
      for (const f of land.townsfolk) {
        if (f.task.kind !== 'linger') continue;
        expect(Math.hypot(f.walker.x - CLOSE.x, f.walker.z - CLOSE.z), `lingerer#${f.id} at ${f.task.spot.kind}`).toBeGreaterThanOrEqual(0.8);
      }
    };
    for (let t = 0; t < 120; t += 1 / 20) {
      sea.pass(1 / 20);
      land.step(1 / 20);
      clear();
    }
    sea.clock.phase = phaseOf(23); // dusk: the keeper goes, but the post stays off limits
    for (let t = 0; t < 90; t += 1 / 20) {
      sea.pass(1 / 20);
      land.step(1 / 20);
      clear();
    }
    sea.clock.phase = phaseOf(8); // dawn: the keeper's back — checked the instant he reappears
    for (let t = 0; t < 30; t += 1 / 20) {
      sea.pass(1 / 20);
      land.step(1 / 20);
      clear();
    }
  });
});
