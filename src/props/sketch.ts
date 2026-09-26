import { FLAG_GLOW, srgbToLinear } from '../voxel/palette';
import type { Point, PropModel } from './types';

/** Draws a prop voxel by voxel in named colours, then hands it over as a model. */
export class Sketch {
  private readonly cells: number[] = [];
  private readonly hex: number[] = [];
  private readonly glowing: boolean[] = [];
  private readonly names = new Map<string, number>();

  /** A colour to draw in (sRGB hex, as a paint program shows it). `glow` lights it after dark: lantern glass. */
  paint(name: string, hex: number, glow = false): this {
    this.hex.push(hex);
    this.glowing.push(glow);
    this.names.set(name, this.hex.length);
    return this;
  }

  put(x: number, y: number, z: number, name: string): this {
    const index = this.names.get(name);
    if (index === undefined) throw new Error(`Sketch: no colour called ${name}`);
    this.cells.push(x, y, z, index);
    return this;
  }

  /** Fills a box, both corners included. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, name: string): this {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) this.put(x, y, z, name);
    return this;
  }

  /**
   * Lays rows of characters in the x–y plane at depth z: the top row first, the bottom one
   * at y0, from x0 across. Each character names a colour in `key`; '.' leaves the voxel empty.
   */
  rows(x0: number, y0: number, z: number, rows: readonly string[], key: Readonly<Record<string, string>>): this {
    rows.forEach((row, r) => [...row].forEach((ch, c) => ch !== '.' && this.put(x0 + c, y0 + rows.length - 1 - r, z, key[ch])));
    return this;
  }

  /** The same in the z–y plane at x: a board seen edge-on from the wall it hangs from. */
  rowsZ(z0: number, y0: number, x: number, rows: readonly string[], key: Readonly<Record<string, string>>): this {
    rows.forEach((row, r) => [...row].forEach((ch, c) => ch !== '.' && this.put(x, y0 + rows.length - 1 - r, z0 + c, key[ch])));
    return this;
  }

  /** The finished model: `origin` (in voxels) is the point that goes where the prop is placed. */
  model(origin: Point, scale = 0.25): PropModel {
    const colors = new Float32Array(256 * 3);
    const solid = new Uint8Array(256);
    const flags = new Uint8Array(256);
    this.hex.forEach((hex, i) => {
      const id = i + 1;
      solid[id] = 1;
      colors[id * 3] = srgbToLinear(((hex >> 16) & 0xff) / 255);
      colors[id * 3 + 1] = srgbToLinear(((hex >> 8) & 0xff) / 255);
      colors[id * 3 + 2] = srgbToLinear((hex & 0xff) / 255);
      if (this.glowing[i]) flags[id] = FLAG_GLOW;
    });
    return { cells: Int32Array.from(this.cells), palette: { colors, solid, flags }, origin, scale };
  }
}
