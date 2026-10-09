import { SEA_LEVEL } from '../config';
import type { KeeperPost, SpotKind, TownSpot } from '../economy/ports';
import type { PropKind, PropPlacement } from '../props/types';
import { baseOf, Block, type BlockId, blocksWalker, FACING_DIRS, isSolid, slabOf, stairOf } from '../voxel/blocks';
import { pointBlocked, topIn } from '../voxel/shapes';
import type { VoxelWorld } from '../voxel/VoxelWorld';
import { hash2 } from '../util/hash';
import { buildHouse, buildTower, clearSite, type Door, type Footprint, groundHeight, TREE_BLOCKS } from './buildings';
import { furnish, plotCells, standProp } from './furnish';

/** How a port's town is built: its walls and roofs, how many buildings, and whether the Crown's tower stands over it. */
export interface TownStyle {
  walls: BlockId;
  roof: BlockId;
  /** Buildings with doors, the market, tavern and office among them. */
  houses: number;
  tower: boolean;
  /** The flag over the guildhall: its owners' colour. */
  flag: BlockId;
  /** The black flag flown over the square (the Brethren's haven). */
  blackFlags: boolean;
  /** Laid out the other way about (so two ports of a kind don't look alike). */
  mirror?: boolean;
  /**
   * How the square's dressed: Haven's nets and fish, the free port's bales, the Crown's
   * guns, the Brethren's guns and gallows. Its awnings are blue at the free port, red elsewhere.
   */
  dress: 'haven' | 'free' | 'crown' | 'brethren';
  /** Storeys to the seat of power (the guildhall or the governor's). */
  officeStoreys?: number;
}

/** Where a town's parts lie, on the grid: for tests and anything that needs to know the lie of the town. */
export interface TownLayout {
  /** The paved square at the top of the ramp from the pier, and the well that stands on it. */
  square: Footprint;
  well: Footprint;
  /** The ramp up from the pier, the main street inland, and the cross street. */
  streets: Footprint[];
  /** Every building with a door. */
  houses: Footprint[];
  /** The shipyard's open shed, and its slipway (null where the shore has no room for one). */
  shed: Footprint;
  slipway: Footprint | null;
  /** What stands on the square: stalls, benches, a cart or a gallows, guns, nets or bales. */
  props: Footprint[];
}

export interface Town {
  layout: TownLayout;
  /** The market's, tavern's and office's doors, where there was room for them. */
  doors: Partial<Record<'market' | 'tavern' | 'office', Door>>;
  /** Where you stand to go into the shipyard: in front of its shed. */
  yard: { x: number; y: number; z: number };
  /** Where each place's sign hangs: on its building, over the door. */
  signs: Partial<Record<'market' | 'tavern' | 'office', { x: number; y: number; z: number }>>;
  yardSign: { x: number; y: number; z: number };
  /**
   * Which side of the pier the shipyard lies, as a sign across the pier: +1 to the pier's
   * left looking out to sea (the `w` of `harbour.ts`'s `at(t, w)`), −1 to its right.
   */
  yardSide: number;
  /** Where townsfolk go about the town. */
  spots: TownSpot[];
  /** Street lamps, and the tower's beacon. */
  lamps: Array<{ x: number; y: number; z: number }>;
  beacon: { x: number; y: number; z: number } | null;
  /** Props set about the town: lanterns, signs, porches, the ship on the stocks. */
  decor: PropPlacement[];
  /** Where each shop's keeper stands: behind the tavern's bar, the office's desk and the market's counter, and the shipwright in the shed. */
  keepers: KeeperPost[];
}

/**
 * The town's own axes, square to the grid: `u` runs inland from the foot of the pier
 * (`ix`, `iz`), `v` across it (`sx`, `sz`). The origin is the foot of the pier.
 */
interface Frame {
  ox: number;
  oz: number;
  ix: number;
  iz: number;
  sx: number;
  sz: number;
}

