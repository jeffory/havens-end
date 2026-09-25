import { BoxGeometry, DoubleSide, EdgesGeometry, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, RingGeometry } from 'three';
import type { CharacterModel } from '../duel/characterModel';
import type { Walker } from '../land/walker';
import { CharacterView } from './CharacterView';
import { type HeldModel, heldCells } from './toolModels';

const OK = 0xfff4d6;
const NO = 0xff5a4a;
/** The ring at the captain's feet: a light band on a dark one, so it shows on sand and paving alike. */
const RING_LIGHT = 0xfff4d6;
const RING_DARK = 0x1c140c;
/** The ring keeps its size on screen out to this camera distance, and grows with it beyond, to this many times at most (a pin takes over further out). */
const RING_NEAR = 24;
const RING_MOST = 2;

/**
 * The captain on foot, the cell their tool would work (a wireframe box), and a ghost
 * of the building being placed. Presentation only: it draws what the `Land` says.
 */
export class LandView {
  readonly group = new Group();
  readonly captain: CharacterView;
  private readonly marker: LineSegments<EdgesGeometry, LineBasicMaterial>;
  private readonly ghost: Mesh<BoxGeometry, MeshBasicMaterial>;
  private held: HeldModel | null = null;
  /** Where the captain stands, at a glance: they're dark, and easy to lose against roofs and paving. */
  private readonly ring = new Group();

  constructor(model: CharacterModel) {
    this.captain = new CharacterView(model);
    this.captain.hold(null);
    this.captain.lift(0.05);
    this.marker = new LineSegments(new EdgesGeometry(new BoxGeometry(1.04, 1.04, 1.04)), new LineBasicMaterial({ color: OK, transparent: true, opacity: 0.9 }));
    this.marker.renderOrder = 2;
    this.ghost = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: OK, transparent: true, opacity: 0.35, depthWrite: false }));
    this.ghost.renderOrder = 2;
    const band = (inner: number, outer: number, color: number, opacity: number) => {
      const mesh = new Mesh(new RingGeometry(inner, outer, 32), new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: DoubleSide }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 3;
      return mesh;
    };
    this.ring.add(band(0.55, 0.95, RING_DARK, 0.35), band(0.64, 0.82, RING_LIGHT, 0.85));
    this.group.add(this.captain.root, this.marker, this.ghost, this.ring);
    this.group.name = 'land';
    this.setVisible(false);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  /** Places and poses the captain (interpolated between sim steps). */
  update(w: Walker, alpha: number, held: HeldModel, swing: number | null, dt: number, time: number): void {
    const x = w.prev.x + (w.x - w.prev.x) * alpha;
    const y = w.prev.y + (w.y - w.prev.y) * alpha;
    const z = w.prev.z + (w.z - w.prev.z) * alpha;
    const root = this.captain.root;
    root.position.set(x, y, z);
    this.ring.position.set(x, y + 0.06, z);
    root.rotation.y = w.facing;
    if (held !== this.held) {
      this.held = held;
      this.captain.hold(heldCells(held));
    }
    this.captain.walk({ speed: Math.hypot(w.vx, w.vz), swing }, dt, time);
  }

  /** Sizes the ring at the captain's feet for the camera's distance, so it stays findable zoomed out. */
  setCameraDistance(distance: number): void {
    this.ring.scale.setScalar(Math.min(RING_MOST, Math.max(1, distance / RING_NEAR)));
  }

  /** The cell a tool would work, green-white if it can, red if not; null hides it. */
  mark(cell: { x: number; y: number; z: number; ok: boolean } | null): void {
    this.marker.visible = cell !== null;
    if (!cell) return;
    this.marker.position.set(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5);
    this.marker.material.color.setHex(cell.ok ? OK : NO);
  }

  /** A building's plot while placing it: its footprint as a translucent block. */
  showGhost(plot: { x0: number; z0: number; w: number; d: number; y: number; height: number; ok: boolean } | null): void {
    this.ghost.visible = plot !== null;
    if (!plot) return;
    this.ghost.scale.set(plot.w, plot.height, plot.d);
    this.ghost.position.set(plot.x0 + plot.w / 2, plot.y + plot.height / 2, plot.z0 + plot.d / 2);
    this.ghost.material.color.setHex(plot.ok ? 0x7ee07a : NO);
  }
}
