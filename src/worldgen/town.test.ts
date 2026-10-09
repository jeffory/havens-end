import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../config';
import type { Port } from '../economy/ports';
import { findPath } from '../land/paths';
import { guardPosts } from '../land/townsfolk';
import { collides, createWalker, groundBelow, STEP_UP, stepWalker } from '../land/walker';
import { propCatalog } from '../props/catalog';
import { reserveProps } from '../props/reserve';
import { PROP_SHAPES, shapeCells } from '../props/shapes';
import type { PropKind } from '../props/types';
import { buildShipModel } from '../sailing/shipModel';
import { SLOOP } from '../sailing/ships';
import { baseOf, Block, blocksWalker, FACING_DIRS, isSolid, stairFacing, stairOf } from '../voxel/blocks';
import { pointBlocked } from '../voxel/shapes';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { parseVox } from '../vox/parseVox';
import { planArchipelago } from './archipelago';
import { type Footprint, groundHeight, overlaps } from './buildings';
import { buildHarbour } from './harbour';
import { generateIsland } from './island';
import { HULL_ON_STOCKS_LENGTH } from './town';

/** The real world's five ports, each built alone on its island. */
const PORTS = planArchipelago(1717)
  .filter((plan) => plan.port)
  .map((plan, i) => {
    const world = new VoxelWorld();
    generateIsland(world, plan);
    // Haven, the first, is home.
    return { name: plan.port!.name, faction: plan.port!.faction, home: i === 0, world, harbour: buildHarbour(world, plan, plan.port!.faction, i === 0) };
  });

/** How many of each block stand in a plot (and its roof's overhang). */
function blocksIn(world: VoxelWorld, f: Footprint, from: number, to: number): Map<number, number> {
  const out = new Map<number, number>();
  for (let x = f.x0 - 1; x <= f.x0 + f.w; x++) {
    for (let z = f.z0 - 1; z <= f.z0 + f.d; z++) {
      for (let y = from; y < to; y++) {
        const id = world.getVoxel(x, y, z);
        out.set(id, (out.get(id) ?? 0) + 1);
      }
    }
  }
  return out;
}

function cells(f: Footprint): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let x = f.x0; x < f.x0 + f.w; x++) for (let z = f.z0; z < f.z0 + f.d; z++) out.push([x, z]);
  return out;
}

const LEAVES = new Set<number>([Block.Leaves, Block.PalmLeaves]);
/** The ground itself: through a lamp post, a flag, a tree or a porch's deck and canopy to what it stands on. */
function terrain(world: VoxelWorld, x: number, z: number): number {
  const furniture = [Block.Lantern, Block.Wood, Block.Leaves, Block.PalmLeaves, Block.FlagBlack, Block.FlagCrimson, Block.FlagBlue, Block.FlagWhite, Block.FlagGold, Block.PlanksSlab];
  let h = world.surfaceHeight(x, z);
  while (h > 0 && (furniture.includes(world.getVoxel(x, h - 1, z) as never) || world.getVoxel(x, h - 1, z) === 0)) h--;
  return h;
}
const inside = (f: Footprint, x: number, z: number) => x >= f.x0 && x < f.x0 + f.w && z >= f.z0 && z < f.z0 + f.d;
/** How far (x, z) lies outside a plot, in blocks either way (0 inside it). */
const outside = (f: Footprint, x: number, z: number) => Math.max(f.x0 - x, x - (f.x0 + f.w - 1), f.z0 - z, z - (f.z0 + f.d - 1), 0);