/** A rectangle in town coordinates, both ends included. */
interface Rect {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

/** A building plot: where, what it's for, and which way its door looks (a point in town coordinates). */
interface Lot extends Rect {
  role: 'market' | 'tavern' | 'office' | 'house';
  faceU: number;
  faceV: number;
}

/** The square: how deep (inland) and how wide. */
const SQUARE_DEEP = 10;
const SQUARE_HALF = 7;
/** How far up the main street the cross street crosses it, and how far it runs either way. */
const CROSS_AT = 22;
const CROSS_HALF = 22;
/** How far the ground eases back to the island's own about the town. */
const BLEND = 4;
/** Trees whose trunks stand this close to town are taken down, canopy and all. */
const CLEARING = 7;
/** The most blocks taken down from one trunk (a grove of touching canopies is well under). */
const TREE_MOST = 4000;
/** Street lamps stand this far apart along the main street. */
const LAMP_EVERY = 6;
/**
 * The row of the square the market's stalls back onto: the market's step is three further on
 * (its front is at 9, the step at 8), so two clear rows lie between.
 */
const STALL_BACK = 5;
/** The ship on the stocks is the sloop's own model (props/catalog.ts): this long, stern to stem. */
export const HULL_ON_STOCKS_LENGTH = 18;

/**
 * Lays out and builds a town behind the foot of a pier. A ramp climbs from the pier to a
 * paved square levelled at the foot of the town, with the market on it and the
 * shipyard (an open shed and a slipway down into the water, a hull on the stocks)
 * beside it. A main street runs inland, climbing with the land a block at a time at
 * most, and a cross street runs across it. Houses stand spaced along the streets, each
 * on its own levelled pad at the height of the street by its door, with stone walls
 * where the ground steps. Street lamps, a well, and the trees cleared from the town.
 * `footX`, `footZ` is the foot of the pier; (`dx`, `dz`) points out along it.
 */
export function buildTown(
  world: VoxelWorld,
  footX: number,
  footZ: number,
  dx: number,
  dz: number,
  pierLine: (t: number) => { x: number; z: number },
  pierReach: readonly [number, number],
  style: TownStyle,
): Town {
  const f = frame(footX, footZ, dx, dz);
  const decor: PropPlacement[] = [];
  const lamps: Town['lamps'] = [];
  const keepers: KeeperPost[] = [];
  /** Porch decks' cells ("x,z"): half a block up from the ground under them. */
  const decked = new Set<string>();
  const natural = (u: number, v: number) => {
    const { x, z } = at(f, u, v);
    return groundHeight(world, x, z);
  };
  const land = (u: number, v: number) => natural(u, v) >= SEA_LEVEL;

  // The square: levelled at the ground about it, a ramp up to it from the pier.
  const lowGuess = median(cells({ u0: 2, u1: 2 + SQUARE_DEEP, v0: -SQUARE_HALF, v1: SQUARE_HALF }).map(([u, v]) => natural(u, v)).filter((h) => h >= SEA_LEVEL + 1));
  const low = clamp(lowGuess ?? SEA_LEVEL + 2, SEA_LEVEL + 2, SEA_LEVEL + 10);
  const ramp = low - (SEA_LEVEL + 1);
  const q = ramp + 1; // where the square starts
  const start = q + SQUARE_DEEP; // where the main street leaves it
  const cross = start + CROSS_AT;

  // The main street climbs with the land (a block a cell at most), as far as there's land.
  let end = start + CROSS_AT + 24;
  while (end > start && !land(end, 0)) end--;
  const mainH = new Map<number, number>();
  let h = low;
  for (let u = start; u <= end; u++) {
    // Level at the start, and level across the crossing.
    if (u > start && u !== cross + 1 && u !== cross + 2) h = clamp(Math.round(average([-3, -2, -1, 0, 1, 2, 3].map((v) => natural(u, v)))), h - 1, h + 1);
    mainH.set(u, h);
  }
  // The cross street runs across the slope the same way, out from where it meets the main street.
  const crossH = new Map<number, number>();
  const hasCross = end >= cross + 2;
  if (hasCross) {
    crossH.set(0, mainH.get(cross + 1)!);
    for (const dir of [1, -1]) {
      let ch = crossH.get(0)!;
      for (let v = dir; Math.abs(v) <= CROSS_HALF && land(cross + 1, v); v += dir) {
        // Level where it crosses the main street, then with the land.
        if (Math.abs(v) > 1) ch = clamp(Math.round(average([cross, cross + 1, cross + 2].map((u) => natural(u, v)))), ch - 1, ch + 1);
        crossH.set(v, ch);
      }
    }
  }
  const crossV = [...crossH.keys()];

  // Which side the shipyard goes: away from where a slanting pier drifts.
  const drift = dx * f.sx + dz * f.sz;
  const sides = drift > 0.1 ? [-1, 1] : drift < -0.1 ? [1, -1] : style.mirror ? [-1, 1] : [1, -1];
  let yardSide = sides[0];
  let slip: { lane: Rect; heights: Map<number, number> } | null = null;
  for (const s of sides) {
    slip = planSlipway(f, s, q, low, natural, pierLine, pierReach);
    if (slip) {
      yardSide = s;
      break;
    }
  }
  const ys = yardSide; // the shipyard's side of the square; the market takes the other
  const ms = -ys;

  const square: Rect = { u0: q, u1: q + SQUARE_DEEP - 1, v0: -SQUARE_HALF, v1: SQUARE_HALF };
  const streets: Array<{ rect: Rect; height: (u: number, v: number) => number }> = [];
  if (ramp >= 1) streets.push({ rect: { u0: 1, u1: ramp, v0: -1, v1: 1 }, height: (u) => SEA_LEVEL + 1 + u });
  if (end > start) streets.push({ rect: { u0: start, u1: end, v0: -1, v1: 1 }, height: (u) => mainH.get(u)! });
  if (hasCross) streets.push({ rect: { u0: cross, u1: cross + 2, v0: Math.min(...crossV), v1: Math.max(...crossV) }, height: (_u, v) => crossH.get(v)! });
  const roads = streets.map((s) => s.rect);

  const shed: Rect = { u0: q + 1, u1: q + 5, v0: ys > 0 ? 9 : -13, v1: ys > 0 ? 13 : -9 };
  // The well stands in the square, on the shipyard's side, clear of the way to every door.
  const well: Rect = { u0: q + 4, u1: q + 6, v0: ys > 0 ? 3 : -5, v1: ys > 0 ? 5 : -3 };
  const side = (lo: number, hi: number, s: number) => (s > 0 ? { v0: lo, v1: hi } : { v0: -hi, v1: -lo });
  // Lots stand at least four apart, so every pad has its own margin all round.
  const lots: Lot[] = [
    { role: 'market', u0: q + 2, u1: q + 7, ...side(9, 14, ms), faceU: q + 4, faceV: 0 },
    { role: 'tavern', u0: start + 4, u1: start + 10, ...side(4, 9, ys), faceU: start + 7, faceV: 0 },
    { role: 'office', u0: start + 3, u1: start + 9, ...side(4, 10, ms), faceU: start + 6, faceV: 0 },
    { role: 'house', u0: start + 15, u1: start + 20, ...side(4, 9, ys), faceU: start + 17, faceV: 0 },
    { role: 'house', u0: start + 15, u1: start + 19, ...side(4, 9, ms), faceU: start + 17, faceV: 0 },
    { role: 'house', u0: cross + 5, u1: cross + 10, ...side(4, 9, ms), faceU: cross + 7, faceV: 0 },
    { role: 'house', u0: cross + 5, u1: cross + 9, ...side(4, 9, ys), faceU: cross + 7, faceV: 0 },
    // Along the cross street, a block back from it, doors onto it.
    { role: 'house', u0: cross - 7, u1: cross - 2, ...side(14, 19, ms), faceU: cross + 1, faceV: ms * 16 },
    { role: 'house', u0: cross - 7, u1: cross - 2, ...side(14, 19, ys), faceU: cross + 1, faceV: ys * 16 },
    { role: 'house', u0: cross + 4, u1: cross + 9, ...side(14, 20, ys), faceU: cross + 1, faceV: ys * 17 },
    { role: 'house', u0: cross + 4, u1: cross + 9, ...side(14, 20, ms), faceU: cross + 1, faceV: ms * 17 },
    { role: 'house', u0: cross + 15, u1: cross + 20, ...side(4, 9, ms), faceU: cross + 17, faceV: 0 },
    { role: 'house', u0: cross + 15, u1: cross + 19, ...side(4, 9, ys), faceU: cross + 17, faceV: 0 },
  ];
  const tower: Rect | null = style.tower ? { u0: q + 2, u1: q + 4, ...side(18, 20, ms) } : null;

  // The height a lot's pad is levelled to: the street's by its door (the square's, on the square).
  const padOf = (lot: Lot): number | undefined => {
    if (lot.role === 'market') return low;
    if (lot.faceV === 0) return mainH.get(lot.faceU);
    return crossH.get(lot.faceV);
  };
  // Choose the lots: the market, tavern and office first (on the first dry lot for each,
  // in order), then houses, all clear of the sea, the streets and the shipyard, and
  // with a street by their door.
  const clearOf = (r: Rect) => ![square, ...roads, shed, ...(slip ? [slip.lane] : [])].some((o) => touches(r, o, 1));
  const free = lots.filter((l) => cells(l).every(([u, v]) => land(u, v)) && clearOf(l) && padOf(l) !== undefined);
  const chosen: Lot[] = [];
  for (const role of ['market', 'tavern', 'office'] as const) {
    const lot = free.find((l) => l.role === role) ?? free.find((l) => l.role === 'house' && !chosen.includes(l));
    if (lot) chosen.push(lot.role === role ? lot : { ...lot, role });
  }
  for (const lot of free) {
    if (chosen.length >= style.houses) break;
    if (lot.role === 'house' && !chosen.some((c) => c.u0 === lot.u0 && c.v0 === lot.v0)) chosen.push(lot);
  }
  const towerFits = tower !== null && cells(tower).every(([u, v]) => land(u, v)) && clearOf(tower);

  // Level the town. Streets and the square are laid first and win; then each lot's pad
  // with two blocks round it; then a block either side of the streets.
  const target = new Map<string, { u: number; v: number; h: number; top: BlockId }>();
  /** `quay`: over the sea too, as a stone quay (round the pads and the square by the shore). */
  const put = (u: number, v: number, height: number, top: BlockId, force = false, quay = false) => {
    const k = `${u},${v}`;
    if (!force && target.has(k)) return;
    if (!force && !land(u, v) && !quay) return;
    target.set(k, { u, v, h: height, top: !force && !land(u, v) ? Block.Stone : top });
  };
  for (const st of streets) for (const [u, v] of cells(st.rect)) put(u, v, st.height(u, v), Block.Gravel, true);
  for (const [u, v] of cells(square)) put(u, v, low, Block.Gravel, true);
  for (const lot of chosen) for (const [u, v] of cells(grow(lot, 2))) put(u, v, padOf(lot)!, Block.Grass, false, true);
  for (const r of [shed, ...(towerFits ? [tower!] : [])]) for (const [u, v] of cells(grow(r, 2))) put(u, v, low, Block.Grass, false, true);
  for (const [u, v] of cells(grow(square, 1))) put(u, v, low, Block.Grass, false, true);
  for (const st of streets) {
    for (const [u, v] of cells(grow(st.rect, 1))) {
      const nu = clamp(u, st.rect.u0, st.rect.u1);
      const nv = clamp(v, st.rect.v0, st.rect.v1);
      put(u, v, st.height(nu, nv), Block.Grass);
    }
  }

  clearTrees(world, f, target);
  const levelled = new Map<string, number>();
  for (const { u, v, h: height, top } of target.values()) {
    const { x, z } = at(f, u, v);
    setGround(world, x, z, height, top);
    levelled.set(`${u},${v}`, height);
  }
  blendEdges(world, f, levelled);
  retainingWalls(world, f, levelled);

  // Where a street climbs a block from one cell to the next, it climbs by a stair.
  const paved = new Set<string>();
  for (const r of [square, ...roads]) for (const [u, v] of cells(r)) paved.add(`${u},${v}`);
  laySteps(world, f, paved, levelled);

  // The shipyard: slipway, hull, shed and timber.
  let slipway: Footprint | null = null;
  if (slip) {
    buildSlipway(world, f, slip.lane, slip.heights, ys, decor);
    slipway = footprint(f, slip.lane);
  }
  const shedPlot = footprint(f, shed);
  buildShed(world, f, shed, low, style.roof, ys);
  const yardAt = at(f, q + 3, ys * 8);
  const yard = { x: yardAt.x + 0.5, y: low, z: yardAt.z + 0.5 };
  // The shipwright, in the shed by the timber, looking out to the square.
  const wright = at(f, shed.u0 + 1, ys * 10);
  keepers.push({ kind: 'shipyard', x: wright.x + 0.5, y: low, z: wright.z + 0.5, facing: Math.atan2(-ys * f.sx, -ys * f.sz) });

  // The well, in the square.
  buildWell(world, footprint(f, well), low);

  // Buildings, doors to the street: the market an open hall of stalls, the tavern and
  // the guildhall two storeys (the guildhall flying its owners' flag), houses of one
  // storey or two, every floor boarded and every room furnished.
  const doors: Town['doors'] = {};
  const signs: Town['signs'] = {};
  const houses: Footprint[] = [];
  const everyDoor: Door[] = [];
  for (const lot of chosen) {
    const fp = footprint(f, lot);
    const base = padOf(lot)!;
    clearSite(world, fp, base, 1);
    const face = at(f, lot.faceU, lot.faceV);
    // Its rooms, furnished when the roof lifts: how they're set out varies a little by plot.
    const look = Math.floor(hash2(fp.x0, fp.z0, 53) * 1000);
    let door: Door;
    if (lot.role === 'market') {
      door = buildMarketHall(world, fp, base, style, face.x + 0.5, face.z + 0.5);
      const post = furnish(world, fp, door, 'market', decor, look);
      if (post) keepers.push({ kind: 'market', ...post });
    } else {
      const storeys = lot.role === 'house' ? (hash2(fp.x0, fp.z0, 71) < 0.4 ? 2 : 1) : lot.role === 'office' ? (style.officeStoreys ?? 2) : 2;
      door = buildHouse(world, fp, base, style, face.x + 0.5, face.z + 0.5, storeys);
      boardFloor(world, fp, base);
      const post = furnish(world, fp, door, lot.role, decor, look);
      if (post && lot.role !== 'house') keepers.push({ kind: lot.role, ...post });
      if (lot.role === 'tavern') barrelsBy(world, door);
      if (lot.role === 'office') flagOver(world, fp, style.flag);
    }
    houses.push(fp);
    everyDoor.push(door);
    if (lot.role !== 'house') {
      // A door you can go in: framed in timber, a stone step, a lantern, and its signboard on a
      // bracket (the market's open hall gets a signpost, once the square is dressed).
      if (lot.role !== 'market') {
        lamps.push(markDoor(world, door, decor));
        for (const c of buildPorch(world, door, decor)) decked.add(c);
        if (decked.has(`${door.outX},${door.outZ}`)) door.outY = door.y + 0.5;
        const [ax, az] = alongOf(door);
        decor.push(onWall(lot.role === 'tavern' ? 'signTavern' : 'signOffice', door.x - ax, door.y + 2, door.z - az, door.outX - door.x, door.outZ - door.z));
        if (lot.role === 'office') clockOver(world, door, decor);
      } else {
        world.setVoxel(door.outX, door.y - 1, door.outZ, Block.Stone);
      }
      doors[lot.role] = door;
      signs[lot.role] = signBy(door);
    }
  }
  let beacon: Town['beacon'] = null;
  if (towerFits) {
    const fp = footprint(f, tower!);
    clearSite(world, fp, low, 1);
    beacon = buildTower(world, fp, low);
  }

  // The shipyard's way in: a stone step before its shed, lanterns on its front posts, its sign.
  const yardFront = ys > 0 ? shed.v0 : shed.v1;
  world.setVoxel(yardAt.x, low - 1, yardAt.z, Block.Stone);
  for (const u of [shed.u0, shed.u1]) {
    const { x, z } = at(f, u, yardFront);
    world.setVoxel(x, low + 2, z, Block.Lantern);
  }
  const yardSign = { x: yardAt.x + 0.5 + f.sx * ys * 0.6, y: low + 2.9, z: yardAt.z + 0.5 + f.sz * ys * 0.6 };

  // The square, dressed. Two stalls by the market, set back from its front so the way in
  // stays open; benches at its top; a hand cart of timber by the shipyard (the Brethren
  // hang a gallows there instead); and the port's own: guns at the seaward edge for the
  // Crown and the Brethren, net racks at Haven, bales at the free port.
  const props: Rect[] = [];
  const stallSpots: Array<[number, number]> = [];
  // (Where there was no room for the market by the square, they stand either side of its middle.)
  const marketU = doors.market ? local(f, doors.market.x, doors.market.z).u : Infinity;
  const doorU = marketU <= q + SQUARE_DEEP ? marketU : q + 4;
  const stalls: PropKind[] = style.dress === 'free' ? ['stallProduceBlue', 'stallClothBlue'] : ['stallProduceRed', 'stallClothRed'];
  if (style.mirror) stalls.reverse();
  // Either side of the column of the market's door, their fronts to the square's middle and
  // two clear rows between their backs and the market's step. Clamped a cell shy of the
  // benches at the square's top and the quay gun at its seaward edge, so nothing standable
  // above the floor is ever next to one (a bench or a gun is a step the blocker's easily climbed from).
  for (const [u0, kind] of [[clamp(doorU - 4, q + 2, q + 6), stalls[0]], [clamp(doorU + 2, q + 2, q + 6), stalls[1]]] as const) {
    const r: Rect = { u0, u1: u0 + 2, ...side(STALL_BACK - 1, STALL_BACK, ms) };
    standProp(world, decor, kind, plotCells(footprint(f, r)), low, facingOf(-ms * f.sx, -ms * f.sz));
    props.push(r);
    stallSpots.push([u0 + 1, ms * (STALL_BACK - 2)]);
  }
  for (const s of [-1, 1]) {
    const r: Rect = { u0: q + SQUARE_DEEP - 1, u1: q + SQUARE_DEEP - 1, ...side(2, 3, s) };
    for (const [u, v] of cells(r)) place(world, f, u, v, low, Block.Planks);
    props.push(r);
  }
  // A cell further out than the well, so its ring is never next to the cart's blocker, and
  // clear of the shed's roof overhang (it reaches to q + 6), so touching or sighting the
  // cart never lifts the shed with it.
  const corner: Rect = { u0: q + 7, u1: q + 9, ...side(6, 7, ys) };
  if (style.dress === 'brethren') buildGallows(world, f, corner, low, ys);
  else standProp(world, decor, 'handCart', plotCells(footprint(f, corner)), low, facingOf(f.ix, f.iz));
  props.push(corner);
  if (style.dress === 'crown' || style.dress === 'brethren') {
    for (const s of [-1, 1]) {
      buildGun(world, f, q, s * 4, low);
      props.push({ u0: q, u1: q, ...side(4, 4, s) });
    }
  } else {
    const quay: Rect = { u0: q, u1: q + 1, ...side(5, 7, ys) };
    if (style.dress === 'haven') buildNetRack(world, f, quay, low, ys);
    else buildBales(world, f, quay, low, ys);
    props.push(quay);
  }
  const onProp = (u: number, v: number) => props.some((r) => u >= r.u0 && u <= r.u1 && v >= r.v0 && v <= r.v1);

  // Signposts by the ways in with no wall beside them: the market's open hall, and the shipyard's shed.
  if (doors.market) {
    const d = doors.market;
    const [ax, az] = alongOf(d);
    signpostAt(world, 'signpostMarket', [2, -2, 3, -3].map((a) => ({ x: d.outX + ax * a, z: d.outZ + az * a })), d.y, d.outX - d.x, d.outZ - d.z, decor);
  }
  signpostAt(world, 'signpostShipyard', [1, 5, 0, 6].map((du) => at(f, q + du, ys * 8)), low, -f.sx * ys, -f.sz * ys, decor);

  // Lamps: at the corners of the square and down the main street on alternate sides,
  // off the streets and out of anyone's doorway.
  const onRoad = (u: number, v: number) => [square, ...roads].some((r) => u >= r.u0 && u <= r.u1 && v >= r.v0 && v <= r.v1);
  const inDoorway = (x: number, z: number) =>
    everyDoor.some((d) => Math.abs(d.outX - x) + Math.abs(d.outZ - z) <= 1) || Math.abs(yard.x - 0.5 - x) + Math.abs(yard.z - 0.5 - z) <= 1;
  // A lamp keeps back from the buildings: none stands against a wall.
  const byBuilding = (u: number, v: number) => chosen.some((l) => touches({ u0: u, u1: u, v0: v, v1: v }, l, 1));
  // Lamps at the top corners of the square; the Brethren fly the black flag either side
  // of the top of the ramp from the pier, to greet whoever comes ashore.
  const spots: Array<[number, number]> = [
    [q + SQUARE_DEEP - 1, -SQUARE_HALF - 1],
    [q + SQUARE_DEEP - 1, SQUARE_HALF + 1],
  ];
  if (style.blackFlags) {
    for (const v of [-2, 2]) {
      const { x, z } = at(f, q - 1, v);
      const height = levelled.get(`${q - 1},${v}`);
      if (height !== undefined) flagPole(world, x, height, z, f.sx * Math.sign(v), f.sz * Math.sign(v), Block.FlagBlack);
    }
  }
  for (let u = start + 2, s = 1; u <= end; u += LAMP_EVERY, s = -s) spots.push([u, s * 2]);
  for (const [u, v] of spots) {
    const { x, z } = at(f, u, v);
    const height = levelled.get(`${u},${v}`);
    if (height === undefined || onRoad(u, v) || byBuilding(u, v) || inDoorway(x, z) || world.getVoxel(x, height, z) !== Block.Air) continue;
    lamps.push(lampPost(world, x, height, z, decor));
  }

  // Where townsfolk go: about the square, down the market's aisle, at the shipyard, by
  // the tavern door and the well, along the street, and in and out of the houses.
  const townSpots: TownSpot[] = [];
  const spotAt = (u: number, v: number, y: number, kind: SpotKind) => {
    const { x, z } = at(f, u, v);
    townSpots.push({ x: x + 0.5, y, z: z + 0.5, kind });
  };
  const inWell = (u: number, v: number) => u >= well.u0 && u <= well.u1 && v >= well.v0 && v <= well.v1;
  for (const u of [q + 2, q + 5, q + 8]) for (const v of [-4, 0, 4]) if (!inWell(u, v) && !onProp(u, v)) spotAt(u, v, low, 'square');
  for (const [u, v] of stallSpots) spotAt(u, v, low, 'stall');
  for (const [u, v] of [[q + 5, ys * 2], [q + 3, ys * 4], [q + 7, ys * 4]]) spotAt(u, v, low, 'well');
  spotAt(q + 3, ys * 8, low, 'yard');
  spotAt(q + 3, ys * 11, low, 'yard');
  for (let u = start + 2; u <= end; u += 7) spotAt(u, 0, mainH.get(u)!, 'street');
  const outside = (d: Door, steps: number, kind: SpotKind) => {
    const x = d.x + (d.outX - d.x) * steps;
    const z = d.z + (d.outZ - d.z) * steps;
    townSpots.push({ x: x + 0.5, y: decked.has(`${x},${z}`) ? d.y + 0.5 : d.y, z: z + 0.5, kind });
  };
  if (doors.market) for (const steps of [-1, -2, 1]) outside(doors.market, steps, 'stall');
  if (doors.tavern) for (const steps of [1, 2]) outside(doors.tavern, steps, 'tavern');
  for (const d of everyDoor) if (d !== doors.market) outside(d, 1, 'door');

  return {
    spots: townSpots,
    layout: { square: footprint(f, square), well: footprint(f, well), streets: roads.map((r) => footprint(f, r)), houses, shed: shedPlot, slipway, props: props.map((r) => footprint(f, r)) },
    doors,
    yard,
    signs,
    yardSign,
    // The town's `v` runs the other way to the pier's `w`.
    yardSide: -ys,
    lamps,
    beacon,
    decor,
    keepers,
  };
}

/** The frame for a pier pointing out along (`dx`, `dz`): inland along the grid axis nearest the way back up it. */
function frame(footX: number, footZ: number, dx: number, dz: number): Frame {
  const [ix, iz] = Math.abs(dx) >= Math.abs(dz) ? [-Math.sign(dx), 0] : [0, -Math.sign(dz)];
  return { ox: Math.floor(footX), oz: Math.floor(footZ), ix, iz, sx: -iz, sz: ix };
}

const at = (f: Frame, u: number, v: number) => ({ x: f.ox + f.ix * u + f.sx * v, z: f.oz + f.iz * u + f.sz * v });

/** Where (x, z) lies in the town's coordinates. */
const local = (f: Frame, x: number, z: number) => ({ u: (x - f.ox) * f.ix + (z - f.oz) * f.iz, v: (x - f.ox) * f.sx + (z - f.oz) * f.sz });

function footprint(f: Frame, r: Rect): Footprint {
  const a = at(f, r.u0, r.v0);
  const b = at(f, r.u1, r.v1);
  return { x0: Math.min(a.x, b.x), z0: Math.min(a.z, b.z), w: Math.abs(a.x - b.x) + 1, d: Math.abs(a.z - b.z) + 1 };
}

function cells(r: Rect): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let u = r.u0; u <= r.u1; u++) for (let v = r.v0; v <= r.v1; v++) out.push([u, v]);
  return out;
}

