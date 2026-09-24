import { describe, expect, it } from 'vitest';
import { decodeRotation, instanceVoxels, mvToGame, parseVox } from './parseVox';
import { writeVox, type VoxObject } from './writeVox';

function palette(): Uint8Array {
  const p = new Uint8Array(256 * 4);
  p.set([200, 10, 20, 255], 1 * 4); // colour index 1
  p.set([30, 40, 250, 255], 2 * 4); // colour index 2
  return p;
}

const HULL: VoxObject = {
  name: 'hull',
  size: [3, 2, 2],
  min: [10, 0, 0],
  voxels: [
    [0, 0, 0, 1],
    [2, 1, 1, 2],
  ],
};
const SAIL: VoxObject = { name: 'sail', size: [1, 1, 3], min: [11, 5, 2], voxels: [[0, 0, 0, 1], [0, 0, 2, 1]] };

describe('.vox round trip', () => {
  const file = parseVox(writeVox([HULL, SAIL], palette()).buffer as ArrayBuffer);

  it('keeps each named object as its own instance', () => {
    expect(file.models).toHaveLength(2);
    expect(file.instances.map((i) => i.name)).toEqual(['hull', 'sail']);
  });

  it('places voxels back at their world positions', () => {
    const cells = (name: string) => {
      const voxels = instanceVoxels(file, file.instances.find((i) => i.name === name)!);
      const out: number[][] = [];
      for (let i = 0; i < voxels.length; i += 4) out.push([...voxels.subarray(i, i + 4)]);
      return out;
    };
    expect(cells('hull')).toEqual([
      [10, 0, 0, 1],
      [12, 1, 1, 2],
    ]);
    expect(cells('sail')).toEqual([
      [11, 5, 2, 1],
      [11, 5, 4, 1],
    ]);
  });

  it('reads the palette so colour index i is palette entry i', () => {
    expect([...file.palette.subarray(4, 8)]).toEqual([200, 10, 20, 255]);
    expect([...file.palette.subarray(8, 12)]).toEqual([30, 40, 250, 255]);
  });

  it('skips hidden objects', () => {
    const hidden = parseVox(writeVox([HULL, { ...SAIL, hidden: true }], palette()).buffer as ArrayBuffer);
    expect(hidden.instances.map((i) => i.name)).toEqual(['hull']);
  });

  it('rejects files that are not .vox', () => {
    expect(() => parseVox(new Uint8Array(16).buffer)).toThrow(/not a MagicaVoxel/);
  });
});

describe('decodeRotation', () => {
  it('matches the example in the MagicaVoxel spec', () => {
    const byte = (1 << 0) | (2 << 2) | (0 << 4) | (1 << 5) | (1 << 6);
    expect([...decodeRotation(byte)]).toEqual([0, 1, 0, 0, 0, -1, -1, 0, 0]);
  });

  it('decodes the identity', () => {
    expect([...decodeRotation(4)]).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });
});

describe('mvToGame', () => {
  it('maps MagicaVoxel Z-up (+Y = bow, +X = starboard) to game Y-up (+Z = bow, +X = port) without mirroring', () => {
    expect(mvToGame(0, 0, 0)).toEqual([-1, 0, 0]);
    expect(mvToGame(0, 5, 0)[2]).toBe(5); // forward stays forward
    expect(mvToGame(0, 0, 7)[1]).toBe(7); // up stays up
    expect(mvToGame(3, 0, 0)[0]).toBe(-4); // starboard becomes -x
  });
});
