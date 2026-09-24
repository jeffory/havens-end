import { crop, type Raster } from './raster';

/** 'black': the sheet was prompted with thin black gutters, which are found and removed. */
export type Gutter = 'black' | 'none';

/** A line counts as gutter when this share of its pixels is near-black. */
const GUTTER_SHARE = 0.9;
const DARK = 60;

/**
 * Cuts a sheet of cols × rows images (a block atlas, an icon grid) into cells, left to
 * right, top to bottom. With black gutters, each separator is the gutter run nearest its
 * even-split position, since generated sheets are rarely spaced exactly evenly.
 */
export function sliceGrid(r: Raster, cols: number, rows: number, gutter: Gutter): Raster[] {
  const xs = gutter === 'black' ? spans(r, cols, true) : evenSpans(r.width, cols);
  const ys = gutter === 'black' ? spans(r, rows, false) : evenSpans(r.height, rows);
  const cells: Raster[] = [];
  for (const [y0, y1] of ys) {
    for (const [x0, x1] of xs) {
      const cell = crop(r, x0, y0, x1 - x0, y1 - y0);
      cells.push(gutter === 'black' ? trimDarkBorders(cell) : cell);
    }
  }
  return cells;
}

function evenSpans(size: number, n: number): Array<[number, number]> {
  return Array.from({ length: n }, (_, i) => [Math.floor((i * size) / n), Math.floor(((i + 1) * size) / n)]);
}

/** [start, end) of each cell along one axis, between detected gutter runs. */
function spans(r: Raster, n: number, horizontal: boolean): Array<[number, number]> {
  const size = horizontal ? r.width : r.height;
  const isGutter = gutterLines(r, horizontal);

  let start = 0;
  while (start < size && isGutter[start]) start++;
  let end = size;
  while (end > start && isGutter[end - 1]) end--;

  // Each inner separator: the gutter run whose centre is nearest the expected cut.
  const cuts: Array<[number, number]> = [];
  const window = size / n / 3;
  for (let i = 1; i < n; i++) {
    const expected = start + ((end - start) * i) / n;
    let best: [number, number] | null = null;
    for (let p = Math.max(start, Math.floor(expected - window)); p < Math.min(end, expected + window); p++) {
      if (!isGutter[p] || (p > 0 && isGutter[p - 1] && p - 1 >= expected - window)) continue;
      let q = p;
      while (q < end && isGutter[q]) q++;
      if (!best || Math.abs((p + q) / 2 - expected) < Math.abs((best[0] + best[1]) / 2 - expected)) best = [p, q];
    }
    const cut = Math.round(expected);
    cuts.push(best ?? [cut, cut]);
  }

  const out: Array<[number, number]> = [];
  let from = start;
  for (const [g0, g1] of cuts) {
    out.push([from, g0]);
    from = g1;
  }
  out.push([from, end]);
  return out;
}

function gutterLines(r: Raster, horizontal: boolean): boolean[] {
  const size = horizontal ? r.width : r.height;
  const other = horizontal ? r.height : r.width;
  const out: boolean[] = [];
  for (let s = 0; s < size; s++) {
    let dark = 0;
    for (let o = 0; o < other; o++) {
      const i = horizontal ? (o * r.width + s) * 4 : (s * r.width + o) * 4;
      if (Math.max(r.data[i], r.data[i + 1], r.data[i + 2]) < DARK) dark++;
    }
    out.push(dark >= other * GUTTER_SHARE);
  }
  return out;
}

/**
 * Removes near-black lines left at a cell's edges (drawn tile borders), at most 15% per
 * side. A dark run that reaches the limit is the texture itself (tar, night sky), not a
 * border, and is kept.
 */
function trimDarkBorders(cell: Raster): Raster {
  const cols = gutterLines(cell, true);
  const rows = gutterLines(cell, false);
  /** Border width at one edge: dark lines from `start` stepping by `dir`, or 0 if they run past `max`. */
  const border = (dark: boolean[], start: number, dir: number, max: number) => {
    let n = 0;
    while (n <= max && dark[start + dir * n]) n++;
    return n > max ? 0 : n;
  };
  const maxX = Math.floor(cell.width * 0.15);
  const maxY = Math.floor(cell.height * 0.15);
  const x0 = border(cols, 0, 1, maxX);
  const x1 = cell.width - border(cols, cell.width - 1, -1, maxX);
  const y0 = border(rows, 0, 1, maxY);
  const y1 = cell.height - border(rows, cell.height - 1, -1, maxY);
  if (x0 === 0 && y0 === 0 && x1 === cell.width && y1 === cell.height) return cell;
  return crop(cell, x0, y0, x1 - x0, y1 - y0);
}