const grow = (r: Rect, by: number): Rect => ({ u0: r.u0 - by, u1: r.u1 + by, v0: r.v0 - by, v1: r.v1 + by });
const touches = (a: Rect, b: Rect, margin: number) => a.u0 <= b.u1 + margin && b.u0 <= a.u1 + margin && a.v0 <= b.v1 + margin && b.v0 <= a.v1 + margin;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const average = (list: readonly number[]) => list.reduce((a, b) => a + b, 0) / list.length;

function median(list: number[]): number | null {
  if (list.length === 0) return null;
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Sets a column's ground to height `h` (the first air), topped with `top`: earth fills
 * up to it, and (with `clear`) what stood above goes. Without it, only ground cut away
 * goes, and a neighbouring tree's canopy overhead is left whole.
 */
function setGround(world: VoxelWorld, x: number, z: number, h: number, top: BlockId, clear = true): void {
  const g = groundHeight(world, x, z);
  for (let y = h; y < (clear ? Math.max(g, h) + 12 : g); y++) world.setVoxel(x, y, z, Block.Air);
  for (let y = g; y < h - 1; y++) world.setVoxel(x, y, z, Block.Dirt);
  world.setVoxel(x, h - 1, z, top);
}

/**
 * Takes down every tree near the town whole: from each trunk, everything of trees joined
 * to it (touching canopies come down together), so no bare trunk or floating leaves are
 * left where a neighbour was cut into.
 */
function clearTrees(world: VoxelWorld, f: Frame, town: Map<string, { u: number; v: number }>): void {
  const near = new Set<string>();
  for (const { u, v } of town.values()) {
    for (let du = -CLEARING; du <= CLEARING; du++) for (let dv = -CLEARING; dv <= CLEARING; dv++) near.add(`${u + du},${v + dv}`);
  }
  for (const k of near) {
    const [u, v] = k.split(',').map(Number);
    const { x, z } = at(f, u, v);
    const g = groundHeight(world, x, z);
    if (world.getVoxel(x, g, z) !== Block.Wood) continue;
    const queue: Array<[number, number, number]> = [[x, g, z]];
    for (let n = 0; queue.length > 0 && n < TREE_MOST; n++) {
      const [cx, cy, cz] = queue.pop()!;
      if (!TREE_BLOCKS.has(world.getVoxel(cx, cy, cz))) continue;
      world.setVoxel(cx, cy, cz, Block.Air);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) if (dx || dy || dz) queue.push([cx + dx, cy + dy, cz + dz]);
    }
  }
}

