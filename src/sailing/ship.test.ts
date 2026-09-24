import { describe, expect, it } from 'vitest';
import { Block } from '../voxel/blocks';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { footprintSamples } from './hull';
import { angleOffWind, sailEfficiency } from './pointOfSail';
import { createShip, hullContacts, type Helm, type ShipSpec, type ShipState, stepShip } from './ship';
import type { Wind } from './weather';

/** A 15 x 5 box hull centred on the origin. */
function boxFootprint(length: number, beam: number): Float32Array {
  const cells: Array<[number, number]> = [];
  for (let x = 0; x < beam; x++) for (let z = 0; z < length; z++) cells.push([x - beam / 2, z - length / 2]);
  return footprintSamples(cells);
}

const SPEC: ShipSpec = {
  name: 'Test sloop',
  draft: 1.4,
  topSpeed: 11,
  acceleration: 2.4,
  turnRate: 0.5,
  footprint: boxFootprint(15, 5),
};

/** Steady wind blowing toward +z (from the north). */
const NORTHERLY: Wind = { dirX: 0, dirZ: 1, strength: 1, squall: 0, calm: 0 };
const EAST = Math.PI / 2; // heading +x

function sail(ship: ShipState, helm: Helm, seconds: number, world = new VoxelWorld(), wind = NORTHERLY) {
  for (let t = 0; t < seconds; t += 1 / 60) stepShip(ship, SPEC, helm, wind, world, 1 / 60);
  return ship;
}

describe('point of sail', () => {
  it('measures the angle between the bow and where the wind comes from', () => {
    expect(angleOffWind(0, -1, NORTHERLY)).toBeCloseTo(0); // bow into the wind
    expect(angleOffWind(1, 0, NORTHERLY)).toBeCloseTo(Math.PI / 2); // beam reach
    expect(angleOffWind(0, 1, NORTHERLY)).toBeCloseTo(Math.PI); // dead downwind
  });

  it('gives almost nothing head to wind and the most on a broad reach', () => {
    const deg = (d: number) => sailEfficiency((d * Math.PI) / 180);
    expect(deg(0)).toBeLessThan(0.1);
    expect(deg(45)).toBeGreaterThan(deg(20));
    expect(deg(90)).toBeGreaterThan(deg(45));
    expect(deg(125)).toBeGreaterThanOrEqual(deg(90));
    expect(deg(180)).toBeLessThan(deg(125));
  });
});

describe('stepShip', () => {
  it('builds up speed under full sail on a beam reach', () => {
    const ship = sail(createShip(0, 0, EAST), { rudder: 0, sails: 1 }, 40);
    expect(ship.surge).toBeGreaterThan(0.75 * SPEC.topSpeed);
    expect(ship.surge).toBeLessThanOrEqual(SPEC.topSpeed);
    expect(ship.x).toBeGreaterThan(200);
  });

  it('carries momentum: speed builds over seconds, not instantly', () => {
    const ship = sail(createShip(0, 0, EAST), { rudder: 0, sails: 1 }, 1);
    expect(ship.surge).toBeGreaterThan(0.1);
    expect(ship.surge).toBeLessThan(0.3 * SPEC.topSpeed);
  });

  it('only crawls when pointed into the wind', () => {
    const ship = sail(createShip(0, 0, Math.PI), { rudder: 0, sails: 1 }, 40); // heading -z, into a northerly
    expect(ship.surge).toBeLessThan(0.2 * SPEC.topSpeed);
  });

  it('coasts to a stop with the sails furled', () => {
    const ship = createShip(0, 0, EAST);
    ship.surge = SPEC.topSpeed;
    sail(ship, { rudder: 0, sails: 0 }, 60);
    expect(ship.surge).toBeLessThan(0.5);
  });

  it('turns toward starboard with positive rudder', () => {
    const ship = sail(createShip(0, 0, EAST), { rudder: 0, sails: 1 }, 20);
    sail(ship, { rudder: 1, sails: 1 }, 3);
    // Starboard of an eastbound ship is south (+z).
    expect(Math.cos(ship.heading)).toBeGreaterThan(0.3);
  });

  it('steers far better with way on than at rest', () => {
    const resting = sail(createShip(0, 0, EAST), { rudder: 1, sails: 0 }, 3);
    const moving = createShip(0, 0, EAST);
    moving.surge = SPEC.topSpeed;
    sail(moving, { rudder: 1, sails: 1 }, 3);
    expect(Math.abs(resting.yawRate)).toBeGreaterThan(0);
    expect(Math.abs(moving.yawRate)).toBeGreaterThan(2 * Math.abs(resting.yawRate));
  });

  it('slips sideways a little, downwind (leeway)', () => {
    const ship = sail(createShip(0, 0, EAST), { rudder: 0, sails: 1 }, 20);
    expect(ship.z).toBeGreaterThan(0.5); // the northerly pushes it south
    expect(Math.abs(ship.sway)).toBeLessThan(0.1 * ship.surge);
  });
});

