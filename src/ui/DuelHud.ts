import type { Duel, Fighter } from '../duel/duel';
import { STAMINA } from '../duel/moves';

export interface ParryCue {
  /** Screen position of the attacker's sword hand. */
  x: number;
  y: number;
  /** 1 when the swing starts, 0 at impact. */
  remaining: number;
  telegraph: 'white' | 'red';
  /** Inside the parry window right now. */
  now: boolean;
}

export type PopTone = 'good' | 'bad' | 'info' | 'gold';

/**
 * The duel overlay: both captains' health and stamina, the parry cue (a ring closing on
 * the enemy's blade: white = block or parry, red = roll, gold = parry now), pop-up
 * combat text, the controls, and the verdict.
 */
export class DuelHud {
  private readonly root = document.createElement('div');
  private readonly el: Record<string, HTMLElement>;
  private readonly shown = new Map<HTMLElement, string>();

  constructor(parent: HTMLElement) {
    this.root.className = 'duel-hud';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="duel-top">
        <div class="duel-side">
          <b>You</b>
          <div class="bar duel-hp"><div data-d="youHp"></div></div>
          <div class="bar duel-st"><div data-d="youSt"></div></div>
        </div>
        <div class="duel-title">DUEL<span data-d="title"></span></div>
        <div class="duel-side foe">
          <b data-d="foeName"></b>
          <div class="bar duel-hp"><div data-d="foeHp"></div></div>
          <div class="bar duel-st"><div data-d="foeSt"></div></div>
        </div>
      </div>
      <div class="duel-cue" data-d="cue"><div class="ring" data-d="ring"></div><div class="core"></div></div>
      <div class="duel-pops" data-d="pops"></div>
      <div class="duel-help">
        <kbd>A</kbd><kbd>D</kbd> move · <kbd>J</kbd> cut · <kbd>K</kbd> heavy · <kbd>U</kbd> thrust (red) · <kbd>I</kbd> kick ·
        hold <kbd>L</kbd> / right mouse to block, tap as the ring closes to <b>parry</b> · <kbd>Space</kbd> roll
        <span class="pad">🎮 <kbd>X</kbd> cut · <kbd>Y</kbd> heavy · <kbd>RB</kbd> thrust · <kbd>B</kbd> kick · <kbd>LB</kbd> block/parry · <kbd>A</kbd> roll</span>
      </div>
      <div class="duel-result" data-d="result" hidden></div>`;
    parent.append(this.root);
    this.el = Object.fromEntries([...this.root.querySelectorAll<HTMLElement>('[data-d]')].map((e) => [e.dataset.d!, e]));
  }

  show(enemyName: string, title: string): void {
    this.root.hidden = false;
    this.el.foeName.textContent = enemyName;
    this.el.title.textContent = title;
    this.el.result.hidden = true;
    this.el.pops.replaceChildren();
  }

  hide(): void {
    this.root.hidden = true;
  }

  update(duel: Duel, cue: ParryCue | null): void {
    this.bar(this.el.youHp, duel.player.hp / duel.player.maxHp);
    this.bar(this.el.foeHp, duel.enemy.hp / duel.enemy.maxHp);
    this.bar(this.el.youSt, duel.player.stamina / STAMINA.max);
    this.bar(this.el.foeSt, duel.enemy.stamina / STAMINA.max);
    this.el.youSt.classList.toggle('winded', winded(duel.player));
    this.el.foeSt.classList.toggle('winded', winded(duel.enemy));

    const c = this.el.cue;
    c.hidden = !cue;
    if (cue) {
      c.style.transform = `translate(${cue.x.toFixed(0)}px, ${cue.y.toFixed(0)}px)`;
      c.className = `duel-cue ${cue.now && cue.telegraph === 'white' ? 'now' : cue.telegraph}`;
      this.el.ring.style.transform = `translate(-50%, -50%) scale(${(1 + cue.remaining * 2.4).toFixed(3)})`;
    }
  }

  /** Floating combat text at a screen position. */
  pop(text: string, x: number, y: number, tone: PopTone): void {
    const el = document.createElement('div');
    el.className = `duel-pop ${tone}`;
    el.textContent = text;
    el.style.left = `${x.toFixed(0)}px`;
    el.style.top = `${y.toFixed(0)}px`;
    this.el.pops.append(el);
    setTimeout(() => el.remove(), 1000);
  }

  result(won: boolean, message: string): void {
    const r = this.el.result;
    r.hidden = false;
    r.className = `duel-result ${won ? 'won' : 'lost'}`;
    r.innerHTML = `<b>${won ? 'Victory!' : 'Defeated'}</b><span></span>`;
    r.querySelector('span')!.textContent = message;
  }

  private bar(el: HTMLElement, fraction: number): void {
    const value = `${Math.max(0, Math.min(100, fraction * 100)).toFixed(1)}%`;
    if (this.shown.get(el) === value) return;
    this.shown.set(el, value);
    el.style.width = value;
  }
}

const winded = (f: Fighter) => f.stamina < STAMINA.winded;