/** Eases the island's own ground toward the town's round its edge: no cliffs or walls where they meet. */
function blendEdges(world: VoxelWorld, f: Frame, levelled: ReadonlyMap<string, number>): void {
  const ring = new Map<string, { u: number; v: number }>();
  for (const k of levelled.keys()) {
    const [u, v] = k.split(',').map(Number);
    for (let du = -BLEND; du <= BLEND; du++) {
      for (let dv = -BLEND; dv <= BLEND; dv++) {
        const nk = `${u + du},${v + dv}`;
        if (!levelled.has(nk)) ring.set(nk, { u: u + du, v: v + dv });
      }
    }
  }
  for (const { u, v } of ring.values()) {
    let lo = -Infinity;
    let hi = Infinity;
    for (let du = -BLEND; du <= BLEND; du++) {
      for (let dv = -BLEND; dv <= BLEND; dv++) {
        const h = levelled.get(`${u + du},${v + dv}`);
        if (h === undefined) continue;
        const d = Math.max(Math.abs(du), Math.abs(dv));
        lo = Math.max(lo, h - d);
        hi = Math.min(hi, h + d);
      }
    }
    const { x, z } = at(f, u, v);
    const g = groundHeight(world, x, z);
    if (g < SEA_LEVEL) continue;
    const h = clamp(g, lo, hi);
    if (h === g) continue;
    const top = world.getVoxel(x, g - 1, z);
    setGround(world, x, z, h, top === Block.Sand || top === Block.Stone ? top : Block.Grass, false);
  }
}

