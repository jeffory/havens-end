import { BoxGeometry, Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Vector3 } from 'three';

const CAPACITY = 900;

interface Burst {
  count: number;
  color: number;
  /** A second colour to mix in at random (e.g. flame and smoke). */
  alt?: number;
  size: [number, number];
  speed: [number, number];
  /** Upward bias added to each particle's launch velocity. */
  lift: number;
  life: [number, number];
  gravity: number;
  /** Fraction of speed kept per second (smoke drags, splinters don't). */
  drag: number;
  /** Size grows to this multiple over the particle's life (smoke billows). */
  grow: number;
}

const BURSTS = {
  smoke: { count: 7, color: 0xe4e1da, alt: 0xc6c2ba, size: [0.45, 0.8], speed: [2, 5], lift: 1.8, life: [1.2, 2.2], gravity: -1.2, drag: 0.35, grow: 2 },
  flash: { count: 3, color: 0xffd36b, alt: 0xff8a2a, size: [0.5, 0.8], speed: [1, 3], lift: 0, life: [0.08, 0.16], gravity: 0, drag: 1, grow: 1.5 },
  splash: { count: 12, color: 0xf2fbff, alt: 0x9fe3f0, size: [0.25, 0.5], speed: [1, 3], lift: 6.5, life: [0.6, 1.1], gravity: 18, drag: 0.9, grow: 1 },
  splinters: { count: 9, color: 0x7a5230, alt: 0xb58a57, size: [0.15, 0.35], speed: [3, 7], lift: 3, life: [0.6, 1.1], gravity: 16, drag: 0.8, grow: 1 },
  dust: { count: 8, color: 0xd9c38e, alt: 0x8f9193, size: [0.25, 0.5], speed: [1.5, 4], lift: 3, life: [0.6, 1.2], gravity: 10, drag: 0.6, grow: 1.4 },
  fire: { count: 22, color: 0xffb13b, alt: 0xff5a1f, size: [0.5, 1.1], speed: [3, 9], lift: 4, life: [0.3, 0.7], gravity: 2, drag: 0.4, grow: 1.6 },
  blackSmoke: { count: 14, color: 0x3d3a36, alt: 0x5c5852, size: [1, 1.8], speed: [1, 4], lift: 2.5, life: [1.8, 3], gravity: -0.8, drag: 0.3, grow: 2.4 },
  sparks: { count: 10, color: 0xfff3c4, alt: 0xffc94d, size: [0.05, 0.1], speed: [3, 7], lift: 1.5, life: [0.12, 0.3], gravity: 12, drag: 0.5, grow: 1 },
  parrySparks: { count: 22, color: 0xffe066, alt: 0xffffff, size: [0.07, 0.14], speed: [4, 9], lift: 2, life: [0.2, 0.45], gravity: 10, drag: 0.4, grow: 1 },
  wound: { count: 8, color: 0xd9412f, alt: 0xff8a5c, size: [0.05, 0.1], speed: [2, 5], lift: 1.5, life: [0.2, 0.4], gravity: 14, drag: 0.6, grow: 1 },
  bubbles: { count: 3, color: 0xe8f7fb, size: [0.2, 0.45], speed: [0.2, 1], lift: 1.5, life: [0.5, 1], gravity: -1, drag: 0.8, grow: 1 },
  leaves: { count: 2, color: 0x4f8a36, alt: 0x7cb44e, size: [0.07, 0.15], speed: [0.4, 1.4], lift: 0.8, life: [1.3, 2.4], gravity: 2.5, drag: 0.5, grow: 1 },
} satisfies Record<string, Burst>;

export type BurstKind = keyof typeof BURSTS;

/**
 * Cosmetic voxel particles: gun smoke, splashes, splinters, explosions. One instanced
 * mesh, a fixed pool; the oldest particles are recycled when it's full.
 */
export class Effects {
  readonly mesh: InstancedMesh;
  private readonly pos = new Float32Array(CAPACITY * 3);
  private readonly vel = new Float32Array(CAPACITY * 3);
  private readonly age = new Float32Array(CAPACITY).fill(1);
  private readonly life = new Float32Array(CAPACITY).fill(1);
  private readonly size = new Float32Array(CAPACITY);
  private readonly gravity = new Float32Array(CAPACITY);
  private readonly drag = new Float32Array(CAPACITY);
  private readonly grow = new Float32Array(CAPACITY);
  private next = 0;
  private readonly matrix = new Matrix4();
  private readonly v = new Vector3();
  private readonly s = new Vector3();
  private readonly q = new Quaternion();
  private readonly color = new Color();

  constructor() {
    this.mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshLambertMaterial(), CAPACITY);
    this.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'effects';
    this.matrix.makeScale(0, 0, 0);
    for (let i = 0; i < CAPACITY; i++) this.mesh.setMatrixAt(i, this.matrix);
  }

  /** Spawns a burst at (x, y, z), thrown mostly along (dirX, dirZ) if given, otherwise in all directions. */
  emit(kind: BurstKind, x: number, y: number, z: number, dirX = 0, dirZ = 0, scale = 1): void {
    const b: Burst = BURSTS[kind];
    const count = Math.round(b.count * scale);
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (i + 1) % CAPACITY;
      const angle = Math.random() * Math.PI * 2;
      const speed = lerp(b.speed, Math.random()) * scale;
      const spread = dirX || dirZ ? 0.45 : 1;
      this.pos.set([x, y, z], i * 3);
      this.vel.set(
        [
          dirX * speed + Math.cos(angle) * speed * spread,
          b.lift * (0.6 + Math.random() * 0.8) * Math.sqrt(scale),
          dirZ * speed + Math.sin(angle) * speed * spread,
        ],
        i * 3,
      );
      this.age[i] = 0;
      this.life[i] = lerp(b.life, Math.random());
      this.size[i] = lerp(b.size, Math.random()) * Math.sqrt(scale);
      this.gravity[i] = b.gravity;
      this.drag[i] = b.drag;
      this.grow[i] = b.grow;
      this.color.set(b.alt !== undefined && Math.random() < 0.4 ? b.alt : b.color);
      this.mesh.setColorAt(i, this.color);
    }
    this.mesh.instanceColor!.needsUpdate = true;
  }

  update(dt: number): void {
    for (let i = 0; i < CAPACITY; i++) {
      if (this.age[i] >= this.life[i]) continue;
      this.age[i] += dt;
      const t = Math.min(1, this.age[i] / this.life[i]);
      const k = i * 3;
      const keep = this.drag[i] ** dt;
      this.vel[k] *= keep;
      this.vel[k + 2] *= keep;
      this.vel[k + 1] = this.vel[k + 1] * keep - this.gravity[i] * dt;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      // Grow (smoke billows), then shrink away at the end instead of fading: no transparency sorting.
      const size = t >= 1 ? 0 : this.size[i] * (1 + (this.grow[i] - 1) * t) * Math.min(1, (1 - t) * 4);
      this.v.set(this.pos[k], this.pos[k + 1], this.pos[k + 2]);
      this.s.set(size, size, size);
      this.mesh.setMatrixAt(i, this.matrix.compose(this.v, this.q, this.s));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const lerp = ([a, b]: readonly [number, number], t: number) => a + (b - a) * t;
