/**
 * Boundary sample points of a hull's waterline footprint, as (x, z) pairs.
 *
 * `cells` are the unit squares the hull covers at the waterline, given by their
 * minimum corner. Every exposed cell edge contributes its two corners and midpoint,
 * so samples are at most half a voxel apart: no single-voxel rock can slip between them.
 */
export function outlineFromFootprint(cells: Iterable<readonly [number, number]>): Float32Array {
  const key = (x: number, z: number) => `${Math.round(x * 2)},${Math.round(z * 2)}`;
  const covered = new Set<string>();
  const list: Array<readonly [number, number]> = [];
  for (const cell of cells) {
    covered.add(key(cell[0], cell[1]));
    list.push(cell);
  }

  const seen = new Set<string>();
  const points: number[] = [];
  const add = (x: number, z: number) => {
    const k = key(x, z);
    if (!seen.has(k)) {
      seen.add(k);
      points.push(x, z);
    }
  };
  // For each side: neighbour offset, then the edge's two corners relative to the cell's min corner.
  const sides = [
    [-1, 0, 0, 0, 0, 1],
    [1, 0, 1, 0, 1, 1],
    [0, -1, 0, 0, 1, 0],
    [0, 1, 0, 1, 1, 1],
  ] as const;
  for (const [x, z] of list) {
    for (const [nx, nz, ax, az, bx, bz] of sides) {
      if (covered.has(key(x + nx, z + nz))) continue;
      add(x + ax, z + az);
      add(x + (ax + bx) / 2, z + (az + bz) / 2);
      add(x + bx, z + bz);
    }
  }
  return new Float32Array(points);
}
