import type { PropKind } from '../props/types';

/**
 * A room's floor as the furnisher sees it: `wide` cells across, and `deep` cells in from the
 * wall with the door, which is `door` across. Cell (a, k) is `a` across and `k` in.
 */
export interface Room {
  wide: number;
  deep: number;
  door: number;
}

/** What the room is for. */
export type RoomRole = 'house' | 'tavern' | 'office' | 'market';

/** Which way a piece's front looks: into the room (away from the door's wall), out toward it, or across to lower or higher `a`. */
export type Toward = 'in' | 'out' | 'left' | 'right';

/** A piece on the floor: what it is, the corner cell it takes, how many cells across and in, and which way it looks. */
export interface Piece {
  kind: PropKind;
  a: number;
  k: number;
  wa: number;
  dk: number;
  toward: Toward;
}

export interface Furnished {
  pieces: Piece[];
  /** Where the keeper stands, behind the counter against the back wall (none in a house). */
  keeper: { a: number; k: number } | null;
}

/** What lies flat on the floor: walked over, and laid under a table. */
const FLAT: ReadonlySet<PropKind> = new Set<PropKind>(['rug', 'runner']);
/** What a rug may lie under. */
const OVER_RUG: ReadonlySet<PropKind> = new Set<PropKind>(['table', 'stool', 'chair']);

const cellsOf = (p: Piece): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let a = p.a; a < p.a + p.wa; a++) for (let k = p.k; k < p.k + p.dk; k++) out.push([a, k]);
  return out;
};

/** A piece a cell square. */
const one = (kind: PropKind, a: number, k: number, toward: Toward): Piece => ({ kind, a, k, wa: 1, dk: 1, toward });

/** The floor as it's furnished: what stands where, and whether the way in is still open. */
class Floor {
  readonly pieces: Piece[] = [];
  private readonly at = new Map<string, PropKind>();
  private readonly flat = new Set<string>();

  constructor(
    readonly room: Room,
    /** Cells kept clear: where the keeper stands. */
    private readonly kept: ReadonlyArray<{ a: number; k: number }> = [],
  ) {}

  /** The first of these that fits; false if none does. */
  first(...options: Piece[]): boolean {
    return options.some((p) => this.put(p));
  }

  /**
   * Puts a piece down if it fits: in the room, on nothing else, off the doorway's two cells and
   * the kept ones, and leaving the way in open. A rug needs only bare floor, or a table's.
   */
  put(p: Piece): boolean {
    const cells = cellsOf(p);
    const { wide, deep, door } = this.room;
    if (cells.some(([a, k]) => a < 0 || k < 0 || a >= wide || k >= deep)) return false;
    if (FLAT.has(p.kind)) {
      if (cells.some(([a, k]) => this.flat.has(`${a},${k}`) || (this.at.has(`${a},${k}`) && !OVER_RUG.has(this.at.get(`${a},${k}`)!)))) return false;
      for (const [a, k] of cells) this.flat.add(`${a},${k}`);
    } else {
      const blocked = ([a, k]: [number, number]) => this.at.has(`${a},${k}`) || (a === door && k <= 1) || this.kept.some((c) => c.a === a && c.k === k);
      if (cells.some(blocked) || !this.wayIn(cells)) return false;
      for (const [a, k] of cells) this.at.set(`${a},${k}`, p.kind);
    }
    this.pieces.push(p);
    return true;
  }

  /** Can someone still walk from the door to beside the room's middle, with these cells taken too? */
  private wayIn(more: ReadonlyArray<[number, number]>): boolean {
    const { wide, deep, door } = this.room;
    const blocked = (a: number, k: number) => a < 0 || k < 0 || a >= wide || k >= deep || this.at.has(`${a},${k}`) || more.some(([ma, mk]) => ma === a && mk === k);
    const middle = (a: number, k: number) => Math.abs(a - (wide - 1) / 2) <= 1 && Math.abs(k - (deep - 1) / 2) <= 1;
    const seen = new Set<string>([`${door},0`]);
    const queue: Array<[number, number]> = [[door, 0]];
    while (queue.length > 0) {
      const [a, k] = queue.shift()!;
      if (middle(a, k)) return true;
      for (const [na, nk] of [[a + 1, k], [a - 1, k], [a, k + 1], [a, k - 1]] as const) {
        if (blocked(na, nk) || seen.has(`${na},${nk}`)) continue;
        seen.add(`${na},${nk}`);
        queue.push([na, nk]);
      }
    }
    return false;
  }
}

