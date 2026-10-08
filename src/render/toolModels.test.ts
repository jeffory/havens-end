import { describe, expect, it } from 'vitest';
import { heldCells } from './toolModels';

/** The flat cells array as a lookup from "x,y,z" to its palette index, for easy assertions. */
function cellMap(cells: Int32Array): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < cells.length; i += 4) map.set(`${cells[i]},${cells[i + 1]},${cells[i + 2]}`, cells[i + 3]);
  return map;
}

describe('held models: the guns and the levelled musket', () => {
  it('draws a pistol: the grip down from the hand, a short barrel, the lock', () => {
    const { cells } = heldCells('pistol');
    const map = cellMap(cells);
    expect(map.get('1,0,0')).toBe(1); // the grip
    expect(map.get('1,-3,0')).toBe(1);
    expect(map.get('2,-3,0')).toBe(1);
    expect(map.get('1,1,0')).toBe(1); // the frame
    expect(map.get('-3,1,0')).toBe(1);
    expect(map.get('0,2,0')).toBe(2); // the barrel
    expect(map.get('-7,2,0')).toBe(3); // the muzzle, shaded
    expect(map.get('0,3,0')).toBe(3); // the lock
  });

  it('draws a rifle: the stock back from the hand, a long barrel out to -18', () => {
    const { cells } = heldCells('rifle');
    const map = cellMap(cells);
    expect(map.get('6,0,0')).toBe(1);
    expect(map.get('-4,0,0')).toBe(1);
    expect(map.get('6,-1,0')).toBe(1); // the butt
    expect(map.get('6,-2,0')).toBe(1);
    expect(map.get('-2,1,0')).toBe(2); // the barrel
    expect(map.get('-17,1,0')).toBe(3); // the muzzle, shaded
    expect(map.get('-18,1,0')).toBe(3);
    expect(map.get('0,2,0')).toBe(3); // the lock
    expect(map.has('-19,1,0')).toBe(false); // nothing beyond the muzzle, unlike the musket
  });

  it('draws a levelled musket: a shorter barrel than the rifle, with a bayonet beyond the muzzle', () => {
    const { cells } = heldCells('musketLevelled');
    const map = cellMap(cells);
    expect(map.get('6,0,0')).toBe(1);
    expect(map.get('-2,1,0')).toBe(2); // the barrel
    expect(map.get('-15,1,0')).toBe(3); // the muzzle, shaded
    expect(map.get('-16,1,0')).toBe(3);
    expect(map.get('0,2,0')).toBe(3); // the lock
    expect(map.get('-17,1,0')).toBe(3); // the bayonet, from one past the muzzle
    expect(map.get('-20,1,0')).toBe(3);
    expect(map.has('-21,1,0')).toBe(false);
  });
});
