import type { Input } from './Input';

/** Discrete things the player can ask for. */
export type Action =
  | 'sailUp'
  | 'sailDown'
  | 'rotateLeft'
  | 'rotateRight'
  | 'firePort'
  | 'fireStarboard'
  | 'ammoRound'
  | 'ammoChain'
  | 'ammoGrape'
  | 'ammoNext'
  | 'board'
  | 'chart'
  | 'journal'
  | 'shanty'
  | 'system'
  // On foot
  | 'interact'
  | 'use'
  | 'useAtCursor'
  | 'place'
  | 'placeAtCursor'
  | 'itemPrev'
  | 'itemNext'
  | 'item1'
  | 'item2'
  | 'item3'
  | 'item4'
  | 'item5'
  | 'item6'
  | 'item7'
  | 'item8'
  | 'item9'
  | 'build'
  | 'cancel'
  // Menus (port screens, the chart)
  | 'navUp'
  | 'navDown'
  | 'navLeft'
  | 'navRight'
  | 'confirm'
  | 'back'
  | 'tabPrev'
  | 'tabNext'
  // Duel
  | 'light'
  | 'heavy'
  | 'thrust'
  | 'kick'
  | 'roll';

export type ControlMode = 'sea' | 'duel' | 'menu' | 'foot';

/** Button indices in the W3C "standard" gamepad layout, with Xbox names. */
export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;
const AXIS = { LX: 0, LY: 1, RY: 3 } as const;
/** How far the stick must go to count as a menu move, and the auto-repeat while it's held. */
const STICK_NAV = 0.55;
const NAV_DELAY = 0.4;
const NAV_REPEAT = 0.14;
const DEAD_ZONE = 0.18;

type Bindings<K> = ReadonlyArray<readonly [K, Action]>;

const SEA_PAD: Bindings<number> = [
  [PAD.UP, 'sailUp'],
  [PAD.Y, 'sailUp'],
  [PAD.DOWN, 'sailDown'],
  [PAD.A, 'sailDown'],
  [PAD.LB, 'rotateLeft'],
  [PAD.RB, 'rotateRight'],
  [PAD.LT, 'firePort'],
  [PAD.RT, 'fireStarboard'],
  [PAD.X, 'ammoNext'],
  [PAD.B, 'board'],
  [PAD.BACK, 'chart'],
  [PAD.START, 'system'],
  [PAD.RS, 'shanty'],
];

const FOOT_PAD: Bindings<number> = [
  [PAD.A, 'interact'],
  [PAD.X, 'use'],
  [PAD.LT, 'place'],
  [PAD.LB, 'itemPrev'],
  [PAD.RB, 'itemNext'],
  [PAD.Y, 'build'],
  [PAD.B, 'cancel'],
  [PAD.LEFT, 'rotateLeft'],
  [PAD.RIGHT, 'rotateRight'],
  [PAD.BACK, 'chart'],
  [PAD.START, 'system'],
];

const MENU_PAD: Bindings<number> = [
  [PAD.UP, 'navUp'],
  [PAD.DOWN, 'navDown'],
  [PAD.LEFT, 'navLeft'],
  [PAD.RIGHT, 'navRight'],
  [PAD.A, 'confirm'],
  [PAD.B, 'back'],
  [PAD.LB, 'tabPrev'],
  [PAD.RB, 'tabNext'],
  [PAD.BACK, 'chart'],
];

const DUEL_PAD: Bindings<number> = [
  [PAD.X, 'light'],
  [PAD.Y, 'heavy'],
  [PAD.RB, 'thrust'],
  [PAD.B, 'kick'],
  [PAD.A, 'roll'],
];

const SEA_KEYS: Bindings<string> = [
  ['KeyW', 'sailUp'],
  ['ArrowUp', 'sailUp'],
  ['KeyS', 'sailDown'],
  ['ArrowDown', 'sailDown'],
  // Left hand fires port, right hand starboard, matching the ship's sides.
  ['KeyQ', 'firePort'],
  ['KeyE', 'fireStarboard'],
  ['KeyZ', 'rotateLeft'],
  ['KeyC', 'rotateRight'],
  ['Digit1', 'ammoRound'],
  ['Digit2', 'ammoChain'],
  ['Digit3', 'ammoGrape'],
  ['KeyR', 'ammoNext'],
  ['KeyB', 'board'],
  ['KeyM', 'chart'],
  ['KeyJ', 'journal'],
  ['KeyN', 'shanty'],
  ['Escape', 'system'],
];

