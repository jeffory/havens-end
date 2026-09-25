import { type Camera, Vector3 } from 'three';

export interface WorldLabel {
  id: string;
  x: number;
  y: number;
  z: number;
  text: string;
  /** A sign (the default), or the pin marking the captain when the camera's pulled back. */
  kind?: 'sign' | 'pin';
}

/** Does a sign `w` by `h`, hung by the middle of its foot at (x, y), fit whole on a `width` by `height` screen? */
export function labelFits(x: number, y: number, w: number, h: number, width: number, height: number): boolean {
  return x - w / 2 >= 0 && x + w / 2 <= width && y - h >= 0 && y <= height;
}

/**
 * Signs hanging in the world (over port doors): plain DOM text placed where a world point
 * lands on screen. A sign that won't fit on screen whole is hidden, not cut off at the edge.
 */
export class WorldLabels {
  private readonly layer = document.createElement('div');
  private readonly els = new Map<string, { el: HTMLElement; w: number; h: number }>();
  private readonly point = new Vector3();

  constructor(parent: HTMLElement) {
    this.layer.className = 'world-labels';
    parent.append(this.layer);
  }

  update(labels: readonly WorldLabel[], camera: Camera, width: number, height: number): void {
    const seen = new Set<string>();
    for (const label of labels) {
      seen.add(label.id);
      let sign = this.els.get(label.id);
      if (!sign) {
        const el = document.createElement('div');
        el.className = label.kind === 'pin' ? 'world-pin' : 'world-label';
        this.layer.append(el);
        sign = { el, w: 0, h: 0 };
        this.els.set(label.id, sign);
      }
      const { el } = sign;
      if (el.textContent !== label.text) {
        el.textContent = label.text;
        sign.w = 0;
      }
      // Measured once for its text (hidden by visibility, so it keeps its size).
      if (sign.w === 0) {
        sign.w = el.offsetWidth;
        sign.h = el.offsetHeight;
      }
      this.point.set(label.x, label.y, label.z).project(camera);
      const x = ((this.point.x + 1) / 2) * width;
      const y = ((1 - this.point.y) / 2) * height;
      const visible = this.point.z < 1 && labelFits(x, y, sign.w, sign.h, width, height);
      el.style.visibility = visible ? '' : 'hidden';
      if (visible) el.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) translate(-50%, -100%)`;
    }
    for (const [id, { el }] of this.els) {
      if (seen.has(id)) continue;
      el.remove();
      this.els.delete(id);
    }
  }
}
