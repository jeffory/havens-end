import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseVox } from '../vox/parseVox';
import { buildCharacterModel, CHARACTER_HEIGHT, cutlassCells, PART_NAMES } from './characterModel';
import { buildSettlerModel } from './settlerModel';

function load(name: string) {
  const bytes = readFileSync(`public/models/characters/${name}.vox`);
  return buildCharacterModel(parseVox(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer));
}

describe('buildCharacterModel', () => {
  for (const name of ['player', 'imperial', 'merchant', 'pirate']) {
    it(`finds every part and joint of the ${name} captain`, () => {
      const m = load(name);
      for (const part of PART_NAMES) expect(m.parts[part].cells.length).toBeGreaterThan(0);
      const p = m.parts;
      // Arms spread either side of the body, right toward -x.
      expect(p.arm_r.pivot.x).toBeLessThan(p.torso.pivot.x);
      expect(p.arm_l.pivot.x).toBeGreaterThan(p.torso.pivot.x);
      expect(m.hand.x).toBeLessThan(p.arm_r.pivot.x);
      // Head on top, shoulders above hips, feet at the bottom.
      expect(p.head.pivot.y).toBeGreaterThan(p.arm_r.pivot.y - 3);
      expect(p.arm_r.pivot.y).toBeGreaterThan(p.leg_r.pivot.y);
      expect(p.leg_r.pivot.y).toBeGreaterThan(m.feet.y);
      // Scaled to a sensible height.
      const top = Math.max(...PART_NAMES.map((n) => Math.max(...[...m.parts[n].cells].filter((_, i) => i % 4 === 1))));
      expect((top + 1 - m.feet.y) * m.scale).toBeCloseTo(CHARACTER_HEIGHT);
    });
  }

  it('refuses a model with parts missing', () => {
    const player = readFileSync('public/models/characters/player.vox');
    const file = parseVox(player.buffer.slice(player.byteOffset, player.byteOffset + player.length) as ArrayBuffer);
    file.instances = file.instances.filter((i) => i.name !== 'head');
    expect(() => buildCharacterModel(file)).toThrow(/missing parts head/);
  });

  it('makes a cutlass pointing away from the hand', () => {
    const { cells } = cutlassCells();
    const xs = [...cells].filter((_, i) => i % 4 === 0);
    expect(Math.min(...xs)).toBeLessThan(-10);
    expect(Math.max(...xs)).toBeLessThanOrEqual(1);
  });
});

describe('buildSettlerModel', () => {
  it('builds a whole settler, the same height with or without a hat, and each one different', () => {
    const looks = [1, 2, 3, 4, 5, 6, 7, 8].map((look) => buildSettlerModel(look * 7919));
    for (const m of looks) {
      for (const part of PART_NAMES) expect(m.parts[part].cells.length).toBeGreaterThan(0);
      expect(m.parts.arm_r.pivot.x).toBeLessThan(m.parts.torso.pivot.x);
      expect(m.hand.x).toBeLessThan(m.parts.arm_r.pivot.x);
      expect(m.scale).toBeCloseTo(CHARACTER_HEIGHT / 26);
    }
    const shirts = new Set(looks.map((m) => [...m.palette.slice(12, 15)].join()));
    expect(shirts.size).toBeGreaterThan(2);
  });
});
