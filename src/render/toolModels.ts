import type { Held } from '../land/Land';

/**
 * Voxel tools for the captain's hand, in character voxels, laid along −x from the
 * grip at the origin (the same convention as the cutlass): a handle, then the head.
 */
export function heldCells(held: Held): { cells: Int32Array; palette: Uint8Array } {
  const palette = new Uint8Array(256 * 4);
  palette.set([118, 82, 48, 255], 1 * 4); // haft
  palette.set([150, 156, 162, 255], 2 * 4); // iron
  palette.set([96, 100, 106, 255], 3 * 4); // iron, shaded
  palette.set([196, 172, 120, 255], 4 * 4); // seed sack
  palette.set([140, 112, 70, 255], 5 * 4); // sack tie
  const cells: number[] = [];
  const put = (x: number, y: number, z: number, c: number) => cells.push(x, y, z, c);

  if (held === 'axe' || held === 'pickaxe' || held === 'shovel' || held === 'hoe') {
    for (let x = 2; x >= -11; x--) put(x, 0, 0, 1);
    switch (held) {
      case 'axe':
        for (let x = -12; x >= -14; x--) for (let y = 0; y <= 3; y++) put(x, y, 0, y === 3 ? 3 : 2);
        break;
      case 'pickaxe':
        for (let y = -3; y <= 3; y++) put(-12, y, 0, Math.abs(y) === 3 ? 3 : 2);
        put(-13, 0, 0, 2);
        break;
      case 'shovel':
        for (let x = -12; x >= -16; x--) for (let z = -1; z <= 1; z++) put(x, 0, z, x === -16 ? 3 : 2);
        break;
      case 'hoe':
        for (let y = -1; y >= -4; y--) put(-12, y, 0, y === -4 ? 3 : 2);
        put(-13, -4, 0, 3);
        break;
    }
  } else {
    // A sack of seed.
    for (let x = -3; x <= 0; x++) for (let y = -4; y <= -1; y++) for (let z = -1; z <= 1; z++) put(x, y, z, 4);
    put(-1, 0, 0, 5);
    put(-2, 0, 0, 5);
  }
  return { cells: Int32Array.from(cells), palette };
}
