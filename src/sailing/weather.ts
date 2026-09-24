import { mulberry32 } from '../worldgen/noise';

export interface Wind {
  /** Unit vector the wind blows toward, on the x/z plane. */
  dirX: number;
  dirZ: number;
  /** 0 = flat calm, 1 = a fresh breeze, up to ~1.8 in squall gusts. */
  strength: number;
  /** 0..1: how deep in a squall / a calm this spot is. For the HUD and visuals. */
  squall: number;
  calm: number;
}

export interface WeatherCell {
  kind: 'squall' | 'calm';
  /** Centre at time 0; cells drift downwind from there. */
  x: number;
  z: number;
  radius: number;
  /** 0..1 */
  intensity: number;
}

export interface WeatherOptions {
  /** Generates the weather cells. Ignored when `cells` is given. */
  seed?: number;
  cells?: WeatherCell[];
  /** Strength of the prevailing trade wind (default 0.85). */
  tradeStrength?: number;
}

/** Cells live on a square this size that wraps around, so weather keeps coming forever. */
export const WEATHER_REGION = 3000;
/** Weather systems ride the trades at this speed (u/s): slower than a ship, so you can run from a squall. */
const DRIFT_SPEED = 2.2;
const MAX_STRENGTH = 1.8;

// North is -z and east is +x. The trades blow from the east-north-east toward the west-south-west.
const TRADE_ANGLE = Math.atan2(-0.92, 0.38); // heading-style angle: direction = (sin a, cos a)

/**
 * Regional weather: the prevailing trades, bent and strengthened by squalls
 * (anticlockwise low-pressure spirals) and smothered by calms, all drifting
 * downwind. The whole field is a pure function of (seed, x, z, time), so it is
 * deterministic, costs nothing to save, and can be sampled anywhere: by ships,
 * the HUD, wind streaks and, later, AI captains.
 */
export class Weather {
  readonly cells: readonly WeatherCell[];
  private readonly tradeStrength: number;

  constructor(options: WeatherOptions = {}) {
    this.tradeStrength = options.tradeStrength ?? 0.85;
    this.cells = options.cells ?? generateCells(options.seed ?? 1);
  }

  windAt(x: number, z: number, time: number): Wind {
    // Prevailing trades, wandering slowly (periods of ~9 and ~25 minutes).
    const angle = TRADE_ANGLE + 0.22 * Math.sin(time * 0.0041) + 0.12 * Math.sin(time * 0.0113 + 1.3);
    const trade = this.tradeStrength * (0.9 + 0.1 * Math.sin(time * 0.0067 + 0.4));
    let vx = Math.sin(angle) * trade;
    let vz = Math.cos(angle) * trade;

    const driftX = Math.sin(TRADE_ANGLE) * DRIFT_SPEED * time;
    const driftZ = Math.cos(TRADE_ANGLE) * DRIFT_SPEED * time;
    let squall = 0;
    let calm = 0;
    let spinX = 0;
    let spinZ = 0;

    for (const cell of this.cells) {
      // Offset from the nearest copy of the (wrapping) cell to this point.
      const dx = wrap(x - (cell.x + driftX));
      const dz = wrap(z - (cell.z + driftZ));
      const s2 = (dx * dx + dz * dz) / (cell.radius * cell.radius);
      if (s2 > 16) continue;
      if (cell.kind === 'calm') {
        calm = Math.max(calm, cell.intensity * Math.exp(-1.5 * s2));
        continue;
      }
      squall = Math.max(squall, cell.intensity * Math.exp(-s2));
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < 1e-6) continue;
      // Anticlockwise on the map (north = -z) with a little inflow, strongest at ~0.7 radius, still in the eye.
      const s = d / cell.radius;
      const speed = cell.intensity * 1.1 * s * Math.exp(-s * s) * 2.33;
      spinX += ((dz - 0.25 * dx) / d) * speed;
      spinZ += ((-dx - 0.25 * dz) / d) * speed;
    }

    vx = vx * (1 + 0.3 * squall) + spinX;
    vz = vz * (1 + 0.3 * squall) + spinZ;
    const gustiness = 0.06 + 0.2 * squall;
    const gust = 1 + gustiness * Math.sin(time * 0.83 + x * 0.021) * Math.sin(time * 0.51 - z * 0.017);
    const scale = gust * (1 - 0.8 * calm);

    const length = Math.hypot(vx, vz);
    if (length < 1e-6) return { dirX: Math.sin(angle), dirZ: Math.cos(angle), strength: 0, squall, calm };
    return { dirX: vx / length, dirZ: vz / length, strength: Math.min(MAX_STRENGTH, length * scale), squall, calm };
  }
}

const wrap = (v: number) => v - WEATHER_REGION * Math.round(v / WEATHER_REGION);

function generateCells(seed: number): WeatherCell[] {
  const random = mulberry32(seed ^ 0x5eed);
  const cells: WeatherCell[] = [];
  const kinds: Array<WeatherCell['kind']> = ['squall', 'squall', 'squall', 'squall', 'squall', 'squall', 'calm', 'calm', 'calm', 'calm'];
  for (const kind of kinds) {
    const radius = kind === 'squall' ? 90 + random() * 90 : 150 + random() * 150;
    const intensity = 0.6 + random() * 0.4;
    let x = 0;
    let z = 0;
    // Keep the home waters fair at the start (the weather reaches them later as it drifts),
    // and keep systems apart: a squall inside a calm would just cancel out.
    for (let attempt = 0; attempt < 1000; attempt++) {
      x = (random() - 0.5) * WEATHER_REGION;
      z = (random() - 0.5) * WEATHER_REGION;
      const clearOfHome = Math.hypot(x, z) >= 2.5 * radius + 100;
      const clearOfOthers = cells.every((c) => Math.hypot(wrap(x - c.x), wrap(z - c.z)) >= 1.5 * (radius + c.radius));
      if (clearOfHome && clearOfOthers) break;
    }
    cells.push({ kind, x, z, radius, intensity });
  }
  return cells;
}
