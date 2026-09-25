import { describe, expect, it } from 'vitest';
import { Block } from '../voxel/blocks';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { type Deposit, DEPOSITS, Deposits, REGROW_DAYS } from './deposits';

/** A copper outcrop on flat ground at y = 10: four blocks and one on top. */
function copper(id = 1, x = 0, z = 0): Deposit {
  const o = Block.CopperOre;
  return { id, kind: 'copper', x, z, cells: [[x, 10, z, o], [x + 1, 10, z, o], [x, 10, z + 1, Block.Boulder], [x + 1, 10, z + 1, o], [x, 11, z, o]] };
}

function standing(world: VoxelWorld, d: Deposit): void {
  for (const [x, y, z, b] of d.cells) world.setVoxel(x, y, z, b);
}

describe('deposits', () => {
  it('know which outcrop a block belongs to, while it stands', () => {
    const world = new VoxelWorld();
    const d = copper();
    standing(world, d);
    const deposits = new Deposits([d]);
    expect(deposits.at(1, 10, 1)).toBe(d);
    expect(deposits.at(0, 11, 0)).toBe(d);
    expect(deposits.at(1, 11, 1)).toBeNull();
    deposits.workOut(world, d, 4.5);
    expect(deposits.at(1, 10, 1)).toBeNull();
    expect(world.getVoxel(0, 11, 0)).toBe(Block.Air);
  });

  it('count blows, and forget them once the outcrop is worked out', () => {
    const world = new VoxelWorld();
    const d = copper();
    standing(world, d);
    const deposits = new Deposits([d]);
    expect(deposits.blow(d)).toBe(1);
    expect(deposits.blow(d)).toBe(2);
    deposits.workOut(world, d, 1);
    expect(deposits.regrow(world, 1 + REGROW_DAYS, () => true)).toEqual([d]);
    expect(deposits.blow(d)).toBe(1);
  });

  it('grow back after three days, where nothing is in the way', () => {
    const world = new VoxelWorld();
    const d = copper();
    standing(world, d);
    const deposits = new Deposits([d]);
    deposits.workOut(world, d, 2.25);
    expect(deposits.regrow(world, 2.25 + REGROW_DAYS - 0.01, () => true)).toEqual([]);
    expect(deposits.dueIn(1, 1, 5, 3.25)).toBeCloseTo(2);
    // Something standing in one of its blocks: it waits.
    expect(deposits.regrow(world, 6, (x, y, z) => !(x === 1 && y === 10 && z === 1))).toEqual([]);
    expect(deposits.regrow(world, 6, () => true)).toEqual([d]);
    for (const [x, y, z, b] of d.cells) expect(world.getVoxel(x, y, z)).toBe(b);
    expect(deposits.at(1, 10, 1)).toBe(d);
  });

  it('grow back only onto firm ground: a block stacked on its own outcrop needs none', () => {
    const world = new VoxelWorld();
    const d = copper();
    standing(world, d);
    const deposits = new Deposits([d]);
    deposits.workOut(world, d, 0);
    const asked: string[] = [];
    const firm = (x: number, y: number, z: number) => (asked.push(`${x},${y},${z}`), !(x === 1 && z === 1));
    expect(deposits.regrow(world, REGROW_DAYS, () => true, firm)).toEqual([]);
    expect(deposits.regrow(world, REGROW_DAYS, () => true, () => true)).toEqual([d]);
    expect(asked).not.toContain('0,10,0'); // under the top block: its own outcrop holds it up
  });

  it('count one found standing again after a load as standing, whatever the save said', () => {
    const world = new VoxelWorld();
    const d = copper();
    standing(world, d);
    const deposits = new Deposits([d]);
    deposits.restore({ worked: [{ id: 1, at: 2 }] });
    deposits.reconcile(world, 3, () => false);
    expect(deposits.at(1, 10, 1)).toBe(d);
    expect(deposits.snapshot().worked).toEqual([]);
  });

  it('find standing outcrops near a spot, and anything in a plot', () => {
    const world = new VoxelWorld();
    const a = copper(1, 0, 0);
    const b = copper(2, 30, 0);
    standing(world, a);
    standing(world, b);
    const deposits = new Deposits([a, b]);
    expect(deposits.within(0, 0, 10)).toEqual([a]);
    expect(deposits.near(3, 3, 3)).toBe(true);
    expect(deposits.near(10, 10, 3)).toBe(false);
    expect(deposits.inPlot({ x0: -2, z0: -2, w: 3, d: 3 }, 0)).toBe(a); // covers (0, 0)
    expect(deposits.inPlot({ x0: -3, z0: -3, w: 3, d: 3 }, 0)).toBeNull(); // stops at -1
    expect(deposits.inPlot({ x0: -3, z0: -3, w: 3, d: 3 }, 1)).toBe(a);
    deposits.workOut(world, a, 1);
    expect(deposits.within(0, 0, 10)).toEqual([]);
    expect(deposits.inPlot({ x0: -2, z0: -2, w: 3, d: 3 }, 0)).toBeNull();
    expect(deposits.near(3, 3, 3)).toBe(true); // worked out or not, treasure keeps clear
  });

  it('save which outcrops are worked out, and when', () => {
    const world = new VoxelWorld();
    const d = copper();
    standing(world, d);
    const deposits = new Deposits([d]);
    deposits.workOut(world, d, 7.5);
    const saved = JSON.parse(JSON.stringify(deposits.snapshot()));
    const again = new Deposits([d]);
    again.restore(saved);
    expect(again.at(1, 10, 1)).toBeNull();
    expect(again.regrow(world, 7.5 + REGROW_DAYS, () => true)).toEqual([d]);
  });

  it('retire outcrops a save’s own edits wiped out on a claim; elsewhere they grow back as if just worked out', () => {
    const world = new VoxelWorld();
    const inCamp = copper(1, 0, 0);
    const wild = copper(2, 30, 0);
    const mined = copper(3, 60, 0);
    const deposits = new Deposits([inCamp, wild, mined]);
    deposits.restore({ worked: [{ id: 3, at: 3 }] });
    // None has blocks in the world: one was mined (and saved as such), two wiped by an older save's edits.
    deposits.reconcile(world, 5, (x) => x < 10);
    expect(deposits.regrow(world, 5 + REGROW_DAYS - 0.01, () => true)).toEqual([mined]);
    expect(deposits.regrow(world, 5 + REGROW_DAYS, () => true)).toEqual([wild]);
    expect(deposits.regrow(world, 100, () => true)).toEqual([]);
    expect(deposits.at(0, 10, 0)).toBeNull();
    expect(deposits.snapshot().gone).toEqual([1]);
  });

  it('have kinds that grow harder and scarcer to win toward gold', () => {
    expect(DEPOSITS.stone.blows).toBeLessThan(DEPOSITS.gold.blows);
    expect(DEPOSITS.gold.yield[1]).toBeLessThan(DEPOSITS.stone.yield[0]);
    expect(DEPOSITS.iron.good).toBe('ore');
    expect(DEPOSITS.copper.good).toBe('copperOre');
  });
});
