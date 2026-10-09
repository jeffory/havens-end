import { Color, Vector2, Vector4 } from 'three';

/** At most this many lifted at once (the terrain shader's limit). */
export const MAX_LIFTS = 12;

/** A lift not in use sits under a height nothing reaches. */
const NEVER = 1e6;
/** Lamplight in a lifted room after dark: warm, and enough that its walls read as walls. */
const ROOM_LIGHT = new Color(0xffb36b).multiplyScalar(0.6);
/** The top of a cut, where what was over it is lifted away: a dark timber plate, on every building and prop alike. */
export const CAP_COLOR = 0x5b3f29;
/** A prop's face lying on a cut (the top of a counter one course high) stays. */
const ON_CUT = 0.01;

/**
 * A box lifted away: on the grid from (x0, z0) up to but not including (x1, z1), everything
 * a tree or building has above `from`.
 */
export interface Lift {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  from: number;
  /**
   * A building's room: its walls' footprint (on the grid, as the box), and the height its walls
   * facing the camera lift from, one course above the floor, so the room shows from the camera
   * as a doll's house does. Whatever stands in front of those walls lifts from there too.
   */
  room?: { x0: number; z0: number; x1: number; z1: number; front: number };
}

/** Where the camera is, across the ground. */
export interface Eye {
  x: number;
  z: number;
}

/**
 * Does a lift take away the voxel at (x, y, z), the camera at `eye`? Its middle must be in the
 * box and above where it lifts from: one course above the floor in a room's walls facing the
 * camera and in front of them (a wall faces it when it stands beyond the wall's outer face),
 * head height elsewhere. The terrain shader's and the props' test (LIFT_GLSL), and the lifter's.
 */
export function liftedBy(l: Lift, eye: Eye, x: number, y: number, z: number): boolean {
  const [cx, cy, cz] = [x + 0.5, y + 0.5, z + 0.5];
  if (!(cx > l.x0 && cx < l.x1 && cz > l.z0 && cz < l.z1)) return false;
  const r = l.room;
  const facing = r !== undefined && ((eye.x > r.x1 && cx > r.x1 - 1) || (eye.x < r.x0 && cx < r.x0 + 1) || (eye.z > r.z1 && cz > r.z1 - 1) || (eye.z < r.z0 && cz < r.z0 + 1));
  return cy > (facing ? Math.min(l.from, r.front) : l.from);
}

/**
 * How high a prop anchored at (x, z) (its cell's middle) stands under a lift, the camera at
 * `eye`. Furniture standing in a room against a wall facing the camera (within a block of the
 * wall's inside, or in the wall) is cut as low as that wall, so a shelf there hides nobody
 * behind it: whatever of it is above the wall's standing course goes, a face level with it
 * stays. Elsewhere, as high as it likes (Infinity): it goes whole or not at all, by its anchor
 * (`liftedBy`). The props' test (`propTop` in LIFT_GLSL, the lowest under every box).
 */
export function propTop(l: Lift, eye: Eye, x: number, z: number): number {
  const r = l.room;
  if (!r || !(x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1)) return Infinity;
  const against = (eye.x > r.x1 && x > r.x1 - 2) || (eye.x < r.x0 && x < r.x0 + 2) || (eye.z > r.z1 && z > r.z1 - 2) || (eye.z < r.z0 && z < r.z0 + 2);
  return against ? Math.min(l.from, r.front) + 0.5 + ON_CUT : Infinity;
}