describe('grounding', () => {
  /** A stone wall across the ship's path at x = 40..41. */
  function walled(): VoxelWorld {
    const world = new VoxelWorld();
    for (let z = -40; z < 40; z++) for (let y = 0; y < 20; y++) for (let x = 40; x < 42; x++) world.setVoxel(x, y, z, Block.Stone);
    return world;
  }

  it('stops at the shore instead of sailing through it', () => {
    const world = walled();
    const ship = sail(createShip(0, 0, EAST), { rudder: 0, sails: 1 }, 20, world);
    expect(ship.x).toBeLessThan(40 - 7);
    expect(ship.x).toBeGreaterThan(40 - 9);
    expect(ship.grounded).toBe(true);
    expect(hullContacts(world, SPEC, ship.x, ship.z, ship.heading)).toBe(0);
  });

  it('can turn away and sail off after running aground', () => {
    const world = walled();
    const ship = sail(createShip(0, 0, EAST), { rudder: 0, sails: 1 }, 15, world);
    const stuckAt = { x: ship.x, z: ship.z };
    // Put the helm over until the bow points away from the wall...
    let seconds = 0;
    while (Math.sin(ship.heading) > -0.2 && seconds < 30) {
      sail(ship, { rudder: 1, sails: 1 }, 0.5, world);
      seconds += 0.5;
    }
    expect(seconds).toBeLessThan(20);
    // ...then sail off.
    sail(ship, { rudder: 0, sails: 1 }, 12, world);
    expect(ship.grounded).toBe(false);
    expect(Math.hypot(ship.x - stuckAt.x, ship.z - stuckAt.z)).toBeGreaterThan(20);
    expect(ship.x).toBeLessThan(40 - 2); // and never through the wall
  });

  it("can't be driven inside a thin pier, and steers off it again", () => {
    // A pier three wide along z at x = -1..1: planks at deck height, pilings every third voxel.
    const world = new VoxelWorld();
    for (let z = -40; z < 40; z++) {
      for (let x = -1; x <= 1; x++) world.setVoxel(x, 12, z, Block.Planks);
      if (z % 3 === 0) for (let y = 0; y < 12; y++) for (const x of [-1, 1]) world.setVoxel(x, y, z, Block.Wood);
    }
    // Moored alongside to port of it, bow along the pier, the wind pressing her onto it.
    const easterly: Wind = { dirX: -1, dirZ: 0, strength: 1, squall: 0, calm: 0 };
    const ship = createShip(6.5, 0, 0);
    let closest = Infinity;
    const run = (helm: Helm, seconds: number) => {
      for (let t = 0; t < seconds; t += 1 / 60) {
        stepShip(ship, SPEC, helm, easterly, world, 1 / 60);
        closest = Math.min(closest, ship.x);
      }
    };
    run({ rudder: 1, sails: 1 }, 8); // hard to starboard: straight into the pier
    expect(closest).toBeGreaterThan(2); // the hull never swallows the pier
    run({ rudder: -1, sails: 1 }, 8); // put the helm over the other way...
    run({ rudder: 0, sails: 1 }, 10); // ...and sail off
    expect(ship.grounded).toBe(false);
    expect(Math.hypot(ship.x - 6.5, ship.z)).toBeGreaterThan(30);
    expect(hullContacts(world, SPEC, ship.x, ship.z, ship.heading)).toBe(0);
  });

  it("doesn't hang up on a corner she's scraping past", () => {
    // A pier with a wider head; she sails out past it with the wind setting her onto it.
    const world = new VoxelWorld();
    for (let z = -40; z < 2; z++) for (let x = z >= -2 ? -2 : -1; x <= (z >= -2 ? 2 : 1); x++) world.setVoxel(x, 12, z, Block.Planks);
    const onshore: Wind = { dirX: -0.86, dirZ: 0.5, strength: 0.8, squall: 0, calm: 0 };
    for (const startX of [5.2, 5.4, 5.6, 5.8]) {
      const ship = createShip(startX, -12, 0);
      for (let t = 0; t < 25; t += 1 / 60) stepShip(ship, SPEC, { rudder: 0, sails: 1 }, onshore, world, 1 / 60);
      expect(ship.z).toBeGreaterThan(40);
    }
  });

  it('grounds in water shallower than its draft, but sails over deeper water', () => {
    const shoal = (surface: number) => {
      const world = new VoxelWorld();
      for (let x = 40; x < 60; x++) for (let z = -20; z < 20; z++) for (let y = 0; y < surface; y++) world.setVoxel(x, y, z, Block.Sand);
      return world;
    };
    // Water surface ~11.6: a floor at 11 leaves 0.6 of water, a floor at 10 leaves 1.6.
    expect(sail(createShip(0, 0, EAST), { rudder: 0, sails: 1 }, 20, shoal(11)).x).toBeLessThan(40);
    expect(sail(createShip(0, 0, EAST), { rudder: 0, sails: 1 }, 20, shoal(10)).x).toBeGreaterThan(70);
  });
});

describe('damage', () => {
  it('is slower with shot-away rigging', () => {
    const whole = sail(createShip(0, 0, EAST), { rudder: 0, sails: 1 }, 40);
    const torn = createShip(0, 0, EAST);
    torn.rig = 0.3;
    sail(torn, { rudder: 0, sails: 1 }, 40);
    expect(torn.surge).toBeLessThan(0.75 * whole.surge);
    expect(torn.surge).toBeGreaterThan(0.3 * whole.surge);
  });

  it('works the sails slowly when short-handed', () => {
    const full = sail(createShip(0, 0, EAST), { rudder: 0, sails: 1 }, 1);
    const shortHanded = createShip(0, 0, EAST);
    shortHanded.crewing = 0.2;
    sail(shortHanded, { rudder: 0, sails: 1 }, 1);
    expect(shortHanded.sail).toBeLessThan(0.6 * full.sail);
  });
});
