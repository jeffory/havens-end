import { DirectionalLight, HemisphereLight, type Scene, Vector3 } from 'three';

const SHADOW_MAP_SIZE = 2048;
const LIGHT_DISTANCE = 200;

/**
 * Sun and sky light. The shadow frustum follows the camera focus and scales with zoom;
 * it moves in whole shadow-map texels so voxel edges don't crawl as the camera pans.
 */
export class Sun {
  readonly light = new DirectionalLight(0xfff0d6, 2.4);
  readonly sky = new HemisphereLight(0xd4ecff, 0x6b7f56, 1.4);
  /** Unit vector pointing from the ground toward the sun. */
  private readonly toSun = new Vector3(-0.5, 0.78, 0.38).normalize();
  // Axes of the shadow camera, which looks along -toSun.
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly snapped = new Vector3();
  private halfExtent = 0;

  constructor(scene: Scene) {
    this.right.crossVectors(new Vector3(0, 1, 0), this.toSun).normalize();
    this.up.crossVectors(this.toSun, this.right);

    const shadow = this.light.shadow;
    shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    shadow.camera.near = 1;
    shadow.camera.far = LIGHT_DISTANCE * 2;
    shadow.bias = -0.0004;
    shadow.normalBias = 0.04;
    shadow.radius = 2;
    this.light.castShadow = true;

    scene.add(this.light, this.light.target, this.sky);
  }

  follow(focus: Vector3, cameraDistance: number): void {
    // Cover the visible ground; step the size so zooming doesn't resize the shadow map every frame.
    const halfExtent = Math.ceil((cameraDistance * 1.05) / 8) * 8;
    if (halfExtent !== this.halfExtent) {
      this.halfExtent = halfExtent;
      const cam = this.light.shadow.camera;
      cam.left = cam.bottom = -halfExtent;
      cam.right = cam.top = halfExtent;
      cam.updateProjectionMatrix();
    }

    const texel = (2 * halfExtent) / SHADOW_MAP_SIZE;
    const snap = (v: number) => Math.round(v / texel) * texel;
    this.snapped
      .copy(this.right).multiplyScalar(snap(focus.dot(this.right)))
      .addScaledVector(this.up, snap(focus.dot(this.up)))
      .addScaledVector(this.toSun, focus.dot(this.toSun));

    this.light.target.position.copy(this.snapped);
    this.light.position.copy(this.snapped).addScaledVector(this.toSun, LIGHT_DISTANCE);
    this.light.target.updateMatrixWorld();
  }
}
