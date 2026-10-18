import { getInstrument, midiToFrequency, renderPluck } from "@fretlight/core";
import { Soundfont } from "smplr";
import { useSession } from "@/store/session";

/**
 * Sounds a note out loud when the player taps a fret on screen.
 *
 * Notes are modelled plucked strings (Karplus-Strong, see `renderPluck`), shaped
 * by a small per-sound filter chain: body resonance for an acoustic, a pickup
 * bump for an electric, a drive stage for overdrive. Each rendered note is cached
 * as an AudioBuffer. Recorded samples load in the background; the model keeps
 * working when the network is slow or unavailable.
 *
 * Not `ReferenceToneEngine`: that holds one sustained tone and stops it when
 * another starts. Here every pluck gets its own source, so earlier notes keep
 * ringing and decaying while new ones start, as on a real instrument.
 */

type FilterStep =
  | { readonly type: "highpass" | "lowpass"; readonly freq: number }
  | { readonly type: "peaking"; readonly freq: number; readonly gain: number; readonly q: number };

export interface SoundPreset {
  readonly id: string;
  readonly label: string;
  readonly kind: "guitar" | "bass";
  /** Seconds to fall 60 dB for a note near 220 Hz; higher notes are shorter. */
  readonly sustain: number;
  readonly brightness: number;
  readonly position: number;
  /** Waveshaper drive applied after the first filter; 0 = clean. */
  readonly drive: number;
  readonly filters: readonly FilterStep[];
  readonly level: number;
  /** General MIDI instrument recorded in the sample library; played instead of the model once loaded. */
  readonly sample: string;
}

export const SOUND_PRESETS: readonly SoundPreset[] = [
  {
    id: "acoustic", sample: "acoustic_guitar_steel", label: "Acoustic guitar", kind: "guitar",
    sustain: 2.4, brightness: 0.6, position: 0.13, drive: 0, level: 1,
    filters: [
      { type: "highpass", freq: 80 },
      { type: "peaking", freq: 110, gain: 5, q: 1.2 },
      { type: "peaking", freq: 2800, gain: 2, q: 1 },
      { type: "lowpass", freq: 7000 },
    ],
  },
  {
    id: "nylon", sample: "acoustic_guitar_nylon", label: "Classical (nylon)", kind: "guitar",
    sustain: 2.0, brightness: 0.3, position: 0.2, drive: 0, level: 1.1,
    filters: [
      { type: "highpass", freq: 70 },
      { type: "peaking", freq: 130, gain: 4, q: 1 },
      { type: "lowpass", freq: 3200 },
    ],
  },
  {
    id: "clean", sample: "electric_guitar_clean", label: "Electric (clean)", kind: "guitar",
    sustain: 3.2, brightness: 0.5, position: 0.17, drive: 0, level: 1,
    filters: [
      { type: "highpass", freq: 60 },
      { type: "peaking", freq: 2200, gain: 3, q: 0.9 },
      { type: "lowpass", freq: 5500 },
    ],
  },
  {
    id: "overdrive", sample: "overdriven_guitar", label: "Electric (overdrive)", kind: "guitar",
    sustain: 4.0, brightness: 0.65, position: 0.12, drive: 6, level: 0.55,
    filters: [
      { type: "highpass", freq: 90 },
      { type: "peaking", freq: 900, gain: 3, q: 0.8 },
      { type: "lowpass", freq: 3800 },
    ],
  },
  {
    id: "bass-finger", sample: "electric_bass_finger", label: "Bass (fingers)", kind: "bass",
    sustain: 3.4, brightness: 0.25, position: 0.25, drive: 0, level: 1.3,
    filters: [
      { type: "highpass", freq: 28 },
      { type: "peaking", freq: 90, gain: 4, q: 1 },
      { type: "lowpass", freq: 1400 },
    ],
  },
  {
    id: "bass-pick", sample: "electric_bass_pick", label: "Bass (pick)", kind: "bass",
    sustain: 3.0, brightness: 0.6, position: 0.1, drive: 0, level: 1.1,
    filters: [
      { type: "highpass", freq: 28 },
      { type: "peaking", freq: 120, gain: 3, q: 1 },
      { type: "peaking", freq: 1800, gain: 4, q: 1 },
      { type: "lowpass", freq: 3500 },
    ],
  },
];

const STORAGE_KEY = "fretlight.sound";

interface Stored {
  preset: string | null;
  volume: number;
}

function load(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Stored> | null;
    return {
      preset: typeof raw?.preset === "string" ? raw.preset : null,
      volume: typeof raw?.volume === "number" ? Math.max(0, Math.min(1, raw.volume)) : 0.7,
    };
  } catch {
    return { preset: null, volume: 0.7 };
  }
}

