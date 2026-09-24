import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseVox } from '../vox/parseVox';
import { writeVox, type VoxObject } from '../vox/writeVox';
import { buildShipModel } from './shipModel';

const palette = new Uint8Array(256 * 4).fill(255);

/** A 3-wide, 6-long, 2-deep box hull with a sail and a flag, authored bow toward +Y. */
function tinyShip(): ArrayBuffer {
  const hull: VoxObject = { name: 'Hull', size: [3, 6, 2], min: [0, 0, 0], voxels: [] };
  for (let x = 0; x < 3; x++) for (let y = 0; y < 6; y++) for (let z = 0; z < 2; z++) hull.voxels.push([x, y, z, 1]);
  hull.voxels.push([1, 5, 2, 2]); // a bow ornament at the +Y end
  const sail: VoxObject = { name: 'sail_main', size: [3, 1, 2], min: [0, 3, 3], voxels: [[0, 0, 0, 3], [2, 0, 1, 3]] };
  const flag: VoxObject = { name: 'flag', size: [1, 2, 1], min: [1, 1, 5], voxels: [[0, 0, 0, 4], [0, 1, 0, 4]] };
  return writeVox([hull, sail, flag], palette).buffer as ArrayBuffer;
}

describe('buildShipModel', () => {
  const model = buildShipModel(parseVox(tinyShip()), 1);

  it('sorts objects into hull, sails and flags by name', () => {
    expect(model.hull.cells.length / 4).toBe(3 * 6 * 2 + 1);
    expect(model.sails).toHaveLength(1);
    expect(model.flags).toHaveLength(1);
  });

  it('centres the ship on its hull at the waterline', () => {
    expect(model.origin.y).toBe(1); // keel at 0, draft 1
    expect(model.halfBeam).toBe(1.5);
    expect(model.bow).toBe(3);
    expect(model.stern).toBe(-3);
  });

  it('keeps the bow forward (+z) and the ornament on the centre line', () => {
    const cells = model.hull.cells;
    let ornament: number[] | null = null;
    for (let i = 0; i < cells.length; i += 4) if (cells[i + 3] === 2) ornament = [...cells.subarray(i, i + 3)];
    expect(ornament![2] + 0.5 - model.origin.z).toBe(2.5); // centre of the bow-most row
    expect(ornament![0] + 0.5 - model.origin.x).toBeCloseTo(0);
  });

  it('outlines the waterline footprint for collisions', () => {
    const xs: number[] = [];
    const zs: number[] = [];
    for (let i = 0; i < model.footprint.length; i += 2) {
      xs.push(model.footprint[i]);
      zs.push(model.footprint[i + 1]);
    }
    expect(Math.min(...xs)).toBe(-1.5);
    expect(Math.max(...xs)).toBe(1.5);
    expect(Math.min(...zs)).toBe(-3);
    expect(Math.max(...zs)).toBe(3);
  });

  it('pivots sails at the top middle and flags at their forward edge', () => {
    const sail = model.sails[0].pivot;
    expect(sail.y - model.origin.y).toBe(4 - 1 + 1); // top of the sail (z 3..4 in MagicaVoxel), above the waterline
    expect(sail.x - model.origin.x).toBeCloseTo(0);
    expect(sail.z).toBe(3); // its aft face, where it would meet the mast
    const flag = model.flags[0].pivot;
    expect(flag.z - model.origin.z).toBe(0); // flag spans y 1..2, so its forward edge is amidships
  });

  it('refuses a model with nothing but sails', () => {
    const onlySail = writeVox([{ name: 'sail', size: [1, 1, 1], min: [0, 0, 0], voxels: [[0, 0, 0, 1]] }], palette);
    expect(() => buildShipModel(parseVox(onlySail.buffer as ArrayBuffer), 1)).toThrow(/no hull/);
  });
});

describe('placeholder sloop.vox', () => {
  it('loads with a hull, a sail and a flag', () => {
    const bytes = readFileSync('public/models/ships/sloop.vox');
    const model = buildShipModel(parseVox(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer), 1.5);
    expect(model.hull.cells.length / 4).toBeGreaterThan(200);
    expect(model.sails).toHaveLength(1);
    expect(model.flags).toHaveLength(1);
    expect(model.halfBeam).toBe(2.5);
    expect(model.bow - model.stern).toBe(18); // 15 of hull plus the bowsprit
    expect(model.deck).toBeGreaterThan(1); // well clear of the water
    expect(model.deck).toBeLessThan(5);
    expect(model.top).toBeGreaterThan(14); // masthead
  });
});

describe('placeholder brig.vox', () => {
  it('loads with a hull, two sails and a flag', () => {
    const bytes = readFileSync('public/models/ships/brig.vox');
    const model = buildShipModel(parseVox(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer), 2);
    expect(model.sails).toHaveLength(2);
    expect(model.flags).toHaveLength(1);
    expect(model.halfBeam).toBe(3.5);
    expect(model.bow - model.stern).toBe(25); // 21 of hull plus the bowsprit
  });
});
