import { describe, expect, it } from 'vitest';
import { atlasPrompt, gridFor, iconSheetPrompt } from './style';

describe('gridFor', () => {
  it('picks the smallest near-square grid that fits', () => {
    expect(gridFor(1)).toEqual([1, 1]);
    expect(gridFor(2)).toEqual([2, 1]);
    expect(gridFor(4)).toEqual([2, 2]);
    expect(gridFor(5)).toEqual([3, 2]);
    expect(gridFor(9)).toEqual([3, 3]);
    expect(gridFor(12)).toEqual([4, 3]);
  });
});

describe('atlasPrompt', () => {
  it('describes each cell in reading order and fills spare cells with black', () => {
    const p = atlasPrompt(['lush grass', 'pale sand', 'grey stone'], 16, 'xy');

    expect(p).toContain('2x2 grid');
    expect(p).toContain('Row 1: lush grass | pale sand.');
    expect(p).toContain('Row 2: grey stone | (empty cell: solid black).');
    expect(p).toContain('16x16');
  });

  it('asks side textures to tile only horizontally', () => {
    expect(atlasPrompt(['grass side', 'sand side'], 16, 'x')).toContain('tiles seamlessly left to right');
  });
});

describe('iconSheetPrompt', () => {
  it('numbers the icons in reading order', () => {
    const p = iconSheetPrompt(['gold coin', 'rum bottle', 'spyglass'], 32);
    expect(p).toContain('2x2 grid');
    expect(p).toContain('1. gold coin; 2. rum bottle; 3. spyglass; 4. (empty cell)');
  });
});