const FOOT_KEYS: Bindings<string> = [
  ['KeyE', 'interact'],
  ['Space', 'use'],
  ['KeyF', 'place'],
  ['KeyQ', 'itemPrev'],
  ['KeyR', 'itemNext'],
  ['Digit1', 'item1'],
  ['Digit2', 'item2'],
  ['Digit3', 'item3'],
  ['Digit4', 'item4'],
  ['Digit5', 'item5'],
  ['Digit6', 'item6'],
  ['Digit7', 'item7'],
  ['Digit8', 'item8'],
  ['Digit9', 'item9'],
  ['KeyB', 'build'],
  ['Escape', 'system'],
  ['KeyZ', 'rotateLeft'],
  ['KeyC', 'rotateRight'],
  ['KeyM', 'chart'],
  ['KeyJ', 'journal'],
];

/** Enter and Space aren't here: the browser already clicks the focused button. */
const MENU_KEYS: Bindings<string> = [
  ['ArrowUp', 'navUp'],
  ['KeyW', 'navUp'],
  ['ArrowDown', 'navDown'],
  ['KeyS', 'navDown'],
  ['ArrowLeft', 'navLeft'],
  ['KeyA', 'navLeft'],
  ['ArrowRight', 'navRight'],
  ['KeyD', 'navRight'],
  ['KeyQ', 'tabPrev'],
  ['KeyE', 'tabNext'],
  ['Escape', 'back'],
  ['KeyM', 'chart'],
  ['KeyJ', 'journal'],
];

const DUEL_KEYS: Bindings<string> = [
  ['KeyJ', 'light'],
  ['KeyK', 'heavy'],
  ['KeyU', 'thrust'],
  ['KeyI', 'kick'],
  ['Space', 'roll'],
];

const BINDINGS: Record<ControlMode, { keys: Bindings<string>; pad: Bindings<number> }> = {
  sea: { keys: SEA_KEYS, pad: SEA_PAD },
  duel: { keys: DUEL_KEYS, pad: DUEL_PAD },
  menu: { keys: MENU_KEYS, pad: MENU_PAD },
  foot: { keys: FOOT_KEYS, pad: FOOT_PAD },
};

export interface PadSnapshot {
  axes: readonly number[];
  buttons: ReadonlyArray<{ pressed: boolean }>;
}

/**
 * Pure mapping from one gamepad snapshot to game controls. `wasPressed` holds the
 * buttons that were down last poll, so actions fire once per press.
 */
