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
  region: string;
}

export interface CombatReadout {
  hull: number;
  sails: number;
  crew: number;
  /** 0..1 fractions of the ship's full strength. */
  hullFraction: number;
  sailsFraction: number;
  crewFraction: number;
  ammo: 'round' | 'chain' | 'grape';
  /** 0..1 reload progress per side; 1 = loaded. */
  port: number;
  starboard: number;
  /** Name of the ship alongside that could be boarded, if any. */
  boardable: string | null;
  sinking: boolean;
  gold: number;
  cargo: number;
  hold: number;
}

export type Tone = 'info' | 'good' | 'bad';

const TOAST_SECONDS = 4.5;
const MAX_TOASTS = 4;

const SAIL_LABELS: Record<number, string> = { 0: 'furled', 0.5: 'half', 1: 'full' };

/** Plain-DOM overlay: controls help, the navigation panel and a perf readout (F3). */
export class Hud {
  private readonly stats: HTMLElement;
  private readonly padHelp: HTMLElement;
  private readonly nav: Record<string, Element>;
  private readonly combat: Record<string, HTMLElement>;
  private readonly toasts: HTMLElement;
  private readonly shown = new Map<Element, string>();
  private frames = 0;
  private elapsed = 0;

  constructor(parent: HTMLElement) {
    const help = document.createElement('div');
    help.className = 'hud';
    help.innerHTML = `
      <div class="hud-title">Haven's End <span>phase 3 · naval combat</span></div>
      <div class="hud-help">
        <kbd>W</kbd><kbd>S</kbd> sails · <kbd>A</kbd><kbd>D</kbd> steer ·
        <kbd>Q</kbd><kbd>E</kbd> fire port / starboard · <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> shot · <kbd>B</kbd> board<br />
        <kbd>Z</kbd><kbd>C</kbd> turn view · wheel zoom · click dig / place
      </div>
      <div class="hud-help hud-pad" hidden>
        🎮 <kbd>LS</kbd> steer · <kbd>↑</kbd><kbd>↓</kbd> sails · <kbd>LT</kbd><kbd>RT</kbd> fire ·
        <kbd>X</kbd> shot · <kbd>B</kbd> board · <kbd>LB</kbd><kbd>RB</kbd> view · <kbd>RS</kbd> zoom
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
        <div data-nav="region" class="nav-region"></div>
      </div>`;

    const combat = document.createElement('div');
    combat.className = 'hud hud-combat';
    combat.innerHTML = `
      <div class="meter"><span>Hull</span><div class="bar hull"><div></div></div><b data-c="hullText"></b></div>
      <div class="meter"><span>Sails</span><div class="bar sails"><div></div></div><b data-c="sailsText"></b></div>
      <div class="meter"><span>Crew</span><div class="bar crew"><div></div></div><b data-c="crewText"></b></div>
      <div class="ammo">
        <span data-ammo="round"><kbd>1</kbd> Round</span>
        <span data-ammo="chain"><kbd>2</kbd> Chain</span>
        <span data-ammo="grape"><kbd>3</kbd> Grape</span>
      </div>
      <div class="purse"><b data-c="gold"></b> gold · hold <b data-c="hold"></b></div>
      <div class="guns">
        <div><span>Port</span><div class="bar reload"><div data-c="port"></div></div></div>
        <div><span>Starboard</span><div class="bar reload"><div data-c="starboard"></div></div></div>
      </div>`;

    const prompt = document.createElement('div');
    prompt.className = 'hud-prompt';
    prompt.hidden = true;
    this.toasts = document.createElement('div');
    this.toasts.className = 'hud-toasts';

    parent.append(help, nav, combat, prompt, this.toasts);
    this.combat = {
      hull: combat.querySelector('.bar.hull > div')!,
      sails: combat.querySelector('.bar.sails > div')!,
      crew: combat.querySelector('.bar.crew > div')!,
      prompt,
      ...Object.fromEntries([...combat.querySelectorAll<HTMLElement>('[data-c]')].map((el) => [el.dataset.c!, el])),
      ...Object.fromEntries([...combat.querySelectorAll<HTMLElement>('[data-ammo]')].map((el) => [`ammo-${el.dataset.ammo}`, el])),
    };
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

  /** Hides the sailing and gunnery panels (during a duel, which has its own). */
  setVisible(visible: boolean): void {
    for (const panel of [this.padHelp.parentElement!, this.nav.north.closest('.hud-nav')!, this.combat.hull.closest('.hud-combat')!]) {
      (panel as HTMLElement).hidden = !visible;
    }
    this.combat.prompt.hidden ||= !visible;
    this.toasts.hidden = !visible;
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
    this.text(this.nav.region, n.region);
  }

  setCombat(c: CombatReadout): void {
    this.width(this.combat.hull, c.hullFraction);
    this.width(this.combat.sails, c.sailsFraction);
    this.width(this.combat.crew, c.crewFraction);
    this.text(this.combat.hullText, `${Math.ceil(c.hull)}`);
    this.text(this.combat.sailsText, `${Math.ceil(c.sails)}`);
    this.text(this.combat.crewText, `${Math.floor(c.crew)}`);
    for (const ammo of ['round', 'chain', 'grape'] as const) this.combat[`ammo-${ammo}`].classList.toggle('active', c.ammo === ammo);
    for (const side of ['port', 'starboard'] as const) {
      const bar = this.combat[side];
      this.width(bar, c[side]);
      bar.classList.toggle('loaded', c[side] >= 1);
    }
    this.text(this.combat.gold, `${c.gold}`);
    this.text(this.combat.hold, `${c.cargo}/${c.hold}`);
    const prompt = this.combat.prompt;
    const message = c.sinking ? 'Abandon ship!' : c.boardable ? `B / 🎮 B: board the ${c.boardable}` : '';
    prompt.hidden = message === '';
    this.text(prompt, message);
  }

  /** A short message across the top of the screen, gone after a few seconds. */
  toast(message: string, tone: Tone = 'info'): void {
    const el = document.createElement('div');
    el.className = `toast toast-${tone}`;
    el.textContent = message;
    this.toasts.append(el);
    while (this.toasts.children.length > MAX_TOASTS) this.toasts.firstElementChild!.remove();
    setTimeout(() => el.classList.add('leaving'), TOAST_SECONDS * 1000);
    setTimeout(() => el.remove(), TOAST_SECONDS * 1000 + 400);
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

  /** Sets a bar's fill, touching the DOM only when the value actually changes. */
  private width(el: HTMLElement, fraction: number): void {
    const value = percent(fraction);
    if (this.shown.get(el) === value) return;
    this.shown.set(el, value);
    el.style.width = value;
  }

  private rotate(el: Element, radians: number): void {
    el.setAttribute('transform', `rotate(${((radians * 180) / Math.PI).toFixed(1)})`);
  }
}

const percent = (fraction: number) => `${Math.max(0, Math.min(100, fraction * 100)).toFixed(1)}%`;
