import { describe, expect, it } from 'vitest';
import type { PropKind } from '../props/types';
import { isFlat, layRoom, type Piece, type Room, type RoomRole, type TownDress } from './rooms';

const ROLES: readonly RoomRole[] = ['house', 'tavern', 'office', 'market'];
const DRESSES: readonly TownDress[] = ['haven', 'free', 'crown', 'brethren'];
/** Each port's rug and runner, the office's chest and desk. */
const RUG: Record<TownDress, readonly [PropKind, PropKind]> = { haven: ['rugSea', 'runnerSea'], free: ['rugGuild', 'runnerGuild'], crown: ['rug', 'runner'], brethren: ['rugBrethren', 'runnerBrethren'] };
const CHEST: Record<TownDress, PropKind> = { haven: 'ledgerChest', free: 'ledgerChest', crown: 'strongbox', brethren: 'treasureChest' };
const cellsOf = (p: Piece): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let a = p.a; a < p.a + p.wa; a++) for (let k = p.k; k < p.k + p.dk; k++) out.push([a, k]);
  return out;
};
/** Every room a town builds: three to five across, `deeps` in, its door in any but a corner column. */
function rooms(deeps: readonly number[]): Room[] {
  const out: Room[] = [];
  for (let wide = 3; wide <= 5; wide++) for (const deep of deeps) for (let door = 1; door <= wide - 2; door++) out.push({ wide, deep, door });
  return out;
}
const label = (r: Room, role: RoomRole) => `${role} ${r.wide}×${r.deep}, door at ${r.door}`;

/** Can someone walk from the door to beside the room's middle, round what stands on the floor? */
function wayIn(r: Room, pieces: readonly Piece[]): boolean {
  const taken = new Set(pieces.filter((p) => !isFlat(p.kind)).flatMap(cellsOf).map(([a, k]) => `${a},${k}`));
  const seen = new Set([`${r.door},0`]);
  const queue: Array<[number, number]> = [[r.door, 0]];
  while (queue.length > 0) {
    const [a, k] = queue.shift()!;
    if (Math.abs(a - (r.wide - 1) / 2) <= 1 && Math.abs(k - (r.deep - 1) / 2) <= 1) return true;
    for (const [na, nk] of [[a + 1, k], [a - 1, k], [a, k + 1], [a, k - 1]]) {
      const key = `${na},${nk}`;
      if (na < 0 || nk < 0 || na >= r.wide || nk >= r.deep || taken.has(key) || seen.has(key)) continue;
      seen.add(key);
      queue.push([na, nk]);
    }
  }
  return false;
}

