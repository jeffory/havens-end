import { describe, expect, it } from 'vitest';
import { type CharacterModel, PART_NAMES } from './characterModel';
import { alike, type Dress, DRESS_KINDS, type DressKind, townDress } from './dress';
import { buildSettlerModel, musketCells } from './settlerModel';

/** A fingerprint of everything a model is made of: every part's cells and joint, the palette, the feet, the hand and the scale. */
function fingerprint(m: CharacterModel): string {
  let h = 0x811c9dc5;
  const mix = (n: number) => {
    h = Math.imul(h ^ (n | 0), 0x01000193) >>> 0;
    h = Math.imul(h ^ Math.round((n % 1) * 1e6), 0x01000193) >>> 0;
  };
  for (const name of PART_NAMES) {
    const p = m.parts[name];
    for (const v of p.cells) mix(v);
    mix(p.pivot.x);
    mix(p.pivot.y);
    mix(p.pivot.z);
  }
  for (const v of m.palette) mix(v);
  for (const p of [m.feet, m.hand]) {
    mix(p.x);
    mix(p.y);
    mix(p.z);
  }
  mix(m.scale * 1e6);
  return h.toString(16);
}

describe('buildSettlerModel', () => {
  it('builds the hired settlers exactly as it always has when given no dress', () => {
    const prints = Array.from({ length: 48 }, (_, i) => fingerprint(buildSettlerModel(i * 7919 + 13)));
    // Taken from the model as it was before townsfolk had dress of their own.
    expect(prints.join(' ')).toBe(
      '5fae8ee2 34499a8c 6bf43c36 9018dd38 51113cf5 6cf28d41 295a5200 7d4477f9 fa4f3cbf 3db534e7 d3f1f31f 6423202f db7eed86 9a51df91 4f8b5241 4df773ba ' +
        'd3f1f31f ff43120c 2d33c5df 71be27b3 f78c8e07 e172f744 e3b443ac 1b782e90 46e5fab4 281e3ca2 c001e552 1df70265 34716d36 a74dd72a 8fff2f8c d6ea8d47 ' +
        '2f08e164 43f0119e c0776bfb 3aca7405 69c06859 6347c1d6 90f0042 3086c9ed 80cf6e66 5d30bc8f a57e3a11 a43f4fae 112f15fc f581728 3d675780 820f224e',
    );
  });

  it('dresses a figure as it is told: the colours worn show in the model', () => {
    const soldier = townDress('soldier', 42);
    const m = buildSettlerModel(42, soldier);
    const colours = paletteColours(m);
    for (const c of [soldier.head.colour, soldier.over.colour, soldier.trousers]) expect(colours).toContain(c);
    // Crossed white belts on the chest: the torso has cells of their colour at the front.
    expect(coloursOn(m, 'torso', (_x, _y, z) => z === 2)).toContain(CROSS_BELTS);
    // Still the same height: a hat never makes its wearer shorter.
    expect(m.scale).toBeCloseTo(buildSettlerModel(42).scale);
  });

  it('puts something different on every head', () => {
    const tops = (dress: Dress) => {
      const m = buildSettlerModel(7, dress);
      return [...m.parts.head.cells].filter((_, i) => i % 4 === 1).reduce((a, b) => Math.max(a, b), 0);
    };
    const base = townDress('merchant', 7);
    const bare = tops({ ...base, head: { kind: 'bare', colour: 0, band: 0 } });
    const straw = tops({ ...base, head: { kind: 'straw', colour: 0xd8bd72, band: 0x7a2a1a } });
    const tricorn = tops({ ...base, head: { kind: 'tricorn', colour: 0x1a1a1a, band: 0xe8e2d0 } });
    const bandana = tops({ ...base, head: { kind: 'bandana', colour: 0xa62a22, band: 0xa62a22 } });
    expect(straw).toBeGreaterThan(bare);
    expect(tricorn).toBeGreaterThan(bare);
    // A bandana is tied round the head, not stood on it.
    expect(bandana).toBe(bare);
    const cloth = buildSettlerModel(7, { ...base, head: { kind: 'bandana', colour: 0xa62a22, band: 0xa62a22 } });
    expect(coloursOn(cloth, 'head', (_x, y) => y >= 24)).toContain(0xa62a22);
  });

  it('gives a soldier a musket that stands up from the hand', () => {
    const { cells } = musketCells();
    const ys = [...cells].filter((_, i) => i % 4 === 1);
    expect(Math.max(...ys)).toBeGreaterThan(8);
    expect(Math.min(...ys)).toBeLessThan(-6);
  });
});