function driveCurve(drive: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(2048);
  const norm = Math.tanh(drive);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * x) / norm;
  }
  return curve;
}

export interface PluckOptions {
  readonly when?: number;
  /** Absolute start on the audio clock (from `warm`); wins over `when`. */
  readonly at?: number;
  readonly gain?: number;
  readonly mute?: boolean;
}

export type SampleStatus = "idle" | "loading" | "ready" | "fallback";

interface SamplerEntry {
  player: Soundfont;
  status: SampleStatus;
}

export class FretSynth {
  private active = new Set<AudioBufferSourceNode>();
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private listeners = new Set<() => void>();
  private chosen: string | null = null;
  private volume = 0.7;
  private loaded = false;
  private samplers = new Map<string, SamplerEntry>();
  private stops = new Set<(time?: number) => void>();
  private generation = 0;

  getSampleStatus(): SampleStatus {
    return this.samplers.get(this.getPreset().id)?.status ?? "idle";
  }

  /** Subscribe to preset / volume changes (for useSyncExternalStore). */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private ensureLoaded(): void {
    if (this.loaded || typeof localStorage === "undefined") return;
    this.loaded = true;
    const stored = load();
    this.chosen = SOUND_PRESETS.some((p) => p.id === stored.preset) ? stored.preset : null;
    this.volume = stored.volume;
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ preset: this.chosen, volume: this.volume } satisfies Stored));
    } catch {
      // Private mode: the choice just doesn't outlive the tab.
    }
  }

  /** The user's explicit choice, or null when following the instrument. */
  getChosen(): string | null {
    this.ensureLoaded();
    return this.chosen;
  }

  /** The preset that will actually sound: the choice, else one that suits the instrument. */
  getPreset(): SoundPreset {
    this.ensureLoaded();
    const found = SOUND_PRESETS.find((p) => p.id === this.chosen);
    if (found) return found;
    const kind = getInstrument(useSession.getState().instrumentId)?.kind ?? "guitar";
    return SOUND_PRESETS.find((p) => p.kind === kind)!;
  }

  setPreset(id: string | null): void {
    this.ensureLoaded();
    this.chosen = id && SOUND_PRESETS.some((p) => p.id === id) ? id : null;
    this.save();
    this.emit();
  }

  getVolume(): number {
    this.ensureLoaded();
    return this.volume;
  }

  setVolume(volume: number): void {
    this.ensureLoaded();
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.master) this.master.gain.value = this.volume;
    this.save();
    this.emit();
  }

  /** Seconds on the audio clock, or 0 before any sound has played. */
  currentTime(): number {
    return this.context?.currentTime ?? 0;
  }

  /** Silence everything that is sounding or scheduled. */
  stopAll(): void {
    // Also cancel plucks still awaiting AudioContext.resume().
    this.generation++;
    for (const source of this.active) {
      try {
        source.stop();
      } catch {
        // already ended
      }
    }
    this.active.clear();
    for (const stop of this.stops) stop();
    this.stops.clear();
  }

  dispose(): void {
    this.stopAll();
    void this.context?.close();
    this.context = null;
    this.master = null;
    this.buffers.clear();
    this.samplers.clear();
    this.emit();
  }

  /**
   * Pluck `midi` with the current sound and let it ring and decay on its own.
   * `when` delays the note on the audio clock (seconds), `gain` scales it, and
   * `mute` chokes it after a moment, like a palm-muted or scratched string.
   */
  async pluck(midi: number, preset: SoundPreset = this.getPreset(), options: PluckOptions = {}): Promise<void> {
    const generation = this.generation;
    const context = await this.ensureContext();
    if (generation !== this.generation || context !== this.context) return;
    const now = Math.max(context.currentTime, options.at ?? context.currentTime + (options.when ?? 0));

    // Recorded guitar/bass samples once they have downloaded; the modelled string until then (or offline).
    const sampler = this.samplerFor(context, preset);
    if (sampler.status === "ready") {
      const velocity = Math.round(Math.max(1, Math.min(127, 96 * (options.gain ?? 1))));
      const stop = sampler.player.start({ note: midi, time: now, velocity, ...(options.mute ? { duration: 0.12 } : {}) });
      this.stops.add(stop);
      setTimeout(() => this.stops.delete(stop), Math.max(0, (now - context.currentTime) * 1000) + 8000);
      return;
    }

    const buffer = this.bufferFor(context, preset, midi);

    const source = context.createBufferSource();
    source.buffer = buffer;

    const nodes: AudioNode[] = [source];
    let tail: AudioNode = source;
    const chain = (node: AudioNode) => {
      tail.connect(node);
      tail = node;
      nodes.push(node);
    };

    preset.filters.forEach((step, index) => {
      const filter = context.createBiquadFilter();
      filter.type = step.type;
      filter.frequency.value = step.freq;
      if (step.type === "peaking") {
        filter.gain.value = step.gain;
        filter.Q.value = step.q;
      }
      chain(filter);
      // Distortion goes after the first (high-pass) filter so low rumble doesn't get clipped.
      if (index === 0 && preset.drive > 0) {
        const shaper = context.createWaveShaper();
        shaper.curve = driveCurve(preset.drive);
        shaper.oversample = "2x";
        chain(shaper);
      }
    });

    const level = context.createGain();
    const peak = preset.level * (options.gain ?? 1);
    level.gain.setValueAtTime(peak, now);
    if (options.mute) level.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    chain(level);
    level.connect(this.master!);

    this.active.add(source);
    source.onended = () => {
      this.active.delete(source);
      for (const node of nodes) node.disconnect();
    };
    source.start(now);
    if (options.mute) source.stop(now + 0.2);
  }

  /** One sample player per sound, created on first use and loaded in the background. */
  private samplerFor(context: AudioContext, preset: SoundPreset): SamplerEntry {
    let entry = this.samplers.get(preset.id);
    if (!entry) {
      const created: SamplerEntry = {
        player: new Soundfont(context, { kit: "MusyngKite", instrument: preset.sample, destination: this.master! }),
        status: "loading",
      };
      created.player.load.then(
        () => {
          created.status = "ready";
          if (this.samplers.get(preset.id) === created) this.emit();
        },
        () => {
          // No network: keep using the modelled string for this sound.
          created.status = "fallback";
          if (this.samplers.get(preset.id) === created) this.emit();
        },
      );
      this.samplers.set(preset.id, created);
      this.emit();
      entry = created;
    }
    return entry;
  }

  /**
   * Start downloading the samples for a sound (or wait up to `timeoutMs` for
   * them), so the first notes of a phrase already use the recorded instrument.
   */
  async preload(preset: SoundPreset = this.getPreset(), timeoutMs = 4000): Promise<boolean> {
    const context = await this.ensureContext();
    const entry = this.samplerFor(context, preset);
    if (entry.status === "ready") return true;
    if (entry.status === "fallback") return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        entry.player.load.catch(() => null),
        new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    return this.samplers.get(preset.id) === entry && this.samplers.get(preset.id)?.status === "ready";
  }

  private bufferFor(context: AudioContext, preset: SoundPreset, midi: number): AudioBuffer {
    const key = `${preset.id}:${midi}`;
    let buffer = this.buffers.get(key);
    if (!buffer) {
      const frequency = midiToFrequency(midi);
      const sustain = preset.sustain * Math.min(2, Math.max(0.4, (220 / frequency) ** 0.4));
      const samples = renderPluck({
        frequency,
        sampleRate: context.sampleRate,
        decaySeconds: sustain,
        brightness: preset.brightness,
        position: preset.position,
        seed: midi * 7 + 3,
      });
      buffer = context.createBuffer(1, samples.length, context.sampleRate);
      buffer.getChannelData(0).set(samples);
      this.buffers.set(key, buffer);
    }
    return buffer;
  }

  /**
   * Render the notes of a phrase ahead of time and return the audio clock, so a
   * whole phrase can then be scheduled against one start time with no drift.
   */
  async warm(items: readonly { midi: number; preset?: SoundPreset }[]): Promise<number> {
    const generation = this.generation;
    const context = await this.ensureContext();
    if (generation !== this.generation || context !== this.context) return context.currentTime;
    const presets = new Set(items.map((item) => item.preset ?? this.getPreset()));
    await Promise.all([...presets].map((preset) => this.preload(preset, 2500)));
    if (generation !== this.generation || context !== this.context) return context.currentTime;
    for (const item of items) {
      const preset = item.preset ?? this.getPreset();
      if (this.samplers.get(preset.id)?.status !== "ready") this.bufferFor(context, preset, item.midi);
    }
    return context.currentTime;
  }

  private async ensureContext(): Promise<AudioContext> {
    this.ensureLoaded();
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: "interactive" });
      // The compressor keeps a 6-note chord from clipping without turning single notes down.
      const compressor = this.context.createDynamicsCompressor();
      compressor.threshold.value = -14;
      compressor.ratio.value = 6;
      this.master = this.context.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(compressor).connect(this.context.destination);
    }
    const context = this.context;
    if (context.state === "suspended" || (context.state as string) === "interrupted") await context.resume();
    return context;
  }
}

/** One instance for the whole app, so every page sounds the same. */
export const fretSynth = new FretSynth();