describe('laying out a room', () => {
  it('keeps the door and the way in clear, in every room of every size', () => {
    for (const r of rooms([3, 4, 5])) {
      for (const [role, dress] of ROLES.flatMap((role) => DRESSES.map((dress) => [role, dress] as const))) {
        const { pieces, keeper } = layRoom(r, role, 0, dress);
        const name = `${label(r, role)} (${dress})`;
        const standing = pieces.filter((p) => !isFlat(p.kind)).flatMap(cellsOf).map(([a, k]) => `${a},${k}`);
        expect(new Set(standing).size, `${name}: nothing stands on anything else`).toBe(standing.length);
        for (const p of pieces) for (const [a, k] of cellsOf(p)) expect(a >= 0 && k >= 0 && a < r.wide && k < r.deep, `${name}: ${p.kind} in the room`).toBe(true);
        for (const k of [0, 1]) expect(standing.includes(`${r.door},${k}`), `${name}: the doorway, ${k} in`).toBe(false);
        expect(wayIn(r, pieces), `${name}: the way in`).toBe(true);
        if (keeper) expect(standing.includes(`${keeper.a},${keeper.k}`), `${name}: where the keeper stands`).toBe(false);
      }
    }
  });

  it('furnishes a house: a bed in a back corner, a hearth on an end wall, a table with seats, a shelf, a chest and a rug', () => {
    for (const r of rooms([4, 5])) {
      for (const look of [0, 1, 2, 3]) {
        const { pieces, keeper } = layRoom(r, 'house', look);
        const name = `${label(r, 'house')}, look ${look}`;
        const of = (kind: PropKind) => pieces.filter((p) => p.kind === kind);
        expect(keeper, name).toBeNull();
        const [bed] = of('bed');
        expect(bed, `${name}: bed`).toBeDefined();
        expect(bed.k + bed.dk, `${name}: the bed against the back wall`).toBe(r.deep);
        expect(bed.a === 0 || bed.a + bed.wa === r.wide, `${name}: the bed in a corner`).toBe(true);
        const [hearth] = of('hearth');
        expect(hearth, `${name}: hearth`).toBeDefined();
        expect(hearth.a === 0 || hearth.a === r.wide - 1, `${name}: the hearth on an end wall`).toBe(true);
        expect(of('table'), `${name}: table`).toHaveLength(1);
        expect(of('stool').length + of('chair').length, `${name}: seats`).toBeGreaterThanOrEqual(1);
        expect(of('chest'), `${name}: chest`).toHaveLength(1);
        expect(of('shelfCrockery').length + of('shelfBottles').length, `${name}: shelf`).toBe(1);
        expect(pieces.filter((p) => isFlat(p.kind)), `${name}: rug`).toHaveLength(1);
      }
    }
  });

  it('sets the tavern’s bar along the back with the keeper behind it, tables with stools, barrels and bottles', () => {
    for (const r of rooms([4, 5])) {
      const { pieces, keeper } = layRoom(r, 'tavern');
      const name = label(r, 'tavern');
      const of = (kind: PropKind) => pieces.filter((p) => p.kind === kind).length;
      expect(keeper!.k, `${name}: the keeper against the back wall`).toBe(r.deep - 1);
      expect(['bar', 'barCask'], `${name}: the bar before the keeper`).toContain(pieces.find((p) => p.a === keeper!.a && p.k === keeper!.k - 1)?.kind);
      expect(of('bar') + of('barCask'), name).toBeGreaterThanOrEqual(2);
      expect(of('barCask'), name).toBe(1);
      for (const kind of ['table', 'stool', 'barrel', 'shelfBottles'] as const) expect(of(kind), `${name}: ${kind}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('sets the office’s desk before the clerk, facing the door, with shelves of ledgers, a chair for callers and a map table', () => {
    for (const dress of DRESSES) {
      for (const r of rooms([4, 5])) {
        const { pieces, keeper } = layRoom(r, 'office', 0, dress);
        const name = `${label(r, 'office')} (${dress})`;
        const of = (kind: PropKind) => pieces.filter((p) => p.kind === kind);
        expect(keeper!.k, name).toBe(r.deep - 1);
        expect(pieces.find((p) => p.a === keeper!.a && p.k === keeper!.k - 1), `${name}: desk`).toMatchObject({ kind: dress === 'crown' ? 'deskGrand' : 'desk', toward: 'out' });
        expect(of('shelfBooks').length, name).toBeGreaterThanOrEqual(2);
        expect(of('chair'), `${name}: a chair for callers`).toHaveLength(1);
        expect(of('mapTable'), `${name}: map table`).toHaveLength(1);
      }
    }
  });

  it('keeps the office’s chest beside the desk and its shelves on the back wall, never against the wall by the door or a side wall (they read as stray blocks)', () => {
    for (const dress of DRESSES) {
      for (const r of rooms([4, 5])) {
        const { pieces, keeper } = layRoom(r, 'office', 0, dress);
        const name = `${label(r, 'office')} (${dress})`;
        const chests = pieces.filter((p) => p.kind === CHEST[dress]);
        expect(chests, `${name}: ${CHEST[dress]}`).toHaveLength(1);
        expect([chests[0].k, Math.abs(chests[0].a - keeper!.a)], `${name}: beside the desk`).toEqual([keeper!.k - 1, 1]);
        expect(pieces.filter((p) => p.k === 0 && !isFlat(p.kind)).map((p) => p.kind), `${name}: against the door’s wall`).toEqual([]);
        // Nor a tall shelf against a side wall: cut low, that wall showed the shelf's back over it.
        expect(pieces.filter((p) => p.kind === 'shelfBooks' && p.k !== keeper!.k), `${name}: shelves off the back wall`).toEqual([]);
      }
    }
  });

  it('dresses each port’s rooms its own way: the rug in its colours, the Governor’s grander desk and strongbox, the tavern’s seats and runner', () => {
    const r: Room = { wide: 5, deep: 5, door: 2 };
    for (const dress of DRESSES) {
      const kinds = (role: RoomRole) => layRoom(r, role, 0, dress).pieces.map((p) => p.kind);
      expect(kinds('house').filter(isFlat), `${dress} house`).toEqual([RUG[dress][0]]);
      expect(kinds('office').filter(isFlat), `${dress} office`).toEqual([RUG[dress][0]]);
      const tavern = kinds('tavern');
      expect(tavern.filter(isFlat), `${dress} tavern: a runner inside the door`).toEqual([RUG[dress][1]]);
      const seat = dress === 'crown' || dress === 'free' ? 'chair' : 'stool';
      expect(tavern.includes(seat) && !tavern.includes(seat === 'chair' ? 'stool' : 'chair'), `${dress} tavern: ${seat}s`).toBe(true);
    }
    // The same room is laid out differently in two ports.
    expect(layRoom(r, 'office', 0, 'crown')).not.toEqual(layRoom(r, 'office', 0, 'free'));
  });

  it('sets out the market’s counters with the stallholder behind them', () => {
    for (const r of rooms([4, 5])) {
      const { pieces, keeper } = layRoom(r, 'market');
      const name = label(r, 'market');
      expect(keeper!.k, name).toBe(r.deep - 1);
      expect(pieces.find((p) => p.a === keeper!.a && p.k === keeper!.k - 1)?.kind, name).toMatch(/^counter/);
      expect(pieces.filter((p) => p.kind.startsWith('counter')).length, name).toBeGreaterThanOrEqual(3);
    }
  });

  it('lays the same room out the same way every time', () => {
    for (const role of ROLES) for (const dress of DRESSES) expect(layRoom({ wide: 4, deep: 5, door: 1 }, role, 3, dress)).toEqual(layRoom({ wide: 4, deep: 5, door: 1 }, role, 3, dress));
  });
});
