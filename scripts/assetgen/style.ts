/**
 * Art direction for Haven's End, shared by every recipe's prompts. Edit here to change
 * the look of everything generated from now on.
 */
import type { TileAxes } from './image/seam';

export const WORLD = "Haven's End is a sunny Caribbean pirate adventure: warm, saturated, cheerful colours.";

export const PIXEL_RULES =
  'Crisp pixel art: every art pixel is a large uniform square on a strict grid, limited palette, clean shapes, ' +
  'no anti-aliasing, no gradients, no blur, no noise dithering.';

/** Smallest near-square grid [columns, rows] holding n cells. */
export function gridFor(n: number): [number, number] {
  const cols = Math.ceil(Math.sqrt(n));
  return [cols, Math.ceil(n / cols)];
}

const tiling = (axes: TileAxes) => (axes === 'xy' ? 'tiles seamlessly in every direction' : 'tiles seamlessly left to right');

/**
 * How big one art pixel is on the generated image, spelled out: without it, models
 * draw far finer detail than a 16×16 texture can hold.
 */
const pixelMath = (size: number, cellPixels: number) =>
  `Each texture is exactly ${size} art pixels wide and ${size} tall, so every art pixel is a solid square about ` +
  `${Math.round(cellPixels / size)} image pixels across. Keep shapes simple and bold so they read at ${size}x${size}.`;

/** Block face textures, several per image so they share one style. `imageSize` is the generated image's width. */
export function atlasPrompt(descriptions: string[], size: number, axes: TileAxes, imageSize = 1024): string {
  const [cols, rows] = gridFor(descriptions.length);
  const flat = `seen perfectly flat and head-on: no perspective, no lighting, no shadows, no text or labels`;
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    const cells = [];
    for (let c = 0; c < cols; c++) cells.push(descriptions[r * cols + c] ?? '(empty cell: solid black)');
    lines.push(`Row ${r + 1}: ${cells.join(' | ')}.`);
  }
  return (
    `Texture atlas for a voxel game: ${descriptions.length} square block textures in an exact ${cols}x${rows} grid, ` +
    `separated by thin solid black gutters with a thin black border. ${pixelMath(size, imageSize / cols)} Each texture is ` +
    `${flat}, and ${tiling(axes)}. ${lines.join(' ')} ${PIXEL_RULES} ${WORLD}`
  );
}

/** Instruction for an image-editing model to mend the seam cross of a rolled texture. */
export function seamEditPrompt(description: string, axes: TileAxes): string {
  const where = axes === 'xy' ? 'the central vertical and horizontal lines' : 'the central vertical line';
  return (
    `Edit this tileable texture (${description}). There are visible seams along ${where}, where the pattern does not ` +
    `line up. Redraw only a narrow band along ${where} so the pattern continues naturally across them, matching the ` +
    `existing pixel size, palette, lighting and style exactly. Keep everything else unchanged, with the same framing.`
  );
}

/** One tileable top-down pattern, later reduced to one pixel per voxel. */
export function patternPrompt(description: string, size: number): string {
  return (
    `Seamless tileable top-down pattern of ${description}, as ${size}x${size} pixel art with big chunky square pixels. ` +
    `Flat and head-on, no lighting or shadows, no border, fills the entire image edge to edge. ${PIXEL_RULES} ${WORLD}`
  );
}

export function spritePrompt(description: string): string {
  return (
    `Pixel art game sprite: ${description}. Full body, three-quarter view, centred with a generous margin on a plain ` +
    `flat solid white background, no ground shadow, no text. ${PIXEL_RULES} ${WORLD}`
  );
}

export function iconSheetPrompt(descriptions: string[], size: number): string {
  const [cols, rows] = gridFor(descriptions.length);
  const list = Array.from({ length: cols * rows }, (_, i) => `${i + 1}. ${descriptions[i] ?? '(empty cell)'}`).join('; ');
  return (
    `A sheet of pixel art inventory icons in an exact ${cols}x${rows} grid of equal square cells, each icon centred in its ` +
    `own cell with a margin, on one plain flat light grey background. No gutters, no labels, no text. Each icon reads ` +
    `clearly at ${size}x${size} pixels, with a clean dark outline. In reading order: ${list}. ${PIXEL_RULES} ${WORLD}`
  );
}

export function materialPrompt(description: string): string {
  return (
    `Seamless tileable texture: orthographic top-down photo of ${description}. Flat even diffuse lighting with no ` +
    `shadows or vignette, no perspective, fills the whole frame edge to edge, high-detail game texture. ${WORLD}`
  );
}

/**
 * A painted story picture (the intro's panels): golden-age book illustration, cinematic
 * and wide. The scene brings its own mood; the world's sunny palette isn't forced on it.
 */
export function illustrationPrompt(description: string): string {
  return (
    `Painted storybook illustration for a pirate adventure game set in the Caribbean in the age of sail: ${description}. ` +
    `Oil painting in the manner of golden-age book illustration (Howard Pyle, N. C. Wyeth): rich colour, dramatic ` +
    `light, visible painterly brushwork, a clear cinematic wide composition. No text, no lettering, no borders, no frame.`
  );
}

/** Concept art that image-to-3D models turn into clean, voxel-friendly shapes. */
export function voxConceptPrompt(description: string): string {
  return (
    `${description}. A single stylised game prop for voxel art: chunky simple shapes and solid colours, three-quarter ` +
    `view from slightly above, the whole object in frame. Centred on a plain flat white background, no shadow, nothing ` +
    `else in frame. ${WORLD}`
  );
}
