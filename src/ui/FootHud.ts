export interface Slot {
  key: string;
  label: string;
  /** How many there are to hand (seeds); undefined for tools. */
  count?: number;
  active: boolean;
}

export interface FootReadout {
  slots: Slot[];
  packUsed: number;
  packSize: number;
  packSummary: string;
  /** What E / A would do here, if anything. */
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

/** The on-foot overlay: the hotbar of tools and seed, the pack, and what's to hand. */
export class FootHud {
  private readonly root = document.createElement('div');
  private readonly slots = document.createElement('div');
  private readonly pack = document.createElement('div');
  private readonly prompt = document.createElement('div');
  private readonly hint = document.createElement('div');
  private readonly help = document.createElement('div');
  private readonly compass = document.createElement('div');
  private readonly needle = document.createElement('div');
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
    this.help.className = 'foot-help';
    this.help.innerHTML = `<kbd>WASD</kbd> walk · <kbd>Space</kbd> / click use · <kbd>F</kbd> / right-click dig for treasure · <kbd>E</kbd> interact ·
      <kbd>1</kbd>–<kbd>8</kbd> tools and seed · <kbd>B</kbd> build · <kbd>M</kbd> chart · <kbd>J</kbd> journal · <kbd>Esc</kbd> menu
      <span class="pad">🎮 <kbd>X</kbd> use · <kbd>LT</kbd> dig · <kbd>A</kbd> interact · <kbd>LB</kbd><kbd>RB</kbd> tools · <kbd>Y</kbd> build · <kbd>Start</kbd> menu</span>`;
    this.help.hidden = true;
    this.slots.addEventListener('pointerdown', (e) => {
      const slot = (e.target as HTMLElement).closest<HTMLElement>('.foot-slot');
      if (!slot || e.button !== 0) return;
      e.preventDefault();
      this.onSelect?.(Number(slot.dataset.index));
    });
    this.compass.className = 'foot-compass';
    this.compass.title = 'North: riddles count paces by the compass and the sun';
    this.needle.className = 'foot-needle';
    this.needle.innerHTML = '<b>N</b>';
    this.compass.append(this.needle);
    this.compass.hidden = true;
    this.lodestone.className = 'foot-lodestone';
    this.root.append(this.lodestone, this.prompt, this.hint, this.pack, this.slots);
    parent.append(this.help, this.compass, this.root);
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
    this.help.hidden = !visible;
    this.compass.hidden = !visible;
  }

  update(r: FootReadout): void {
    const slots = r.slots.map((s) => `${s.key}|${s.label}|${s.count ?? ''}|${s.active}`).join(';');
    if (slots !== this.shownSlots) {
      this.shownSlots = slots;
      this.slots.replaceChildren(
        ...r.slots.map((s, i) => {
          const el = document.createElement('div');
          el.dataset.index = `${i}`;
          el.className = `foot-slot${s.active ? ' active' : ''}${s.count === 0 ? ' empty' : ''}`;
          el.innerHTML = `<kbd></kbd><span></span>${s.count !== undefined ? '<b></b>' : ''}`;
          el.querySelector('kbd')!.textContent = s.key;
          el.querySelector('span')!.textContent = s.label;
          if (s.count !== undefined) el.querySelector('b')!.textContent = `${s.count}`;
          return el;
        }),
      );
    }
    set(this.pack, `Pack ${r.packUsed}/${r.packSize}${r.packSummary ? ` · ${r.packSummary}` : ''}`);
    set(this.prompt, r.placing ?? r.prompt ?? '');
    this.prompt.hidden = !(r.placing ?? r.prompt);
    set(this.hint, r.hint ?? '');
    this.hint.hidden = !r.hint;
    this.hint.classList.toggle('ok', r.hintOk);
    set(this.lodestone, r.lodestone ?? '');
    this.lodestone.hidden = !r.lodestone;
    if (r.north !== this.shownNorth) {
      this.shownNorth = r.north;
      this.needle.style.transform = `rotate(${r.north}rad)`;
    }
  }
}

function set(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}
