import { type Camera, Vector3 } from 'three';

export interface ShipLabel {
  id: number;
  /** World point to hang the label from (above the masthead). */
  x: number;
  y: number;
  z: number;
  name: string;
  faction: string;
  /** 0..1 */
  hull: number;
  note: string;
}

/** Name tags floating over other ships: who she is, her hull, and what she's up to. */
export class ShipLabels {
  private readonly layer = document.createElement('div');
  private readonly labels = new Map<number, { root: HTMLElement; name: HTMLElement; bar: HTMLElement; note: HTMLElement }>();
  private readonly point = new Vector3();

  constructor(parent: HTMLElement) {
    this.layer.className = 'ship-labels';
    parent.append(this.layer);
  }

  setVisible(visible: boolean): void {
    this.layer.hidden = !visible;
  }

  update(labels: readonly ShipLabel[], camera: Camera, width: number, height: number): void {
    const seen = new Set<number>();
    for (const label of labels) {
      seen.add(label.id);
      let el = this.labels.get(label.id);
      if (!el) {
        const root = document.createElement('div');
        root.innerHTML = '<div class="ship-label-name"></div><div class="ship-label-hull"><div></div></div><div class="ship-label-note"></div>';
        this.layer.append(root);
        el = {
          root,
          name: root.querySelector('.ship-label-name')!,
          bar: root.querySelector('.ship-label-hull > div')!,
          note: root.querySelector('.ship-label-note')!,
        };
        this.labels.set(label.id, el);
      }
      el.root.className = `ship-label faction-${label.faction}`;
      if (el.name.textContent !== label.name) el.name.textContent = label.name;
      if (el.note.textContent !== label.note) el.note.textContent = label.note;
      el.bar.style.width = `${Math.round(label.hull * 100)}%`;

      this.point.set(label.x, label.y, label.z).project(camera);
      const visible = this.point.z < 1 && Math.abs(this.point.x) < 1.1 && Math.abs(this.point.y) < 1.1;
      el.root.hidden = !visible;
      if (visible) {
        const sx = ((this.point.x + 1) / 2) * width;
        const sy = ((1 - this.point.y) / 2) * height;
        el.root.style.transform = `translate(${sx.toFixed(0)}px, ${sy.toFixed(0)}px) translate(-50%, -100%)`;
      }
    }
    for (const [id, el] of this.labels) {
      if (seen.has(id)) continue;
      el.root.remove();
      this.labels.delete(id);
    }
  }
}