/** Faces the step up from one terrace to the next in stone. */
function retainingWalls(world: VoxelWorld, f: Frame, levelled: ReadonlyMap<string, number>): void {
  for (const [k, h] of levelled) {
    const [u, v] = k.split(',').map(Number);
    let lowest = h;
    for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = levelled.get(`${u + du},${v + dv}`);
      if (n !== undefined) lowest = Math.min(lowest, n);
    }
    if (h - lowest < 2) continue;
    const { x, z } = at(f, u, v);
    for (let y = lowest - 1; y < h - 1; y++) world.setVoxel(x, y, z, Block.Stone);
  }
}

/** The four ways across the grid, in town coordinates. */
const ACROSS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Paves the streets' climbs with stairs: where a paved cell stands a block above exactly
 * one of its paved neighbours (never at a corner or a crossing, where it's above two),
 * its paving becomes a stair climbing away from that neighbour. A run of rises (the ramp
 * up from the pier) becomes a flight of half-steps.
 */
function laySteps(world: VoxelWorld, f: Frame, paved: ReadonlySet<string>, levelled: ReadonlyMap<string, number>): void {
  for (const k of paved) {
    const h = levelled.get(k);
    if (h === undefined) continue;
    const [u, v] = k.split(',').map(Number);
    const below = ACROSS.filter(([du, dv]) => paved.has(`${u + du},${v + dv}`) && levelled.get(`${u + du},${v + dv}`) === h - 1);
    if (below.length !== 1) continue;
    const [du, dv] = below[0];
    const here = at(f, u, v);
    const up = at(f, u - du, v - dv);
    const facing = FACING_DIRS.findIndex(([dx, dz]) => dx === up.x - here.x && dz === up.z - here.z);
    if (baseOf(world.getVoxel(here.x, h - 1, here.z)) === Block.Gravel) world.setVoxel(here.x, h - 1, here.z, stairOf(Block.Gravel, facing));
  }
}

/**
 * Where a slipway could run down into the water on side `s`: a lane seven wide from the
 * square's edge seaward, falling a block every two, and ending three blocks into water
 * deep enough to float a hull. Null if the water's too far, or the pier's in the way.
 */
function planSlipway(
  f: Frame,
  s: number,
  q: number,
  low: number,
  natural: (u: number, v: number) => number,
  pierLine: (t: number) => { x: number; z: number },
  pierReach: readonly [number, number],
): { lane: Rect; heights: Map<number, number> } | null {
  const centre = s * 11;
  const heights = new Map<number, number>();
  let wet = 0;
  let u = q;
  for (; u > q - 26 && wet < 3; u--) {
    const h = Math.max(SEA_LEVEL - 1, low - Math.floor((q - u + 1) / 2));
    heights.set(u, h);
    if (h === SEA_LEVEL - 1 && natural(u, centre) <= SEA_LEVEL - 1) wet++;
  }
  if (wet < 3) return null;
  const lane: Rect = { u0: u + 1, u1: q, v0: centre - 3, v1: centre + 3 };
  // Clear of the pier (with room to walk between).
  for (let t = pierReach[0]; t <= pierReach[1]; t += 0.5) {
    const p = pierLine(t);
    const { u: pu, v: pv } = local(f, Math.floor(p.x), Math.floor(p.z));
    if (pu >= lane.u0 - 3 && pu <= lane.u1 + 3 && pv >= lane.v0 - 3 && pv <= lane.v1 + 3) return null;
  }
  return { lane, heights };
}

/**
 * The slipway's planks, falling to the water, and the stocks under a ship: the sloop's
 * model, a prop (Town.decor). Where the slipway's shorter than she is, the stocks carry on
 * out over the water regardless, standing on the seabed.
 */
function buildSlipway(world: VoxelWorld, f: Frame, lane: Rect, heights: ReadonlyMap<number, number>, side: number, decor: PropPlacement[]): void {
  for (const [u, v] of cells(lane)) {
    const h = heights.get(u)!;
    const { x, z } = at(f, u, v);
    const g = groundHeight(world, x, z);
    for (let y = h; y < Math.max(g, h) + 12; y++) world.setVoxel(x, y, z, Block.Air);
    for (let y = Math.min(g, h - 2); y < h - 1; y++) world.setVoxel(x, y, z, Block.Stone);
    world.setVoxel(x, h - 1, z, Block.Planks);
  }
  // She lies level on her keel over stocks down to the falling planks, stern to the land and bow to the sea.
  const centre = side * 11;
  const stern = lane.u1 - 2;
  const keel = heights.get(stern)!;
  for (let u = stern; u > stern - HULL_ON_STOCKS_LENGTH; u -= 3) {
    // A cradle running out into the water where the slipway is shorter than she is: past
    // its end, a post stands on the seabed instead of on the falling planks.
    const { x, z } = at(f, u, centre);
    const foot = heights.get(u) ?? groundHeight(world, x, z);
    for (let y = foot; y < keel; y++) place(world, f, u, centre, y, Block.Wood);
  }
  // Her origin is the middle of her stern's face: between her stern's cell and the one landward of it.
  const here = at(f, stern, centre);
  const back = at(f, stern + 1, centre);
  decor.push({
    kind: 'hullOnStocks',
    x: (here.x + back.x) / 2 + 0.5,
    y: keel,
    z: (here.z + back.z) / 2 + 0.5,
    facing: facingOf(here.x - back.x, here.z - back.z),
    anchor: null,
  });
}

/**
 * The shipyard's shed: boarded floor, planked walls at the back and the landward end,
 * open to the square in front and to the slipway, on posts, under a gable roof, with
 * timber stacked against the back wall. `side` is which way (across the town) its back is.
 */
function buildShed(world: VoxelWorld, f: Frame, r: Rect, base: number, roof: BlockId, side: number): void {
  const back = side > 0 ? r.v1 : r.v0;
  const front = side > 0 ? r.v0 : r.v1;
  const put = (u: number, v: number, y: number, id: BlockId) => {
    const { x, z } = at(f, u, v);
    world.setVoxel(x, y, z, id);
  };
  for (const [u, v] of cells(r)) {
    put(u, v, base - 1, Block.Planks);
    for (let y = base; y < base + 7; y++) put(u, v, y, Block.Air);
  }
  for (const [u, v] of cells(r)) {
    const wall = v === back || u === r.u1;
    const post = (u === r.u0 || u === r.u1) && (v === back || v === front);
    if (wall || post) for (let y = base; y < base + 3; y++) put(u, v, y, wall ? Block.Planks : Block.Wood);
  }
  // A gable roof, its ridge running along the shed, a block's overhang all round.
  const mid = (r.v0 + r.v1) / 2;
  const half = (r.v1 - r.v0) / 2 + 1;
  for (let u = r.u0 - 1; u <= r.u1 + 1; u++) {
    for (let v = r.v0 - 1; v <= r.v1 + 1; v++) put(u, v, base + 3 + Math.round(half - Math.abs(v - mid)) - 1, roof);
  }
  // Timber against the back wall.
  const stack = back - Math.sign(side);
  for (let u = r.u0 + 1; u < r.u1; u++) for (let y = base; y < base + 2; y++) put(u, stack, y, Block.Wood);
}

/** A stone well: a low ring round dark water. */
function buildWell(world: VoxelWorld, fp: Footprint, base: number): void {
  for (let x = fp.x0; x < fp.x0 + fp.w; x++) {
    for (let z = fp.z0; z < fp.z0 + fp.d; z++) {
      const middle = x === fp.x0 + 1 && z === fp.z0 + 1;
      world.setVoxel(x, base, z, middle ? Block.Air : Block.Stone);
      if (middle) world.setVoxel(x, base - 1, z, Block.WellWater);
    }
  }
}

/** The market: an open hall on posts under a gable roof, a wall at the back; its counters are set out by `furnish`. Returns its way in (the middle of its open front). */
function buildMarketHall(world: VoxelWorld, fp: Footprint, base: number, style: TownStyle, towardX: number, towardZ: number): Door {
  const { x0, z0, w, d } = fp;
  const x1 = x0 + w - 1;
  const z1 = z0 + d - 1;
  const cx = x0 + (w - 1) / 2;
  const cz = z0 + (d - 1) / 2;
  const alongX = Math.abs(towardX - cx) > Math.abs(towardZ - cz); // the front is an x-facing side
  const frontHigh = alongX ? towardX > cx : towardZ > cz;
  const isFront = (x: number, z: number) => (alongX ? x === (frontHigh ? x1 : x0) : z === (frontHigh ? z1 : z0));
  const isBack = (x: number, z: number) => (alongX ? x === (frontHigh ? x0 : x1) : z === (frontHigh ? z0 : z1));
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      world.setVoxel(x, base - 1, z, Block.Planks);
      const corner = (x === x0 || x === x1) && (z === z0 || z === z1);
      const edge = x === x0 || x === x1 || z === z0 || z === z1;
      if (isBack(x, z)) for (let y = base; y < base + 3; y++) world.setVoxel(x, y, z, style.walls);
      else if (corner || (edge && !isFront(x, z) && ((alongX ? z : x) - (alongX ? z0 : x0)) % 2 === 0)) for (let y = base; y < base + 3; y++) world.setVoxel(x, y, z, Block.Wood);
    }
  }
  // Lanterns hung at the front corners.
  for (const [x, z] of alongX ? [[frontHigh ? x1 : x0, z0], [frontHigh ? x1 : x0, z1]] : [[x0, frontHigh ? z1 : z0], [x1, frontHigh ? z1 : z0]]) world.setVoxel(x, base + 2, z, Block.Lantern);
  // The roof, ridge along the front, a block's overhang.
  const span = alongX ? d : w;
  const mid = alongX ? cz : cx;
  for (let x = x0 - 1; x <= x1 + 1; x++) {
    for (let z = z0 - 1; z <= z1 + 1; z++) {
      const across = Math.abs((alongX ? z : x) - mid);
      world.setVoxel(x, base + 3 + Math.round((span + 1) / 2 - across) - 1, z, style.roof);
    }
  }
  const doorX = alongX ? (frontHigh ? x1 : x0) : Math.floor(cx);
  const doorZ = alongX ? Math.floor(cz) : frontHigh ? z1 : z0;
  return { x: doorX, z: doorZ, outX: doorX + (alongX ? (frontHigh ? 1 : -1) : 0), outZ: doorZ + (alongX ? 0 : frontHigh ? 1 : -1), y: base };
}

