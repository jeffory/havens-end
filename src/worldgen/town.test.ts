import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../config';
import type { Port } from '../economy/ports';
import { findPath } from '../land/paths';
import { guardPosts } from '../land/townsfolk';
import { collides, createWalker, groundBelow, stepWalker } from '../land/walker';
import { baseOf, Block, blocksWalker, FACING_DIRS, isSolid, stairFacing, stairOf } from '../voxel/blocks';
import { pointBlocked } from '../voxel/shapes';
import { VoxelWorld } from '../voxel/VoxelWorld';
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
      // The market: stalls under an open hall.
      const market = plotOf('market');
      const hall = blocksIn(world, market, place('market').y, place('market').y + 3);
      expect(hall.get(Block.Barrel) ?? 0, `${name} market stalls`).toBeGreaterThanOrEqual(2);
      expect([Block.Fruit, Block.Greens, Block.Cloth].reduce((n, id) => n + (hall.get(id) ?? 0), 0), `${name} market goods`).toBeGreaterThanOrEqual(2);
      expect(hall.get(Block.Lantern) ?? 0, `${name} market lanterns`).toBeGreaterThanOrEqual(2);
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

  /** The height a building's rooms stand at: the first air up from below, at its lowest inside its walls. */
  const floorOf = (world: VoxelWorld, f: Footprint) =>
    Math.min(
      ...cells({ x0: f.x0 + 1, z0: f.z0 + 1, w: f.w - 2, d: f.d - 2 }).map(([x, z]) => {
        let y = SEA_LEVEL;
        while (world.getVoxel(x, y, z) !== Block.Air) y++;
        return y;
      }),
    );
  /** Blocks of the given kinds anywhere near the square (and the quay below it). */
  const nearSquare = (world: VoxelWorld, square: Footprint, ids: number[]) => {
    const around = { x0: square.x0 - 10, z0: square.z0 - 10, w: square.w + 20, d: square.d + 20 };
    const got = blocksIn(world, around, SEA_LEVEL - 2, SEA_LEVEL + 40);
    return ids.reduce((n, id) => n + (got.get(id) ?? 0), 0);
  };
  const AWNINGS = [Block.Canvas, Block.AwningRed, Block.AwningBlue];
  const GOODS = [Block.Fruit, Block.Greens, Block.Cloth, Block.Sack];

  it('set out stalls under striped awnings by the market, with goods on their counters', () => {
    for (const { name, world, harbour } of PORTS) {
      const { square, props } = harbour.town;
      expect(props.length, `${name} props`).toBeGreaterThanOrEqual(3);
      const onSquare = blocksIn(world, { x0: square.x0 + 1, z0: square.z0 + 1, w: square.w - 2, d: square.d - 2 }, SEA_LEVEL, SEA_LEVEL + 30);
      expect(AWNINGS.reduce((n, id) => n + (onSquare.get(id) ?? 0), 0), `${name} awnings`).toBeGreaterThanOrEqual(12);
      expect(GOODS.reduce((n, id) => n + (onSquare.get(id) ?? 0), 0), `${name} goods`).toBeGreaterThanOrEqual(4);
      // Townsfolk shop at them.
      expect(harbour.spots.filter((p) => p.kind === 'stall' && inside(square, Math.floor(p.x), Math.floor(p.z))).length, `${name} stall spots`).toBeGreaterThanOrEqual(2);
    }
  });

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
    const standing = new Set(['lantern', 'porchPost', 'porchRail', 'signpostMarket', 'signpostShipyard']);
    for (const { name, world, harbour } of PORTS) {
      const props = harbour.decor.filter((d) => standing.has(d.kind));
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

  it('furnish the rooms: beds and hearths in the houses, tables and a bar in the tavern, books in the office', () => {
    for (const { name, world, harbour } of PORTS) {
      const placeAt = (f: Footprint) => harbour.places.find((p) => p.kind !== 'shipyard' && outside(f, Math.floor(p.x), Math.floor(p.z)) <= 1)?.kind;
      for (const house of harbour.town.houses) {
        const kind = placeAt(house) ?? 'house';
        if (kind === 'market') continue;
        const floor = floorOf(world, house);
        // Inside its walls (blocksIn takes a block round what it's given).
        const inside = blocksIn(world, { x0: house.x0 + 2, z0: house.z0 + 2, w: house.w - 4, d: house.d - 4 }, floor, floor + 3);
        const label = `${name} ${kind} at ${house.x0},${house.z0}`;
        if (kind === 'house') {
          expect(inside.get(Block.Canvas) ?? 0, `${label} bed`).toBeGreaterThanOrEqual(1);
          expect(inside.get(Block.Embers) ?? 0, `${label} hearth`).toBeGreaterThanOrEqual(1);
        } else if (kind === 'tavern') {
          expect(inside.get(Block.Barrel) ?? 0, `${label} barrels`).toBeGreaterThanOrEqual(2);
          expect(inside.get(Block.Planks) ?? 0, `${label} tables and bar`).toBeGreaterThanOrEqual(4);
        } else if (kind === 'office') {
          expect(inside.get(Block.Books) ?? 0, `${label} books`).toBeGreaterThanOrEqual(3);
        }
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
});