/** From a side wall, looking into the room. */
const offWall = (a: number): Toward => (a === 0 ? 'right' : 'left');

/** The side walls: the one further from the door, and the nearer. */
function sides({ wide, door }: Room): { far: number; near: number } {
  const far = door < wide / 2 ? wide - 1 : 0;
  return { far, near: wide - 1 - far };
}

/** Every cell, nearest the room's middle first. */
function byMiddle({ wide, deep }: Room): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  for (let a = 0; a < wide; a++) for (let k = 0; k < deep; k++) cells.push([a, k]);
  const off = ([a, k]: [number, number]) => Math.hypot(a - (wide - 1) / 2, k - (deep - 1) / 2);
  return cells.sort((p, q) => off(p) - off(q) || p[0] - q[0] || p[1] - q[1]);
}

/** A table at the first of `near` that leaves the way in, with up to `seats` of `seat` drawn up to it. */
function tableAt(f: Floor, seat: PropKind, seats: number, near: ReadonlyArray<[number, number]> = byMiddle(f.room)): void {
  for (const [a, k] of near) {
    if (!f.put(one('table', a, k, 'in'))) continue;
    let placed = 0;
    for (const [da, dk, toward] of [[-1, 0, 'right'], [1, 0, 'left'], [0, -1, 'in'], [0, 1, 'out']] as const) {
      if (placed < seats && f.put(one(seat, a + da, k + dk, toward))) placed++;
    }
    return;
  }
}

/** A rug in the middle (under the table, if that's where it is), or a runner where there's no room for one. */
function rugAt(f: Floor): void {
  const { wide, deep } = f.room;
  const options: Piece[] = [];
  for (let a = 0; a + 1 < wide; a++) for (let k = 0; k + 1 < deep; k++) options.push({ kind: 'rug', a, k, wa: 2, dk: 2, toward: 'in' });
  for (let a = 0; a < wide; a++) for (let k = 0; k + 1 < deep; k++) options.push({ kind: 'runner', a, k, wa: 1, dk: 2, toward: 'in' });
  const off = (p: Piece) => Math.hypot(p.a + (p.wa - 1) / 2 - (wide - 1) / 2, p.k + (p.dk - 1) / 2 - (deep - 1) / 2);
  f.first(...options.sort((p, q) => (p.kind === q.kind ? off(p) - off(q) : p.kind === 'rug' ? -1 : 1)));
}

/** A house: a bed in a back corner, the hearth on the end wall across from it, a shelf, a chest, a table with stools (or chairs) and a rug. */
function house(room: Room, look: number): Furnished {
  const back = room.deep - 1;
  const { far, near } = sides(room);
  const f = new Floor(room);
  f.first(
    { kind: 'bed', a: far, k: back - 1, wa: 1, dk: 2, toward: 'out' },
    { kind: 'bed', a: far === 0 ? 0 : far - 1, k: back, wa: 2, dk: 1, toward: far === 0 ? 'right' : 'left' },
    { kind: 'bed', a: near, k: back - 1, wa: 1, dk: 2, toward: 'out' },
  );
  f.first(one('hearth', near, back, offWall(near)), one('hearth', near, back - 1, offWall(near)), one('hearth', far, 0, offWall(far)), one('hearth', near, 0, offWall(near)));
  const shelf: PropKind = look % 2 === 0 ? 'shelfCrockery' : 'shelfBottles';
  const onBack = Array.from({ length: room.wide }, (_, a) => one(shelf, a, back, 'out'));
  f.first(one(shelf, near, back - 1, offWall(near)), ...onBack, one(shelf, far, 0, offWall(far)), one(shelf, near, 0, offWall(near)));
  f.first(one('chest', far, back - 2, 'out'), one('chest', far, 0, offWall(far)), one('chest', near, 0, offWall(near)));
  tableAt(f, look % 3 === 0 ? 'chair' : 'stool', 2);
  rugAt(f);
  return { pieces: f.pieces, keeper: null };
}

