import { FixedStep } from './FixedStep';

export interface LoopHandlers {
  /** Advances the simulation by exactly `dt` seconds. May run 0..n times per frame. */
  update(dt: number): void;
  /**
   * Draws a frame. `alpha` (0..1) is how far we are between the last two sim steps,
   * for interpolation. `frameSeconds` is real elapsed time, for presentation-only easing.
   */
  render(alpha: number, frameSeconds: number): void;
}

/** requestAnimationFrame driver: fixed-step simulation, variable-rate rendering. */
export class GameLoop {
  private readonly clock: FixedStep;
  private lastTime = -1;
  private running = false;

  constructor(
    private readonly handlers: LoopHandlers,
    hz: number,
  ) {
    this.clock = new FixedStep(1 / hz);
  }

  get step(): number {
    return this.clock.step;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = -1;
    requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    const frameSeconds = this.lastTime < 0 ? 0 : (now - this.lastTime) / 1000;
    this.lastTime = now;

    const { steps, alpha } = this.clock.advance(frameSeconds);
    for (let i = 0; i < steps; i++) this.handlers.update(this.clock.step);
    this.handlers.render(alpha, frameSeconds);

    requestAnimationFrame(this.frame);
  };
}
