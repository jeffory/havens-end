import type { Raster } from './raster';

/** Colour jump (sum of |ΔR| + |ΔG| + |ΔB|) that counts as an edge between art pixels. */
const EDGE = 48;

/**
 * Roughly how many art pixels span the image: 1 + the average number of colour edges
 * per row and column. Soft (anti-aliased) edges count once. A texture drawn at 16×16
 * scores about 16 whatever its image size, so a much higher score means more detail
 * than a 16-pixel texture can hold.
 */
export function detailResolution(r: Raster): number {
  const edgesAlong = (count: number, length: number, at: (line: number, i: number) => number) => {
    let total = 0;
    for (let line = 0; line < count; line++) {
      let wasEdge = false;
      for (let i = 0; i < length - 1; i++) {
        const a = at(line, i);
        const b = at(line, i + 1);
        const d = Math.abs(r.data[a] - r.data[b]) + Math.abs(r.data[a + 1] - r.data[b + 1]) + Math.abs(r.data[a + 2] - r.data[b + 2]);
        const isEdge = d > EDGE;
        if (isEdge && !wasEdge) total++;
        wasEdge = isEdge;
      }
    }
    return total / count;
  };
  const rows = edgesAlong(r.height, r.width, (y, x) => (y * r.width + x) * 4);
  const cols = edgesAlong(r.width, r.height, (x, y) => (y * r.width + x) * 4);
  return 1 + (rows + cols) / 2;
}
