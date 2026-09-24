import { describe, expect, it } from 'vitest';
import { Weather, WEATHER_REGION, type WeatherCell } from './weather';

const angleBetween = (ax: number, az: number, bx: number, bz: number) =>
  Math.acos(Math.min(1, Math.max(-1, ax * bx + az * bz)));

describe('Weather', () => {
  const weather = new Weather({ seed: 7 });

  it('returns a unit direction and a bounded strength everywhere', () => {
    for (let i = 0; i < 400; i++) {
      const w = weather.windAt(i * 37.7 - 7000, i * -21.3 + 3000, i * 13.1);
      expect(Math.hypot(w.dirX, w.dirZ)).toBeCloseTo(1, 6);
      expect(w.strength).toBeGreaterThanOrEqual(0);
      expect(w.strength).toBeLessThanOrEqual(1.8);
    }
  });

  it('is a pure function of place and time, so it needs no saving', () => {
    const again = new Weather({ seed: 7 });
    expect(again.windAt(120, -340, 999)).toEqual(weather.windAt(120, -340, 999));
    expect(new Weather({ seed: 8 }).cells).not.toEqual(weather.cells);
  });

  it('keeps the trade wind steady enough to sail by', () => {
    const trades = new Weather({ cells: [] });
    for (let t = 0; t < 1800; t += 7) {
      const a = trades.windAt(0, 0, t);
      const b = trades.windAt(0, 0, t + 1);
      expect(angleBetween(a.dirX, a.dirZ, b.dirX, b.dirZ)).toBeLessThan(0.01);
      expect(a.strength).toBeGreaterThan(0.6);
    }
  });

  it('spins squall winds anticlockwise on the map, like a northern-hemisphere low', () => {
    const squall: WeatherCell = { kind: 'squall', x: 0, z: 0, radius: 100, intensity: 1 };
    const w = new Weather({ cells: [squall], tradeStrength: 0 });
    // East of the centre the wind blows north (north is -z).
    const east = w.windAt(70, 0, 0);
    expect(east.dirZ).toBeLessThan(-0.9);
    // North of the centre it blows west.
    const north = w.windAt(0, -70, 0);
    expect(north.dirX).toBeLessThan(-0.9);
    expect(east.squall).toBeGreaterThan(0.5);
  });

  it('dies away inside a calm', () => {
    const calm: WeatherCell = { kind: 'calm', x: 0, z: 0, radius: 200, intensity: 1 };
    const w = new Weather({ cells: [calm] });
    const inside = w.windAt(0, 0, 0);
    const outside = w.windAt(900, 0, 0);
    expect(inside.strength).toBeLessThan(outside.strength * 0.35);
    expect(inside.calm).toBeGreaterThan(0.9);
  });

  it('keeps generated weather systems apart, so they never cancel out', () => {
    for (const seed of [...Array(20).keys(), 1717]) {
      const cells = new Weather({ seed }).cells;
      for (let i = 0; i < cells.length; i++) {
        for (let j = i + 1; j < cells.length; j++) {
          const a = cells[i];
          const b = cells[j];
          const wrap = (v: number) => v - WEATHER_REGION * Math.round(v / WEATHER_REGION);
          expect(Math.hypot(wrap(a.x - b.x), wrap(a.z - b.z))).toBeGreaterThanOrEqual(1.5 * (a.radius + b.radius));
        }
      }
    }
  });

  it('blows harder in a squall than in the open trades', () => {
    const weather = new Weather({ seed: 1717 });
    for (const cell of weather.cells.filter((c) => c.kind === 'squall')) {
      // Sample round the ring of strongest wind at t = 0 (cells haven't drifted yet).
      let strongest = 0;
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const r = cell.radius * 0.7;
        strongest = Math.max(strongest, weather.windAt(cell.x + Math.cos(a) * r, cell.z + Math.sin(a) * r, 0).strength);
      }
      expect(strongest).toBeGreaterThan(1.2);
    }
  });

  it('starts the game with sailable wind at the home island', () => {
    for (const seed of [1, 2, 3, 1717]) {
      expect(new Weather({ seed }).windAt(0, 0, 0).strength).toBeGreaterThan(0.6);
    }
  });
});
