export interface HudStats {
  drawCalls: number;
  triangles: number;
  chunks: number;
}

export interface NavReadout {
  /** Screen angles in radians, clockwise from straight up the screen. */
  windAngle: number;
  headingAngle: number;
  northAngle: number;
  windKnots: number;
  /** Compass point the wind blows from, e.g. 'ENE'. */
  windFrom: string;
  conditions: string;
  speedKnots: number;
  pointOfSail: string;
  /** Canvas ordered by the helm: 0, 0.5 or 1. */
  sails: number;
  grounded: boolean;
}

const SAIL_LABELS: Record<number, string> = { 0: 'furled', 0.5: 'half', 1: 'full' };

/** Plain-DOM overlay: controls help, the navigation panel and a perf readout (F3). */
export class Hud {
  private readonly stats: HTMLElement;
  private readonly padHelp: HTMLElement;
  private readonly nav: Record<string, Element>;
  private readonly shown = new Map<Element, string>();
  private frames = 0;
  private elapsed = 0;

  constructor(parent: HTMLElement) {
    const help = document.createElement('div');
    help.className = 'hud';
    help.innerHTML = `
      <div class="hud-title">Haven's End <span>phase 2 · sailing</span></div>
      <div class="hud-help">
        <kbd>W</kbd><kbd>S</kbd> sails · <kbd>A</kbd><kbd>D</kbd> steer ·
        <kbd>Q</kbd><kbd>E</kbd> turn view · wheel zoom · click dig / place
      </div>
      <div class="hud-help hud-pad" hidden>
        🎮 <kbd>LS</kbd> steer · <kbd>↑</kbd><kbd>↓</kbd> or <kbd>Y</kbd><kbd>A</kbd> sails ·
        <kbd>LB</kbd><kbd>RB</kbd> turn view · <kbd>RS</kbd> zoom
      </div>
      <div class="hud-stats"></div>`;

    const nav = document.createElement('div');
    nav.className = 'hud hud-nav';
    nav.innerHTML = `
      <svg class="compass" viewBox="-50 -50 100 100" role="img" aria-label="Compass">
        <circle r="46" class="compass-face" />
        <g class="compass-north"><text y="-33">N</text></g>
        <g class="compass-wind"><path d="M0,-40 L10,-22 L3.5,-22 L3.5,34 L-3.5,34 L-3.5,-22 L-10,-22 Z" /></g>
        <g class="compass-ship"><path d="M0,-17 L7,11 L0,6 L-7,11 Z" /></g>
      </svg>
      <div class="nav-lines">
        <div>Wind <b data-nav="wind"></b> from <b data-nav="from"></b></div>
        <div data-nav="conditions" class="nav-muted"></div>
        <div>Speed <b data-nav="speed"></b> · <span data-nav="pos"></span></div>
        <div>Sails <span data-nav="sails" class="nav-sails"></span></div>
        <div data-nav="aground" class="nav-warn" hidden>Aground! Turn away</div>
      </div>`;

    parent.append(help, nav);
    this.stats = help.querySelector('.hud-stats')!;
    this.padHelp = help.querySelector('.hud-pad')!;
    this.nav = {
      north: nav.querySelector('.compass-north')!,
      windArrow: nav.querySelector('.compass-wind')!,
      ship: nav.querySelector('.compass-ship')!,
      ...Object.fromEntries([...nav.querySelectorAll('[data-nav]')].map((el) => [(el as HTMLElement).dataset.nav!, el])),
    };
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.stats.hidden = !this.stats.hidden;
      }
    });
  }

  setGamepadConnected(connected: boolean): void {
    this.padHelp.hidden = !connected;
  }

  setNav(n: NavReadout): void {
    this.rotate(this.nav.north, n.northAngle);
    this.rotate(this.nav.windArrow, n.windAngle);
    this.rotate(this.nav.ship, n.headingAngle);
    this.text(this.nav.wind, `${Math.round(n.windKnots)} kn`);
    this.text(this.nav.from, n.windFrom);
    this.text(this.nav.conditions, n.conditions);
    this.text(this.nav.speed, `${n.speedKnots.toFixed(1)} kn`);
    this.text(this.nav.pos, n.pointOfSail);
    const pips = n.sails === 0 ? '▯▯' : n.sails < 1 ? '▮▯' : '▮▮';
    this.text(this.nav.sails, `${pips} ${SAIL_LABELS[n.sails] ?? ''}${n.sails === 0 ? ' (W to raise)' : ''}`);
    (this.nav.aground as HTMLElement).hidden = !n.grounded;
  }

  /** Call once per rendered frame; the perf readout refreshes twice a second. */
  frame(frameSeconds: number, sample: () => HudStats): void {
    this.frames++;
    this.elapsed += frameSeconds;
    if (this.elapsed < 0.5 || this.stats.hidden) return;
    const { drawCalls, triangles, chunks } = sample();
    const fps = Math.round(this.frames / this.elapsed);
    this.stats.textContent = `${fps} fps · ${drawCalls} draws · ${(triangles / 1000).toFixed(0)}k tris · ${chunks} chunks`;
    this.frames = 0;
    this.elapsed = 0;
  }

  /** Only touch the DOM when the text actually changes. */
  private text(el: Element, value: string): void {
    if (this.shown.get(el) === value) return;
    this.shown.set(el, value);
    el.textContent = value;
  }

  private rotate(el: Element, radians: number): void {
    el.setAttribute('transform', `rotate(${((radians * 180) / Math.PI).toFixed(1)})`);
  }
}
