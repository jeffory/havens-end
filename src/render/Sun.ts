import { Color, DirectionalLight, HemisphereLight, type Scene, Vector3 } from 'three';
import { darkness, DAYLIGHT, sunHeight } from '../core/clock';
import { smoothstep } from '../util/math';

const SHADOW_MAP_SIZE = 2048;
const LIGHT_DISTANCE = 200;
const SUN_INTENSITY = 2.4;
const MOON_INTENSITY = 1.1;
const SKY_INTENSITY = 1.4;
const NIGHT_SKY_INTENSITY = 1.15;
/** The sun's direction only moves in steps this big (radians), so shadows don't crawl. */
const SUN_STEP = (0.75 * Math.PI) / 180;

const COLORS = {
  sunHigh: new Color(0xfff0d6),
  sunLow: new Color(0xffa860),
  moon: new Color(0x9fb4ff),
  skyDay: new Color(0xd4ecff),
  skyNight: new Color(0x6f86c8),
  groundDay: new Color(0x6b7f56),
  groundNight: new Color(0x2c3548),
  /** The background and fog. */
  day: new Color(0xa9d9ea),
  dusk: new Color(0xe8a47e),
  night: new Color(0x0c1630),
  storm: new Color(0x74879a),
};
/** The moon rides high in the north-west all night. */
const MOON = new Vector3(-0.35, 0.85, -0.4).normalize();

/**
 * Sun and sky light. The shadow frustum follows the camera focus and scales with zoom;
 * it moves in whole shadow-map texels so voxel edges don't crawl as the camera pans.
 */
export class Sun {
  readonly light = new DirectionalLight(0xfff0d6, SUN_INTENSITY);
  readonly sky = new HemisphereLight(0xd4ecff, 0x6b7f56, SKY_INTENSITY);
  /** Unit vector pointing from the ground toward the sun (or the moon, by night). */
  private readonly toSun = new Vector3(-0.5, 0.78, 0.38).normalize();
  private readonly wanted = new Vector3();
  /** Background and fog colour for the time of day and the weather. */
  readonly skyColor = new Color();
  // Axes of the shadow camera, which looks along -toSun.
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly snapped = new Vector3();
  private halfExtent = 0;

  constructor(scene: Scene) {
    this.aim();

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

  /**
   * Lights the scene for the time of day and the weather: the sun rising in the east and
   * setting in the west, warm and low at either end; the moon's cold light by night.
   * `overcast` 0 is a clear sky, 1 the heart of a squall.
   */
  setSky(phase: number, overcast: number): void {
    const h = sunHeight(phase);
    const dark = darkness(phase);
    const day = smoothstep(-0.05, 0.35, h);
    if (h > 0.02) {
      // East (+x) at sunrise, overhead and a little south at noon, west (-x) at sunset.
      const a = Math.round(((Math.PI * phase) / DAYLIGHT) / SUN_STEP) * SUN_STEP;
      this.wanted.set(Math.cos(a) * 0.95, Math.max(0.2, Math.sin(a)), 0.35).normalize();
      this.light.color.lerpColors(COLORS.sunLow, COLORS.sunHigh, smoothstep(0.05, 0.5, h));
      this.light.intensity = SUN_INTENSITY * day * (1 - 0.45 * overcast);
    } else {
      this.wanted.copy(MOON);
      this.light.color.copy(COLORS.moon);
      this.light.intensity = MOON_INTENSITY * dark * (1 - 0.5 * overcast);
    }
    if (!this.wanted.equals(this.toSun)) {
      this.toSun.copy(this.wanted);
      this.aim();
    }
    this.sky.color.lerpColors(COLORS.skyNight, COLORS.skyDay, 1 - dark);
    this.sky.groundColor.lerpColors(COLORS.groundNight, COLORS.groundDay, 1 - dark);
    this.sky.intensity = (NIGHT_SKY_INTENSITY + (SKY_INTENSITY - NIGHT_SKY_INTENSITY) * (1 - dark)) * (1 - 0.2 * overcast);

    // The sky: blue by day, navy by night, reddened near the horizon at dusk and dawn, grey in a squall.
    this.skyColor.lerpColors(COLORS.night, COLORS.day, 1 - dark);
    this.skyColor.lerp(COLORS.dusk, Math.exp(-((h / 0.16) ** 2)) * 0.55);
    this.skyColor.lerp(COLORS.storm, overcast * (1 - 0.7 * dark));
  }

  /** The shadow camera's axes, square to the light. */
  private aim(): void {
    this.right.crossVectors(new Vector3(0, 1, 0), this.toSun).normalize();
    this.up.crossVectors(this.toSun, this.right);
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