/** Boards a building's floor inside its walls. */
function boardFloor(world: VoxelWorld, fp: Footprint, base: number): void {
  for (let x = fp.x0 + 1; x < fp.x0 + fp.w - 1; x++) for (let z = fp.z0 + 1; z < fp.z0 + fp.d - 1; z++) world.setVoxel(x, base - 1, z, Block.Planks);
}

/** A barrel either side of a door, against the wall. */
function barrelsBy(world: VoxelWorld, door: Door): void {
  const alongX = door.outX === door.x; // the wall runs along x
  for (const s of [-1, 1]) {
    const x = alongX ? door.outX + s * 2 : door.outX;
    const z = alongX ? door.outZ : door.outZ + s * 2;
    if (world.getVoxel(x, door.y, z) === Block.Air && world.getVoxel(x, door.y - 1, z) !== Block.Air) world.setVoxel(x, door.y, z, Block.Barrel);
  }
}

/** A flag on a pole from the top of a building's roof, flying its owners' colour. */
function flagOver(world: VoxelWorld, fp: Footprint, flag: BlockId): void {
  const x = fp.x0 + Math.floor(fp.w / 2);
  const z = fp.z0 + Math.floor(fp.d / 2);
  const top = world.surfaceHeight(x, z);
  const alongX = fp.w < fp.d; // fly it along the ridge, across the long side
  flagPole(world, x, top, z, alongX ? 1 : 0, alongX ? 0 : 1, flag, 5);
}

