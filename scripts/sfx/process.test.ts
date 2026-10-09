import { describe, expect, it } from 'vitest';
import { SOUNDS } from '../../src/audio/sfx/sounds';
import { ffmpegArgs, sfxDoc } from './process';

describe('ffmpegArgs', () => {
  it('a one-shot is trimmed of silence, levelled, and saved as a small mono MP3', () => {
    const args = ffmpegArgs('in.flac', 'out.mp3', false, 2.5);
    const joined = args.join(' ');
    expect(joined).toContain('-ac 1');
    expect(joined).toContain('-ar 44100');
    expect(joined).toContain('-codec:a libmp3lame');
    expect(joined).toContain('-q:a 6');
    const filter = args[args.indexOf('-af') + 1];
    expect(filter).toContain('silenceremove=start_periods=1:start_threshold=-50dB');
    expect(filter).toMatch(/areverse,silenceremove=[^,]+,afade=t=in:d=0\.03,areverse/);
    expect(filter).toContain('loudnorm=I=-16:TP=-1.5:LRA=11');
    expect(args).toContain('in.flac');
    expect(args[args.length - 1]).toBe('out.mp3');
  });

  it('a loop has its ends crossfaded', () => {
    const args = ffmpegArgs('in.flac', 'out.mp3', true, 20);
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).not.toContain('silenceremove');
    expect(graph).toContain('atrim=0:1.5');
    expect(graph).toContain('afade=t=out:st=17:d=1.5');
    expect(graph).toContain('adelay=17000|17000');
    expect(graph).toContain('amix=inputs=2:normalize=0');
    expect(args).toContain('-t');
    expect(args[args.indexOf('-t') + 1]).toBe('18.5');
    expect(args.join(' ')).toContain('-ac 1');
  });
});

describe('sfxDoc', () => {
  it('lists every sound with its prompt, length and takes', () => {
    const doc = sfxDoc();
    expect(doc).toMatch(/^# /);
    expect(doc).toContain('## How they were made');
    for (const [name, spec] of Object.entries(SOUNDS)) {
      expect(doc).toContain(`| \`${name}\` |`);
      expect(doc).toContain(spec.prompt);
    }
  });
});
