import { Group } from 'three';
import type { Sea } from '../combat/sea';
import type { Faction } from '../combat/vessel';
import { WATER_LEVEL } from '../ocean/waves';
import type { ShipModel } from '../sailing/shipModel';
import type { ShipType } from '../sailing/ships';
import { wrapAngle } from '../util/math';
import type { Effects } from './Effects';
import type { RangeArcs } from './RangeArcs';
import { type Livery, type ShipPose, ShipView } from './ShipView';
import type { WakePool } from './Wake';

/** Flag colours by faction. The player flies the flag as it was drawn. */
export const LIVERIES: Record<Faction, Livery | undefined> = {
  player: undefined,
  imperial: { field: 0xa51d24, emblem: 0xf2c14e },
  merchant: { field: 0xf1efe6, emblem: 0x2b5da8 },
  pirate: { field: 0x5a1414, emblem: 0x141414 },
};

/** One ShipView per vessel afloat: created when a ship appears, disposed when she's gone. */
export class FleetView {
  readonly group = new Group();
  private readonly views = new Map<number, ShipView>();
  private readonly poses = new Map<number, ShipPose>();

  constructor(
    private readonly models: Map<ShipType, ShipModel>,
    private readonly wakes: WakePool,
    private readonly effects: Effects,
    private readonly arcs: RangeArcs,
  ) {
    this.group.name = 'fleet';
  }

  view(id: number): ShipView | undefined {
    return this.views.get(id);
  }

  /** Where a vessel is drawn this frame (interpolated). */
  pose(id: number): ShipPose | undefined {
    return this.poses.get(id);
  }

  update(sea: Sea, alpha: number, time: number, frameSeconds: number): void {
    const alive = new Set<number>();
    for (const v of sea.vessels) {
      alive.add(v.id);
      let view = this.views.get(v.id);
      if (!view) {
        view = new ShipView(this.models.get(v.cls.type)!, LIVERIES[v.faction]);
        this.views.set(v.id, view);
        this.group.add(view.root);
        if (v.faction === 'player') view.root.add(this.arcs.mesh);
      }

      let pose = this.poses.get(v.id);
      if (!pose) this.poses.set(v.id, (pose = { x: 0, z: 0, heading: 0 }));
      pose.x = v.prev.x + (v.ship.x - v.prev.x) * alpha;
      pose.z = v.prev.z + (v.ship.z - v.prev.z) * alpha;
      pose.heading = v.prev.heading + wrapAngle(v.ship.heading - v.prev.heading) * alpha;
      view.update(pose, v.ship, sea.weather.windAt(pose.x, pose.z, time), time, frameSeconds, v.status, v.fate);

      const fx = Math.sin(pose.heading);
      const fz = Math.cos(pose.heading);
      if (v.ship.surge > 1 && v.status !== 'sinking') {
        const stern = v.cls.body.stern;
        this.wakes.trail(v.id, time, pose.x + fx * stern, pose.z + fz * stern, 0.45 + (0.55 * v.ship.surge) / v.cls.type.topSpeed);
      }
      if (v.status === 'sinking' && Math.random() < frameSeconds * 12) {
        const along = v.cls.body.stern + Math.random() * (v.cls.body.bow - v.cls.body.stern);
        this.effects.emit('bubbles', pose.x + fx * along, WATER_LEVEL + 0.3, pose.z + fz * along);
      }
    }

    for (const [id, view] of this.views) {
      if (alive.has(id)) continue;
      this.group.remove(view.root);
      view.dispose();
      this.views.delete(id);
      this.poses.delete(id);
      this.wakes.forget(id);
    }
  }
}

