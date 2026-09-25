import { GOOD_INFO, GOODS, type Good } from '../economy/goods';
import type { Held, Tool } from '../land/Land';
import { ICON_SIZE, ICONS, type Icon, SACK, TOOL_ICONS } from '../render/itemIcons';

/** Which controls the player is using: the keyboard (and mouse), or a gamepad. */
export type Scheme = 'keys' | 'pad';

/** A legend's entries: the keys that do each thing (space-separated) and what it does. */
export type KeyEntries = ReadonlyArray<readonly [keys: string, action: string]>;

/**
 * One row of a controls legend: each entry the keys that do it (space-separated, drawn as
 * keycaps side by side) and what they do.
 */
export function keyRow(entries: KeyEntries): string {
  return entries.map(([keys, action]) => `<span>${keys.split(' ').map((k) => `<kbd>${k}</kbd>`).join('')} ${action}</span>`).join('');
}

/** A little gamepad, drawn in the text colour, to lead the gamepad row of a legend. */
export const PAD_MARK = `<svg class="pad-mark" viewBox="0 0 24 16" role="img" aria-label="Gamepad"><rect x="1.5" y="2.5" width="21" height="11" rx="5.5" /><path d="M7 5.5v5M4.5 8h5" /><circle cx="16" cy="6.5" r="1.3" /><circle cx="18.6" cy="9.4" r="1.3" /></svg>`;

/** A prompt naming both schemes' keys: "E / 🎮 A: the market". */
const BOTH_KEYS = /^(.+?) \/ 🎮 (.+?): (.+)$/su;

/**
 * A prompt split into the key for the scheme in use and what it does: "E / 🎮 A: the market"
 * is E (or the pad's A) and "the market". A prompt without keys comes back whole.
 */
export function splitPrompt(prompt: string, scheme: Scheme): { key: string | null; pad: boolean; text: string } {
  const both = BOTH_KEYS.exec(prompt);
  if (!both) return { key: null, pad: false, text: prompt };
  return { key: scheme === 'pad' ? both[2] : both[1], pad: scheme === 'pad', text: both[3] };
}

/** What each prompt pill was last filled with, so filling it every frame costs nothing. */
const shownPrompts = new WeakMap<HTMLElement, string>();

/**
 * Fills a prompt pill: the key for the scheme in use as a keycap (the pad's led by a little
 * gamepad), then what it does.
 */
export function showPrompt(el: HTMLElement, prompt: string, scheme: Scheme): void {
  const shown = `${scheme}|${prompt}`;
  if (shownPrompts.get(el) === shown) return;
  shownPrompts.set(el, shown);
  const { key, pad, text } = splitPrompt(prompt, scheme);
  const keys = document.createElement('span');
  keys.className = 'prompt-keys';
  if (pad) keys.innerHTML = PAD_MARK;
  for (const k of key?.split(' ') ?? []) keys.append(Object.assign(document.createElement('kbd'), { textContent: k }));
  el.replaceChildren(...(key ? [keys] : []), text);
}

/**
 * A controls legend, top left: the keys of the scheme in use. Tucked away, all that's left is
 * a small "H controls" tab, so it can be found again.
 */
export class Legend {
  readonly el = document.createElement('div');
  private readonly full = document.createElement('div');
  private readonly tab = document.createElement('div');
  private readonly rows: Record<Scheme, HTMLElement>;

  /** `head` goes above the keys, and is tucked away with them. */
  constructor(className: string, keys: KeyEntries, pad: KeyEntries, head = '') {
    this.el.className = `hud-legend ${className}`;
    this.full.innerHTML = `${head}<div class="keys">${keyRow(keys)}</div><div class="keys pad">${PAD_MARK}${keyRow(pad)}</div>`;
    const [keyKeys, padKeys] = this.full.querySelectorAll<HTMLElement>('.keys');
    this.rows = { keys: keyKeys, pad: padKeys };
    this.tab.className = 'legend-tab';
    this.tab.innerHTML = '<kbd>H</kbd> controls';
    this.el.append(this.full, this.tab);
    this.setShown(true);
    this.setScheme('keys');
  }

  /** Shows the keys, or tucks them away to the tab. */
  setShown(shown: boolean): void {
    this.full.hidden = !shown;
    this.tab.hidden = shown;
    this.el.classList.toggle('tucked', !shown);
  }

  /** Shows the keyboard's keys or the gamepad's, never both. */
  setScheme(scheme: Scheme): void {
    this.rows.keys.hidden = scheme !== 'keys';
    this.rows.pad.hidden = scheme !== 'pad';
  }
}

const isTool = (item: Held): item is Tool => Object.hasOwn(TOOL_ICONS, item);

/** The picture for something in the hotbar: a tool's own, a good's, or a sack for a good without one. */
export function heldIcon(item: Held): Icon {
  return isTool(item) ? TOOL_ICONS[item] : (ICONS[item as Good] ?? SACK);
}

/** Hotbar labels, lower-cased, to what they name: tools by their name, goods by their market label. */
const BY_LABEL = new Map<string, Held>([
  ...(Object.keys(TOOL_ICONS) as Tool[]).map((tool) => [tool, tool] as const),
  ...GOODS.map((good) => [GOOD_INFO[good].label.toLowerCase(), good] as const),
]);

/** What a hotbar label names ("Axe", "Cane cuttings"), or null if nothing. */
export function heldByLabel(label: string): Held | null {
  return BY_LABEL.get(label.trim().toLowerCase()) ?? null;
}

const urls = new WeakMap<Icon, string>();

/**
 * An icon as an SVG data URL: a square per pixel (runs merged), with crisp edges, so it stays
 * sharp at any whole-number scale. Made once per icon.
 */
export function iconUrl(icon: Icon): string {
  let url = urls.get(icon);
  if (url) return url;
  const rects: string[] = [];
  icon.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      const ch = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === ch) end++;
      if (ch !== '.') rects.push(`<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="#${icon.colors[ch].toString(16).padStart(6, '0')}"/>`);
      x = end;
    }
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}" shape-rendering="crispEdges">${rects.join('')}</svg>`;
  url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  urls.set(icon, url);
  return url;
}
