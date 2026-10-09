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

interface CompressorLike extends NodeLike {
  readonly threshold: ParamLike;
  readonly knee: ParamLike;
  readonly ratio: ParamLike;
  readonly attack: ParamLike;
  readonly release: ParamLike;
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
  suspend(): Promise<void>;
  createGain(): GainLike;
  createStereoPanner(): PannerLike;
  createDynamicsCompressor(): CompressorLike;
  createBufferSource(): SourceLike;
  decodeAudioData(data: ArrayBuffer): Promise<object>;
}

/** Seconds for a loop's gain to get most of the way to a new level. */
const LOOP_GLIDE = 0.6;
/** A loop's level changing by less than this isn't glided to afresh (but 0 always is). */
const LOOP_STEADY = 0.001;

interface Voice {
  source: SourceLike;
  gain: GainLike;
  panner: PannerLike;
}

interface Loop {
  source: SourceLike;
  gain: GainLike;
  /** The level it's gliding to. */
  target: number;
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
  private tabHidden = false;

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
    // The game's frames stop in a hidden tab, so nothing could quieten the loops: the context is held instead.
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => (this.hidden = document.hidden));
  }

  /** Whether the tab is hidden: then all sound is held, and it carries on when the tab comes back. */
  set hidden(h: boolean) {
    this.tabHidden = h;
    const context = this.context;
    if (!context) return;
    if (h) context.suspend().catch(() => {});
    else if (context.state === 'suspended') context.resume().catch(() => {});
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
      // A limiter at the end, so a full broadside (eight cannon at once) is loud but never clips.
      const limiter = this.context.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 3;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.2;
      this.master.connect(limiter);
      limiter.connect(this.context.destination);
      this.load();
    }
    if (this.context.state === 'suspended' && !this.tabHidden) this.context.resume().catch(() => {});
  }

  /** Play a sound once, if it's in reach and its files have loaded. */
  play(id: SoundId, options: PlayOptions = {}): void {
    if (!this.context || !this.master || this.level <= 0) return;
    const reach = options.at ? falloff(options.at.distance, SOUNDS[id].reach) : 1;
    if (reach <= 0) return;
    const buffer = this.take(id);
    if (buffer) this.start(id, buffer, options, reach);
  }

  /** Play exactly one take (counting from 0) of a sound or loop, once, centred at full strength: for the dev sound board. */
  playTake(id: SfxName, take: number): void {
    const url = this.files(id)[take];
    const buffer = url === undefined ? undefined : this.buffers.get(url);
    if (buffer && this.level > 0) this.start(id, buffer, {}, 1);
  }

  private start(id: SfxName, buffer: object, options: PlayOptions, reach: number): void {
    const { context, master } = this;
    if (!context || !master) return;
    const spec = SOUNDS[id];
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
        loop = { source, gain, target: NaN };
        this.loops.set(id, loop);
      }
      // Silence is always glided to exactly.
      if (target === loop.target || (target > 0 && Math.abs(target - loop.target) <= LOOP_STEADY)) continue;
      loop.target = target;
      loop.gain.gain.setTargetAtTime(target, context.currentTime, LOOP_GLIDE);
    }
  }

  /** A decoded take of the sound, not the one it played last (of those that have loaded); null if none has. */
  private take(name: SfxName): object | null {
    const urls = this.files(name);
    const ready: number[] = [];
    urls.forEach((url, i) => {
      if (this.buffers.has(url)) ready.push(i);
    });
    const pick = pickVariant(ready.length, ready.indexOf(this.lastTake.get(name) ?? -1), this.random);
    if (pick < 0) return null;
    const i = ready[pick];
    this.lastTake.set(name, i);
    return this.buffers.get(urls[i]) ?? null;
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
