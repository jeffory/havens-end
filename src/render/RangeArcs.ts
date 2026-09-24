import { BoxGeometry, Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshBasicMaterial } from 'three';
import { landingDistance } from '../combat/ammo';
import { reloadTime, type Side, type Vessel } from '../combat/vessel';

const DOTS_PER_SIDE = 15;
const HALF_ARC = (10 * Math.PI) / 180;
const COLORS = { round: new Color(0xfff2d6), chain: new Color(0x9fd4ff), grape: new Color(0xffb09a) } as const;
const DIM = new Color(0x3c5a78);

/**
 * Where the player's broadsides will land: a row of dots on the water at full range,
 * off each beam. The dots light up from the middle outward as that side reloads, in
 * the colour of the loaded shot. Lives in the ship's frame, so it turns with her.
 */
export class RangeArcs {
  readonly mesh: InstancedMesh;
  private readonly matrix = new Matrix4();
  private readonly color = new Color();

  constructor() {
    this.mesh = new InstancedMesh(
      new BoxGeometry(0.45, 0.12, 0.45),
      new MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false }),
      DOTS_PER_SIDE * 2,
    );
    this.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(DOTS_PER_SIDE * 2 * 3), 3);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.renderOrder = 1; // after the transparent ocean
    this.mesh.frustumCulled = false;
    this.mesh.position.y = 0.55;
  }

  update(player: Vessel): void {
    this.mesh.visible = player.status === 'afloat' && player.cls.type.gunsPerSide > 0;
    if (!this.mesh.visible) return;
    const range = landingDistance(player.ammo, player.cls.body.deck - 0.7);
    const loaded = COLORS[player.ammo];
    (['port', 'starboard'] as Side[]).forEach((side, s) => {
      const sign = side === 'port' ? 1 : -1;
      const progress = 1 - player.reload[side] / reloadTime(player);
      for (let i = 0; i < DOTS_PER_SIDE; i++) {
        const t = i / (DOTS_PER_SIDE - 1) - 0.5; // -0.5 .. 0.5 along the arc
        const angle = t * 2 * HALF_ARC;
        // Port is local +x; the arc sweeps fore and aft around the beam.
        this.matrix.makeTranslation(sign * Math.cos(angle) * range, 0, Math.sin(angle) * range);
        this.mesh.setMatrixAt(s * DOTS_PER_SIDE + i, this.matrix);
        const lit = player.reload[side] <= 0 || Math.abs(t) * 2 <= progress;
        this.mesh.setColorAt(s * DOTS_PER_SIDE + i, lit ? (player.reload[side] <= 0 ? loaded : this.color.copy(loaded).lerp(DIM, 0.5)) : DIM);
      }
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }
}