export function readPad(pad: PadSnapshot, wasPressed: ReadonlySet<number>, mode: ControlMode = 'sea') {
  const pressed = new Set<number>();
  pad.buttons.forEach((button, i) => button?.pressed && pressed.add(i));
  const actions: Action[] = [];
  for (const [button, action] of BINDINGS[mode].pad) {
    if (pressed.has(button) && !wasPressed.has(button) && !actions.includes(action)) actions.push(action);
  }
  const dpad = (pressed.has(PAD.RIGHT) ? 1 : 0) - (pressed.has(PAD.LEFT) ? 1 : 0);
  const stick = deadZone(pad.axes[AXIS.LX] ?? 0);
  const x = pad.axes[AXIS.LX] ?? 0;
  const y = pad.axes[AXIS.LY] ?? 0;
  const tilt = Math.hypot(x, y);
  // On foot the stick is a direction: dead-zoned by its tilt, not per axis, so diagonals stay smooth.
  const walk = tilt < DEAD_ZONE ? 0 : Math.min(1, (tilt - DEAD_ZONE) / (1 - DEAD_ZONE)) / tilt;
  return {
    rudder: dpad !== 0 ? dpad : stick,
    /** Left stick as a walking direction: +x right, +y up the screen. */
    walkX: x * walk,
    walkY: -y * walk,
    /** The left stick as a menu direction, if it's pushed far enough. */
    stickNav: (Math.max(Math.abs(x), Math.abs(y)) < STICK_NAV
      ? null
      : Math.abs(x) > Math.abs(y)
        ? x > 0
          ? 'navRight'
          : 'navLeft'
        : y > 0
          ? 'navDown'
          : 'navUp') as Action | null,
    /** Right stick Y: pushed down (positive) zooms out. */
    zoom: deadZone(pad.axes[AXIS.RY] ?? 0),
    /** Duel guard: either left shoulder button. */
    block: pressed.has(PAD.LB) || pressed.has(PAD.LT),
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
  /** Left/right: the rudder at sea (+1 = starboard), footwork in a duel (+1 = right). */
  rudder = 0;
  /** Duel guard held: keyboard L, right mouse button, or a left shoulder button. */
  block = false;
  /** On foot: which way to walk, on screen (+x right, +y up), up to length 1. */
  walkX = 0;
  walkY = 0;
  gamepadConnected = false;
  private mode: ControlMode = 'sea';
  private padZoom = 0;
  private readonly queued = new Map<Action, number>();
  private readonly padButtons = new Map<number, Set<number>>();
  /** The menu direction the stick is held in, and when it next repeats. */
  private stickNav: Action | null = null;
  private stickRepeat = 0;

  constructor(private readonly input: Input) {}

  /** Switches key/button meanings, dropping anything queued under the old ones. */
  setMode(mode: ControlMode): void {
    this.mode = mode;
    this.queued.clear();
  }

  poll(): void {
    const input = this.input;
    this.rudder =
      (input.isHeld('KeyD') || input.isHeld('ArrowRight') ? 1 : 0) - (input.isHeld('KeyA') || input.isHeld('ArrowLeft') ? 1 : 0);
    for (const [code, action] of BINDINGS[this.mode].keys) for (let n = input.presses(code); n > 0; n--) this.queue(action);
    this.block = this.mode === 'duel' && (input.isHeld('KeyL') || input.isMouseHeld(2));
    if (this.mode === 'duel') {
      // In a duel the mouse fights: left click cuts.
      for (const click of input.takeClicks()) if (click.button === 0) this.queue('light');
    }
    const held = (...codes: string[]) => (codes.some((c) => input.isHeld(c)) ? 1 : 0);
    this.walkX = this.mode === 'foot' ? held('KeyD', 'ArrowRight') - held('KeyA', 'ArrowLeft') : 0;
    this.walkY = this.mode === 'foot' ? held('KeyW', 'ArrowUp') - held('KeyS', 'ArrowDown') : 0;
    if (this.mode === 'foot') {
      // On foot the mouse works: a left click uses what's in hand on the block under the cursor, a right click puts earth there.
      for (const click of input.takeClicks()) {
        if (click.button === 0) this.queue('useAtCursor');
        if (click.button === 2) this.queue('placeAtCursor');
      }
    }

    this.padZoom = 0;
    this.gamepadConnected = false;
    let stickNav: Action | null = null;
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad || !pad.connected || pad.mapping !== 'standard') continue;
      this.gamepadConnected = true;
      const state = readPad(pad, this.padButtons.get(pad.index) ?? new Set(), this.mode);
      this.padButtons.set(pad.index, state.pressed);
      if (Math.abs(state.rudder) > Math.abs(this.rudder)) this.rudder = state.rudder;
      if (this.mode === 'foot' && Math.hypot(state.walkX, state.walkY) > Math.hypot(this.walkX, this.walkY)) {
        this.walkX = state.walkX;
        this.walkY = state.walkY;
      }
      if (this.mode === 'duel' && state.block) this.block = true;
      if (Math.abs(state.zoom) > Math.abs(this.padZoom)) this.padZoom = state.zoom;
      for (const action of state.actions) this.queue(action);
      stickNav ??= state.stickNav;
    }
    this.pollStick(this.mode === 'menu' ? stickNav : null);
  }

  /** In menus the stick moves the selection: once when pushed, then repeating while held. */
  private pollStick(nav: Action | null): void {
    const now = performance.now() / 1000;
    if (nav !== this.stickNav) {
      this.stickNav = nav;
      this.stickRepeat = now + NAV_DELAY;
      if (nav) this.queue(nav);
    } else if (nav && now >= this.stickRepeat) {
      this.stickRepeat = now + NAV_REPEAT;
      this.queue(nav);
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
