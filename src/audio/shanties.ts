/**
 * The sea shanties: every MP3 in src/assets/music/shanties/, found at build time, so
 * adding one is just dropping it in the folder. Its title comes from its file name:
 * "haul-away-to-haven.mp3" is "Haul Away to Haven".
 */
export interface Track {
  url: string;
  title: string;
}

/** Little words stay lower-case inside a title. */
const SMALL = new Set(['a', 'an', 'and', 'the', 'to', 'of', 'in', 'on', 'for', 'o']);

const FILES = import.meta.glob<string>('../assets/music/shanties/*.mp3', { eager: true, query: '?url', import: 'default' });

export const SHANTIES: readonly Track[] = Object.entries(FILES)
  .map(([path, url]) => ({ url, title: titleOf(path) }))
  .sort((a, b) => a.title.localeCompare(b.title));

/** A title from a file name: "01-haul-away-to-haven.mp3" → "Haul Away to Haven". */
export function titleOf(path: string): string {
  const name = path.split('/').pop()!.replace(/\.mp3$/i, '').replace(/^\d+[-_ ]*/, '');
  return name
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((w, i) => (i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}
