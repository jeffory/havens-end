import type { Held } from '../land/Land';
import { SACK } from '../render/itemIcons';
import { heldByLabel, heldIcon, iconUrl, type KeyEntries, Legend, type Scheme, showPrompt } from './hudParts';

export interface Slot {
  key: string;
  label: string;
  /** What's in the slot, for its picture; when left out it's found from the label. */
  item?: Held;
  /** How many there are to hand (seeds); undefined for tools. */
  count?: number;
  active: boolean;
}

export interface FootReadout {
  slots: Slot[];
  packUsed: number;
  packSize: number;
  packSummary: string;
  /** What E / A would do here, if anything: "E / 🎮 A: the market". Only the key for the scheme in use is shown. */
  prompt: string | null;
  /** What came of the last thing you did (why it didn't work, or what it got you). */
  hint: string | null;
  hintOk: boolean;
  /** Placing a building: what, and the keys. */
  placing: string | null;
  /** Which way north is on screen: radians clockwise from up. */
  north: number;
  /** The lodestone's pull toward buried treasure, if it's stirring. */
  lodestone: string | null;
}

/** The keys on foot, keyboard and mouse. */
const FOOT_KEYS: KeyEntries = [
  ['WASD', 'walk'],
  ['Space Click', 'use'],
  ['F Right-click', 'dig for treasure'],
  ['E', 'interact'],
  ['1–8', 'tools and seeds'],
  ['B', 'build'],
  ['M', 'chart'],
  ['J', 'journal'],
  ['Esc', 'menu'],
  ['H', 'hide'],
];

/** The gamepad's buttons on foot. */
const FOOT_PAD: KeyEntries = [
  ['LS', 'walk'],
  ['X', 'use'],
  ['LT', 'dig for treasure'],
  ['A', 'interact'],
  ['LB RB', 'tools and seeds'],
  ['Y', 'build'],
  ['View', 'chart'],
  ['Start', 'menu'],
];

/** The on-foot overlay: the hotbar of tools and seeds, the pack, and what's to hand. */
export class FootHud {
  private readonly root = document.createElement('div');
  private readonly slots = document.createElement('div');
  private readonly pack = document.createElement('div');
  private readonly prompt = document.createElement('div');
  private readonly hint = document.createElement('div');
  private readonly legend = new Legend('foot-help', FOOT_KEYS, FOOT_PAD);
  private scheme: Scheme = 'keys';
  private readonly compass = document.createElement('div');
  /** The compass card (needle and N), turned so N points north. */
  private readonly card: SVGSVGElement;
  /** The N, turned back the other way so it always reads upright. */
  private readonly northLetter: SVGTextElement;
  private readonly lodestone = document.createElement('div');
  private shownSlots = '';
  private shownNorth = NaN;
  /** A hotbar slot was clicked. */
  onSelect: ((index: number) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root.className = 'foot-hud';
    this.root.hidden = true;
    this.slots.className = 'foot-slots';
    this.pack.className = 'foot-pack';
    this.prompt.className = 'foot-prompt';
    this.hint.className = 'foot-hint';
    this.legend.el.hidden = true;
    this.slots.addEventListener('pointerdown', (e) => {
      const slot = (e.target as HTMLElement).closest<HTMLElement>('.foot-slot');
      if (!slot || e.button !== 0) return;
      e.preventDefault();
      this.onSelect?.(Number(slot.dataset.index));
    });
    this.compass.className = 'foot-compass';
    this.compass.title = 'North: riddles count paces by the compass and the sun';
    this.compass.innerHTML = `
      <svg class="foot-card" viewBox="-32 -32 64 64" aria-hidden="true">
        <path class="dial-ticks" d="M29 0H25M0 29V25M-29 0H-25" />
        <path class="needle-south" d="M0 12L4 0H-4Z" />
        <path class="needle-north" d="M0 -12L4 0H-4Z" />
        <circle class="needle-pin" r="1.6" />
        <text class="dial-n" y="-20">N</text>
      </svg>`;
    this.card = this.compass.querySelector('.foot-card')!;
    this.northLetter = this.compass.querySelector('.dial-n')!;
    this.compass.hidden = true;
    this.lodestone.className = 'foot-lodestone';
    this.root.append(this.lodestone, this.prompt, this.hint, this.pack, this.slots);
    parent.append(this.legend.el, this.compass, this.root);
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
    this.legend.el.hidden = !visible;
    this.compass.hidden = !visible;
  }

  /** Shows the controls legend, or tucks it away to a small "H controls" tab. */
  setHelpShown(shown: boolean): void {
    this.legend.setShown(shown);
  }

  /** Whose controls the legend and the prompt show: the keyboard's, or the gamepad's. */
  setScheme(scheme: Scheme): void {
    this.scheme = scheme;
    this.legend.setScheme(scheme);
  }

  update(r: FootReadout): void {
    const slots = r.slots.map((s) => `${s.key}|${s.label}|${s.item ?? ''}|${s.count ?? ''}|${s.active}`).join(';');
    if (slots !== this.shownSlots) {
      this.shownSlots = slots;
      this.slots.replaceChildren(...r.slots.map(slotElement));
    }
    set(this.pack, `Pack ${r.packUsed}/${r.packSize}${r.packSummary ? ` · ${r.packSummary}` : ''}`);
    showPrompt(this.prompt, r.placing ?? r.prompt ?? '', this.scheme);
    this.prompt.hidden = !(r.placing ?? r.prompt);
    set(this.hint, r.hint ?? '');
    this.hint.hidden = !r.hint;
    this.hint.classList.toggle('ok', r.hintOk);
    set(this.lodestone, r.lodestone ?? '');
    this.lodestone.hidden = !r.lodestone;
    if (r.north !== this.shownNorth) {
      this.shownNorth = r.north;
      this.card.style.transform = `rotate(${r.north}rad)`;
      this.northLetter.style.transform = `rotate(${-r.north}rad)`;
    }
  }
}

/** A hotbar slot: its key in one corner, how many in the other, its picture, and its name. */
function slotElement(s: Slot, index: number): HTMLElement {
  const el = document.createElement('div');
  el.dataset.index = `${index}`;
  el.className = `foot-slot${s.active ? ' active' : ''}${s.count === 0 ? ' empty' : ''}`;
  el.title = s.count === 0 ? `${s.label}: none to hand` : s.label;
  const key = document.createElement('kbd');
  key.textContent = s.key;
  const icon = document.createElement('img');
  icon.className = 'foot-icon';
  icon.alt = '';
  icon.draggable = false;
  const item = s.item ?? heldByLabel(s.label);
  icon.src = iconUrl(item ? heldIcon(item) : SACK);
  const label = document.createElement('span');
  label.textContent = s.label;
  el.append(key, icon, label);
  if (s.count !== undefined) {
    const count = document.createElement('b');
    count.textContent = `${s.count}`;
    el.append(count);
  }
  return el;
}

function set(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}
