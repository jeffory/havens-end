import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseVox } from '../vox/parseVox';
import { COAT, dressCaptain, HAT, TRIM } from './captainDress';
import { buildCharacterModel, type CharacterModel, PART_NAMES, type PartName } from './characterModel';

function player(): CharacterModel {
  const bytes = readFileSync('public/models/characters/player.vox');
  return buildCharacterModel(parseVox(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer));
}

/** Each cell of a part, with its colour. */
function cells(m: CharacterModel, part: PartName): Array<{ x: number; y: number; z: number; rgb: [number, number, number] }> {
  const c = m.parts[part].cells;
  const out = [];
  for (let i = 0; i < c.length; i += 4) out.push({ x: c[i], y: c[i + 1], z: c[i + 2], rgb: [0, 1, 2].map((k) => m.palette[c[i + 3] * 4 + k]) as [number, number, number] });
  return out;
}
const hex = (n: number) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
const charcoal = ([r, g, b]: number[]) => Math.max(r, g, b) <= 0x40 && Math.max(r, g, b) - Math.min(r, g, b) <= 4;
const redOf = ([r, g, b]: number[]) => r > 2 * g && r > 2 * b && r > 0x50;
const same = (a: number[], b: number[]) => a.every((v, k) => v === b[k]);

describe('the captain’s dress', () => {
  it('is a deep red coat, gold at its lapels, cuffs and hem, over a light shirt: nothing left charcoal on the body', () => {
    const dressed = dressCaptain(player());
    for (const part of ['torso', 'arm_l', 'arm_r'] as const) {
      const all = cells(dressed, part);
      expect(all.filter((c) => charcoal(c.rgb)), `${part}: charcoal left`).toEqual([]);
      expect(all.filter((c) => redOf(c.rgb)).length, `${part}: mostly red`).toBeGreaterThan(all.length / 2);
      expect(all.some((c) => same(c.rgb, hex(TRIM))), `${part}: gold trim`).toBe(true);
    }
    for (const part of ['leg_l', 'leg_r'] as const) expect(cells(dressed, part).some((c) => same(c.rgb, hex(TRIM))), `${part}: a gold hem`).toBe(true);
    // The shirt shows light at the chest.
    const light = cells(dressed, 'torso').filter(({ rgb: [r, g, b] }) => Math.min(r, g, b) > 0xd8);
    expect(light.length).toBeGreaterThan(10);
    expect(COAT).toBeDefined();
  });

  it('gives the hat a gold edge round its brim, which shows from above, and no black', () => {
    const dressed = dressCaptain(player());
    const head = cells(dressed, 'head');
    expect(head.filter((c) => charcoal(c.rgb))).toEqual([]);
    // From above: the top cell of each column of the hat.
    const top = new Map<string, (typeof head)[number]>();
    for (const c of head) {
      const k = `${c.x},${c.z}`;
      if (!top.has(k) || top.get(k)!.y < c.y) top.set(k, c);
    }
    const seen = [...top.values()];
    const gold = seen.filter((c) => same(c.rgb, hex(TRIM)));
    expect(gold.length).toBeGreaterThan(seen.length / 6);
    // The gold is round the outside, the felt in the middle.
    const [mx, mz] = [seen.reduce((s, c) => s + c.x, 0) / seen.length, seen.reduce((s, c) => s + c.z, 0) / seen.length];
    const reach = (c: { x: number; z: number }) => Math.hypot(c.x - mx, c.z - mz);
    const average = (list: Array<{ x: number; z: number }>) => list.reduce((s, c) => s + reach(c), 0) / list.length;
    expect(average(gold)).toBeGreaterThan(average(seen.filter((c) => !same(c.rgb, hex(TRIM)))));
    expect(seen.some((c) => c.rgb[0] < 0x60 && c.rgb[0] > c.rgb[2] && !charcoal(c.rgb)), 'brown felt').toBe(true);
    expect(HAT).toBeDefined();
  });

  it('keeps the face, hands, boots and the figure’s shape and joints as they were', () => {
    const before = player();
    const after = dressCaptain(before);
    for (const part of PART_NAMES) {
      const [a, b] = [cells(before, part), cells(after, part)];
      expect(b.map(({ x, y, z }) => [x, y, z])).toEqual(a.map(({ x, y, z }) => [x, y, z]));
      a.forEach((c, i) => {
        const [r, g, bl] = c.rgb;
        const skinOrBoots = (r > 0xa0 && g > 0x60 && r - bl > 0x40 && r > g && g > bl) || (!charcoal(c.rgb) && Math.max(r, g, bl) < 0x50);
        if (skinOrBoots) expect(b[i].rgb, `${part} at ${c.x}, ${c.y}, ${c.z}`).toEqual(c.rgb);
      });
      expect(after.parts[part].pivot).toEqual(before.parts[part].pivot);
    }
    expect([after.feet, after.hand, after.scale]).toEqual([before.feet, before.hand, before.scale]);
  });
});