/**
 * A pole `height` high from ground `y`, topped with a finial, and a banner five long and
 * three deep flying from it out along (`dx`, `dz`) in its owners' `flag` colour.
 */
function flagPole(world: VoxelWorld, x: number, y: number, z: number, dx: number, dz: number, flag: BlockId, height = 6): void {
  for (let i = 0; i <= height; i++) world.setVoxel(x, y + i, z, Block.Wood);
  for (let out = 1; out <= 5; out++) {
    for (let up = 0; up < 3; up++) world.setVoxel(x + dx * out, y + height - 3 + up, z + dz * out, bannerAt(flag, out, up));
  }
}

/**
 * A banner's device, `out` along from the pole (1 to 5) and `up` from its foot (0 to 2): a
 * skull over two bones on the black, a gold cross on the Crown's crimson, a white band
 * with a gold boss on the Guild's blue.
 */
function bannerAt(flag: BlockId, out: number, up: number): BlockId {
  if (flag === Block.FlagBlack) return (out === 3 && up === 1) || (Math.abs(out - 3) === 1 && up === 0) ? Block.FlagWhite : flag;
  if (flag === Block.FlagCrimson) return out === 3 || up === 1 ? Block.FlagGold : flag;
  return up !== 1 ? flag : out === 3 ? Block.FlagGold : Block.FlagWhite;
}

/** Sets one block, by town coordinates. */
function place(world: VoxelWorld, f: Frame, u: number, v: number, y: number, id: BlockId): void {
  const { x, z } = at(f, u, v);
  world.setVoxel(x, y, z, id);
}

/** The Brethren's gallows: two posts, a beam across, a noose hanging. */
function buildGallows(world: VoxelWorld, f: Frame, r: Rect, base: number, side: number): void {
  const v = side > 0 ? r.v0 : r.v1;
  for (const u of [r.u0, r.u1]) for (let y = base; y < base + 5; y++) place(world, f, u, v, y, Block.Wood);
  for (let u = r.u0 + 1; u < r.u1; u++) place(world, f, u, v, base + 4, Block.Wood);
  const mid = Math.floor((r.u0 + r.u1) / 2);
  place(world, f, mid, v, base + 3, Block.Rope);
  place(world, f, mid, v, base + 2, Block.Rope);
  // The drop, boarded, beside it.
  const by = side > 0 ? r.v1 : r.v0;
  for (let u = r.u0; u <= r.u1; u++) place(world, f, u, by, base, Block.Planks);
}

/** A gun at the square's seaward edge, on its carriage, its barrel run out over the quay. */
function buildGun(world: VoxelWorld, f: Frame, u: number, v: number, base: number): void {
  for (const du of [0, -1]) place(world, f, u + du, v, base, Block.Planks);
  for (const du of [0, -1, -2]) place(world, f, u + du, v, base + 1, Block.Iron);
}

/** Haven's fishing: a rack of nets drying on two posts, and crates of the catch. */
function buildNetRack(world: VoxelWorld, f: Frame, r: Rect, base: number, side: number): void {
  const [near, far] = side > 0 ? [r.v0, r.v1] : [r.v1, r.v0];
  for (const v of [near, far]) for (let y = base; y < base + 2; y++) place(world, f, r.u0, v, y, Block.Wood);
  for (let v = r.v0; v <= r.v1; v++) place(world, f, r.u0, v, base + 2, Block.Net);
  place(world, f, r.u0, (near + far) / 2, base + 1, Block.Net);
  place(world, f, r.u1, near, base, Block.Crate);
  place(world, f, r.u1, far, base, Block.Crate);
  place(world, f, r.u1, far, base + 1, Block.Crate);
}

/** The free port's trade: bales of goods two high, and a crate and a barrel beside them. */
function buildBales(world: VoxelWorld, f: Frame, r: Rect, base: number, side: number): void {
  const far = side > 0 ? r.v1 : r.v0;
  for (const [u, v] of cells(r)) {
    if (v === far) {
      place(world, f, u, v, base, u === r.u0 ? Block.Crate : Block.Barrel);
      continue;
    }
    place(world, f, u, v, base, Block.Sack);
    place(world, f, u, v, base + 1, Block.Sack);
  }
}

/** Where a place's sign hangs: over its door, just out from the wall. */
function signBy(door: Door): { x: number; y: number; z: number } {
  return { x: door.x + 0.5 + (door.outX - door.x) * 0.6, y: door.y + 2.9, z: door.z + 0.5 + (door.outZ - door.z) * 0.6 };
}

/** Along a door's wall: the grid step from the door to its jambs. */
const alongOf = (door: Door): readonly [number, number] => (door.outX !== door.x ? [0, 1] : [1, 0]);

/** The quarter turn (as FACING_DIRS) that looks along (dx, dz). */
const facingOf = (dx: number, dz: number): number => FACING_DIRS.findIndex(([fx, fz]) => fx === dx && fz === dz);

/** A prop hung on the face of wall block (x, y, z) looking out along (ox, oz): its origin at the middle of that face, at the block's foot. */
function onWall(kind: PropKind, x: number, y: number, z: number, ox: number, oz: number): PropPlacement {
  return { kind, x: x + 0.5 + ox * 0.5, y, z: z + 0.5 + oz * 0.5, facing: facingOf(ox, oz), anchor: { x, y, z } };
}

/**
 * The cells a signpost's post keeps people out of, from its foot up. The post is 2.75
 * blocks tall; with only two, anyone walking into it scrambled up on top (a ledge of two
 * is within STEP_UP), and paths went over it.
 */
const SIGNPOST_CELLS = 3;

