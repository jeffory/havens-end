import { describe, expect, it } from 'vitest';
import { decodeImage } from './io';
import { createRaster, getPixel } from './raster';
import { contactSheet, previewScale } from './sheet';

describe('contactSheet', () => {
  it('lays previews out in a labelled grid of fixed-size cells', async () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({ label: `item ${i}`, image: createRaster(16, 16, [200, 0, 0, 255]) }));

    const png = await contactSheet(entries, { cell: 128, columns: 3 });
    const sheet = await decodeImage(png);

    expect(sheet.width).toBe(3 * 128);
    expect(sheet.height).toBe(2 * (128 + 38)); // two-line caption strip per row
    expect(getPixel(sheet, 64, 64)).toEqual([200, 0, 0, 255]); // preview scaled into the first cell
  });
});

describe('previewScale', () => {
  it('scales small pixel art up by a whole number so pixels stay square', () => {
    expect(previewScale(16, 16, 128)).toBe(8);
    expect(previewScale(48, 20, 128)).toBe(2);
    expect(previewScale(1024, 1024, 128)).toBe(0.125);
  });
});