/** The tavern: the bar across the back with the keeper behind it, bottles and barrels at the back wall, tables with stools either side of the way in. */
function tavern(room: Room): Furnished {
  const { wide } = room;
  const back = room.deep - 1;
  const keeper = { a: Math.floor((wide - 1) / 2), k: back };
  const f = new Floor(room, [keeper]);
  // In a wide room a gap at either end of the bar, to get behind it; the cask on the end further from the keeper.
  const [b0, b1] = wide >= 4 ? [1, wide - 2] : [0, wide - 1];
  const cask = keeper.a - b0 > b1 - keeper.a ? b0 : b1;
  for (let a = b0; a <= b1; a++) f.put(one(a === cask ? 'barCask' : 'bar', a, back - 1, 'out'));
  for (let a = 0; a < wide; a++) {
    if (a === keeper.a) continue;
    const bottles = a === keeper.a - 1 || (wide >= 5 && a === keeper.a + 1);
    f.put(one(bottles ? 'shelfBottles' : 'barrel', a, back, 'out'));
  }
  const { far, near } = sides(room);
  tableAt(f, 'stool', 2, [[near, 1], [near, 0], [near, 2]]);
  tableAt(f, 'stool', 2, [[far, 1], [far, 0], [far, 2]]);
  return { pieces: f.pieces, keeper };
}

/** The office: the desk facing the door with the clerk behind it, ledgers on shelves along the back and side walls, a chest, a chair for callers and a rug. */
function office(room: Room): Furnished {
  const { wide, door } = room;
  const back = room.deep - 1;
  let a = Math.floor((wide - 1) / 2);
  // The desk mustn't stand in the doorway: in a shallow room, it goes beside it.
  if (back - 1 <= 1 && a === door) a = door + 1 < wide ? door + 1 : door - 1;
  const keeper = { a, k: back };
  const f = new Floor(room, [keeper]);
  f.put(one('desk', a, back - 1, 'out'));
  for (let s = 0; s < wide; s++) if (s !== a) f.put(one('shelfBooks', s, back, 'out'));
  for (const s of [0, wide - 1]) f.put(one('shelfBooks', s, back - 1, offWall(s)));
  const { far, near } = sides(room);
  f.first(one('chest', far, 0, offWall(far)), one('chest', near, 0, offWall(near)));
  f.put(one('chair', a, back - 2, 'in'));
  rugAt(f);
  return { pieces: f.pieces, keeper };
}

/** The market hall: counters across the back with the stallholder behind, crates and barrels by the back wall, counters down both sides at the front. */
function market(room: Room): Furnished {
  const { wide } = room;
  const back = room.deep - 1;
  const keeper = { a: Math.floor((wide - 1) / 2), k: back };
  const f = new Floor(room, [keeper]);
  for (let a = 1; a <= wide - 2; a++) f.put(one(a % 2 ? 'counterProduce' : 'counterCloth', a, back - 1, 'out'));
  for (let a = 0; a < wide; a++) if (a !== keeper.a) f.put(one(a === 0 || a === wide - 1 ? 'barrel' : 'crate', a, back, 'out'));
  for (let k = 0; k < back - 1; k++) for (const a of [0, wide - 1]) f.put(one(k % 2 ? 'counterCloth' : 'counterProduce', a, k, offWall(a)));
  for (const a of [0, wide - 1]) f.put(one('crate', a, back - 1, 'out'));
  return { pieces: f.pieces, keeper };
}

/**
 * Lays out a room's furniture by what it's for and its size, keeping the doorway's two cells
 * clear and a way from the door to beside the room's middle. `look` (from the plot) varies a
 * house a little: crockery or bottles on its shelf, stools or chairs at its table.
 */
export function layRoom(room: Room, role: RoomRole, look = 0): Furnished {
  switch (role) {
    case 'house':
      return house(room, look);
    case 'tavern':
      return tavern(room);
    case 'office':
      return office(room);
    case 'market':
      return market(room);
  }
}
