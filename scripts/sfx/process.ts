/**
 * sfx: turns the raw ElevenLabs downloads in sfx-raw/ into the game's small mono MP3s in
 * src/assets/sfx/, and writes docs/sfx.md. Run `npm run sfx -- process` or `npm run sfx -- docs`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOUNDS, type SfxName } from '../../src/audio/sfx/sounds';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW_DIR = join(ROOT, 'sfx-raw');
const OUT_DIR = join(ROOT, 'src', 'assets', 'sfx');
const DOC_FILE = join(ROOT, 'docs', 'sfx.md');

/** Seconds a loop's end overlaps its start. */
const OVERLAP = 1.5;
/** Seconds faded off a one-shot's tail so a trimmed take never clicks. */
const TAIL_FADE = 0.03;

const SILENCE = 'silenceremove=start_periods=1:start_threshold=-50dB';

/** The ffmpeg arguments for one take; `seconds` is the input's real length (used by loops). */
export function ffmpegArgs(input: string, output: string, loop: boolean, seconds: number): string[] {
  const encode = ['-ac', '1', '-ar', '44100', '-codec:a', 'libmp3lame', '-q:a', '6', output];
  if (!loop) {
    const filter = [
      SILENCE,
      `areverse,${SILENCE},afade=t=in:d=${TAIL_FADE},areverse`,
      'loudnorm=I=-16:TP=-1.5:LRA=11',
    ].join(',');
    return ['-y', '-i', input, '-af', filter, ...encode];
  }
  const f = OVERLAP;
  const fadeStart = round(seconds - 2 * f);
  const delayMs = Math.round(fadeStart * 1000);
  const graph = [
    `[0:a]atrim=0:${f},asetpts=PTS-STARTPTS,afade=t=in:d=${f}[head]`,
    `[0:a]atrim=${f},asetpts=PTS-STARTPTS,afade=t=out:st=${fadeStart}:d=${f}[body]`,
    `[head]adelay=${delayMs}|${delayMs}[late]`,
    '[body][late]amix=inputs=2:normalize=0,loudnorm=I=-20:TP=-2:LRA=7',
  ].join(';');
  return ['-y', '-i', input, '-filter_complex', graph, '-t', String(round(seconds - f)), ...encode];
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** The whole of docs/sfx.md. */
export function sfxDoc(): string {
  const rows = Object.entries(SOUNDS).map(
    ([name, s]) => `| \`${name}\` | ${s.loop ? 'loop' : 'one-shot'} | ${s.seconds} s | ${s.takes} | ${s.prompt} |`,
  );
  return `# Sound effects: how they're made

Every sound effect is generated from a text prompt. The prompts, lengths and number of
takes are in \`src/audio/sfx/sounds.ts\`; the table below lists them all. The files are in
\`src/assets/sfx/\`, named \`<id>-<take>.mp3\`, and the game picks a take at random.

| Sound | Kind | Length | Takes | Prompt |
| --- | --- | --- | --- | --- |
${rows.join('\n')}

## How they were made

- The model is ElevenLabs \`elevenlabs/sound-generation\`, run through Comfy Cloud's
  \`partner_generate\` tool, with \`params.duration\` set to the sound's length and \`client_os\`.
- Each download is saved as \`sfx-raw/<id>-<take>.mp3\` (\`.flac\`, \`.wav\` and \`.ogg\` also work).
  \`sfx-raw/\` is not committed.
- \`npm run sfx -- process\` turns every raw take into a small mono MP3 in \`src/assets/sfx/\`.
  One-shots are trimmed of silence at both ends and levelled; loops have their ends crossfaded
  (1.5 s) so they repeat seamlessly. Takes already newer than their raw file are skipped.
- To redo a take, regenerate it, save it over its raw file and run the process step again.
- \`npm run sfx -- docs\` rewrites this file from \`sounds.ts\`.
- The sound board, for listening to every take, is at \`/?sounds\`.
`;
}

function probeSeconds(file: string): number {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {
    encoding: 'utf8',
  });
  return Number(out.trim());
}

function processAll(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const files = readdirSync(RAW_DIR).filter((f) => /\.(mp3|wav|ogg|flac)$/.test(f)).sort();
  for (const file of files) {
    const stem = file.replace(/\.[^.]+$/, '');
    const id = stem.replace(/-\d+$/, '');
    if (!(id in SOUNDS)) {
      console.log(`skip ${file}: no sound called ${id}`);
      continue;
    }
    const input = join(RAW_DIR, file);
    const output = join(OUT_DIR, `${stem}.mp3`);
    if (existsSync(output) && statSync(output).mtimeMs >= statSync(input).mtimeMs) {
      console.log(`up to date ${stem}.mp3`);
      continue;
    }
    const loop = SOUNDS[id as SfxName].loop === true;
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...ffmpegArgs(input, output, loop, probeSeconds(input))]);
    console.log(`made ${stem}.mp3 (${Math.round(statSync(output).size / 1024)} KB)`);
  }
}

function main(argv: string[]): void {
  switch (argv[0]) {
    case 'process':
      return processAll();
    case 'docs':
      writeFileSync(DOC_FILE, sfxDoc());
      console.log('Wrote docs/sfx.md');
      return;
    default:
      console.log('Usage: npm run sfx -- process | docs');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