/** GLSL: the lifted boxes, and whether a voxel (by its centre) is lifted away: `liftedBy`, for every box. */
export const LIFT_GLSL = /* glsl */ `
uniform vec4 uLiftBox[${MAX_LIFTS}];
/** Where each box lifts from: x all over it, y in its room's walls facing the camera and in front of them. */
uniform vec2 uLiftFrom[${MAX_LIFTS}];
/** Each box's room: its walls' footprint (none, all zero). */
uniform vec4 uLiftRoom[${MAX_LIFTS}];
/** The camera, across the ground. */
uniform vec2 uLiftEye;
bool facingEye(vec4 r, vec3 cell) {
  return (uLiftEye.x > r.z && cell.x > r.z - 1.0) || (uLiftEye.x < r.x && cell.x < r.x + 1.0)
    || (uLiftEye.y > r.w && cell.z > r.w - 1.0) || (uLiftEye.y < r.y && cell.z < r.y + 1.0);
}
bool lifted(vec3 cell) {
  for (int k = 0; k < ${MAX_LIFTS}; k++) {
    vec4 b = uLiftBox[k];
    if (cell.x > b.x && cell.x < b.z && cell.z > b.y && cell.z < b.w
      && cell.y > (facingEye(uLiftRoom[k], cell) ? uLiftFrom[k].y : uLiftFrom[k].x)) return true;
  }
  return false;
}
/** How high a prop anchored at p stands (1e6: as high as it likes): propTop, the lowest under every box. */
float propTop(vec3 p) {
  float top = 1e6;
  for (int k = 0; k < ${MAX_LIFTS}; k++) {
    vec4 r = uLiftRoom[k];
    if (p.x > r.x && p.x < r.z && p.z > r.y && p.z < r.w
      && ((uLiftEye.x > r.z && p.x > r.z - 2.0) || (uLiftEye.x < r.x && p.x < r.x + 2.0)
        || (uLiftEye.y > r.w && p.z > r.w - 2.0) || (uLiftEye.y < r.y && p.z < r.y + 2.0))) top = min(top, uLiftFrom[k].y + ${(0.5 + ON_CUT).toFixed(3)});
  }
  return top;
}
/** Lamplight in a lifted room (none by day). */
uniform vec3 uRoomLight;
/** Is a voxel (by its centre) within a lifted room's walls, or (inset 1) within them and not in them? */
bool inRoom(vec3 cell, float inset) {
  for (int k = 0; k < ${MAX_LIFTS}; k++) {
    vec4 r = uLiftRoom[k] + vec4(inset, inset, -inset, -inset);
    if (cell.x > r.x && cell.x < r.z && cell.z > r.y && cell.z < r.w) return true;
  }
  return false;
}`;

/**
 * What's lifted away on foot, as shader uniforms shared by everything drawn that lifts:
 * the terrain, and props hung on buildings. Up to MAX_LIFTS boxes, the camera they're seen
 * from (which of a room's walls face it), and the lamplight in a lifted room after dark.
 */
export class Lifts {
  readonly uniforms = {
    uLiftBox: { value: Array.from({ length: MAX_LIFTS }, () => new Vector4()) },
    uLiftFrom: { value: Array.from({ length: MAX_LIFTS }, () => new Vector2(NEVER, NEVER)) },
    uLiftRoom: { value: Array.from({ length: MAX_LIFTS }, () => new Vector4()) },
    uLiftEye: { value: new Vector2() },
    uRoomLight: { value: new Color(0, 0, 0) },
  };
  private lifts: readonly Lift[] = [];
  private readonly eye: Eye = { x: 0, z: 0 };

  set(lifts: ReadonlyArray<Lift>, eye: Eye): void {
    this.lifts = lifts.slice(0, MAX_LIFTS);
    this.eye.x = eye.x;
    this.eye.z = eye.z;
    this.uniforms.uLiftEye.value.set(eye.x, eye.z);
    for (let k = 0; k < MAX_LIFTS; k++) {
      const l = lifts[k];
      const r = l?.room;
      this.uniforms.uLiftBox.value[k].set(l?.x0 ?? 0, l?.z0 ?? 0, l?.x1 ?? 0, l?.z1 ?? 0);
      this.uniforms.uLiftRoom.value[k].set(r?.x0 ?? 0, r?.z0 ?? 0, r?.x1 ?? 0, r?.z1 ?? 0);
      const from = l ? l.from : NEVER;
      this.uniforms.uLiftFrom.value[k].set(from, r ? Math.min(from, r.front) : from);
    }
  }

  /** How brightly lamplight fills a lifted room: 0 by day, 1 at night. */
  setRoomLight(amount: number): void {
    this.uniforms.uRoomLight.value.copy(ROOM_LIGHT).multiplyScalar(amount);
  }

  /** Is the voxel at (x, y, z) lifted away? The shader's test, at the voxel's centre. */
  holds(x: number, y: number, z: number): boolean {
    return this.lifts.some((l) => liftedBy(l, this.eye, x, y, z));
  }
}
