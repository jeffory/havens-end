import { AdditiveBlending, CanvasTexture, SpriteMaterial, type Texture } from 'three';

let texture: Texture | null = null;

/** A soft round glow, drawn once and shared: halos round lanterns, ghost lights. */
export function glowTexture(): Texture {
  if (texture) return texture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gradient;
  g.fillRect(0, 0, size, size);
  texture = new CanvasTexture(canvas);
  return texture;
}

/** A glow sprite's material: additive, unlit, and drawn over nothing it shouldn't hide. */
export function glowMaterial(color: number): SpriteMaterial {
  return new SpriteMaterial({ map: glowTexture(), color, blending: AdditiveBlending, transparent: true, depthWrite: false, opacity: 0, toneMapped: false });
}