/**
 * A signpost by a way in with no wall beside it (the market's open hall, the shipyard's
 * shed), on the first of `spots` with room for it, looking out along (ox, oz). It keeps
 * people out of its post's cells: its foot and the cell over it must be clear, and the
 * top one clear or already something nobody walks through (the shed's eave, over the way
 * into the shipyard). The blocker goes only where there's air.
 */
function signpostAt(world: VoxelWorld, kind: PropKind, spots: ReadonlyArray<{ x: number; z: number }>, y: number, ox: number, oz: number, decor: PropPlacement[]): void {
  for (const { x, z } of spots) {
    let room = isSolid(world.getVoxel(x, y - 1, z));
    for (let dy = 0; dy < SIGNPOST_CELLS && room; dy++) {
      const id = world.getVoxel(x, y + dy, z);
      room = id === Block.Air || (dy === SIGNPOST_CELLS - 1 && blocksWalker(id));
    }
    if (!room) continue;
    decor.push({ kind, x: x + 0.5, y, z: z + 0.5, facing: facingOf(ox, oz), anchor: null });
    for (let dy = 0; dy < SIGNPOST_CELLS; dy++) if (world.getVoxel(x, y + dy, z) === Block.Air) world.setVoxel(x, y + dy, z, Block.Blocker);
    return;
  }
}

/** How high the clock is, and how wide: two blocks each. */
const CLOCK_SIZE = 2;

/**
 * A clock on the office's front over its door, where there's an upper storey's wall to hang it
 * on. It stands on the porch's canopy where there is one (half a block up), and goes up only
 * where the wall is behind the whole of it and nothing, a canopy or an eave, is in front of its face.
 */
function clockOver(world: VoxelWorld, door: Door, decor: PropPlacement[]): void {
  const y = door.y + 3;
  const [ox, oz] = [door.outX - door.x, door.outZ - door.z];
  const [ax, az] = alongOf(door);
  const foot = y + (world.getVoxel(door.outX, y, door.outZ) === Block.Air ? 0 : topIn(world.getVoxel(door.outX, y, door.outZ), 0.5, 0.5));
  const roof: readonly BlockId[] = [Block.Thatch, Block.RoofTile, Block.RoofSlate, Block.TarredRoof];
  const wallAt = (a: number, h: number) => world.getVoxel(door.x + ax * a, Math.floor(h), door.z + az * a);
  // Its rows' middles, a quarter of a block apart; and just out from the wall's face, across it.
  for (let h = foot + 0.125; h < foot + CLOCK_SIZE; h += 0.25) {
    for (const a of [-1, 0, 1]) if (!isSolid(wallAt(a, h)) || roof.includes(wallAt(a, h))) return;
    for (const s of [-0.875, 0, 0.875]) {
      if (pointBlocked(world, door.x + 0.5 + ox * 0.625 + ax * s, h, door.z + 0.5 + oz * 0.625 + az * s)) return;
    }
  }
  decor.push({ ...onWall('clock', door.x, y, door.z, ox, oz), y: foot });
}

/**
 * A porch before a door (the tavern's and the office's): a deck of plank slabs three wide
 * and two deep (one, where the street comes closer), a plank-slab canopy over it a storey
 * up, posts at the deck's front corners, and a rail either side of the way in. It's built
 * only on dry pad in front of the door, never on the street's paving. Where it's built, the
 * doorway behind it is opened a storey high (the lintel taken out, the jambs carried up to
 * its height). Returns the deck's cells ("x,z").
 */
function buildPorch(world: VoxelWorld, door: Door, decor: PropPlacement[]): Set<string> {
  const [ax, az] = alongOf(door);
  const [ox, oz] = [door.outX - door.x, door.outZ - door.z];
  const cell = (a: number, k: number) => ({ x: door.x + ox * k + ax * a, z: door.z + oz * k + az * a });
  const clear = (k: number) =>
    [-1, 0, 1].every((a) => {
      const { x, z } = cell(a, k);
      const under = world.getVoxel(x, door.y - 1, z);
      return world.getVoxel(x, door.y, z) === Block.Air && isSolid(under) && baseOf(under) !== Block.Gravel;
    });
  const deck = new Set<string>();
  if (!clear(1)) return deck;
  const deep = clear(2) ? 2 : 1;
  for (let k = 1; k <= deep; k++) {
    for (const a of [-1, 0, 1]) {
      const { x, z } = cell(a, k);
      world.setVoxel(x, door.y, z, slabOf(Block.Planks));
      if (world.getVoxel(x, door.y + 3, z) === Block.Air) world.setVoxel(x, door.y + 3, z, slabOf(Block.Planks));
      deck.add(`${x},${z}`);
    }
  }
  // Whoever stands on the deck is half a block up, and would stop at a lintel two up from the
  // door's foot: over a porch the doorway's open a storey high, with no lintel, and the jambs
  // are carried up beside it (they hold the lantern and the signboard).
  world.setVoxel(door.x, door.y + 2, door.z, Block.Air);
  for (const a of [-1, 1]) world.setVoxel(door.x + ax * a, door.y + 2, door.z + az * a, Block.Wood);
  // A point `t` out from the wall's face and `s` along it from the door's middle.
  const at = (t: number, s: number) => ({ x: door.x + 0.5 + ox * (0.5 + t) + ax * s, z: door.z + 0.5 + oz * (0.5 + t) + az * s });
  const facing = facingOf(ox, oz);
  // The posts hold up the canopy, and go with it when the roof lifts on foot.
  for (const s of [-1.25, 1.25]) decor.push({ kind: 'porchPost', ...at(deep - 0.25, s), y: door.y + 0.5, facing, anchor: { ...cell(Math.sign(s), deep), y: door.y + 3 } });
  for (const s of [-1, 1]) decor.push({ kind: 'porchRail', ...at(deep - 0.125, s), y: door.y + 0.5, facing, anchor: null });
  return deck;
}

/**
 * A door you can go in, marked out: its frame in timber (the jambs and the lintel; a porch
 * built after opens it up, see `buildPorch`), a stone step before it, and a lantern hung on
 * the wall beside it. Returns the lantern's light.
 */
function markDoor(world: VoxelWorld, door: Door, decor: PropPlacement[]): { x: number; y: number; z: number } {
  const [ax, az] = alongOf(door);
  const [ox, oz] = [door.outX - door.x, door.outZ - door.z];
  for (const s of [-1, 1]) for (let y = door.y; y < door.y + 2; y++) world.setVoxel(door.x + ax * s, y, door.z + az * s, Block.Wood);
  world.setVoxel(door.x, door.y + 2, door.z, Block.Wood);
  world.setVoxel(door.outX, door.y - 1, door.outZ, Block.Stone);
  decor.push(onWall('wallLantern', door.x + ax, door.y + 2, door.z + az, ox, oz));
  return { x: door.x + ax + 0.5 + ox * 0.9, y: door.y + 2.5, z: door.z + az + 0.5 + oz * 0.9 };
}

/** A street lamp: a post two high with a lantern standing on top. Returns where the light is. */
function lampPost(world: VoxelWorld, x: number, h: number, z: number, decor: PropPlacement[]): { x: number; y: number; z: number } {
  world.setVoxel(x, h, z, Block.Wood);
  world.setVoxel(x, h + 1, z, Block.Wood);
  decor.push({ kind: 'lantern', x: x + 0.5, y: h + 2, z: z + 0.5, facing: 0, anchor: null });
  return { x: x + 0.5, y: h + 2.5, z: z + 0.5 };
}