describe('towns', () => {
  it('space their houses out: three clear blocks between any two', () => {
    for (const { name, harbour } of PORTS) {
      const houses = harbour.town.houses;
      expect(houses.length, name).toBeGreaterThanOrEqual(4);
      for (const a of houses) for (const b of houses) if (a !== b) expect(overlaps(a, b, 3), name).toBe(false);
    }
  });

  it('pave a flat square at the foot of the pier, and streets that never step more than a block', () => {
    for (const { name, world, harbour } of PORTS) {
      const { square, streets, well, props } = harbour.town;
      // Flat, but for the well, the stalls and the rest that stand on it.
      const open = (x: number, z: number) => ![well, ...props].some((p) => inside(p, x, z));
      expect(new Set(cells(square).filter(([x, z]) => open(x, z)).map(([x, z]) => groundHeight(world, x, z))).size, name).toBe(1);
      for (const street of [square, ...streets]) {
        for (const [x, z] of cells(street).filter(([x, z]) => open(x, z))) {
          const h = groundHeight(world, x, z);
          expect(baseOf(world.getVoxel(x, h - 1, z)), `${name} paving at ${x},${z}`).toBe(Block.Gravel);
          for (const [nx, nz] of [[x + 1, z], [x, z + 1]]) {
            if (inside(street, nx, nz) && open(nx, nz)) expect(Math.abs(h - groundHeight(world, nx, nz)), `${name} step at ${x},${z}`).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it('climb the streets by stairs, wherever the paving rises a block from one neighbour', () => {
    let stairs = 0;
    for (const { name, world, harbour } of PORTS) {
      const { square, streets, well, props } = harbour.town;
      const paved = (x: number, z: number) => [square, ...streets].some((s) => inside(s, x, z)) && ![well, ...props].some((p) => inside(p, x, z));
      for (const street of [square, ...streets]) {
        for (const [x, z] of cells(street).filter(([x, z]) => paved(x, z))) {
          const h = groundHeight(world, x, z);
          // The ways this cell climbs from: paved neighbours a block below it.
          const from = FACING_DIRS.filter(([dx, dz]) => paved(x - dx, z - dz) && groundHeight(world, x - dx, z - dz) === h - 1);
          const id = world.getVoxel(x, h - 1, z);
          const label = `${name} at ${x},${z}`;
          if (from.length !== 1) {
            expect(stairFacing(id), label).toBe(-1);
            continue;
          }
          expect(id, label).toBe(stairOf(Block.Gravel, FACING_DIRS.indexOf(from[0])));
          stairs++;
        }
      }
    }
    expect(stairs).toBeGreaterThan(0);
  });

  it('stand every house on level ground, not perched on a slope', () => {
    for (const { name, world, harbour } of PORTS) {
      const { square, streets } = harbour.town;
      const paved = (x: number, z: number) => [square, ...streets].some((r) => inside(r, x, z));
      for (const house of harbour.town.houses) {
        // Its pad, two blocks out (the roof overhangs the first); a street beside it is its own level.
        const ring: number[] = [];
        for (let x = house.x0 - 2; x <= house.x0 + house.w + 1; x++) {
          for (let z = house.z0 - 2; z <= house.z0 + house.d + 1; z++) if (outside(house, x, z) === 2 && !paved(x, z)) ring.push(terrain(world, x, z));
        }
        expect(Math.max(...ring) - Math.min(...ring), `${name} house at ${house.x0},${house.z0}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('clear the trees out of town', () => {
    for (const { name, world, harbour } of PORTS) {
      const t = harbour.town;
      // Leaves, that is: lamp posts, the shed and the hull are wood too.
      const leaves: string[] = [];
      for (const plot of [t.square, ...t.streets, ...t.houses, t.shed]) {
        for (let x = plot.x0 - 2; x < plot.x0 + plot.w + 2; x++) {
          for (let z = plot.z0 - 2; z < plot.z0 + plot.d + 2; z++) {
            for (let y = SEA_LEVEL; y < SEA_LEVEL + 40; y++) if (LEAVES.has(world.getVoxel(x, y, z))) leaves.push(`${x},${y},${z}`);
          }
        }
      }
      expect(leaves.slice(0, 5), `${name} trees`).toEqual([]);
    }
  });

  it('build a shipyard: a slipway down into the water, a hull on the stocks, and a shed by it', () => {
    for (const { name, world, harbour } of PORTS) {
      const { slipway, shed } = harbour.town;
      expect(slipway, name).not.toBeNull();
      const way = slipway!;
      expect(cells(way).some(([x, z]) => [SEA_LEVEL - 1, SEA_LEVEL - 2].some((y) => world.getVoxel(x, y, z) === Block.Planks)), `${name} slipway in the water`).toBe(true);
      const hull = harbour.decor.find((d) => d.kind === 'hullOnStocks');
      expect(hull, `${name} hull`).toBeDefined();
      expect(outside(way, Math.floor(hull!.x), Math.floor(hull!.z)), `${name} hull over the slipway`).toBeLessThanOrEqual(1);
      const yard = harbour.places.find((p) => p.kind === 'shipyard')!;
      expect(outside(shed, Math.floor(yard.x), Math.floor(yard.z)), `${name} yard door`).toBeLessThanOrEqual(2);
    }
  });

  it('open the market onto the square, and light the streets', () => {
    for (const { name, harbour } of PORTS) {
      const { square, streets, houses } = harbour.town;
      const market = harbour.places.find((p) => p.kind === 'market')!;
      expect(outside(square, Math.floor(market.x), Math.floor(market.z)), `${name} market`).toBeLessThanOrEqual(2);
      const inTown = (x: number, z: number) => [square, ...streets, ...houses].some((f) => outside(f, Math.floor(x), Math.floor(z)) <= 3);
      expect(harbour.lamps.filter((l) => inTown(l.x, l.z)).length, `${name} street lamps`).toBeGreaterThanOrEqual(4);
    }
  });

  it('give each town its own look: Haven thatched, free ports slated, the Crown tiled, the Brethren tarred', () => {
    const roof = (home: boolean, faction: string) =>
      home ? Block.Thatch : faction === 'merchant' ? Block.RoofSlate : faction === 'imperial' ? Block.RoofTile : Block.TarredRoof;
    for (const { name, faction, home, world, harbour } of PORTS) {
      for (const house of harbour.town.houses) {
        expect(blocksIn(world, house, SEA_LEVEL, SEA_LEVEL + 50).get(roof(home, faction)) ?? 0, `${name} roof`).toBeGreaterThan(0);
      }
    }
  });

  it('set the market, tavern and guildhall apart from the houses', () => {
    for (const { name, world, harbour } of PORTS) {
      const place = (kind: string) => harbour.places.find((p) => p.kind === kind)!;
      const plotOf = (kind: string) => {
        const p = place(kind);
        return harbour.town.houses.find((h) => outside(h, Math.floor(p.x), Math.floor(p.z)) <= 1)!;
      };
      // The market: counters of goods under an open hall, and lanterns at its front.
      const market = plotOf('market');
      const counters = harbour.decor.filter((d) => d.kind.startsWith('counter') && inside(market, Math.floor(d.x), Math.floor(d.z)));
      expect(counters.length, `${name} market counters`).toBeGreaterThanOrEqual(2);
      expect(blocksIn(world, market, place('market').y, place('market').y + 3).get(Block.Lantern) ?? 0, `${name} market lanterns`).toBeGreaterThanOrEqual(2);
      // The tavern: barrels by its door.
      const tavern = place('tavern');
      let barrels = 0;
      for (let x = Math.floor(tavern.x) - 2; x <= tavern.x + 2; x++) for (let z = Math.floor(tavern.z) - 2; z <= tavern.z + 2; z++) if (world.getVoxel(x, tavern.y, z) === Block.Barrel) barrels++;
      expect(barrels, `${name} tavern barrels`).toBeGreaterThanOrEqual(1);
      // The guildhall: two storeys, a row of windows on each.
      const office = plotOf('office');
      const y = place('office').y;
      for (const row of [y + 1, y + 4]) expect(blocksIn(world, office, row, row + 1).get(Block.Window) ?? 0, `${name} guildhall windows at ${row - y}`).toBeGreaterThan(0);
    }
  });

  it('fly flags: the guildhall its owners’, and the pirate haven the black flag in the square', () => {
    const colour = { merchant: Block.FlagBlue, imperial: Block.FlagCrimson, pirate: Block.FlagBlack } as const;
    for (const { name, faction, world, harbour } of PORTS) {
      const p = harbour.places.find((q) => q.kind === 'office')!;
      const office = harbour.town.houses.find((h) => outside(h, Math.floor(p.x), Math.floor(p.z)) <= 1)!;
      expect(blocksIn(world, office, p.y, p.y + 20).get(colour[faction]) ?? 0, `${name} flag`).toBeGreaterThan(0);
      if (faction === 'pirate') {
        const { square } = harbour.town;
        const around = { x0: square.x0 - 3, z0: square.z0 - 3, w: square.w + 6, d: square.d + 6 };
        expect(blocksIn(world, around, SEA_LEVEL, SEA_LEVEL + 40).get(Block.FlagBlack) ?? 0, `${name} black flags`).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('board the floors inside, and fill the well with water', () => {
    for (const { name, world, harbour } of PORTS) {
      for (const kind of ['tavern', 'office']) {
        const p = harbour.places.find((q) => q.kind === kind)!;
        const plot = harbour.town.houses.find((h) => outside(h, Math.floor(p.x), Math.floor(p.z)) <= 1)!;
        expect(world.getVoxel(plot.x0 + 2, p.y - 1, plot.z0 + 2), `${name} ${kind} floor`).toBe(Block.Planks);
      }
      const { well } = harbour.town;
      expect(blocksIn(world, { x0: well.x0 + 1, z0: well.z0 + 1, w: 1, d: 1 }, SEA_LEVEL, SEA_LEVEL + 30).get(Block.WellWater) ?? 0, `${name} well`).toBeGreaterThan(0);
    }
  });

  it('keep everyone off the well: nobody climbs onto its ring or into it, and no path goes over it', () => {
    let tried = 0;
    for (const { name, world, harbour } of PORTS) {
      const { well } = harbour.town;
      const inWell = (x: number, z: number) => inside(well, Math.floor(x), Math.floor(z));
      // The ring stands on the square: its foot is the square's floor.
      const floor = groundBelow(world, well.x0 - 0.5, well.z0 + 1.5, SEA_LEVEL + 40);
      for (const [cx, cz] of cells(well)) {
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const [bx, bz] = [cx + dx, cz + dz];
          if (inWell(bx, bz)) continue;
          const nh = groundBelow(world, bx + 0.5, bz + 0.5, floor + STEP_UP + 1);
          if (nh !== floor || collides(world, bx + 0.5, nh, bz + 0.5)) continue;
          tried++;
          const w = createWalker(bx + 0.5, nh, bz + 0.5);
          let onto = false;
          for (let t = 0; t < 1.5 && !onto; t += 1 / 60) {
            stepWalker(w, -dx, -dz, world, 1 / 60);
            onto = inWell(w.x, w.z);
          }
          expect(onto, `${name}: walked onto the well from ${bx},${bz}`).toBe(false);
        }
      }
      // Straight across it, either way: round it, never over.
      const [mx, mz] = [well.x0 + 1, well.z0 + 1];
      for (const [fx, fz, tx, tz] of [[well.x0 - 1, mz, well.x0 + well.w, mz], [mx, well.z0 - 1, mx, well.z0 + well.d]]) {
        const path = findPath(world, { x: fx + 0.5, y: floor, z: fz + 0.5 }, { x: tx + 0.5, z: tz + 0.5 });
        expect(path, `${name}: a way round the well`).not.toBeNull();
        expect(path!.filter((p) => inWell(p.x, p.z)), `${name}: the way across the well`).toEqual([]);
      }
    }
    expect(tried).toBeGreaterThan(0);
  });

  it('gather townsfolk off the doorways: no spot but a door’s own is where the captain stands to go in', () => {
    for (const { name, harbour } of PORTS) {
      for (const s of harbour.spots.filter((q) => q.kind !== 'door')) {
        for (const p of harbour.places) expect(Math.hypot(s.x - p.x, s.z - p.z), `${name} ${s.kind} spot at ${s.x},${s.z}, by the ${p.kind}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('hang every sign on its building, over the door', () => {
    for (const { name, harbour } of PORTS) {
      const { houses, shed } = harbour.town;
      for (const p of harbour.places) {
        expect(p.sign, `${name} ${p.kind} sign`).toBeDefined();
        const s = p.sign!;
        const on = [...houses, shed].some((f) => outside(f, Math.floor(s.x), Math.floor(s.z)) <= 1);
        expect(on, `${name} ${p.kind} sign on a building`).toBe(true);
        expect(s.y, `${name} ${p.kind} sign height`).toBeGreaterThan(p.y + 2);
      }
    }
  });

  /** Blocks of the given kinds anywhere near the square (and the quay below it). */
  const nearSquare = (world: VoxelWorld, square: Footprint, ids: number[]) => {
    const around = { x0: square.x0 - 10, z0: square.z0 - 10, w: square.w + 20, d: square.d + 20 };
    const got = blocksIn(world, around, SEA_LEVEL - 2, SEA_LEVEL + 40);
    return ids.reduce((n, id) => n + (got.get(id) ?? 0), 0);
  };
  it('set out two stalls by the market, under awnings in the port’s colour, and a hand cart by the shipyard', () => {
    for (const { name, faction, home, world, harbour } of PORTS) {
      const { square } = harbour.town;
      const stalls = harbour.decor.filter((d) => d.kind.startsWith('stall'));
      expect(stalls.length, `${name} stalls`).toBe(2);
      expect(new Set(stalls.map((s) => s.kind)).size, `${name} two kinds of stall`).toBe(2);
      const blue = !home && faction === 'merchant';
      for (const s of stalls) {
        expect(s.kind.endsWith(blue ? 'Blue' : 'Red'), `${name} ${s.kind}`).toBe(true);
        expect(inside(square, Math.floor(s.x), Math.floor(s.z)), `${name} ${s.kind} on the square`).toBe(true);
        expect(world.getVoxel(Math.floor(s.x), s.y, Math.floor(s.z)), `${name} ${s.kind} keeps people out`).toBe(Block.Blocker);
      }
      expect(harbour.decor.filter((d) => d.kind === 'handCart').length, `${name} cart`).toBe(faction === 'pirate' ? 0 : 1);
      // Townsfolk shop at them.
      expect(harbour.spots.filter((p) => p.kind === 'stall' && inside(square, Math.floor(p.x), Math.floor(p.z))).length, `${name} stall spots`).toBeGreaterThanOrEqual(2);
    }
  });

  it('keep the stalls and the cart two clear of every door’s step, and out of the market’s front', () => {
    for (const { name, harbour } of PORTS) {
      const steps = [...harbour.places, ...harbour.spots.filter((s) => s.kind === 'door')].map((p) => ({ x: Math.floor(p.x), z: Math.floor(p.z) }));
      const market = harbour.places.find((p) => p.kind === 'market')!;
      const hall = harbour.town.houses.find((h) => outside(h, Math.floor(market.x), Math.floor(market.z)) <= 1);
      expect(hall, `${name} market hall`).toBeDefined();
      for (const d of harbour.decor.filter((p) => p.kind.startsWith('stall') || p.kind === 'handCart')) {
        for (const c of shapeCells(d, PROP_SHAPES[d.kind]!)) {
          for (const s of steps) expect(Math.max(Math.abs(c.x - s.x), Math.abs(c.z - s.z)), `${name} ${d.kind} at ${c.x},${c.z} by the step at ${s.x},${s.z}`).toBeGreaterThanOrEqual(3);
          expect(outside(hall!, c.x, c.z), `${name} ${d.kind} at ${c.x},${c.z} in the market’s front`).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it('keep everyone out of the stalls and the cart: nobody walks in or scrambles up on top, even by way of a bench, a gun or the well', () => {
    let tried = 0;
    for (const { name, world, harbour } of PORTS) {
      for (const d of harbour.decor.filter((p) => p.kind.startsWith('stall') || p.kind === 'handCart')) {
        const cells = shapeCells(d, PROP_SHAPES[d.kind]!);
        const inProp = (x: number, z: number) => cells.some((c) => c.x === Math.floor(x) && c.z === Math.floor(z));
        for (const c of cells) {
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const [bx, bz] = [c.x + dx, c.z + dz];
            if (inProp(bx, bz)) continue;
            // Whatever the neighbour stands on, up to a climb's reach above the prop's own floor: the
            // ground itself, or a bench, a gun or the well's ring that'd give a leg up onto it.
            const nh = groundBelow(world, bx + 0.5, bz + 0.5, d.y + STEP_UP + 1);
            if (nh < d.y || nh > d.y + STEP_UP || collides(world, bx + 0.5, nh, bz + 0.5)) continue;
            tried++;
            const w = createWalker(bx + 0.5, nh, bz + 0.5);
            for (let t = 0; t < 1.5; t += 1 / 60) stepWalker(w, -dx, -dz, world, 1 / 60);
            expect(inProp(w.x, w.z), `${name} ${d.kind}: walked in from ${bx},${bz} (stands ${nh})`).toBe(false);
            expect(w.y, `${name} ${d.kind}: climbed from ${bx},${bz} (stands ${nh})`).toBe(nh);
          }
        }
      }
    }
    expect(tried).toBeGreaterThan(0);
  });

  it(
    'keep everyone off every stall and the cart from any standable place nearby, however they got up there: a ledge, a corner, a roof’s edge',
    () => {
      let tried = 0;
      const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
      for (const { name, world, harbour } of PORTS) {
        for (const d of harbour.decor.filter((p) => p.kind.startsWith('stall') || p.kind === 'handCart')) {
          const cells = shapeCells(d, PROP_SHAPES[d.kind]!);
          const inProp = (x: number, z: number) => cells.some((c) => c.x === Math.floor(x) && c.z === Math.floor(z));
          const top = d.y + 3;
          const xs = cells.map((c) => c.x);
          const zs = cells.map((c) => c.z);
          // Three cells out all round: a bench, a lamp post, the well's ring, a roof's eave
          // or a grass bank behind the square all lie within that reach.
          for (let x = Math.min(...xs) - 3; x <= Math.max(...xs) + 3; x++) {
            for (let z = Math.min(...zs) - 3; z <= Math.max(...zs) + 3; z++) {
              if (inProp(x, z)) continue;
              const hh = groundBelow(world, x + 0.5, z + 0.5, d.y + 6);
              if (collides(world, x + 0.5, hh, z + 0.5)) continue;
              for (const [dx, dz] of DIRS) {
                tried++;
                const w = createWalker(x + 0.5, hh, z + 0.5);
                // Over the footprint at or above its top, at any point along the walk,
                // whether or not they're on the ground: standing on it is one way up,
                // hovering there (refused, never settling) would be just as wrong.
                let over = false;
                for (let t = 0; t < 3 && !over; t += 1 / 60) {
                  stepWalker(w, dx, dz, world, 1 / 60);
                  if (inProp(w.x, w.z) && w.y >= top - 1e-6) over = true;
                }
                expect(over, `${name} ${d.kind}: from ${x},${z} (stands ${hh}) going ${dx},${dz} -> ${w.x.toFixed(2)},${w.y},${w.z.toFixed(2)}`).toBe(false);
              }
            }
          }
        }
      }
      expect(tried).toBeGreaterThan(0);
    },
    20_000, // sweeps every port's stalls and cart from every direction: slow under a full parallel run
  );

  it(
    'keeps everyone off the hull on the stocks too, once reserveProps has blocked her in at runtime',
    () => {
      const bytes = readFileSync(`public/${SLOOP.model}`);
      const sloop = buildShipModel(parseVox(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), SLOOP.draft);
      const catalog = propCatalog(sloop);
      let tried = 0;
      const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
      const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
      // Built fresh, never shared with the other tests: reserveProps marks the world up.
      const plans = planArchipelago(1717).filter((plan) => plan.port);
      for (const [i, plan] of plans.entries()) {
        const name = plan.port!.name;
        const world = new VoxelWorld();
        generateIsland(world, plan);
        const harbour = buildHarbour(world, plan, plan.port!.faction, i === 0);
        const hull = harbour.decor.find((d) => d.kind === 'hullOnStocks');
        if (!hull) continue;
        reserveProps(world, harbour.decor, catalog); // as Game.ts does, straight after the world's built
        // Every column near her reserved to a blocker, and the height it stands to: her
        // own shape, not the town's — a world away from an unrelated flagpole or roof
        // that happens to sit within some fixed distance of her long hull.
        const [hx, hz] = [Math.floor(hull.x), Math.floor(hull.z)];
        const tops = new Map<string, number>();
        for (let x = hx - 15; x <= hx + 15; x++) {
          for (let z = hz - 15; z <= hz + 15; z++) {
            for (let y = 40; y >= 0; y--) {
              const id = world.getVoxel(x, y, z);
              if (id === Block.Air) continue;
              if (id === Block.Blocker) tops.set(`${x},${z}`, y + 1);
              break;
            }
          }
        }
        expect(tops.size, `${name} hull reserved`).toBeGreaterThan(0);
        const topOf = (x: number, z: number) => tops.get(`${Math.floor(x)},${Math.floor(z)}`);
        // From each cell of hers, its own immediate, reachable neighbours: a climb of up
        // to STEP_UP from right beside her, or a few cells above (a nearby roof's edge),
        // whatever her own shape is there — never a town-wide sweep that could reach some
        // unrelated flagpole or roof far across the square instead.
        for (const [key, top] of tops) {
          const [cx, cz] = key.split(',').map(Number);
          for (const [dx, dz] of D4) {
            const [nx, nz] = [cx + dx, cz + dz];
            if (topOf(nx, nz) !== undefined) continue;
            const nh = groundBelow(world, nx + 0.5, nz + 0.5, top + 6);
            if (nh < top - STEP_UP || collides(world, nx + 0.5, nh, nz + 0.5)) continue;
            for (const [wx, wz] of DIRS) {
              tried++;
              const w = createWalker(nx + 0.5, nh, nz + 0.5);
              let over = false;
              for (let t = 0; t < 3 && !over; t += 1 / 60) {
                stepWalker(w, wx, wz, world, 1 / 60);
                const atTop = topOf(w.x, w.z);
                if (atTop !== undefined && w.y >= atTop - 1e-6) over = true;
              }
              expect(over, `${name} hull: from ${nx},${nz} (stands ${nh}) toward ${cx},${cz} (top ${top}) going ${wx},${wz}`).toBe(false);
            }
          }
        }
      }
      expect(tried).toBeGreaterThan(0);
    },
    20_000, // sweeps every port's hull from every neighbouring cell: slow under a full parallel run
  );

  it('mark the doors you can go in: a timber frame, a stone step, a lantern, and the sign by the door', () => {
    for (const { name, world, harbour } of PORTS) {
      for (const kind of ['tavern', 'office'] as const) {
        const p = harbour.places.find((q) => q.kind === kind)!;
        const ox = Math.floor(p.x);
        const oz = Math.floor(p.z);
        const plot = harbour.town.houses.find((h) => outside(h, ox, oz) === 1)!;
        const [dx, dz] = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([a, b]) => inside(plot, ox + a, oz + b))!;
        const [x, z] = [ox + dx, oz + dz];
        const label = `${name} ${kind} door`;
        const floor = Math.floor(p.y);
        // Over a porch's deck (half a block up) the doorway's open a storey high, its jambs
        // carried up beside it: under a lintel, you'd have to duck.
        const porch = p.y % 1 === 0.5;
        expect(world.getVoxel(x, floor + 2, z), `${label} lintel`).toBe(porch ? Block.Air : Block.Wood);
        for (const s of [-1, 1]) for (const y of porch ? [floor, floor + 1, floor + 2] : [floor, floor + 1]) expect(world.getVoxel(x + dz * s, y, z + dx * s), `${label} jamb`).toBe(Block.Wood);
        expect(world.getVoxel(ox, Math.floor(p.y) - 1, oz), `${label} step`).toBe(Block.Stone);
        const lantern = harbour.decor.find((d) => d.kind === 'wallLantern' && Math.hypot(d.x - p.x, d.z - p.z) <= 1.6 && d.y === Math.floor(p.y) + 2);
        expect(lantern, `${label} lantern`).toBeDefined();
      }
      for (const p of harbour.places) {
        const s = p.sign!;
        expect(Math.hypot(s.x - p.x, s.z - p.z), `${name} ${p.kind} sign by the door`).toBeLessThanOrEqual(1.6);
        expect(s.y - p.y, `${name} ${p.kind} sign over the door`).toBeGreaterThanOrEqual(2);
        expect(s.y - p.y, `${name} ${p.kind} sign over the door`).toBeLessThanOrEqual(4);
      }
    }
  });

  it('top the lamp posts with lanterns, each with its light', () => {
    for (const { name, world, harbour } of PORTS) {
      const posts = harbour.decor.filter((d) => d.kind === 'lantern');
      expect(posts.length, `${name} lanterns`).toBeGreaterThanOrEqual(4);
      for (const d of posts) {
        const [x, z] = [Math.floor(d.x), Math.floor(d.z)];
        expect(world.getVoxel(x, d.y - 1, z), `${name} post under the lantern at ${x},${z}`).toBe(Block.Wood);
        expect(world.getVoxel(x, d.y, z), `${name} nothing where the lantern stands at ${x},${z}`).toBe(Block.Air);
        expect(harbour.lamps.some((l) => Math.hypot(l.x - d.x, l.z - d.z) < 0.01), `${name} its light at ${x},${z}`).toBe(true);
      }
    }
  });

  it('hang a signboard by the tavern’s and office’s doors, and stand signposts by the market and the shipyard', () => {
    for (const { name, world, harbour } of PORTS) {
      for (const [kind, sign] of [['tavern', 'signTavern'], ['office', 'signOffice']] as const) {
        const p = harbour.places.find((q) => q.kind === kind)!;
        const board = harbour.decor.find((d) => d.kind === sign);
        expect(board, `${name} ${kind} sign`).toBeDefined();
        expect(Math.hypot(board!.x - p.x, board!.z - p.z), `${name} ${kind} sign by the door`).toBeLessThanOrEqual(1.6);
        const { x, y, z } = board!.anchor!;
        expect(isSolid(world.getVoxel(x, y, z)), `${name} ${kind} sign on a wall`).toBe(true);
      }
      const yard = harbour.places.find((q) => q.kind === 'shipyard')!;
      for (const [kind, sign] of [['market', 'signpostMarket'], ['shipyard', 'signpostShipyard']] as const) {
        const p = harbour.places.find((q) => q.kind === kind)!;
        if (kind === 'market' && p.x === yard.x && p.z === yard.z) continue; // no market hall of its own
        const post = harbour.decor.find((d) => d.kind === sign);
        expect(post, `${name} ${kind} signpost`).toBeDefined();
        expect(Math.hypot(post!.x - p.x, post!.z - p.z), `${name} ${kind} signpost by the way in`).toBeLessThanOrEqual(3.5);
        // Its post is 2.75 blocks tall: the blocker in its two cells, and over them either
        // the blocker again or something already in the way (the shed's eave).
        const [x, z] = [Math.floor(post!.x), Math.floor(post!.z)];
        for (const dy of [0, 1]) expect(world.getVoxel(x, post!.y + dy, z), `${name} ${kind} signpost keeps its cells`).toBe(Block.Blocker);
        expect(blocksWalker(world.getVoxel(x, post!.y + 2, z)), `${name} ${kind} signpost keeps the cell over them`).toBe(true);
      }
    }
  });

  it('keep everyone off the signposts: nobody walks into one or scrambles up on top of it, and no path goes over it', () => {
    let tried = 0;
    for (const { name, world, harbour } of PORTS) {
      for (const post of harbour.decor.filter((d) => d.kind === 'signpostMarket' || d.kind === 'signpostShipyard')) {
        const [x, z] = [Math.floor(post.x), Math.floor(post.z)];
        // A cell beside it with its ground at the post's foot, clear to stand in.
        const beside = (dx: number, dz: number) => !collides(world, x + dx + 0.5, post.y, z + dz + 0.5) && groundBelow(world, x + dx + 0.5, z + dz + 0.5, post.y + 0.5) === post.y;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (!beside(dx, dz)) continue;
          tried++;
          const label = `${name} ${post.kind} at ${x},${z}, from ${dx},${dz}`;
          const w = createWalker(x + dx + 0.5, post.y, z + dz + 0.5);
          for (let t = 0; t < 1.5; t += 1 / 60) stepWalker(w, -dx, -dz, world, 1 / 60);
          expect([Math.floor(w.x), Math.floor(w.z)], `${label}: walked in`).not.toEqual([x, z]);
          expect(w.y, `${label}: climbed`).toBe(post.y);
          if (!beside(-dx, -dz)) continue;
          const path = findPath(world, { x: x + dx + 0.5, y: post.y, z: z + dz + 0.5 }, { x: x - dx + 0.5, z: z - dz + 0.5 });
          expect(path, `${label}: a way round`).not.toBeNull();
          expect(path!.some((n) => Math.floor(n.x) === x && Math.floor(n.z) === z), `${label}: the way goes over it`).toBe(false);
        }
      }
    }
    expect(tried).toBeGreaterThan(0);
  });

  it('set out the same props from the same seed', () => {
    const plans = planArchipelago(1717).filter((plan) => plan.port);
    PORTS.forEach(({ name, home, harbour }, i) => {
      const world = new VoxelWorld();
      generateIsland(world, plans[i]);
      const again = buildHarbour(world, plans[i], plans[i].port!.faction, home);
      expect(harbour.decor.length, name).toBeGreaterThan(0);
      expect(again.decor, name).toEqual(harbour.decor);
    });
  });

  it('stand every prop that stands on the ground on something solid: lanterns on their posts, porch posts and rails on the deck, signposts', () => {
    const kinds = new Set<string>(['lantern', 'porchPost', 'porchRail', 'signpostMarket', 'signpostShipyard']);
    const standing = (kind: PropKind) => kinds.has(kind) || PROP_SHAPES[kind] !== undefined;
    for (const { name, world, harbour } of PORTS) {
      const props = harbour.decor.filter((d) => standing(d.kind));
      expect(props.length, name).toBeGreaterThan(0);
      // Looking down from under its foot (a signpost's own cells are the blocker), the top of what's there is where it stands.
      for (const d of props) expect(groundBelow(world, d.x, d.z, d.y - 0.5), `${name} ${d.kind} at ${d.x},${d.y},${d.z}`).toBe(d.y);
    }
  });

  it('put a clock over the office door, where it has an upper storey to hang on', () => {
    let clocks = 0;
    for (const { name, world, harbour } of PORTS) {
      const office = harbour.places.find((q) => q.kind === 'office')!;
      for (const c of harbour.decor.filter((d) => d.kind === 'clock')) {
        clocks++;
        const { x, y, z } = c.anchor!;
        expect(isSolid(world.getVoxel(x, y, z)), `${name} clock on a wall`).toBe(true);
        expect(Math.hypot(c.x - office.x, c.z - office.z), `${name} clock over the door`).toBeLessThanOrEqual(1);
        expect(y - Math.floor(office.y), `${name} clock a storey up`).toBe(3);
      }
    }
    expect(clocks).toBeGreaterThanOrEqual(1);
  });

  it('hang the clock clear of the porch’s canopy and the eaves, flat on the wall', () => {
    for (const { name, world, harbour } of PORTS) {
      for (const c of harbour.decor.filter((d) => d.kind === 'clock')) {
        const [dx, dz] = FACING_DIRS[c.facing];
        const [ax, az] = [dz, -dx]; // along the wall
        const { x, z } = c.anchor!;
        // Two blocks across and two high, a quarter of a block out from the wall: every row of it, at its middle and both ends.
        for (let y = c.y + 0.125; y < c.y + 2; y += 0.25) {
          expect(isSolid(world.getVoxel(x, Math.floor(y), z)), `${name} wall behind the clock at ${y}`).toBe(true);
          for (const s of [-0.875, 0, 0.875]) {
            const [px, pz] = [x + 0.5 + dx * 0.625 + ax * s, z + 0.5 + dz * 0.625 + az * s];
            expect(pointBlocked(world, px, y, pz), `${name} clock's face at ${y} (${s} along)`).toBe(false);
          }
        }
      }
    }
  });

  it('fly banners five long and three deep in the owners’ colour, with a device on them', () => {
    const colour = { merchant: Block.FlagBlue, imperial: Block.FlagCrimson, pirate: Block.FlagBlack } as const;
    const device = { merchant: Block.FlagWhite, imperial: Block.FlagGold, pirate: Block.FlagWhite } as const;
    for (const { name, faction, world, harbour } of PORTS) {
      const p = harbour.places.find((q) => q.kind === 'office')!;
      const office = harbour.town.houses.find((h) => outside(h, Math.floor(p.x), Math.floor(p.z)) <= 1)!;
      const around = { x0: office.x0 - 6, z0: office.z0 - 6, w: office.w + 12, d: office.d + 12 };
      const got = blocksIn(world, around, p.y, p.y + 25);
      const cloth = [colour[faction], Block.FlagWhite, Block.FlagGold].reduce((n, id) => n + (got.get(id) ?? 0), 0);
      expect(cloth, `${name} banner`).toBeGreaterThanOrEqual(15);
      expect(got.get(device[faction]) ?? 0, `${name} device`).toBeGreaterThanOrEqual(1);
    }
  });

  it('set the sloop on the stocks: level on her keel over them, stern to the land and bow to the sea', () => {
    for (const { name, world, harbour } of PORTS) {
      const hull = harbour.decor.find((d) => d.kind === 'hullOnStocks')!;
      const [dx, dz] = FACING_DIRS[hull.facing];
      // Bow to the sea: down the slipway ahead of her, the ground falls away.
      expect(groundHeight(world, Math.floor(hull.x + dx * 10), Math.floor(hull.z + dz * 10)), `${name} bow to the sea`).toBeLessThan(hull.y);
      // Stocks under her, up to her keel.
      let stocks = 0;
      for (let t = 1; t < HULL_ON_STOCKS_LENGTH; t++) {
        if (world.getVoxel(Math.floor(hull.x + dx * (t - 0.5)), hull.y - 1, Math.floor(hull.z + dz * (t - 0.5))) === Block.Wood) stocks++;
      }
      expect(stocks, `${name} stocks`).toBeGreaterThanOrEqual(2);
    }
  });

  it('keep the ship on the stocks out of the way of ships at the berth: shoreward of it, and clear of the pier', () => {
    for (const { name, world, harbour } of PORTS) {
      const hull = harbour.decor.find((d) => d.kind === 'hullOnStocks')!;
      const [dx, dz] = FACING_DIRS[hull.facing];
      // The pier runs out to sea along (sin(heading), cos(heading)); the berth lies out along it.
      const hx = Math.sin(harbour.heading);
      const hz = Math.cos(harbour.heading);
      // Along the pier's heading, from the berth: negative is shoreward of it.
      const along = (x: number, z: number) => (x - harbour.x) * hx + (z - harbour.z) * hz;
      // Across the pier's heading, from a point on its centre line.
      const across = (x: number, z: number) => Math.abs((z - harbour.pier.z) * hx - (x - harbour.pier.x) * hz);
      const stern = { x: hull.x, z: hull.z };
      const bow = { x: hull.x + dx * HULL_ON_STOCKS_LENGTH, z: hull.z + dz * HULL_ON_STOCKS_LENGTH };
      for (const [end, p] of [['stern', stern], ['bow', bow]] as const) {
        expect(along(p.x, p.z), `${name} ${end} shoreward of the berth`).toBeLessThan(0);
        expect(across(p.x, p.z), `${name} ${end} clear of the pier`).toBeGreaterThanOrEqual(6);
      }
      // None of her stocks, wherever the cradle runs, reaches out as far as the berth.
      for (let t = 1; t < HULL_ON_STOCKS_LENGTH; t++) {
        const x = Math.floor(hull.x + dx * (t - 0.5));
        const z = Math.floor(hull.z + dz * (t - 0.5));
        if (world.getVoxel(x, hull.y - 1, z) === Block.Wood) expect(along(x, z), `${name} stocks at t=${t} shoreward of the berth`).toBeLessThan(0);
      }
    }
  });

  it('furnish the rooms: a bed and a hearth in every house, the tavern’s bar, the office’s desk, and counters in the market', () => {
    const NEEDS: Record<string, readonly PropKind[]> = {
      house: ['bed', 'hearth', 'table', 'chest'],
      tavern: ['bar', 'barCask', 'barrel', 'shelfBottles', 'table', 'stool'],
      office: ['desk', 'shelfBooks', 'chest'],
      market: ['counterProduce', 'counterCloth'],
    };
    for (const { name, harbour } of PORTS) {
      const placeAt = (f: Footprint) => harbour.places.find((p) => p.kind !== 'shipyard' && outside(f, Math.floor(p.x), Math.floor(p.z)) <= 1)?.kind;
      for (const house of harbour.town.houses) {
        const kind = placeAt(house) ?? 'house';
        const room = { x0: house.x0 + 1, z0: house.z0 + 1, w: house.w - 2, d: house.d - 2 };
        const kinds = new Set(harbour.decor.filter((d) => inside(room, Math.floor(d.x), Math.floor(d.z))).map((d) => d.kind));
        for (const k of NEEDS[kind]) expect(kinds.has(k), `${name} ${kind} at ${house.x0},${house.z0}: ${k}`).toBe(true);
      }
    }
  });

  it('leave every door and the way into each room clear: the captain can walk in from the step to the middle', () => {
    for (const { name, world, harbour } of PORTS) {
      const steps = [...harbour.places.filter((p) => p.kind !== 'shipyard'), ...harbour.spots.filter((s) => s.kind === 'door')];
      for (const house of harbour.town.houses) {
        const step = steps.find((s) => outside(house, Math.floor(s.x), Math.floor(s.z)) === 1);
        if (!step) continue;
        const middle = { x: house.x0 + house.w / 2, z: house.z0 + house.d / 2 };
        expect(findPath(world, { x: step.x, y: step.y, z: step.z }, middle, 1.5), `${name} into the room at ${house.x0},${house.z0}`).not.toBeNull();
      }
    }
  });

  it('dress each port its own way: nets at Haven, bales at the free port, the Crown’s guns, and the Brethren’s guns and gallows', () => {
    for (const { name, faction, home, world, harbour } of PORTS) {
      const { square } = harbour.town;
      if (home) expect(nearSquare(world, square, [Block.Net]), `${name} nets`).toBeGreaterThanOrEqual(3);
      else if (faction === 'merchant') expect(nearSquare(world, square, [Block.Sack]), `${name} bales`).toBeGreaterThanOrEqual(6);
      else expect(nearSquare(world, square, [Block.Iron]), `${name} cannon`).toBeGreaterThanOrEqual(4);
      if (faction === 'pirate') expect(nearSquare(world, square, [Block.Rope]), `${name} gallows`).toBeGreaterThanOrEqual(1);
    }
  });

  it('build porches before the tavern and the office: a deck of plank slabs, posts and rails', () => {
    for (const { name, world, harbour } of PORTS) {
      for (const kind of ['tavern', 'office'] as const) {
        const p = harbour.places.find((q) => q.kind === kind)!;
        const [x, z] = [Math.floor(p.x), Math.floor(p.z)];
        const label = `${name} ${kind} porch`;
        expect(p.y % 1, `${label}: the place stands on the deck`).toBe(0.5);
        expect(world.getVoxel(x, Math.floor(p.y), z), label).toBe(Block.PlanksSlab);
        const near = (kind: string) => harbour.decor.filter((d) => d.kind === kind && Math.hypot(d.x - p.x, d.z - p.z) < 3).length;
        expect(near('porchPost'), `${label} posts`).toBe(2);
        expect(near('porchRail'), `${label} rails`).toBe(2);
      }
    }
  });

  it('anchor each porch post to the canopy over it, so the posts go when the roof lifts', () => {
    for (const { name, world, harbour } of PORTS) {
      const posts = harbour.decor.filter((d) => d.kind === 'porchPost');
      expect(posts.length, name).toBeGreaterThan(0);
      for (const p of posts) {
        const a = p.anchor;
        expect(a, `${name} post at ${p.x},${p.z}`).not.toBeNull();
        expect(world.getVoxel(a!.x, a!.y, a!.z), `${name} canopy over the post at ${p.x},${p.z}`).toBe(Block.PlanksSlab);
        expect(a!.y, `${name} post at ${p.x},${p.z}`).toBe(Math.floor(p.y) + 3);
        expect([Math.floor(p.x), Math.floor(p.z)], `${name} post at ${p.x},${p.z}`).toEqual([a!.x, a!.z]);
      }
    }
  });

  it('let the captain in at the tavern’s and office’s doors, walking from the porch', () => {
    for (const { name, world, harbour } of PORTS) {
      for (const kind of ['tavern', 'office'] as const) {
        const p = harbour.places.find((q) => q.kind === kind)!;
        const [ox, oz] = [Math.floor(p.x), Math.floor(p.z)];
        const plot = harbour.town.houses.find((h) => outside(h, ox, oz) === 1)!;
        const [dx, dz] = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([a, b]) => inside(plot, ox + a, oz + b))!;
        const w = createWalker(p.x, p.y, p.z);
        for (let t = 0; t < 3; t += 1 / 60) stepWalker(w, dx, dz, world, 1 / 60);
        // The doorway is the first cell in: past the wall is a cell further.
        const [x, z] = [Math.floor(w.x), Math.floor(w.z)];
        expect(inside(plot, x, z) && (x - ox) * dx + (z - oz) * dz >= 2, `${name} ${kind}: in as far as ${x},${z}`).toBe(true);
      }
    }
  });

  it('leave the Crown’s guards room either side of the Governor’s door', () => {
    const crown = PORTS.filter((p) => p.faction === 'imperial');
    expect(crown.length).toBeGreaterThan(0);
    for (const { name, faction, world, harbour } of crown) {
      const port: Port = { id: 0, name, faction, islandX: 0, islandZ: 0, ...harbour };
      expect(guardPosts(port, world), `${name} guards`).toHaveLength(2);
    }
  });

  it('stand townsfolk on the tavern’s and office’s porches at the deck’s height, not in it', () => {
    for (const { name, world, harbour } of PORTS) {
      const porches = harbour.places.filter((q) => q.kind === 'tavern' || q.kind === 'office');
      const onPorch = (harbour.spots ?? []).filter((q) => (q.kind === 'door' || q.kind === 'tavern') && porches.some((p) => Math.hypot(q.x - p.x, q.z - p.z) < 2.5));
      expect(onPorch.length, `${name} spots by the porches`).toBeGreaterThan(0);
      for (const s of onPorch) expect(groundBelow(world, s.x, s.z, s.y + 0.5), `${name} ${s.kind} spot at ${s.x},${s.z}`).toBe(s.y);
    }
  });

  it('post a keeper in each shop with a building of its own: behind its counter, facing the room’s front, clear of every door', () => {
    const COUNTERS = ['bar', 'barCask', 'desk', 'counterProduce', 'counterCloth'];
    for (const { name, world, harbour } of PORTS) {
      const yard = harbour.places.find((p) => p.kind === 'shipyard')!;
      const own = harbour.places.filter((p) => p.kind === 'shipyard' || p.x !== yard.x || p.z !== yard.z);
      expect(harbour.keepers.map((k) => k.kind).sort(), name).toEqual(own.map((p) => p.kind).sort());
      for (const post of harbour.keepers) {
        const label = `${name} ${post.kind}’s keeper`;
        expect(collides(world, post.x, post.y, post.z), `${label}: room to stand`).toBe(false);
        expect(groundBelow(world, post.x, post.z, post.y + 0.5), `${label}: on the floor`).toBe(post.y);
        for (const p of harbour.places) expect(Math.hypot(post.x - p.x, post.z - p.z), `${label}, by the ${p.kind}’s door`).toBeGreaterThanOrEqual(1.5);
        if (post.kind === 'shipyard') {
          expect(inside(harbour.town.shed, Math.floor(post.x), Math.floor(post.z)), `${label}: in the shed`).toBe(true);
          continue;
        }
        const ahead = { x: Math.floor(post.x + Math.sin(post.facing)), z: Math.floor(post.z + Math.cos(post.facing)) };
        const counter = harbour.decor.find((d) => COUNTERS.includes(d.kind) && Math.floor(d.x) === ahead.x && Math.floor(d.z) === ahead.z);
        expect(counter, `${label}: a counter before them`).toBeDefined();
      }
    }
  });
});
