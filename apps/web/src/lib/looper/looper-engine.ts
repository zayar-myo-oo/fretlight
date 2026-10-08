"use client";

import {
  GATE_THRESHOLDS,
  type GateLevel,
  type LoopMode,
  clearRegion,
  encodeWav,
  levelOf,
  mixTracks,
  peaksOf,
  positionInfo,
  repeatLoop,
  replaceRegion,
  secondsPerBar,
  snapLoopSeconds,
} from "@fretlight/core";
import { MetronomeEngine } from "@/lib/audio/metronome-engine";

/**
 * The Companion looper.
 *
 * One AudioContext runs everything, so recording, playback and the metronome
 * share a single sample clock and stay locked together:
 *
 *   input -> gain -> high-pass -> (lookahead) noise gate -> compressor -> recorder worklet
 *
 * The first take fixes the loop length. Each later take is recorded for exactly
 * one loop, starting on a loop boundary, so every line is the same length and
 * `loop = true` on its buffer keeps all of them in step indefinitely. Audio is
 * only ever held in memory here: nothing is uploaded, and nothing is stored.
 */

export type TrackKind = "rhythm" | "lead" | "bass" | "melody" | "guitar" | "other";
export type Phase = "empty" | "counting" | "recording" | "playing" | "paused" | "stopped";

export interface LooperTrack {
  readonly id: string;
  readonly name: string;
  readonly kind: TrackKind;
  readonly samples: Float32Array;
  readonly peaks: Float32Array;
  readonly volume: number;
  readonly muted: boolean;
  readonly solo: boolean;
}

export interface LooperSettings {
  readonly bpm: number;
  readonly beatsPerBar: number;
  readonly countInBars: 0 | 1 | 2;
  readonly metronome: boolean;
  readonly loopMode: LoopMode;
  readonly gate: GateLevel;
  /** 0..2, linear. */
  readonly inputGain: number;
  readonly compressor: boolean;
  readonly monitor: boolean;
  readonly latencyMs: number;
  readonly deviceId: string;
}

export interface RecordingInfo {
  readonly master: boolean;
  readonly trackId: string | null;
  readonly kind: TrackKind;
  readonly name: string;
  readonly region: { readonly start: number; readonly end: number } | null;
  /** Audio-clock time the take starts (after any count-in). */
  readonly startsAt: number;
  readonly beatSeconds: number;
}

export interface LooperState {
  readonly phase: Phase;
  readonly tracks: readonly LooperTrack[];
  readonly loopSeconds: number | null;
  readonly bars: number | null;
  readonly settings: LooperSettings;
  readonly recording: RecordingInfo | null;
  readonly inputReady: boolean;
  readonly error: string | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

interface Snapshot {
  readonly tracks: readonly LooperTrack[];
  readonly loopSeconds: number | null;
  readonly bars: number | null;
}

interface Take {
  readonly chunks: Float32Array[];
  total: number;
  readonly startFrame: number;
  readonly needed: number | null; // frames to keep after latency compensation, known for overdubs
  resolve: (samples: Float32Array) => void;
}

const DEFAULTS: LooperSettings = {
  bpm: 90,
  beatsPerBar: 4,
  countInBars: 1,
  metronome: true,
  loopMode: "musical",
  gate: "low",
  inputGain: 1,
  compressor: false,
  monitor: false,
  latencyMs: 40,
  deviceId: "",
};

let nextId = 1;
const newId = () => `track-${nextId++}`;

export class LooperEngine {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private nodes: {
    source: MediaStreamAudioSourceNode;
    inGain: GainNode;
    hpf: BiquadFilterNode;
    analyser: AnalyserNode;
    delay: DelayNode;
    gate: GainNode;
    comp: DynamicsCompressorNode;
    recorder: AudioWorkletNode;
    monitor: GainNode;
  } | null = null;
  private master: GainNode | null = null;
  private metronome: MetronomeEngine | null = null;
  private metronomeStop: ReturnType<typeof setTimeout> | undefined;
  private phaseTimer: ReturnType<typeof setTimeout> | undefined;
  private gateTimer: ReturnType<typeof setInterval> | null = null;
  private analyserBuffer = new Float32Array(512);
  private peak = 0;
  private clipUntil = 0;
  private gateOpen = true;
  private gateHeldUntil = 0;

