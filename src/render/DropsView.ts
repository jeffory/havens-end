import { type BufferGeometry, Group, Mesh, MeshLambertMaterial } from 'three';
import type { Good } from '../economy/goods';
import type { Drop } from '../land/drops';
import { ICON_SIZE, ICONS, iconGeometry, SACK } from './itemIcons';

/** An item is this wide, in world units. */
const SIZE = 0.5;
/** Items further than this from the view aren't drawn. */
const DRAW_RANGE = 90;
/** Turns per second, in radians. */
const SPIN = 2.2;
/** A pile shows as up to this many, one behind another. */
const PILE = 3;

/**
 * What's lying about on land: little pixel-art pictures, cut out one voxel deep, that
 * turn slowly and bob where they lie. Presentation only: it draws the `Land`'s drops.
 */
export class DropsView {
  readonly group = new Group();
  private readonly shown = new Map<number, Group>();
  private readonly material = new MeshLambertMaterial({ vertexColors: true });
  private readonly shapes = new Map<Good, BufferGeometry>();

  constructor() {
    this.group.name = 'drops';
  }

  update(drops: readonly Drop[], alpha: number, time: number, focus: { x: number; z: number }): void {
    const seen = new Set<number>();
    for (const d of drops) {
      const x = d.prev.x + (d.x - d.prev.x) * alpha;
      const y = d.prev.y + (d.y - d.prev.y) * alpha;
      const z = d.prev.z + (d.z - d.prev.z) * alpha;
      if (Math.hypot(x - focus.x, z - focus.z) > DRAW_RANGE) continue;
      seen.add(d.id);
      const copies = Math.min(PILE, d.amount);
      let item = this.shown.get(d.id);
      if (!item || item.children.length !== copies) {
        if (item) this.group.remove(item);
        item = this.item(d.good, copies);
        this.shown.set(d.id, item);
        this.group.add(item);
      }
      const bob = d.still ? 0.08 + Math.sin(time * 2.6 + d.id) * 0.06 : 0;
      item.position.set(x, y + SIZE / 2 + 0.04 + bob, z);
      item.rotation.y = time * SPIN + d.id * 1.3;
    }
    for (const [id, item] of this.shown) {
      if (seen.has(id)) continue;
      this.group.remove(item);
      this.shown.delete(id);
    }
  }

  /** One of these (or a little pile of them). */
  private item(good: Good, copies: number): Group {
    let shape = this.shapes.get(good);
    if (!shape) {
      shape = iconGeometry(ICONS[good] ?? SACK);
      this.shapes.set(good, shape);
    }
    const item = new Group();
    item.scale.setScalar(SIZE / ICON_SIZE);
    for (let i = 0; i < copies; i++) {
      const mesh = new Mesh(shape, this.material);
      mesh.castShadow = true;
      mesh.position.set(i * 2, i * 1.5, -i * 1.5);
      item.add(mesh);
    }
    return item;
  }
}
