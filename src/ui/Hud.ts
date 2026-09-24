export interface HudStats {
  fps: number;
  drawCalls: number;
  triangles: number;
  chunks: number;
}

/** Plain-DOM overlay: controls help plus a small performance readout (F3 toggles it). */
export class Hud {
  private readonly stats: HTMLElement;
  private frames = 0;
  private elapsed = 0;

  constructor(parent: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'hud';
    root.innerHTML = `
      <div class="hud-title">Haven's End <span>phase 1 · voxel sandbox</span></div>
      <div class="hud-help">
        <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move focus (<kbd>Shift</kbd> faster) ·
        <kbd>Q</kbd><kbd>E</kbd> rotate · wheel zoom ·
        <b>left click</b> dig · <b>right click</b> place
      </div>
      <div class="hud-stats"></div>`;
    parent.appendChild(root);
    this.stats = root.querySelector('.hud-stats')!;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.stats.hidden = !this.stats.hidden;
      }
    });
  }

  /** Call once per rendered frame; the readout refreshes twice a second. */
  frame(frameSeconds: number, sample: () => Omit<HudStats, 'fps'>): void {
    this.frames++;
    this.elapsed += frameSeconds;
    if (this.elapsed < 0.5 || this.stats.hidden) return;
    const { drawCalls, triangles, chunks } = sample();
    const fps = Math.round(this.frames / this.elapsed);
    this.stats.textContent = `${fps} fps · ${drawCalls} draws · ${(triangles / 1000).toFixed(0)}k tris · ${chunks} chunks`;
    this.frames = 0;
    this.elapsed = 0;
  }
}
