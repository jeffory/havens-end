/**
 * Deterministic k-means on packed RGB triples (r, g, b, r, g, b, …). Seeds are chosen by
 * farthest-point sampling from the first colour, so the same input always gives the
 * same clusters (no randomness, reproducible assets).
 */
export interface Clusters {
  /** k × 3 centroid components; empty clusters keep their seed. */
  centroids: Float64Array;
  /** Cluster index per input colour. */
  labels: Int32Array;
  /** Members per cluster. */
  counts: Int32Array;
}

export function kmeans(rgb: ArrayLike<number>, k: number, iterations = 8): Clusters {
  const n = rgb.length / 3;
  const centroids = farthestPointSeeds(rgb, Math.max(1, Math.min(k, n)));
  const labels = new Int32Array(n);
  for (let iter = 0; iter < iterations; iter++) {
    assign(rgb, centroids, labels);
    recompute(rgb, centroids, labels);
  }
  assign(rgb, centroids, labels);
  const counts = new Int32Array(centroids.length / 3);
  for (const label of labels) counts[label]++;
  return { centroids, labels, counts };
}

function farthestPointSeeds(rgb: ArrayLike<number>, k: number): Float64Array {
  const n = rgb.length / 3;
  const seeds = new Float64Array(k * 3);
  for (let c = 0; c < 3; c++) seeds[c] = rgb[c];
  const nearest = new Float64Array(n).fill(Infinity);
  for (let s = 1; s < k; s++) {
    let far = 0;
    for (let i = 0; i < n; i++) {
      nearest[i] = Math.min(nearest[i], dist2(rgb, i, seeds, s - 1));
      if (nearest[i] > nearest[far]) far = i;
    }
    for (let c = 0; c < 3; c++) seeds[s * 3 + c] = rgb[far * 3 + c];
  }
  return seeds;
}

function assign(rgb: ArrayLike<number>, centroids: Float64Array, labels: Int32Array): void {
  const k = centroids.length / 3;
  for (let i = 0; i < labels.length; i++) {
    let best = 0;
    let bestD = Infinity;
    for (let c = 0; c < k; c++) {
      const d = dist2(rgb, i, centroids, c);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    labels[i] = best;
  }
}

function recompute(rgb: ArrayLike<number>, centroids: Float64Array, labels: Int32Array): void {
  const k = centroids.length / 3;
  const sums = new Float64Array(k * 4);
  for (let i = 0; i < labels.length; i++) {
    const c = labels[i];
    sums[c * 4] += rgb[i * 3];
    sums[c * 4 + 1] += rgb[i * 3 + 1];
    sums[c * 4 + 2] += rgb[i * 3 + 2];
    sums[c * 4 + 3]++;
  }
  for (let c = 0; c < k; c++) {
    const count = sums[c * 4 + 3];
    if (count === 0) continue;
    for (let ch = 0; ch < 3; ch++) centroids[c * 3 + ch] = sums[c * 4 + ch] / count;
  }
}

function dist2(rgb: ArrayLike<number>, i: number, centroids: ArrayLike<number>, c: number): number {
  const dr = rgb[i * 3] - centroids[c * 3];
  const dg = rgb[i * 3 + 1] - centroids[c * 3 + 1];
  const db = rgb[i * 3 + 2] - centroids[c * 3 + 2];
  return dr * dr + dg * dg + db * db;
}
