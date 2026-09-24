import { type Camera, Vector3 } from 'three';

export interface WorldLabel {
  id: string;
  x: number;
  y: number;
  z: number;
  text: string;
}

/** Signs hanging in the world (over port doors): plain DOM text placed where a world point lands on screen. */
export class WorldLabels {
  private readonly layer = document.createElement('div');
  private readonly els = new Map<string, HTMLElement>();
  private readonly point = new Vector3();

  constructor(parent: HTMLElement) {
    this.layer.className = 'world-labels';
    parent.append(this.layer);
  }

  update(labels: readonly WorldLabel[], camera: Camera, width: number, height: number): void {
    const seen = new Set<string>();
    for (const label of labels) {
      seen.add(label.id);
      let el = this.els.get(label.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'world-label';
        this.layer.append(el);
        this.els.set(label.id, el);
      }
      if (el.textContent !== label.text) el.textContent = label.text;
      this.point.set(label.x, label.y, label.z).project(camera);
      const visible = this.point.z < 1 && Math.abs(this.point.x) < 1.1 && Math.abs(this.point.y) < 1.1;
      el.hidden = !visible;
      if (visible) el.style.transform = `translate(${(((this.point.x + 1) / 2) * width).toFixed(0)}px, ${(((1 - this.point.y) / 2) * height).toFixed(0)}px) translate(-50%, -100%)`;
    }
    for (const [id, el] of this.els) {
      if (seen.has(id)) continue;
      el.remove();
      this.els.delete(id);
    }
  }
}