  private listeners = new Set<() => void>();
  private state: LooperState;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];

  private buffers = new Map<string, AudioBuffer>();
  private gains = new Map<string, GainNode>();
  private sources = new Map<string, AudioBufferSourceNode>();
  private loopStart = 0;
  private pausedAt = 0;
  private take: Take | null = null;
  private cancelled = false;

  constructor() {
    this.state = {
      phase: "empty",
      tracks: [],
      loopSeconds: null,
      bars: null,
      settings: DEFAULTS,
      recording: null,
      inputReady: false,
      error: null,
      canUndo: false,
      canRedo: false,
    };
  }

  // ---------------------------------------------------------------- state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): LooperState => this.state;

  private set(patch: Partial<LooperState>): void {
    this.state = {
      ...this.state,
      ...patch,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    };
    for (const listener of this.listeners) listener();
  }

  /** Change settings. Once a loop exists, tempo, bar length and loop mode are part of it and stay fixed. */
  configure(patch: Partial<LooperSettings>): void {
    const { bpm, beatsPerBar, loopMode } = this.state.settings;
    const locked = this.state.tracks.length > 0;
    const settings: LooperSettings = { ...this.state.settings, ...patch, ...(locked ? { bpm, beatsPerBar, loopMode } : {}) };
    this.set({ settings });
    this.applyInputSettings();
    if (patch.metronome !== undefined && this.state.phase === "playing") {
      if (settings.metronome && settings.loopMode === "musical") {
        this.metronome?.stop();
        void this.metronome?.start(this.loopStart);
      } else this.metronome?.stop();
    }
  }

  /** Audio-clock seconds (0 before the first sound). */
  now(): number {
    return this.context?.currentTime ?? 0;
  }

  get sampleRate(): number {
    return this.context?.sampleRate ?? 44100;
  }

  /** Seconds into the loop, or null when it is not playing. */
  position(): number | null {
    const { phase, loopSeconds } = this.state;
    if (!loopSeconds) return null;
    if (phase === "paused") return this.pausedAt;
    if (phase !== "playing" || !this.context) return phase === "stopped" ? 0 : null;
    return (((this.context.currentTime - this.loopStart) % loopSeconds) + loopSeconds) % loopSeconds;
  }

  barPosition() {
    const position = this.position();
    const { loopSeconds, settings } = this.state;
    if (position === null || !loopSeconds) return null;
    return positionInfo(position, loopSeconds, settings.bpm, settings.beatsPerBar);
  }

  /** Current input level 0..1 and whether it has recently clipped. */
  level(): { peak: number; clipping: boolean } {
    const now = this.context?.currentTime ?? 0;
    return { peak: this.peak, clipping: now < this.clipUntil };
  }

  // ---------------------------------------------------------------- input

