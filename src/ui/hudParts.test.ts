import { describe, expect, it } from 'vitest';
import type { Held } from '../land/Land';
import { ICON_SIZE, ICONS, SACK, TOOL_ICONS } from '../render/itemIcons';
import { heldByLabel, heldIcon, iconUrl, splitPrompt } from './hudParts';

/** What the hotbar holds: the tools, the seeds and saplings. */
const HOTBAR: Held[] = ['axe', 'pickaxe', 'hoe', 'caneCuttings', 'tobaccoSeed', 'pepperSeed', 'maize', 'sapling'];

describe('hotbar icons', () => {
  it('give every tool and good a square picture with every pixel coloured', () => {
    for (const [tool, icon] of [...Object.entries(TOOL_ICONS), ...Object.entries(ICONS)]) {
      expect(icon.rows.length, tool).toBe(ICON_SIZE);
      for (const row of icon.rows) {
        expect(row.length, `${tool}: "${row}"`).toBe(ICON_SIZE);
        for (const ch of row) if (ch !== '.') expect(icon.colors[ch], `${tool}: '${ch}'`).toBeTypeOf('number');
      }
    }
  });

  it('give everything in the hotbar a picture of its own, each different', () => {
    const icons = HOTBAR.map(heldIcon);
    for (const [i, icon] of icons.entries()) expect(icon, HOTBAR[i]).not.toBe(SACK);
    expect(new Set(icons).size).toBe(HOTBAR.length);
  });

  it('tell the two seeds apart by colour: not one colour in common', () => {
    const colours = (icon: { colors: Record<string, number> }) => new Set(Object.values(icon.colors));
    const tobacco = colours(heldIcon('tobaccoSeed'));
    for (const colour of colours(heldIcon('pepperSeed'))) expect(tobacco.has(colour), colour.toString(16)).toBe(false);
  });

  it('find what a slot holds from its label', () => {
    expect(heldByLabel('Axe')).toBe('axe');
    expect(heldByLabel('Pickaxe')).toBe('pickaxe');
    expect(heldByLabel('Cane cuttings')).toBe('caneCuttings');
    expect(heldByLabel('Tobacco seed')).toBe('tobaccoSeed');
    expect(heldByLabel('Sapling')).toBe('sapling');
    expect(heldByLabel('Nothing like it')).toBeNull();
  });

  it('draw an icon as a crisp SVG, made once', () => {
    const icon = heldIcon('axe');
    const url = iconUrl(icon);
    expect(url.startsWith('data:image/svg+xml,')).toBe(true);
    const svg = decodeURIComponent(url.slice('data:image/svg+xml,'.length));
    expect(svg).toContain(`viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}"`);
    expect(svg).toContain('shape-rendering="crispEdges"');
    // Every coloured pixel is covered by exactly one run.
    const covered = [...svg.matchAll(/width="(\d+)"/g)].reduce((sum, m) => sum + Number(m[1]), 0);
    const pixels = icon.rows.join('').replace(/\./g, '').length;
    expect(covered).toBe(pixels);
    expect(iconUrl(icon)).toBe(url);
  });
});

describe('prompts', () => {
  it('show only the key for the scheme in use', () => {
    expect(splitPrompt('E / 🎮 A: the market', 'keys')).toEqual({ key: 'E', pad: false, text: 'the market' });
    expect(splitPrompt('E / 🎮 A: the market', 'pad')).toEqual({ key: 'A', pad: true, text: 'the market' });
    expect(splitPrompt('B / 🎮 B: board the Swallow', 'pad')).toEqual({ key: 'B', pad: true, text: 'board the Swallow' });
  });

  it('keep everything after the keys, colons and all', () => {
    expect(splitPrompt('E / 🎮 A: the camp: settlers, workshops, stores', 'keys').text).toBe('the camp: settlers, workshops, stores');
  });

  it('pass a prompt without both keys through whole', () => {
    const sail = 'Take in sail to go alongside at Port Royal';
    expect(splitPrompt(sail, 'pad')).toEqual({ key: null, pad: false, text: sail });
    const placing = 'Wharf (4 timber) · Space / click to build · Q R turn · Esc done';
    expect(splitPrompt(placing, 'keys')).toEqual({ key: null, pad: false, text: placing });
  });
});
