import { describe, expect, it } from 'vitest';
import { falloff } from './mix';
import { type AudioContextLike, Sfx } from './Sfx';
import { LOOP_IDS, type LoopId, SOUNDS, type SfxName } from './sounds';

/** A Web Audio context that only remembers what was wired up and started. */
function fakeContext(decodeFails: (bytes: ArrayBuffer) => boolean = () => false) {
  const param = (value = 1) => {
    const p = {
      value,
      target: NaN,
      timeConstant: NaN,
      setTargetAtTime(target: number, _start: number, timeConstant: number) {
        p.target = target;
        p.timeConstant = timeConstant;
      },
    };
    return p;
  };
  type Param = ReturnType<typeof param>;
  interface Node {
    kind: string;
    out: Node | null;
    gain?: Param;
    pan?: Param;
    connect(to: Node): Node;
    disconnect(): void;
  }
  const node = (kind: string, extra: object = {}): Node => {
    const n: Node = {
      kind,
      out: null,
      connect(to) {
        n.out = to;
        return to;
      },
      disconnect() {
        n.out = null;
      },
      ...extra,
    };
    return n;
  };
  const started: (Node & { buffer: unknown; loop: boolean; playbackRate: Param; stopped: boolean; onended: (() => void) | null })[] = [];
  const ctx = {
    currentTime: 0,
    state: 'suspended',
    destination: node('destination'),
    resumed: 0,
    resume() {
      ctx.resumed++;
      ctx.state = 'running';
      return Promise.resolve();
    },
    createGain: () => node('gain', { gain: param() }),
    createStereoPanner: () => node('panner', { pan: param(0) }),
    createBufferSource() {
      const s = node('source', {
        buffer: null,
        loop: false,
        playbackRate: param(),
        stopped: false,
        onended: null,
        start: () => started.push(s),
        stop: () => {
          s.stopped = true;
        },
      }) as (typeof started)[number];
      return s;
    },
    decodeAudioData: (bytes: ArrayBuffer) => (decodeFails(bytes) ? Promise.reject(new Error('bad mp3')) : Promise.resolve({ bytes })),
  };
  /** The gain and pan a source is wired through. */
  const route = (s: Node) => ({ gain: s.out?.gain, pan: s.out?.out?.pan });
  return { ctx, started, route };
}

/** Every sound has two files, named after it; fetching records the URL. */
function setup(options: { files?: (name: SfxName) => readonly string[]; decodeFails?: (bytes: ArrayBuffer) => boolean; random?: () => number } = {}) {
  const fake = fakeContext(options.decodeFails);
  const fetched: string[] = [];
  const sfx = new Sfx({
    context: () => fake.ctx as unknown as AudioContextLike,
    fetchBytes: (url) => {
      fetched.push(url);
      return Promise.resolve(new TextEncoder().encode(url).buffer as ArrayBuffer);
    },
    random: options.random ?? (() => 0.3),
    files: options.files ?? ((name) => [`${name}-1.mp3`, `${name}-2.mp3`]),
  });
  return { sfx, fetched, ...fake };
}

