/** Plays the sound effects and the ambience loops through Web Audio. A sound with no files is silence. */
import { variantsOf } from './files';
import { falloff, pickVariant, pitchFor, VoicePool } from './mix';
import { LOOP_IDS, type LoopId, SOUND_IDS, SOUNDS, type SfxName, type SoundId } from './sounds';

/** Where a sound is: world units from the camera's focus, and its stereo pan (-1 left to 1 right). */
export interface Placement {
  distance: number;
  pan: number;
}

export interface PlayOptions {
  /** Where it is; heard centred at full strength without. */
  at?: Placement;
  /** A further gain, 0 to 1. */
  gain?: number;
}

interface ParamLike {
  value: number;
  setTargetAtTime(target: number, startTime: number, timeConstant: number): unknown;
}

interface NodeLike {
  connect(destination: NodeLike): unknown;
  disconnect(): void;
}

interface GainLike extends NodeLike {
  readonly gain: ParamLike;
}

interface PannerLike extends NodeLike {
  readonly pan: ParamLike;
}

interface SourceLike extends NodeLike {
  buffer: object | null;
  loop: boolean;
  readonly playbackRate: ParamLike;
  onended: ((ev: Event) => unknown) | null;
  start(): void;
  stop(): void;
}

/** The slice of Web Audio the engine uses (a fake in tests). */
export interface AudioContextLike {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: NodeLike;
  resume(): Promise<void>;
  createGain(): GainLike;
  createStereoPanner(): PannerLike;
  createBufferSource(): SourceLike;
  decodeAudioData(data: ArrayBuffer): Promise<object>;
}

/** Seconds for a loop's gain to get most of the way to a new level. */
const LOOP_GLIDE = 0.6;

interface Voice {
  source: SourceLike;
  gain: GainLike;
  panner: PannerLike;
}

interface Loop {
  source: SourceLike;
  gain: GainLike;
}

function fetchBytes(url: string): Promise<ArrayBuffer> {
  return fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.arrayBuffer();
  });
}

export class Sfx {
  private readonly makeContext: () => AudioContextLike;
  private readonly fetchBytes: (url: string) => Promise<ArrayBuffer>;
  private readonly random: () => number;
  private readonly files: (name: SfxName) => readonly string[];

  private context: AudioContextLike | null = null;
  private master: GainLike | null = null;
  private level = 1;
  /** Decoded buffers by URL. */
  private readonly buffers = new Map<string, object>();
  /** URLs fetched or being fetched: each is asked for once, and a failure stays silent. */
  private readonly requested = new Set<string>();
  /** The take each sound played last, so the next is a different one. */
  private readonly lastTake = new Map<SfxName, number>();
  private readonly pool = new VoicePool<Voice>();
  private readonly loops = new Map<LoopId, Loop>();
  private loopLevels: Readonly<Record<LoopId, number>> | null = null;

  constructor(
    options: {
      context?: () => AudioContextLike;
      fetchBytes?: (url: string) => Promise<ArrayBuffer>;
      random?: () => number;
      files?: (name: SfxName) => readonly string[];
    } = {},
  ) {
    this.makeContext = options.context ?? (() => new AudioContext());
    this.fetchBytes = options.fetchBytes ?? fetchBytes;
    this.random = options.random ?? Math.random;
    this.files = options.files ?? variantsOf;
  }

  /** How loud the effects are, 0 (off) to 1. */
  set volume(v: number) {
    const rising = this.level <= 0 && v > 0;
    this.level = v;
    if (rising) this.load();
    if (this.loopLevels) this.setLoops(this.loopLevels);
  }

  /** Live one-shot voices. */
  get voices(): number {
    return this.pool.size;
  }

  /** Start sound, after the player's first key press or click (browsers won't before). Safe to call again. */
  unlock(): void {
    if (!this.context) {
      try {
        this.context = this.makeContext();
      } catch {
        return; // no Web Audio here: the game stays silent
      }
      this.master = this.context.createGain();
      this.master.connect(this.context.destination);
      this.load();
    }
    if (this.context.state === 'suspended') this.context.resume().catch(() => {});
  }

  /** Play a sound once, if it's in reach and its files have loaded. */
  play(id: SoundId, options: PlayOptions = {}): void {
    const { context, master } = this;
    if (!context || !master || this.level <= 0) return;
    const spec = SOUNDS[id];
    const reach = options.at ? falloff(options.at.distance, spec.reach) : 1;
    if (reach <= 0) return;
    const buffer = this.take(id);
    if (!buffer) return;

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = pitchFor(spec.pitch, this.random);
    const gain = context.createGain();
    gain.gain.value = this.level * spec.volume * (options.gain ?? 1) * reach;
    const panner = context.createStereoPanner();
    panner.pan.value = options.at?.pan ?? 0;
    source.connect(gain);
    gain.connect(panner);
    panner.connect(master);

    const voice: Voice = { source, gain, panner };
    source.onended = () => {
      this.pool.release(voice);
      source.disconnect();
      gain.disconnect();
      panner.disconnect();
    };
    for (const cut of this.pool.admit(spec.group ?? id, spec.cap, voice)) {
      try {
        cut.source.stop();
      } catch {
        // already stopped
      }
    }
    source.start();
  }

  /** Set each ambience loop's level, 0 to 1; they glide there. A loop starts on its first level above 0 and keeps running. */
  setLoops(levels: Readonly<Record<LoopId, number>>): void {
    this.loopLevels = levels;
    const { context, master } = this;
    if (!context || !master) return;
    for (const id of LOOP_IDS) {
      const target = this.level * SOUNDS[id].volume * levels[id];
      let loop = this.loops.get(id);
      if (!loop) {
        if (target <= 0) continue;
        const buffer = this.take(id);
        if (!buffer) continue;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        const gain = context.createGain();
        gain.gain.value = 0;
        source.connect(gain);
        gain.connect(master);
        source.start();
        loop = { source, gain };
        this.loops.set(id, loop);
      }
      loop.gain.gain.setTargetAtTime(target, context.currentTime, LOOP_GLIDE);
    }
  }

  /** A decoded take of the sound, not the one it played last; null if none has loaded. */
  private take(name: SfxName): object | null {
    const urls = this.files(name);
    const i = pickVariant(urls.length, this.lastTake.get(name) ?? -1, this.random);
    const buffer = i < 0 ? undefined : this.buffers.get(urls[i]);
    if (!buffer) return null;
    this.lastTake.set(name, i);
    return buffer;
  }

  /** Fetch and decode every sound's files not yet asked for, unless the effects are off. */
  private load(): void {
    const context = this.context;
    if (!context || this.level <= 0) return;
    for (const name of [...SOUND_IDS, ...LOOP_IDS]) {
      for (const url of this.files(name)) {
        if (this.requested.has(url)) continue;
        this.requested.add(url);
        this.fetchBytes(url)
          .then((bytes) => context.decodeAudioData(bytes))
          .then((buffer) => this.buffers.set(url, buffer))
          .catch(() => {
            // A missing or broken file is silence, not an error.
          });
      }
    }
  }
}
