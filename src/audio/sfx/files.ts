/** The sound files found at build time in src/assets/sfx/, as <id>-<take>.mp3. None is fine: a missing sound is silence. */
import { filesFrom, type SfxName } from './sounds';

const FILES = filesFrom(import.meta.glob<string>('../../assets/sfx/*.mp3', { eager: true, query: '?url', import: 'default' }));

/** The URLs of a sound's takes, in take order; empty when none has been generated yet. */
export function variantsOf(name: SfxName): readonly string[] {
  return FILES.get(name) ?? [];
}
