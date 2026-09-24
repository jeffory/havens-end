import { describe, expect, it } from 'vitest';
import { ICON_SIZE, ICONS, SACK } from './itemIcons';

describe('item icons', () => {
  it('are square, and every pixel has a colour', () => {
    for (const [good, icon] of [...Object.entries(ICONS), ['sack', SACK] as const]) {
      expect(icon!.rows.length, good).toBe(ICON_SIZE);
      for (const row of icon!.rows) {
        expect(row.length, `${good}: "${row}"`).toBe(ICON_SIZE);
        for (const ch of row) if (ch !== '.') expect(icon!.colors[ch], `${good}: '${ch}'`).toBeTypeOf('number');
      }
    }
  });
});
