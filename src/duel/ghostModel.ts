import type { CharacterModel } from './characterModel';

/**
 * A captain's ghost: the same figure, washed out to the pale sea-green of the ghost
 * lights. The see-through glow is the view's (`CharacterView` with `ghost`).
 */
export function ghostModel(model: CharacterModel): CharacterModel {
  const palette = new Uint8Array(model.palette);
  for (let i = 0; i < palette.length; i += 4) {
    if (palette[i + 3] === 0) continue;
    const light = 0.3 * palette[i] + 0.59 * palette[i + 1] + 0.11 * palette[i + 2];
    palette[i] = Math.min(255, 50 + light * 0.55);
    palette[i + 1] = Math.min(255, 90 + light * 0.75);
    palette[i + 2] = Math.min(255, 80 + light * 0.65);
  }
  return { ...model, palette };
}
