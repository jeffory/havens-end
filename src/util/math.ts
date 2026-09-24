/** Hermite ease between two edges, 0 below `edge0`, 1 above `edge1`. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** An angle folded into [-π, π]: the short way round. */
export const wrapAngle = (a: number): number => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
