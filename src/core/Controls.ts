import type { Input } from './Input';

/** Discrete things the player can ask for. */
export type Action = 'sailUp' | 'sailDown' | 'rotateLeft' | 'rotateRight';

/** Button indices in the W3C "standard" gamepad layout, with Xbox names. */
export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;
const AXIS = { LX: 0, RY: 3 } as const;
const DEAD_ZONE = 0.18;

const PAD_ACTIONS: ReadonlyArray<readonly [number, Action]> = [
  [PAD.UP, 'sailUp'],
  [PAD.Y, 'sailUp'],
  [PAD.DOWN, 'sailDown'],
  [PAD.A, 'sailDown'],
  [PAD.LB, 'rotateLeft'],
  [PAD.RB, 'rotateRight'],
];

const KEY_ACTIONS: ReadonlyArray<readonly [string, Action]> = [
  ['KeyW', 'sailUp'],
  ['ArrowUp', 'sailUp'],
  ['KeyS', 'sailDown'],
  ['ArrowDown', 'sailDown'],
  ['KeyQ', 'rotateLeft'],
  ['KeyE', 'rotateRight'],
];

export interface PadSnapshot {
  axes: readonly number[];
  buttons: ReadonlyArray<{ pressed: boolean }>;
}

/**
 * Pure mapping from one gamepad snapshot to game controls. `wasPressed` holds the
 * buttons that were down last poll, so actions fire once per press.
 */
export function readPad(pad: PadSnapshot, wasPressed: ReadonlySet<number>) {
  const pressed = new Set<number>();
  pad.buttons.forEach((button, i) => button?.pressed && pressed.add(i));
  const actions: Action[] = [];
  for (const [button, action] of PAD_ACTIONS) {
    if (pressed.has(button) && !wasPressed.has(button) && !actions.includes(action)) actions.push(action);
  }
  const dpad = (pressed.has(PAD.RIGHT) ? 1 : 0) - (pressed.has(PAD.LEFT) ? 1 : 0);
  const stick = deadZone(pad.axes[AXIS.LX] ?? 0);
  return {
    rudder: dpad !== 0 ? dpad : stick,
    /** Right stick Y: pushed down (positive) zooms out. */
    zoom: deadZone(pad.axes[AXIS.RY] ?? 0),
    actions,
    pressed,
  };
}

/** Rescales so the output starts at 0 at the edge of the dead zone and still reaches ±1. */
function deadZone(value: number): number {
  const magnitude = Math.abs(value);
  return magnitude < DEAD_ZONE ? 0 : (Math.sign(value) * (magnitude - DEAD_ZONE)) / (1 - DEAD_ZONE);
}

/**
 * Keyboard and gamepads merged into one set of controls. Poll once at the start of
 * each frame. Analog values are levels; actions are queued until something takes
 * them, so a tap is never lost on a frame where the sim happens not to step.
 */
export class Controls {
  /** -1 (port) .. +1 (starboard). */
  rudder = 0;
  gamepadConnected = false;
  private padZoom = 0;
  private readonly queued = new Map<Action, number>();
  private readonly padButtons = new Map<number, Set<number>>();

  constructor(private readonly input: Input) {}

  poll(): void {
    const input = this.input;
    this.rudder =
      (input.isHeld('KeyD') || input.isHeld('ArrowRight') ? 1 : 0) - (input.isHeld('KeyA') || input.isHeld('ArrowLeft') ? 1 : 0);
    for (const [code, action] of KEY_ACTIONS) for (let n = input.presses(code); n > 0; n--) this.queue(action);

    this.padZoom = 0;
    this.gamepadConnected = false;
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad || !pad.connected || pad.mapping !== 'standard') continue;
      this.gamepadConnected = true;
      const state = readPad(pad, this.padButtons.get(pad.index) ?? new Set());
      this.padButtons.set(pad.index, state.pressed);
      if (Math.abs(state.rudder) > Math.abs(this.rudder)) this.rudder = state.rudder;
      if (Math.abs(state.zoom) > Math.abs(this.padZoom)) this.padZoom = state.zoom;
      for (const action of state.actions) this.queue(action);
    }
  }

  /** How many times `action` was triggered since it was last taken. */
  take(action: Action): number {
    const count = this.queued.get(action) ?? 0;
    this.queued.delete(action);
    return count;
  }

  /** Zoom input this frame, in mouse-wheel units: the wheel plus the right stick. */
  takeZoom(frameSeconds: number): number {
    return this.input.takeWheel() + this.padZoom * 1500 * frameSeconds;
  }

  private queue(action: Action): void {
    this.queued.set(action, (this.queued.get(action) ?? 0) + 1);
  }
}