/** Let the fetches and decodes settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const silent = (): Record<LoopId, number> => Object.fromEntries(LOOP_IDS.map((id) => [id, 0])) as Record<LoopId, number>;

describe('the sound effects', () => {
  it('nothing plays before unlock', async () => {
    const { sfx, started, fetched } = setup();
    sfx.play('cannon');
    sfx.setLoops({ ...silent(), waves: 1 });
    await settle();
    expect(started).toHaveLength(0);
    expect(fetched).toHaveLength(0);
    expect(sfx.voices).toBe(0);
  });

  it('plays a variant of the sound, at the spec\'s volume times the gain, with falloff and pan', async () => {
    const { sfx, started, route, ctx } = setup();
    sfx.volume = 0.75;
    sfx.unlock();
    await settle();
    expect(ctx.resumed).toBe(1);
    sfx.play('cannon', { at: { distance: 160, pan: 0.5 }, gain: 0.5 });
    expect(started).toHaveLength(1);
    const s = started[0];
    expect(['cannon-1.mp3', 'cannon-2.mp3']).toContain(new TextDecoder().decode((s.buffer as { bytes: ArrayBuffer }).bytes));
    expect(route(s).gain?.value).toBeCloseTo(0.75 * SOUNDS.cannon.volume * 0.5 * falloff(160, 320));
    expect(route(s).pan?.value).toBe(0.5);
    expect(Math.abs(s.playbackRate.value - 1)).toBeLessThanOrEqual(0.06);
    expect(sfx.voices).toBe(1);
  });

  it('playTake plays exactly that file', async () => {
    const { sfx, started } = setup();
    sfx.unlock();
    await settle();
    sfx.playTake('cannon', 1);
    sfx.playTake('waves', 0);
    sfx.playTake('cannon', 7);
    expect(started.map((s) => new TextDecoder().decode((s.buffer as { bytes: ArrayBuffer }).bytes))).toEqual(['cannon-2.mp3', 'waves-1.mp3']);
    expect(started[0].loop).toBe(false);
    expect(sfx.voices).toBe(2);
  });

  it('drops a sound out of reach without taking a voice', async () => {
    const { sfx, started } = setup();
    sfx.unlock();
    await settle();
    sfx.play('cannon', { at: { distance: 400, pan: 0 } });
    expect(started).toHaveLength(0);
    expect(sfx.voices).toBe(0);
  });

  it('caps a sound\'s voices and cuts the oldest', async () => {
    const { sfx, started } = setup();
    sfx.unlock();
    await settle();
    for (let i = 0; i < 9; i++) sfx.play('cannon');
    expect(started).toHaveLength(9);
    expect(started[0].stopped).toBe(true);
    expect(started.slice(1).every((s) => !s.stopped)).toBe(true);
    expect(sfx.voices).toBe(8);
    started[1].onended?.();
    expect(sfx.voices).toBe(7);
  });

  it('plays nothing, and throws nothing, for a sound with no files or a failed decode', async () => {
    const { sfx, started } = setup({
      files: (name) => (name === 'hull-hit' ? [] : [`${name}-1.mp3`]),
      decodeFails: (bytes) => new TextDecoder().decode(bytes) === 'splash-1.mp3',
    });
    sfx.unlock();
    await settle();
    expect(() => sfx.play('hull-hit')).not.toThrow();
    expect(() => sfx.play('splash')).not.toThrow();
    expect(started).toHaveLength(0);
    expect(sfx.voices).toBe(0);
  });

  it('volume 0 plays nothing and loads nothing', async () => {
    const { sfx, started, fetched } = setup();
    sfx.volume = 0;
    sfx.unlock();
    await settle();
    sfx.play('cannon');
    expect(fetched).toHaveLength(0);
    expect(started).toHaveLength(0);
    sfx.volume = 0.5;
    await settle();
    expect(fetched.length).toBeGreaterThan(0);
    sfx.play('cannon');
    expect(started).toHaveLength(1);
  });

  it('loops start at their level and glide to new levels', async () => {
    const { sfx, started, route } = setup();
    sfx.volume = 0.5;
    sfx.unlock();
    await settle();
    sfx.setLoops({ ...silent(), waves: 0.5 });
    expect(started).toHaveLength(1);
    const waves = started[0];
    expect(waves.loop).toBe(true);
    expect(new TextDecoder().decode((waves.buffer as { bytes: ArrayBuffer }).bytes)).toBe('waves-1.mp3');
    expect(route(waves).gain?.target).toBeCloseTo(0.5 * 0.5);
    expect(route(waves).gain?.timeConstant).toBe(0.6);
    expect(sfx.voices).toBe(0);
    sfx.setLoops(silent());
    expect(route(waves).gain?.target).toBe(0);
    sfx.setLoops({ ...silent(), waves: 1 });
    expect(started).toHaveLength(1); // the same source, kept alive
    expect(route(waves).gain?.target).toBeCloseTo(0.5);
  });
});
