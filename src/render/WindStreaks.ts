import { BoxGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import { WATER_LEVEL } from '../ocean/waves';
import type { Weather } from '../sailing/weather';

const COUNT = 90;
/** Drift speed in u/s per unit of wind strength. */
const DRIFT = 14;
const HEIGHT = WATER_LEVEL + 1.4;

interface Streak {
  x: number;
  z: number;
  age: number;
  life: number;
}

/**
 * Short white dashes that drift with the local wind: many and quick in a squall,
 * few and lazy in a calm. The quickest way to read the regional weather at a glance.
 */
export class WindStreaks {
  readonly mesh: InstancedMesh;
  private readonly streaks: Streak[] = Array.from({ length: COUNT }, () => ({ x: 0, z: 0, age: 1, life: 0 }));
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly scale = new Vector3();
  private readonly up = new Vector3(0, 1, 0);

  constructor(private readonly weather: Weather) {
    this.mesh = new InstancedMesh(
      new BoxGeometry(0.12, 0.05, 1),
      new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }),
      COUNT,
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1; // after the ocean, which is transparent too and would paint over it
    this.mesh.name = 'wind-streaks';
  }

  update(focus: Vector3, radius: number, time: number, frameSeconds: number): void {
    const here = this.weather.windAt(focus.x, focus.z, time);
    // Stronger wind: more streaks alive at once.
    const spawnChance = Math.min(1, 0.15 + here.strength * 0.6) * frameSeconds * 1.5;

    for (let i = 0; i < COUNT; i++) {
      const streak = this.streaks[i];
      if (streak.age >= streak.life) {
        this.scale.set(0, 0, 0);
        this.mesh.setMatrixAt(i, this.matrix.compose(this.position, this.rotation, this.scale));
        if (Math.random() < spawnChance) {
          const angle = Math.random() * Math.PI * 2;
          const distance = Math.sqrt(Math.random()) * radius;
          streak.x = focus.x + Math.cos(angle) * distance;
          streak.z = focus.z + Math.sin(angle) * distance;
          streak.age = 0;
          streak.life = 1.2 + Math.random() * 1.8;
        }
        continue;
      }

      const wind = this.weather.windAt(streak.x, streak.z, time);
      streak.x += wind.dirX * wind.strength * DRIFT * frameSeconds;
      streak.z += wind.dirZ * wind.strength * DRIFT * frameSeconds;
      streak.age += frameSeconds;

      // Grow in, then shrink out; longer in stronger wind.
      const envelope = Math.sin((Math.PI * streak.age) / streak.life);
      const length = (1.5 + wind.strength * 3) * envelope;
      this.position.set(streak.x, HEIGHT, streak.z);
      this.rotation.setFromAxisAngle(this.up, Math.atan2(wind.dirX, wind.dirZ));
      this.scale.set(1, 1, Math.max(0.001, length));
      this.mesh.setMatrixAt(i, this.matrix.compose(this.position, this.rotation, this.scale));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
