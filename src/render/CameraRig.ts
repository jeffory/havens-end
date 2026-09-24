import { MathUtils, PerspectiveCamera, Vector3 } from 'three';

export interface CameraRigOptions {
  /** Angle below the horizon. 50-60° gives the diorama look without hiding what is behind hills. */
  pitchDeg: number;
  /** Starting heading; 45° gives the classic isometric diagonal. */
  yawDeg: number;
  /** A narrow field of view flattens perspective toward isometric while keeping some depth. */
  fovDeg: number;
  distance: number;
  minDistance: number;
  maxDistance: number;
}

const DEFAULTS: CameraRigOptions = {
  pitchDeg: 52,
  yawDeg: 45,
  fovDeg: 30,
  distance: 90,
  minDistance: 25,
  maxDistance: 150,
};

/**
 * 2.5D follow camera: fixed pitch, heading turns in 90° steps, smooth zoom, and a
 * damped follow of whatever it is told to track (a marker now, the ship or captain later).
 * This is presentation only, so it runs on frame time, not the fixed sim clock.
 */
export class CameraRig {
  readonly camera: PerspectiveCamera;
  /** Smoothed point the camera looks at. */
  readonly focus = new Vector3();
  readonly pitch: number;
  yaw: number;
  distance: number;
  private targetYaw: number;
  private targetDistance: number;
  private framing = false;
  private readonly framedPosition = new Vector3();
  private readonly framedTarget = new Vector3();
  private readonly options: CameraRigOptions;

  constructor(aspect: number, options: Partial<CameraRigOptions> = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.camera = new PerspectiveCamera(this.options.fovDeg, aspect, 1, 2000);
    this.pitch = MathUtils.degToRad(this.options.pitchDeg);
    this.yaw = this.targetYaw = MathUtils.degToRad(this.options.yawDeg);
    this.distance = this.targetDistance = this.options.distance;
  }

  /** Turns the view a quarter circle; -1 is counter-clockwise. */
  rotate(direction: 1 | -1): void {
    this.targetYaw += (direction * Math.PI) / 2;
  }

  /** Mouse-wheel deltas zoom exponentially, so each notch feels the same at any distance. */
  zoom(wheelDelta: number): void {
    const { minDistance, maxDistance } = this.options;
    this.targetDistance = MathUtils.clamp(this.targetDistance * Math.exp(wheelDelta * 0.0012), minDistance, maxDistance);
  }

  /** Jumps straight to the target with no easing (spawns, teleports, loading a save). */
  snapTo(target: Vector3): void {
    this.focus.copy(target);
    this.yaw = this.targetYaw;
    this.distance = this.targetDistance;
    this.place();
  }

  update(target: Vector3, dt: number): void {
    // Frame-rate independent exponential smoothing.
    this.focus.lerp(target, 1 - Math.exp(-6 * dt));
    this.yaw += (this.targetYaw - this.yaw) * (1 - Math.exp(-10 * dt));
    this.distance += (this.targetDistance - this.distance) * (1 - Math.exp(-10 * dt));
    this.place();
  }

  /**
   * Ground-plane unit vectors for "up the screen" and "right on screen" at the current
   * heading, used to make directional input camera-relative.
   */
  groundAxes(): { forwardX: number; forwardZ: number; rightX: number; rightZ: number } {
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    return { forwardX: -s, forwardZ: -c, rightX: c, rightZ: -s };
  }

  /** Eases the camera to an explicit shot (the duel), from wherever it was. */
  frame(position: Vector3, target: Vector3, dt: number): void {
    if (!this.framing) {
      this.framing = true;
      this.framedPosition.copy(this.camera.position);
      this.framedTarget.copy(this.focus);
    }
    const k = 1 - Math.exp(-4 * dt);
    this.framedPosition.lerp(position, k);
    this.framedTarget.lerp(target, k);
    this.camera.position.copy(this.framedPosition);
    this.camera.lookAt(this.framedTarget);
  }

  /** Back to following the ship. */
  release(): void {
    this.framing = false;
    this.place();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  private place(): void {
    const horizontal = this.distance * Math.cos(this.pitch);
    this.camera.position.set(
      this.focus.x + Math.sin(this.yaw) * horizontal,
      this.focus.y + this.distance * Math.sin(this.pitch),
      this.focus.z + Math.cos(this.yaw) * horizontal,
    );
    this.camera.lookAt(this.focus);
  }
}
