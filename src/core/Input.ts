export interface PointerClick {
  button: number;
  /** Normalised device coordinates, -1..1, +y up. */
  x: number;
  y: number;
}

/**
 * Collects raw DOM input into state the game polls. Held keys are levels (safe to read
 * from fixed sim steps); presses, clicks and wheel are edges, read once per rendered
 * frame and cleared by endFrame().
 */
export class Input {
  /** Pointer position in normalised device coordinates. */
  readonly pointer = { x: 0, y: 0, inside: false };
  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly clicks: PointerClick[] = [];
  private wheel = 0;

  constructor(private readonly element: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    element.addEventListener('pointermove', this.onPointerMove);
    element.addEventListener('pointerdown', this.onPointerDown);
    element.addEventListener('pointerleave', this.onPointerLeave);
    element.addEventListener('wheel', this.onWheel, { passive: false });
    element.addEventListener('contextmenu', this.onContextMenu);
  }

  /** `code` is a KeyboardEvent.code such as 'KeyW' or 'ShiftLeft' (layout independent). */
  isHeld(code: string): boolean {
    return this.held.has(code);
  }

  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  takeWheel(): number {
    const delta = this.wheel;
    this.wheel = 0;
    return delta;
  }

  takeClicks(): PointerClick[] {
    return this.clicks.splice(0);
  }

  endFrame(): void {
    this.pressed.clear();
  }

  private toNdc(e: MouseEvent): { x: number; y: number } {
    const rect = this.element.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((e.clientY - rect.top) / rect.height) * 2 + 1,
    };
  }

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (!e.repeat) this.pressed.add(e.code);
    this.held.add(e.code);
  };

  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.held.delete(e.code);
  };

  /** Keys released while the window is unfocused never send keyup; forget them all. */
  private readonly onBlur = () => {
    this.held.clear();
  };

  private readonly onPointerMove = (e: PointerEvent) => {
    Object.assign(this.pointer, this.toNdc(e), { inside: true });
  };

  private readonly onPointerDown = (e: PointerEvent) => {
    this.clicks.push({ button: e.button, ...this.toNdc(e) });
  };

  private readonly onPointerLeave = () => {
    this.pointer.inside = false;
  };

  private readonly onWheel = (e: WheelEvent) => {
    e.preventDefault();
    // Normalise line/page deltas (Firefox) to pixels.
    this.wheel += e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
  };

  private readonly onContextMenu = (e: Event) => {
    e.preventDefault();
  };
}
