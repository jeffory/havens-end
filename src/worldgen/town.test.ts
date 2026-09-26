import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../config';
import { baseOf, Block, FACING_DIRS, isSolid, stairFacing, stairOf } from '../voxel/blocks';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { planArchipelago } from './archipelago';
import { type Footprint, groundHeight, overlaps } from './buildings';
import { buildHarbour } from './harbour';
import { generateIsland } from './island';

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
/** The ground itself: through a lamp post, a flag or a tree to what it stands on. */
function terrain(world: VoxelWorld, x: number, z: number): number {
  const furniture = [Block.Lantern, Block.Wood, Block.Leaves, Block.PalmLeaves, Block.FlagBlack, Block.FlagCrimson, Block.FlagBlue, Block.FlagWhite, Block.FlagGold];
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
      // The hull's timber and planking, above the slipway's own deck (a plank a column).
      let hull = -cells(way).length;
      for (const [x, z] of cells(way)) for (let y = SEA_LEVEL - 3; y < SEA_LEVEL + 20; y++) if ([Block.Wood, Block.Planks].includes(world.getVoxel(x, y, z) as never)) hull++;
      expect(hull, `${name} hull`).toBeGreaterThanOrEqual(12);
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
        expect(world.getVoxel(x, p.y + 2, z), `${label} lintel`).toBe(Block.Wood);
        for (const s of [-1, 1]) for (const y of [p.y, p.y + 1]) expect(world.getVoxel(x + dz * s, y, z + dx * s), `${label} jamb`).toBe(Block.Wood);
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
        expect(world.getVoxel(Math.floor(post!.x), post!.y, Math.floor(post!.z)), `${name} ${kind} signpost keeps its cell`).toBe(Block.Blocker);
      }
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

  it('build a ship on the stocks: seven wide amidships, her ribs bare forward, and a mast stepped', () => {
    for (const { name, world, harbour } of PORTS) {
      const way = harbour.town.slipway!;
      const alongX = way.w > way.d;
      const [across, along] = alongX ? [way.d, way.w] : [way.w, way.d];
      expect(across, `${name} slipway breadth`).toBeGreaterThanOrEqual(7);
      // Hull across the whole breadth somewhere amidships.
      const hullAt = (a: number, b: number) => {
        const [x, z] = alongX ? [way.x0 + b, way.z0 + a] : [way.x0 + a, way.z0 + b];
        let n = 0;
        for (let y = SEA_LEVEL; y < SEA_LEVEL + 20; y++) if ([Block.Wood, Block.Planks].includes(world.getVoxel(x, y, z) as never)) n++;
        return n;
      };
      let widest = 0;
      for (let b = 0; b < along; b++) widest = Math.max(widest, Array.from({ length: across }, (_, a) => a).filter((a) => hullAt(a, b) >= 2).length);
      expect(widest, `${name} beam`).toBeGreaterThanOrEqual(7);
      // A mast: a tall run of wood, ten or more.
      let tallest = 0;
      for (const [x, z] of cells(way)) {
        let run = 0;
        for (let y = SEA_LEVEL; y < SEA_LEVEL + 30; y++) {
          run = world.getVoxel(x, y, z) === Block.Wood ? run + 1 : 0;
          tallest = Math.max(tallest, run);
        }
      }
      expect(tallest, `${name} mast`).toBeGreaterThanOrEqual(10);
      // Ribs: frames standing bare, open between.
      let ribs = 0;
      for (const [x, z] of cells(way)) {
        for (let y = SEA_LEVEL; y < SEA_LEVEL + 12; y++) {
          const [px, pz, nx, nz] = alongX ? [x - 1, z, x + 1, z] : [x, z - 1, x, z + 1];
          if (world.getVoxel(x, y, z) === Block.Wood && world.getVoxel(px, y, pz) === Block.Air && world.getVoxel(nx, y, nz) === Block.Air) ribs++;
        }
      }
      expect(ribs, `${name} ribs`).toBeGreaterThanOrEqual(6);
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
});
