/**
 * Turns variable-length display frames into whole, fixed-length simulation steps.
 *
 * Keeping the simulation on a fixed clock makes sailing, cannonball arcs and NPC
 * automation behave identically on 60 Hz and 144 Hz monitors, and makes the sim
 * reproducible for tests. Rendering uses `alpha` to interpolate between steps.
 */
export class FixedStep {
  private accumulator = 0;

  constructor(
    readonly step: number,
    /** Longest frame we will try to catch up on; anything longer is dropped. */
    private readonly maxFrame = 0.25,
  ) {}

  advance(frameSeconds: number): { steps: number; alpha: number } {
    this.accumulator += Math.min(Math.max(frameSeconds, 0), this.maxFrame);
    // The epsilon absorbs float drift so 0.3 s of 0.1 s steps is 3 steps, not 2.
    const steps = Math.floor(this.accumulator / this.step + 1e-9);
    this.accumulator = Math.max(0, this.accumulator - steps * this.step);
    return { steps, alpha: this.accumulator / this.step };
  }
}
