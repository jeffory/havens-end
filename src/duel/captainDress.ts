import { type CharacterModel, PART_NAMES, type PartName } from './characterModel';

/** The captain's coat: a deep red. */
export const COAT = 0x7e1b23;
/** Gold braid: on the coat's lapels, cuffs and hem, and round the hat's brim. */
export const TRIM = 0xd9a93c;
/** The hat: a dark brown felt, not the coat's black. */
export const HAT = 0x4a3020;
/** The belt over the shirt, where the sash was red (it would be lost against the coat). */
const BELT = 0x3b2516;

type Rgb = readonly [number, number, number];
const rgb = (hex: number): Rgb => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
/** A colour scaled lighter or darker. */
const shade = ([r, g, b]: Rgb, k: number): Rgb => [r, g, b].map((c) => Math.min(255, Math.round(c * k))) as unknown as Rgb;

/** What a colour in the figure is: its coat or hat (the charcoal), the shirt, the sash, or something else (skin, hair, boots). */
function kindOf([r, g, b]: Rgb): 'charcoal' | 'shirt' | 'sash' | 'other' {
  const [hi, lo] = [Math.max(r, g, b), Math.min(r, g, b)];
  if (hi <= 0x40 && hi - lo <= 4) return 'charcoal';
  if (lo >= 0x60 && hi - lo <= 0x30) return 'shirt';
  if (r > 0x60 && r > 2.5 * g && r > 2.5 * b) return 'sash';
  return 'other';
}

/**
 * The player's captain, dressed to be seen: the figure (made in charcoal, and lost at night
 * and against the dark-clad guards) gets a deep red coat, trimmed gold at its lapels, cuffs
 * and hem; its shirt lighter; a leather belt for the red sash; and a brown hat with a gold
 * edge round its brim, which is most of what shows of the captain from above. Face, hands,
 * hair, breeches and boots stay as they are, and so do the parts' shapes and joints.
 * Works on the colours: the charcoal on the head is the hat, and elsewhere the coat (the
 * body, the sleeves and the skirts over the legs).
 */
export function dressCaptain(model: CharacterModel): CharacterModel {
  const colour = (i: number): Rgb => [model.palette[i * 4], model.palette[i * 4 + 1], model.palette[i * 4 + 2]];
  /** Every cell, across all the parts (they share the model's space), to its palette index. */
  const at = new Map<string, number>();
  const used = new Set<number>();
  for (const part of PART_NAMES) {
    const c = model.parts[part].cells;
    for (let i = 0; i < c.length; i += 4) {
      at.set(`${c[i]},${c[i + 1]},${c[i + 2]}`, c[i + 3]);
      used.add(c[i + 3]);
    }
  }
  const kind = (x: number, y: number, z: number) => {
    const i = at.get(`${x},${y},${z}`);
    return i === undefined ? 'air' : kindOf(colour(i));
  };
  const skin = (x: number, y: number, z: number) => {
    const i = at.get(`${x},${y},${z}`);
    if (i === undefined) return false;
    const [r, g, b] = colour(i);
    return r > 0xa0 && r > g && g > b && kindOf([r, g, b]) === 'other';
  };

  // New colours go in palette slots no cell uses yet.
  const palette = new Uint8Array(model.palette);
  let free = 255;
  const added = new Map<string, number>();
  const slot = (c: Rgb): number => {
    const k = c.join(',');
    let i = added.get(k);
    if (i === undefined) {
      while (used.has(free)) free--;
      i = free--;
      palette.set([...c, 255], i * 4);
      added.set(k, i);
    }
    return i;
  };
  // The charcoal's shades carried over: darker folds stay darker, in red or brown.
  const tone = (i: number) => Math.min(1.25, Math.max(0.7, Math.max(...colour(i)) / 0x28));
  const sides = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;

  // The hat seen from above: the columns it covers. Those on its outline are the brim's edge.
  // Each column's top, so the braid is the edge's top two cells, not the brim's whole depth.
  const hat = new Map<string, number>();
  const head = model.parts.head.cells;
  for (let i = 0; i < head.length; i += 4) {
    const k = `${head[i]},${head[i + 2]}`;
    if (kindOf(colour(head[i + 3])) === 'charcoal') hat.set(k, Math.max(hat.get(k) ?? -Infinity, head[i + 1]));
  }
  const edge = (x: number, y: number, z: number) =>
    y >= hat.get(`${x},${z}`)! - 1 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => !hat.has(`${x + dx},${z + dz}`));

  const dress = (part: PartName, x: number, y: number, z: number, i: number): number => {
    const what = kindOf(colour(i));
    if (what === 'shirt') return slot(colour(i).map((c) => Math.round(c + (255 - c) * 0.45)) as unknown as Rgb);
    if (what === 'sash') return slot(rgb(BELT));
    if (what !== 'charcoal') return i;
    if (part === 'head') return slot(edge(x, y, z) ? rgb(TRIM) : shade(rgb(HAT), tone(i)));
    const lapel = sides.some(([dx, dy, dz]) => ['shirt', 'sash'].includes(kind(x + dx, y + dy, z + dz)));
    const cuff = (part === 'arm_l' || part === 'arm_r') && sides.some(([dx, dy, dz]) => skin(x + dx, y + dy, z + dz));
    const hem = (part === 'leg_l' || part === 'leg_r') && kind(x, y - 1, z) !== 'charcoal';
    return slot(lapel || cuff || hem ? rgb(TRIM) : shade(rgb(COAT), tone(i)));
  };

  const parts = Object.fromEntries(
    PART_NAMES.map((part) => {
      const cells = Int32Array.from(model.parts[part].cells);
      for (let i = 0; i < cells.length; i += 4) cells[i + 3] = dress(part, cells[i], cells[i + 1], cells[i + 2], cells[i + 3]);
      return [part, { ...model.parts[part], cells }];
    }),
  ) as CharacterModel['parts'];
  return { ...model, parts, palette };
}