  private async ensureContext(): Promise<AudioContext> {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: "interactive" });
      this.master = this.context.createGain();
      this.master.connect(this.context.destination);
      this.metronome = new MetronomeEngine({
        bpm: this.state.settings.bpm,
        timeSignature: { beats: this.state.settings.beatsPerBar, value: 4 },
        subdivision: "quarter",
        accentFirstBeat: true,
      });
      this.metronome.attach(this.context, this.context.destination);
      this.metronome.setVolume(0.5);
    }
    if (this.context.state === "suspended") await this.context.resume();
    return this.context;
  }

  /** Open an input device. Must come from a click (browsers require a gesture for audio). */
  async enableInput(deviceId = this.state.settings.deviceId): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          // Voice-call processing would colour the guitar; the looper does its own, lighter cleanup.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: { ideal: 1 },
        },
      });
      await this.useStream(stream);
      if (deviceId !== this.state.settings.deviceId) this.set({ settings: { ...this.state.settings, deviceId } });
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      this.set({
        inputReady: false,
        error:
          name === "NotAllowedError"
            ? "Microphone access was blocked. Allow it in the address bar, then try again."
            : name === "NotFoundError"
              ? "No audio input found. Plug in your interface and try again."
              : name === "NotReadableError"
                ? "The input is in use by another app."
                : "Couldn't open the audio input.",
      });
    }
  }

  /** Use an existing MediaStream as the input (also how the looper is tested without a microphone). */
  async useStream(stream: MediaStream): Promise<void> {
    const context = await this.ensureContext();
    this.closeInput();
    this.stream = stream;

    if (!this.nodes) {
      await context.audioWorklet.addModule("/worklets/looper-recorder.js");
    }
    const source = context.createMediaStreamSource(stream);
    const inGain = context.createGain();
    const hpf = context.createBiquadFilter();
    hpf.type = "highpass";
    hpf.frequency.value = 70; // below the low E of a guitar (82 Hz) and bass B; removes rumble and hum
    hpf.Q.value = 0.7;
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    // A short delay on the audio path lets the gate open *before* the note arrives.
    const delay = context.createDelay(0.05);
    delay.delayTime.value = 0.012;
    const gate = context.createGain();
    const comp = context.createDynamicsCompressor();
    const recorder = new AudioWorkletNode(context, "looper-recorder", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    const monitor = context.createGain();
    const silent = context.createGain();
    silent.gain.value = 0;

    source.connect(inGain).connect(hpf);
    hpf.connect(analyser);
    hpf.connect(delay).connect(gate).connect(comp);
    comp.connect(recorder);
    comp.connect(monitor).connect(context.destination);
    recorder.connect(silent).connect(context.destination);

    recorder.port.onmessage = (event: MessageEvent) => this.onRecorderMessage(event.data);
    this.nodes = { source, inGain, hpf, analyser, delay, gate, comp, recorder, monitor };

    this.applyInputSettings();
    this.startGateLoop();
    const estimate = Math.round(((context.baseLatency || 0) + (context.outputLatency || 0)) * 1000 + 12 + 8);
    this.set({ inputReady: true, error: null, settings: { ...this.state.settings, latencyMs: Math.min(250, Math.max(20, estimate)) } });
  }

  private closeInput(): void {
    if (this.gateTimer) clearInterval(this.gateTimer);
    this.gateTimer = null;
    this.nodes?.source.disconnect();
    this.nodes?.recorder.disconnect();
    this.nodes?.recorder.port.close();
    this.nodes = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
  }

  private applyInputSettings(): void {
    const n = this.nodes;
    const context = this.context;
    if (!n || !context) return;
    const s = this.state.settings;
    n.inGain.gain.setTargetAtTime(s.inputGain, context.currentTime, 0.01);
    n.monitor.gain.setTargetAtTime(s.monitor ? 1 : 0, context.currentTime, 0.01);
    // Light, transparent compression: only tames big peaks.
    n.comp.threshold.value = s.compressor ? -20 : 0;
    n.comp.ratio.value = s.compressor ? 3 : 1;
    n.comp.knee.value = 18;
    n.comp.attack.value = 0.008;
    n.comp.release.value = 0.2;
    if (GATE_THRESHOLDS[s.gate] === 0) n.gate.gain.setTargetAtTime(1, context.currentTime, 0.005);
  }

  /** Watches the input and opens / closes the gate; also feeds the level meter. */
  private startGateLoop(): void {
    this.gateTimer = setInterval(() => {
      const n = this.nodes;
      const context = this.context;
      if (!n || !context) return;
      n.analyser.getFloatTimeDomainData(this.analyserBuffer);
      let sum = 0;
      for (const v of this.analyserBuffer) sum += v * v;
      const rms = Math.sqrt(sum / this.analyserBuffer.length);
      const { peak, clipping } = levelOf(this.analyserBuffer);
      this.peak = Math.max(peak, this.peak * 0.9);
      if (clipping) this.clipUntil = context.currentTime + 1.2;

      const threshold = GATE_THRESHOLDS[this.state.settings.gate];
      if (threshold === 0) return;
      const now = context.currentTime;
      if (rms > threshold) {
        this.gateOpen = true;
        this.gateHeldUntil = now + 0.15; // hold, so a decaying note is not chopped
      } else if (now > this.gateHeldUntil) this.gateOpen = false;
      n.gate.gain.setTargetAtTime(this.gateOpen ? 1 : 0, now, this.gateOpen ? 0.002 : 0.03);
    }, 8);
  }

  // ------------------------------------------------------------ recording

  private onRecorderMessage(data: { type: string; data?: Float32Array; frames?: number }): void {
    const take = this.take;
    if (!take) return;
    if (data.type === "chunk" && data.data) {
      take.chunks.push(data.data);
      take.total += data.data.length;
    } else if (data.type === "done") {
      const all = new Float32Array(take.total);
      let offset = 0;
      for (const chunk of take.chunks) {
        all.set(chunk, offset);
        offset += chunk.length;
      }
      this.take = null;
      take.resolve(all);
    }
  }

  private beginTake(startFrame: number, endFrame: number | null, needed: number | null): Promise<Float32Array> {
    return new Promise((resolve) => {
      this.take = { chunks: [], total: 0, startFrame, needed, resolve };
      this.nodes!.recorder.port.postMessage({ type: "start", startFrame, ...(endFrame !== null ? { endFrame } : {}) });
    });
  }

  private latencyFrames(): number {
    return Math.round((this.state.settings.latencyMs / 1000) * this.sampleRate);
  }

  private async prepare(): Promise<AudioContext | null> {
    if (!this.nodes) await this.enableInput();
    if (!this.nodes) return null;
    const context = await this.ensureContext();
    this.cancelled = false;
    return context;
  }

  /** Record the first line. Its length becomes the loop. */
  async recordMaster(kind: TrackKind, name: string): Promise<void> {
    if (this.state.tracks.length > 0 || this.state.recording) return;
    const context = await this.prepare();
    if (!context) return;
    const s = this.state.settings;
    const beat = 60 / s.bpm;
    const bar = secondsPerBar(s.bpm, s.beatsPerBar);
    const anchor = context.currentTime + 0.15;
    const startsAt = anchor + s.countInBars * bar;

    this.metronome?.stop();
    this.metronome?.update({ bpm: s.bpm, timeSignature: { beats: s.beatsPerBar, value: 4 } });
    if (s.metronome || s.countInBars > 0) await this.metronome?.start(anchor);
    if (!s.metronome) this.stopMetronomeAt(startsAt);

    this.set({ phase: s.countInBars > 0 ? "counting" : "recording", recording: { master: true, trackId: null, kind, name, region: null, startsAt, beatSeconds: beat }, error: null });
    this.scheduleRecordingPhase(startsAt);

    const startFrame = Math.round(startsAt * context.sampleRate);
    const pending = this.beginTake(startFrame, null, null);
    this.masterTake = { pending, startsAt, kind, name };
  }

  private masterTake: { pending: Promise<Float32Array>; startsAt: number; kind: TrackKind; name: string } | null = null;

  /** Stop the first line: this is the moment the loop length is decided. */
  async stopMaster(): Promise<void> {
    const context = this.context;
    const take = this.masterTake;
    if (!context || !take || !this.nodes) return;
    this.masterTake = null;
    const s = this.state.settings;

    const now = context.currentTime;
    if (now <= take.startsAt + 0.2) {
      this.cancelRecording();
      return;
    }
    const duration = now - take.startsAt;
    const snap = snapLoopSeconds(duration, s.bpm, s.beatsPerBar, s.loopMode);
    const sr = context.sampleRate;
    const loopFrames = Math.round(snap.seconds * sr);
    const comp = this.latencyFrames();
    const startFrame = Math.round(take.startsAt * sr);

    // If rounding up to a whole bar, keep listening until that bar is complete.
    this.nodes.recorder.port.postMessage({ type: "end", endFrame: startFrame + loopFrames + comp });
    const raw = await take.pending;
    if (this.cancelled) return;

    const samples = new Float32Array(loopFrames);
    for (let i = 0; i < loopFrames; i++) samples[i] = raw[i + comp] ?? 0;
    const track = this.makeTrack(take.name, take.kind, samples);

    this.commit();
    this.set({ tracks: [track], loopSeconds: loopFrames / sr, bars: snap.bars, recording: null, phase: "stopped" });
    this.rebuildBuffers();
    if (!(s.metronome && s.loopMode === "musical")) this.metronome?.stop();
    this.startPlayback(take.startsAt);
  }

  /** Record another line over the loop, starting at the next loop boundary after the count-in. */
  async recordOverdub(
    kind: TrackKind,
    name: string,
    options: { replaceId?: string; region?: { start: number; end: number } } = {},
  ): Promise<void> {
    const { loopSeconds } = this.state;
    if (!loopSeconds || this.state.recording) return;
    const context = await this.prepare();
    if (!context) return;
    const s = this.state.settings;
    const sr = context.sampleRate;
    const beat = 60 / s.bpm;
    const bar = secondsPerBar(s.bpm, s.beatsPerBar);

    if (this.state.phase !== "playing") this.startPlayback();
    const countIn = s.countInBars * bar;
    const earliest = context.currentTime + countIn + 0.12;
    const cycles = Math.max(0, Math.ceil((earliest - this.loopStart) / loopSeconds));
    const startsAt = this.loopStart + cycles * loopSeconds;

    // Count-in clicks lead into the loop start, on the same beat grid.
    if (s.countInBars > 0 && !(s.metronome && s.loopMode === "musical")) {
      await this.metronome?.start(startsAt - countIn);
      this.stopMetronomeAt(startsAt);
    }

    this.set({
      phase: "counting",
      recording: { master: false, trackId: options.replaceId ?? null, kind, name, region: options.region ?? null, startsAt, beatSeconds: beat },
      error: null,
    });
    this.scheduleRecordingPhase(startsAt);

    const loopFrames = Math.round(loopSeconds * sr);
    const comp = this.latencyFrames();
    const startFrame = Math.round(startsAt * sr);
    const raw = await this.beginTake(startFrame, startFrame + loopFrames + comp, loopFrames);
    if (this.cancelled) return;

    const samples = new Float32Array(loopFrames);
    for (let i = 0; i < loopFrames; i++) samples[i] = raw[i + comp] ?? 0;

    this.commit();
    if (options.replaceId) {
      const existing = this.state.tracks.find((t) => t.id === options.replaceId);
      if (existing) {
        const next = options.region ? replaceRegion(existing.samples, samples, sr, options.region.start, options.region.end) : samples;
        this.set({ tracks: this.state.tracks.map((t) => (t.id === existing.id ? { ...t, samples: next, peaks: peaksOf(next, 600) } : t)), recording: null });
      } else this.set({ recording: null });
    } else {
      this.set({ tracks: [...this.state.tracks, this.makeTrack(name, kind, samples)], recording: null });
    }
    this.set({ phase: this.state.phase === "counting" || this.state.phase === "recording" ? "playing" : this.state.phase });
    this.rebuildSources();
  }

  cancelRecording(): void {
    this.cancelled = true;
    this.masterTake = null;
    this.take = null;
    this.nodes?.recorder.port.postMessage({ type: "cancel" });
    clearTimeout(this.phaseTimer);
    const { tracks } = this.state;
    if (!tracks.length) {
      this.metronome?.stop();
      this.set({ phase: "empty", recording: null });
    } else this.set({ phase: this.sources.size ? "playing" : "stopped", recording: null });
  }

  private scheduleRecordingPhase(startsAt: number): void {
    clearTimeout(this.phaseTimer);
    const wait = Math.max(0, (startsAt - (this.context?.currentTime ?? 0)) * 1000);
    this.phaseTimer = setTimeout(() => {
      if (this.state.recording) this.set({ phase: "recording" });
    }, wait);
  }

  private stopMetronomeAt(time: number): void {
    clearTimeout(this.metronomeStop);
    const wait = Math.max(0, (time - (this.context?.currentTime ?? 0)) * 1000);
    this.metronomeStop = setTimeout(() => this.metronome?.stop(), wait);
  }

  // ------------------------------------------------------------- playback

  /** Play the loop. `loopStart` is the audio-clock time that is position 0 (any whole number of loops back). */
  startPlayback(anchor?: number): void {
    const context = this.context;
    const { loopSeconds, tracks, settings } = this.state;
    if (!context || !loopSeconds || tracks.length === 0) return;
    if (this.state.phase === "playing" && anchor === undefined) return;

    const when = context.currentTime + 0.06;
    if (anchor !== undefined) {
      // Join the loop in step with the clock the take was recorded against.
      const offset = (((when - anchor) % loopSeconds) + loopSeconds) % loopSeconds;
      this.loopStart = when - offset;
    } else {
      this.loopStart = when - (this.state.phase === "paused" ? this.pausedAt : 0);
    }
    this.stopSources();
    this.rebuildBuffers();
    this.startSources(when);
    if (settings.metronome && settings.loopMode === "musical") {
      this.metronome?.stop();
      void this.metronome?.start(this.loopStart);
    }
    this.set({ phase: "playing" });
  }

  pause(): void {
    if (this.state.phase !== "playing") return;
    this.pausedAt = this.position() ?? 0;
    this.stopSources();
    this.metronome?.stop();
    this.set({ phase: "paused" });
  }

  stop(): void {
    if (this.state.recording) {
      this.cancelRecording();
      return;
    }
    this.stopSources();
    this.metronome?.stop();
    this.pausedAt = 0;
    if (this.state.tracks.length) this.set({ phase: "stopped" });
  }

  restart(): void {
    this.stopSources();
    this.pausedAt = 0;
    if (this.state.phase === "paused") this.set({ phase: "stopped" });
    this.startPlayback();
  }

  private rebuildBuffers(): void {
    const context = this.context;
    if (!context) return;
    this.buffers.clear();
    for (const track of this.state.tracks) {
      const buffer = context.createBuffer(1, Math.max(1, track.samples.length), context.sampleRate);
      buffer.getChannelData(0).set(track.samples);
      this.buffers.set(track.id, buffer);
    }
  }

  private stopSources(): void {
    for (const source of this.sources.values()) {
      try {
        source.stop();
      } catch {
        // already stopped
      }
      source.disconnect();
    }
    this.sources.clear();
  }

  private startSources(when: number): void {
    const context = this.context;
    const loop = this.state.loopSeconds;
    if (!context || !loop) return;
    const offset = (((when - this.loopStart) % loop) + loop) % loop;
    for (const track of this.state.tracks) {
      const buffer = this.buffers.get(track.id);
      if (!buffer) continue;
      let gain = this.gains.get(track.id);
      if (!gain) {
        gain = context.createGain();
        gain.connect(this.master!);
        this.gains.set(track.id, gain);
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.loopStart = 0;
      source.loopEnd = buffer.duration;
      source.connect(gain);
      source.start(when, offset % buffer.duration);
      this.sources.set(track.id, source);
    }
    this.applyMix();
  }

  /** Rebuild buffers and sources after an edit, keeping the loop playing in place. */
  private rebuildSources(): void {
    const context = this.context;
    if (!context) return;
    this.rebuildBuffers();
    for (const [id, gain] of this.gains) {
      if (!this.state.tracks.some((t) => t.id === id)) {
        gain.disconnect();
        this.gains.delete(id);
      }
    }
    if (this.state.phase === "playing") {
      this.stopSources();
      this.startSources(context.currentTime + 0.03);
    }
  }

  private applyMix(): void {
    const context = this.context;
    if (!context) return;
    const anySolo = this.state.tracks.some((t) => t.solo);
    for (const track of this.state.tracks) {
      const audible = anySolo ? track.solo : !track.muted;
      this.gains.get(track.id)?.gain.setTargetAtTime(audible ? track.volume : 0, context.currentTime, 0.015);
    }
  }

  // --------------------------------------------------------------- tracks

  private makeTrack(name: string, kind: TrackKind, samples: Float32Array): LooperTrack {
    return { id: newId(), name, kind, samples, peaks: peaksOf(samples, 600), volume: 0.9, muted: false, solo: false };
  }

  private updateTrack(id: string, patch: Partial<LooperTrack>): void {
    this.set({ tracks: this.state.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
    this.applyMix();
  }

  setVolume(id: string, volume: number): void {
    this.updateTrack(id, { volume: Math.max(0, Math.min(1.5, volume)) });
  }
  setMuted(id: string, muted: boolean): void {
    this.updateTrack(id, { muted });
  }
  setSolo(id: string, solo: boolean): void {
    this.updateTrack(id, { solo });
  }
  rename(id: string, name: string): void {
    this.updateTrack(id, { name: name.slice(0, 40) || "Line" });
  }
  setKind(id: string, kind: TrackKind): void {
    this.updateTrack(id, { kind });
  }

  deleteTrack(id: string): void {
    this.commit();
    const tracks = this.state.tracks.filter((t) => t.id !== id);
    this.set({ tracks });
    this.rebuildSources();
    if (tracks.length === 0) this.afterEmpty();
  }

  duplicateTrack(id: string): void {
    const track = this.state.tracks.find((t) => t.id === id);
    if (!track) return;
    this.commit();
    this.set({ tracks: [...this.state.tracks, this.makeTrack(`${track.name} copy`, track.kind, Float32Array.from(track.samples))] });
    this.rebuildSources();
  }

  /** Silence part of a line (seconds into the loop). */
  clearSection(id: string, start: number, end: number): void {
    const track = this.state.tracks.find((t) => t.id === id);
    if (!track) return;
    this.commit();
    const samples = clearRegion(track.samples, this.sampleRate, start, end);
    this.updateTrack(id, { samples, peaks: peaksOf(samples, 600) });
    this.rebuildSources();
  }

  /** Remove every line so a new first take can set a new loop. */
  clearAll(): void {
    this.cancelled = true;
    this.commit();
    this.stopSources();
    this.metronome?.stop();
    this.set({ tracks: [], loopSeconds: null, bars: null, recording: null, phase: "empty" });
    this.rebuildBuffers();
    this.afterEmpty();
  }

  private afterEmpty(): void {
    this.stopSources();
    this.metronome?.stop();
    this.pausedAt = 0;
    this.set({ phase: "empty", loopSeconds: null, bars: null });
  }

  // ------------------------------------------------------------ undo/redo

  private snapshot(): Snapshot {
    return { tracks: this.state.tracks, loopSeconds: this.state.loopSeconds, bars: this.state.bars };
  }

  private commit(): void {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 30) this.undoStack.shift();
    this.redoStack = [];
  }

  private restore(snapshot: Snapshot): void {
    const wasPlaying = this.state.phase === "playing";
    this.set({ tracks: snapshot.tracks, loopSeconds: snapshot.loopSeconds, bars: snapshot.bars });
    if (snapshot.tracks.length === 0) {
      this.afterEmpty();
      return;
    }
    if (this.state.phase === "empty") this.set({ phase: "stopped" });
    this.rebuildSources();
    if (!wasPlaying && this.state.phase === "empty") this.set({ phase: "stopped" });
  }

  undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(this.snapshot());
    this.restore(previous);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.snapshot());
    this.restore(next);
  }

  // -------------------------------------------------------------- export

  /** One line as a WAV file. */
  trackWav(id: string): Uint8Array<ArrayBuffer> | null {
    const track = this.state.tracks.find((t) => t.id === id);
    return track ? encodeWav(track.samples, this.sampleRate) : null;
  }

  /** The audible mix (respecting mute, solo and volume), repeated `repeats` times. */
  mixWav(repeats = 1): Uint8Array<ArrayBuffer> | null {
    const { tracks, loopSeconds } = this.state;
    if (!loopSeconds || tracks.length === 0) return null;
    const anySolo = tracks.some((t) => t.solo);
    const audible = tracks.filter((t) => (anySolo ? t.solo : !t.muted));
    const length = tracks[0]!.samples.length;
    const mix = mixTracks(audible.map((t) => ({ samples: t.samples, volume: t.volume })), length);
    return encodeWav(repeats > 1 ? repeatLoop(mix, repeats) : mix, this.sampleRate);
  }

  dispose(): void {
    this.cancelled = true;
    clearTimeout(this.phaseTimer);
    clearTimeout(this.metronomeStop);
    this.stopSources();
    this.metronome?.stop();
    this.closeInput();
    void this.context?.close();
    this.context = null;
    this.listeners.clear();
  }
}
