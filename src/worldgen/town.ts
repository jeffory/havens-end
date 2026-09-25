import { SEA_LEVEL } from '../config';
import type { SpotKind, TownSpot } from '../economy/ports';
import { Block, type BlockId } from '../voxel/blocks';
import type { VoxelWorld } from '../voxel/VoxelWorld';
import { hash2 } from '../util/hash';
import { buildHouse, buildTower, clearSite, type Door, type Footprint, groundHeight, TREE_BLOCKS } from './buildings';

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

  // The shipyard: slipway, hull, shed and timber.
  let slipway: Footprint | null = null;
  if (slip) {
    buildSlipway(world, f, slip.lane, slip.heights, ys);
    slipway = footprint(f, slip.lane);
  }
  const shedPlot = footprint(f, shed);
  buildShed(world, f, shed, low, style.roof, ys);
  const yardAt = at(f, q + 3, ys * 8);
  const yard = { x: yardAt.x + 0.5, y: low, z: yardAt.z + 0.5 };

  // The well, in the square.
  buildWell(world, footprint(f, well), low);

  // Buildings, doors to the street: the market an open hall of stalls, the tavern and
  // the guildhall two storeys (the guildhall flying its owners' flag), houses of one
  // storey or two, every floor boarded.
  const doors: Town['doors'] = {};
  const signs: Town['signs'] = {};
  const houses: Footprint[] = [];
  const everyDoor: Door[] = [];
  for (const lot of chosen) {
    const fp = footprint(f, lot);
    const base = padOf(lot)!;
    clearSite(world, fp, base, 1);
    const face = at(f, lot.faceU, lot.faceV);
    let door: Door;
    if (lot.role === 'market') {
      door = buildMarketHall(world, fp, base, style, face.x + 0.5, face.z + 0.5);
    } else {
      const storeys = lot.role === 'house' ? (hash2(fp.x0, fp.z0, 71) < 0.4 ? 2 : 1) : lot.role === 'office' ? (style.officeStoreys ?? 2) : 2;
      door = buildHouse(world, fp, base, style, face.x + 0.5, face.z + 0.5, storeys);
      boardFloor(world, fp, base);
      furnish(world, fp, door, lot.role);
      if (lot.role === 'tavern') barrelsBy(world, door);
      if (lot.role === 'office') flagOver(world, fp, style.flag);
    }
    houses.push(fp);
    everyDoor.push(door);
    if (lot.role !== 'house') {
      // A door you can go in: framed in timber, a stone step, a lantern, its sign over it.
      if (lot.role !== 'market') markDoor(world, door);
      else world.setVoxel(door.outX, door.y - 1, door.outZ, Block.Stone);
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

  // The square, dressed. Stalls either side of the way to the market's door, under
  // awnings; benches at its top; a cart of timber by the shipyard (the Brethren hang a
  // gallows there instead); and the port's own: guns at the seaward edge for the Crown
  // and the Brethren, net racks at Haven, bales at the free port.
  const props: Rect[] = [];
  const stallSpots: Array<[number, number]> = [];
  // (Where there was no room for the market by the square, they stand either side of its middle.)
  const marketU = doors.market ? local(f, doors.market.x, doors.market.z).u : Infinity;
  const doorU = marketU <= q + SQUARE_DEEP ? marketU : q + 4;
  const awning = style.dress === 'free' ? Block.AwningBlue : Block.AwningRed;
  for (const [u0, i] of [[doorU - 3, 0], [doorU + 1, 1]]) {
    const r: Rect = { u0: clamp(u0, q + 1, q + 6), u1: clamp(u0, q + 1, q + 6) + 2, ...side(4, 6, ms) };
    buildStall(world, f, r, low, ms, awning, STALL_GOODS[(i + (style.mirror ? 1 : 0)) % STALL_GOODS.length]);
    props.push(r);
    stallSpots.push([r.u0 + 1, ms * 4]);
  }
  for (const s of [-1, 1]) {
    const r: Rect = { u0: q + SQUARE_DEEP - 1, u1: q + SQUARE_DEEP - 1, ...side(2, 3, s) };
    for (const [u, v] of cells(r)) place(world, f, u, v, low, Block.Planks);
    props.push(r);
  }
  const corner: Rect = { u0: q + 6, u1: q + 8, ...side(6, 7, ys) };
  if (style.dress === 'brethren') buildGallows(world, f, corner, low, ys);
  else buildCart(world, f, corner, low, ys);
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

  // Lamps: at the corners of the square and down the main street on alternate sides,
  // off the streets and out of anyone's doorway.
  const lamps: Town['lamps'] = [];
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
    lamps.push(lampPost(world, x, height, z));
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
  const outside = (d: Door, steps: number, kind: SpotKind) => townSpots.push({ x: d.x + (d.outX - d.x) * steps + 0.5, y: d.y, z: d.z + (d.outZ - d.z) * steps + 0.5, kind });
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

/** The slipway's planks, falling to the water, and a hull on the stocks over them. */
function buildSlipway(world: VoxelWorld, f: Frame, lane: Rect, heights: ReadonlyMap<number, number>, side: number): void {
  for (const [u, v] of cells(lane)) {
    const h = heights.get(u)!;
    const { x, z } = at(f, u, v);
    const g = groundHeight(world, x, z);
    for (let y = h; y < Math.max(g, h) + 12; y++) world.setVoxel(x, y, z, Block.Air);
    for (let y = Math.min(g, h - 2); y < h - 1; y++) world.setVoxel(x, y, z, Block.Stone);
    world.setVoxel(x, h - 1, z, Block.Planks);
  }
  // The hull, half built: level on her keel over stocks down to the falling planks.
  // She's broadest aft of amidships and narrows to a stem at the bow (seaward), her
  // sheer rising fore and aft. Aft she's planked up to the gunwale and closed by a
  // transom; over her forward part only her bottom strakes are on, and her frames stand
  // bare above.
  // Her mast is stepped, with a yard across it.
  const centre = side * 11;
  const stern = lane.u1 - 2;
  const bow = Math.max(lane.u0 + 3, stern - 13);
  const length = Math.max(1, stern - bow);
  const keel = heights.get(stern)!;
  const put = (u: number, v: number, y: number, id: BlockId) => place(world, f, u, v, y, id);
  for (let u = bow; u <= stern; u++) {
    const t = (u - bow) / length; // 0 at the bow, 1 at the stern
    const deck = heights.get(u)!;
    if ((u - bow) % 3 === 1) for (let y = deck; y < keel; y++) put(u, centre, y, Block.Wood); // the stocks
    put(u, centre, keel, Block.Wood); // the keel
    const sheer = 4 + (t < 0.15 || t > 0.9 ? 1 : 0);
    if (u === bow) {
      for (let y = keel + 1; y <= keel + sheer + 1; y++) put(u, centre, y, Block.Wood); // the stem
      continue;
    }
    const beam = t < 0.15 ? 1 : t < 0.35 ? 2 : t > 0.9 ? 2 : 3;
    const planked = t >= 0.6 ? sheer : 2;
    const frame = (u - bow) % 2 === 1;
    for (let k = 1; k <= sheer; k++) {
      const w = Math.min(beam, k); // she flares out from the keel
      if (u === stern) {
        for (let a = -w; a <= w; a++) put(u, centre + a, keel + k, Block.Planks); // the transom
        continue;
      }
      const id = k <= planked ? Block.Planks : frame ? Block.Wood : Block.Air;
      if (id === Block.Air) continue;
      // Her bottom's whole; above it, each strake from where the one below left off.
      const inner = k === 1 ? 0 : Math.min(Math.min(beam, k - 1) + 1, w);
      for (let a = inner; a <= w; a++) {
        put(u, centre - a, keel + k, id);
        put(u, centre + a, keel + k, id);
      }
    }
  }
  const mast = bow + Math.round(length * 0.35);
  for (let y = keel + 1; y <= keel + 13; y++) put(mast, centre, y, Block.Wood);
  for (let a = -3; a <= 3; a++) put(mast, centre + a, keel + 11, Block.Wood);
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

/** The market: an open hall on posts under a gable roof, a wall at the back, stalls of barrels and counters within. Returns its way in (the middle of its open front). */
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
  // Stalls: counters and barrels down both sides, clear down the middle to the front.
  for (let x = x0 + 1; x < x1; x++) {
    for (let z = z0 + 1; z < z1; z++) {
      const across = alongX ? z : x;
      const lo = alongX ? z0 + 1 : x0 + 1;
      const hi = alongX ? z1 - 1 : x1 - 1;
      if ((across === lo || across === hi) && !isBack(x, z) && !isFront(x + (alongX ? (frontHigh ? 1 : -1) : 0), z + (alongX ? 0 : frontHigh ? 1 : -1))) {
        const barrel = (x + z) % 2 === 0;
        world.setVoxel(x, base, z, barrel ? Block.Barrel : Block.Planks);
        // Goods laid out on the counters.
        if (!barrel) world.setVoxel(x, base + 1, z, [Block.Fruit, Block.Greens, Block.Cloth][(((x * 7 + z * 3) % 3) + 3) % 3]);
      }
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

/** What each stall sells, laid along its counter: greengrocer, fruiterer, draper. */
const STALL_GOODS: ReadonlyArray<readonly BlockId[]> = [
  [Block.Greens, Block.Fruit, Block.Greens],
  [Block.Cloth, Block.Sack, Block.Cloth],
  [Block.Fruit, Block.Fruit, Block.Sack],
];

/**
 * A market stall on the square: a counter of crates with `goods` on it, a post at each
 * corner, and a striped awning over the lot. `r` is three long and three deep; the
 * counter runs down its middle, the customers' side toward the square's middle (away
 * from `side`), the stallholder's behind.
 */
function buildStall(world: VoxelWorld, f: Frame, r: Rect, base: number, side: number, awning: BlockId, goods: readonly BlockId[]): void {
  const front = side > 0 ? r.v0 : r.v1;
  const back = side > 0 ? r.v1 : r.v0;
  const middle = (r.v0 + r.v1) / 2;
  for (let u = r.u0; u <= r.u1; u++) {
    place(world, f, u, middle, base, u === r.u0 || u === r.u1 ? Block.Crate : Block.Planks);
    place(world, f, u, middle, base + 1, goods[(u - r.u0) % goods.length]);
    for (let v = r.v0; v <= r.v1; v++) place(world, f, u, v, base + 3, (u - r.u0) % 2 === 0 ? awning : Block.Canvas);
  }
  for (const u of [r.u0, r.u1]) for (const v of [front, back]) for (let y = base; y < base + 3; y++) place(world, f, u, v, y, Block.Wood);
}

/** A cart of timber: its bed on two wheels, planks and logs aboard, its shafts to the ground. */
function buildCart(world: VoxelWorld, f: Frame, r: Rect, base: number, side: number): void {
  const mid = Math.floor((r.u0 + r.u1) / 2);
  for (const [u, v] of cells(r)) {
    if (u === mid) place(world, f, u, v, base, Block.Wood); // the wheels
    place(world, f, u, v, base + 1, Block.Planks);
    if (v === (side > 0 ? r.v1 : r.v0) && u !== r.u1) place(world, f, u, v, base + 2, Block.Wood); // logs
  }
  place(world, f, r.u1, side > 0 ? r.v1 : r.v0, base + 2, Block.Sack);
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

/**
 * A door you can go in, marked out: its frame in timber (the jambs and the lintel), a
 * stone step before it, and a lantern on the wall beside it.
 */
function markDoor(world: VoxelWorld, door: Door): void {
  const [ax, az] = door.outX !== door.x ? [0, 1] : [1, 0]; // along the wall
  for (const s of [-1, 1]) for (let y = door.y; y < door.y + 2; y++) world.setVoxel(door.x + ax * s, y, door.z + az * s, Block.Wood);
  world.setVoxel(door.x, door.y + 2, door.z, Block.Wood);
  world.setVoxel(door.outX, door.y - 1, door.outZ, Block.Stone);
  world.setVoxel(door.outX + ax, door.y + 2, door.outZ + az, Block.Lantern);
}

/** Where a place's sign hangs: over its door, just out from the wall. */
function signBy(door: Door): { x: number; y: number; z: number } {
  return { x: door.x + 0.5 + (door.outX - door.x) * 0.6, y: door.y + 2.9, z: door.z + 0.5 + (door.outZ - door.z) * 0.6 };
}

/**
 * Furnishes a building's ground floor, seen when its roof lifts: in a house a bed and a
 * hearth against the back wall and a table and stool; in the tavern a bar across the
 * back with barrels behind it, and tables; in the office shelves of books along the back
 * and a desk. The way in from the door is left clear.
 */
function furnish(world: VoxelWorld, fp: Footprint, door: Door, role: 'tavern' | 'office' | 'house'): void {
  const ix = Math.sign(door.x - door.outX);
  const iz = Math.sign(door.z - door.outZ);
  const deep = ix !== 0 ? fp.w - 2 : fp.d - 2;
  const wide = ix !== 0 ? fp.d - 2 : fp.w - 2;
  /** The cell `k` in from the door's wall and `a` across the room. */
  const cell = (a: number, k: number) =>
    ix !== 0
      ? { x: ix > 0 ? fp.x0 + 1 + k : fp.x0 + fp.w - 2 - k, z: fp.z0 + 1 + a }
      : { x: fp.x0 + 1 + a, z: iz > 0 ? fp.z0 + 1 + k : fp.z0 + fp.d - 2 - k };
  const doorA = ix !== 0 ? door.z - (fp.z0 + 1) : door.x - (fp.x0 + 1);
  const put = (a: number, k: number, dy: number, id: BlockId) => {
    if (a < 0 || a >= wide || k < 0 || k >= deep || (a === doorA && k <= 1)) return;
    const { x, z } = cell(a, k);
    world.setVoxel(x, door.y + dy, z, id);
  };
  const back = deep - 1;
  // The far side of the room from the door, and the near.
  const far = doorA < wide / 2 ? wide - 1 : 0;
  const near = wide - 1 - far;
  const toward = Math.sign(near - far) || 1;
  if (role === 'house') {
    put(far, back, 0, Block.Canvas); // the bed: a pillow and a blanket
    put(far + toward, back, 0, Block.AwningRed);
    put(near, back, 0, Block.Embers); // the hearth, and its chimney breast
    put(near, back, 1, Block.Stone);
    const t = Math.floor(wide / 2) === doorA ? Math.floor(wide / 2) + toward : Math.floor(wide / 2);
    put(t, Math.max(1, back - 1), 0, Block.Planks); // a table, and a stool
    put(t - toward, Math.max(1, back - 1), 0, Block.Wood);
  } else if (role === 'tavern') {
    for (let a = 0; a < wide; a++) {
      if (a > 0 && a < wide - 1) put(a, back - 1, 0, Block.Planks); // the bar
      if (a % 2 === 0) put(a, back, 0, Block.Barrel);
    }
    for (const a of [0, wide - 1]) {
      put(a, 1, 0, Block.Planks); // tables, with a stool at each
      put(a, 0, 0, Block.Wood);
    }
  } else {
    for (let a = 0; a < wide; a++) for (let y = 0; y < 2; y++) put(a, back, y, Block.Books);
    const d = Math.floor(wide / 2) === doorA ? Math.floor(wide / 2) + toward : Math.floor(wide / 2);
    put(d, back - 2, 0, Block.Planks); // the desk, a book open on it, and a chair
    put(d, back - 2, 1, Block.Books);
    put(d, back - 1, 0, Block.Wood);
  }
}

/** A street lamp: a post two high with a lantern on top. Returns where the light is. */
function lampPost(world: VoxelWorld, x: number, h: number, z: number): { x: number; y: number; z: number } {
  world.setVoxel(x, h, z, Block.Wood);
  world.setVoxel(x, h + 1, z, Block.Wood);
  world.setVoxel(x, h + 2, z, Block.Lantern);
  return { x: x + 0.5, y: h + 2.5, z: z + 0.5 };
}
