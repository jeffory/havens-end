import { type BufferGeometry, Group, Mesh, MeshLambertMaterial } from 'three';
import { buildSettlerModel } from '../duel/settlerModel';
import type { CreatureKind } from '../land/creatures';
import type { Land } from '../land/Land';
import { indoors, JOB_LABELS, type Settler } from '../land/settlers';
import type { WorldLabel } from '../ui/WorldLabels';
import { paletteFromRgba } from '../voxel/palette';
import { CharacterView } from './CharacterView';
import { type HeldModel, heldCells } from './toolModels';
import { meshCells } from './voxelGeometry';

/** Settlers and creatures further than this from the view aren't drawn. */
const DRAW_RANGE = 110;
/** Names show over settlers this close to the captain. */
const NAME_RANGE = 7;
/** Creature voxels, in world units. */
const CREATURE_SCALE = 0.12;

const TOOL: Record<Settler['job'], HeldModel | null> = { idle: null, farmer: 'hoe', woodcutter: 'axe', miner: 'pickaxe', fisher: 'rod', worker: 'hammer' };

interface Figure {
  view: CharacterView;
  held: HeldModel | null;
}

/**
 * The people and animals on land besides the captain: settlers going about their work,
 * and the night's creatures. Presentation only: it draws what the `Land` says.
 */
export class PeopleView {
  readonly group = new Group();
  private readonly figures = new Map<number, Figure>();
  private readonly beasts = new Map<number, Mesh>();
  private readonly creatureMaterial = new MeshLambertMaterial({ vertexColors: true });
  private readonly shapes: Record<CreatureKind, BufferGeometry> = { crab: creatureShape('crab'), boar: creatureShape('boar') };

  constructor() {
    this.group.name = 'people';
  }

  update(land: Land, alpha: number, dt: number, time: number, focus: { x: number; z: number }): void {
    const seen = new Set<number>();
    for (const s of land.settlers) {
      const w = s.walker;
      const x = w.prev.x + (w.x - w.prev.x) * alpha;
      const y = w.prev.y + (w.y - w.prev.y) * alpha;
      const z = w.prev.z + (w.z - w.prev.z) * alpha;
      if (indoors(s) || Math.hypot(x - focus.x, z - focus.z) > DRAW_RANGE) continue;
      seen.add(s.id);
      let figure = this.figures.get(s.id);
      if (!figure) {
        figure = { view: new CharacterView(buildSettlerModel(s.look)), held: null };
        figure.view.hold(null);
        figure.view.lift(0.05);
        this.figures.set(s.id, figure);
        this.group.add(figure.view.root);
      }
      const held = TOOL[s.job];
      if (held !== figure.held) {
        figure.held = held;
        figure.view.hold(held ? heldCells(held) : null);
      }
      const root = figure.view.root;
      root.position.set(x, y, z);
      root.rotation.y = w.facing;
      const t = s.task;
      const busy = t.kind === 'harvest' || t.kind === 'plant' || t.kind === 'fell' || t.kind === 'mine' || t.kind === 'work';
      const rate = t.kind === 'fell' || t.kind === 'mine' ? 1.3 : t.kind === 'work' ? 1.1 : 1.6;
      figure.view.walk(
        {
          speed: Math.hypot(w.vx, w.vz),
          swing: busy ? (time * rate + s.id * 0.37) % 1 : null,
          lying: t.kind === 'sleep',
          fishing: t.kind === 'fish',
        },
        dt,
        time,
      );
    }
    for (const [id, figure] of this.figures) {
      if (seen.has(id)) continue;
      this.group.remove(figure.view.root);
      figure.view.dispose();
      this.figures.delete(id);
    }

    const alive = new Set<number>();
    for (const c of land.creatures) {
      alive.add(c.id);
      let mesh = this.beasts.get(c.id);
      if (!mesh) {
        mesh = new Mesh(this.shapes[c.kind], this.creatureMaterial);
        mesh.castShadow = true;
        mesh.scale.setScalar(CREATURE_SCALE);
        this.beasts.set(c.id, mesh);
        this.group.add(mesh);
      }
      const w = c.walker;
      const moving = Math.hypot(w.vx, w.vz) > 0.2;
      const bob = moving ? Math.abs(Math.sin(time * (c.kind === 'crab' ? 18 : 12) + c.id)) * 0.08 : 0;
      mesh.position.set(w.prev.x + (w.x - w.prev.x) * alpha, w.prev.y + (w.y - w.prev.y) * alpha + bob, w.prev.z + (w.z - w.prev.z) * alpha);
      // Crabs scuttle sideways.
      mesh.rotation.y = w.facing + (c.kind === 'crab' ? Math.PI / 2 : 0);
    }
    for (const [id, mesh] of this.beasts) {
      if (alive.has(id)) continue;
      this.group.remove(mesh);
      this.beasts.delete(id);
    }
  }

  /** Names over the settlers close to the captain. */
  labels(land: Land, captain: { x: number; z: number } | null): WorldLabel[] {
    if (!captain) return [];
    return land.settlers
      .filter((s) => !indoors(s) && Math.hypot(s.walker.x - captain.x, s.walker.z - captain.z) < NAME_RANGE)
      .map((s) => ({ id: `settler-${s.id}`, x: s.walker.x, y: s.walker.y + 2.3, z: s.walker.z, text: `${s.name} · ${s.hungry > 0 ? 'hungry' : JOB_LABELS[s.job].toLowerCase()}` }));
  }
}

/** A crab or a boar in voxels, centred on its feet and facing +z. */
function creatureShape(kind: CreatureKind): BufferGeometry {
  const palette = new Uint8Array(256 * 4);
  const cells: number[] = [];
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: number) => {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) cells.push(x, y, z, c);
  };
  if (kind === 'crab') {
    palette.set([214, 84, 44, 255], 4);
    palette.set([160, 52, 30, 255], 8);
    palette.set([20, 20, 20, 255], 12);
    box(-3, 3, 1, 2, -2, 2, 1); // shell
    box(-2, 2, 3, 3, -1, 1, 1);
    for (const x of [-4, 4]) box(x, x, 0, 1, -2, 2, 2); // legs
    box(-5, -4, 1, 3, 3, 4, 2); // claws
    box(4, 5, 1, 3, 3, 4, 2);
    box(-1, -1, 3, 4, 2, 2, 3); // eyes on stalks
    box(1, 1, 3, 4, 2, 2, 3);
  } else {
    palette.set([74, 58, 46, 255], 4);
    palette.set([50, 38, 30, 255], 8);
    palette.set([236, 226, 200, 255], 12);
    palette.set([120, 88, 72, 255], 16);
    box(-2, 2, 3, 7, -4, 4, 1); // body
    box(-1, 1, 8, 8, -4, 3, 2); // bristles along the back
    box(-2, 2, 3, 6, 5, 7, 1); // head
    box(-1, 1, 3, 4, 8, 9, 4); // snout
    box(-2, -2, 4, 5, 8, 8, 3); // tusks
    box(2, 2, 4, 5, 8, 8, 3);
    for (const x of [-2, 2]) for (const z of [-3, 3]) box(x, x, 0, 2, z, z, 2); // legs
  }
  const geometry = meshCells(Int32Array.from(cells), paletteFromRgba(palette));
  geometry.translate(-0.5, 0, -0.5);
  return geometry;
}