describe('townDress', () => {
  const LOOKS = Array.from({ length: 200 }, (_, i) => i * 104729 + 17);
  const dresses = (kind: DressKind) => LOOKS.map((look) => townDress(kind, look));
  const share = (kind: DressKind, test: (d: Dress) => boolean) => dresses(kind).filter(test).length / LOOKS.length;

  it('is the same every time for the same look', () => {
    for (const kind of DRESS_KINDS) expect(townDress(kind, 12345)).toEqual(townDress(kind, 12345));
  });

  it('spreads the looks wide in every port: hats and bare heads and scarves, many shirts, some waistcoats or aprons', () => {
    for (const kind of ['haven', 'merchant', 'imperial', 'pirate'] as const) {
      const all = dresses(kind);
      expect(new Set(all.map((d) => d.head.kind)).size, kind).toBeGreaterThanOrEqual(3);
      expect(share(kind, (d) => d.head.kind === 'bare'), kind).toBeGreaterThan(0.1);
      expect(new Set(all.map((d) => d.shirt)).size, kind).toBeGreaterThanOrEqual(5);
      expect(share(kind, (d) => d.over.kind === 'waistcoat' || d.over.kind === 'apron'), kind).toBeGreaterThan(0.15);
      // Nobody's hat outnumbers everything else put together.
      for (const hat of new Set(all.map((d) => d.head.kind))) expect(share(kind, (d) => d.head.kind === hat), `${kind} ${hat}`).toBeLessThan(0.6);
    }
  });

  it('ties bandanas on the Brethren, with the odd tricorn, and never a straw hat', () => {
    expect(share('pirate', (d) => d.head.kind === 'straw')).toBe(0);
    expect(share('pirate', (d) => d.head.kind === 'bandana')).toBeGreaterThan(0.35);
    expect(share('pirate', (d) => d.head.kind === 'tricorn')).toBeGreaterThan(0.03);
    // Red, black or dark.
    for (const d of dresses('pirate')) if (d.head.kind === 'bandana') expect(isRed(d.head.colour) || brightness(d.head.colour) < 0.45).toBe(true);
    expect(share('pirate', (d) => d.stripe !== undefined)).toBeGreaterThan(0.15);
    expect(share('pirate', (d) => d.ragged === true)).toBeGreaterThan(0.15);
    // A coloured sash for a belt, every one of them.
    expect(share('pirate', (d) => d.sash === true)).toBe(1);
  });

  it('keeps the Crown’s townsfolk sober, and puts some soldiers among them', () => {
    const civil = dresses('imperial').filter((d) => !d.soldier);
    expect(civil.every((d) => d.head.kind !== 'bandana' && d.stripe === undefined && !d.ragged && !d.sash)).toBe(true);
    // Plain colours: no bright shirts or coats.
    for (const d of civil) for (const c of [d.shirt, d.over.colour, ...(d.head.kind === 'bare' ? [] : [d.head.colour])]) expect(chroma(c)).toBeLessThan(0.22);
    const soldiers = share('imperial', (d) => d.soldier === true);
    expect(soldiers).toBeGreaterThan(0.08);
    expect(soldiers).toBeLessThan(0.35);
  });

  it('turns out a soldier in a red coat and a black tricorn', () => {
    for (const d of dresses('soldier')) {
      expect(d.soldier).toBe(true);
      expect(d.head.kind).toBe('tricorn');
      expect(brightness(d.head.colour)).toBeLessThan(0.15);
      expect(d.over.kind).toBe('coat');
      expect(isRed(d.over.colour)).toBe(true);
    }
  });

  it('puts straw hats and aprons about the free port and Haven, and Haven’s folk in oilskins and blue smocks', () => {
    for (const kind of ['haven', 'merchant'] as const) {
      expect(share(kind, (d) => d.head.kind === 'straw'), kind).toBeGreaterThan(0.2);
      expect(share(kind, (d) => d.over.kind === 'apron'), kind).toBeGreaterThan(0.15);
      expect(share(kind, (d) => d.head.kind === 'bandana' || d.head.kind === 'tricorn' || d.soldier === true), kind).toBe(0);
    }
    const oilskin = (d: Dress) => d.over.kind === 'smock' && d.over.colour === OILSKIN;
    expect(share('haven', oilskin)).toBeGreaterThan(0.08);
    expect(share('haven', (d) => d.over.kind === 'smock' && isBlue(d.over.colour))).toBeGreaterThan(0.08);
    // The free port has neither: it's a town of traders, not fishermen.
    expect(share('merchant', (d) => d.over.kind === 'smock')).toBe(0);
  });

  it('tells two looks apart when their hats or their clothes differ', () => {
    const d = townDress('merchant', 99);
    expect(alike(d, d)).toBe(true);
    expect(alike(d, { ...d, shirt: d.shirt ^ 0x101010, over: { kind: 'none', colour: 0 } })).toBe(false);
    expect(alike(d, { ...d, head: { kind: d.head.kind === 'bare' ? 'straw' : 'bare', colour: 0xd8bd72, band: 0x7a2a1a } })).toBe(false);
  });
});

const CROSS_BELTS = 0xefeadf;
const OILSKIN = 0xe0b43a;

const rgb = (hex: number) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const brightness = (hex: number) => Math.max(...rgb(hex)) / 255;
/** How far a colour is from grey, 0 to 1. */
const chroma = (hex: number) => (Math.max(...rgb(hex)) - Math.min(...rgb(hex))) / 255;
const isRed = (hex: number) => {
  const [r, g, b] = rgb(hex);
  return r > g * 2 && r > b * 2;
};
const isBlue = (hex: number) => {
  const [r, g, b] = rgb(hex);
  return b > r && b >= g;
};

function paletteColours(m: CharacterModel): number[] {
  const out: number[] = [];
  for (let i = 4; i < m.palette.length; i += 4) if (m.palette[i + 3]) out.push((m.palette[i] << 16) | (m.palette[i + 1] << 8) | m.palette[i + 2]);
  return out;
}

/** The colours on one part's cells where `where` holds. */
function coloursOn(m: CharacterModel, part: (typeof PART_NAMES)[number], where: (x: number, y: number, z: number) => boolean): number[] {
  const cells = m.parts[part].cells;
  const out = new Set<number>();
  for (let i = 0; i < cells.length; i += 4) {
    if (!where(cells[i], cells[i + 1], cells[i + 2])) continue;
    const s = cells[i + 3] * 4;
    out.add((m.palette[s] << 16) | (m.palette[s + 1] << 8) | m.palette[s + 2]);
  }
  return [...out];
}
