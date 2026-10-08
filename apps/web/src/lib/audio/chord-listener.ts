"use client";

import { ChordStabilizer, type ChordMatch, chromaFromSpectrum, matchChord } from "@fretlight/core";
import { classifyDevice, noiseFloorFor } from "./audio-input";

export interface ChordFrame {
  /** Input loudness, RMS 0..1. */
  readonly level: number;
  /** True when the signal is above the noise gate. */
  readonly active: boolean;
  /** Smoothed 12-bin pitch-class energy, max 1. */
  readonly chroma: readonly number[];
  /** Pitch classes strong enough to count as played. */
  readonly notes: readonly number[];
  /** Best match this instant, before debouncing. */
  readonly raw: ChordMatch | null;
  /** The debounced answer to display; null means "no chord detected". */
  readonly chord: ChordMatch | null;
}

const FFT_SIZE = 16384;
const FRAME_MS = 70;
const NOTE_THRESHOLD = 0.4;

/**
 * Listens to an audio input and reports detected chords.
 *
 * Microphone / audio interface -> AnalyserNode -> chroma -> chord match ->
 * stabiliser. Runs entirely in the browser and nothing is recorded or sent. The
 * stream is analysed only, never routed to the speakers, so a plugged-in
 * guitar cannot feed back.
 *
 * `start()` must be called from a user gesture (getUserMedia / AudioContext).
 */
export class ChordListener {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  get running(): boolean {
    return this.timer !== null;
  }

  async start(deviceId: string, label: string, onFrame: (frame: ChordFrame) => void): Promise<void> {
    await this.stop();

    // Processing built for voice calls mangles a musical signal, so turn it all off.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 1 },
      },
    });

    const context = new AudioContext({ latencyHint: "interactive" });
    this.context = context;
    if (context.state === "suspended") await context.resume();

    const analyser = context.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.4;
    analyser.minDecibels = -110;
    analyser.maxDecibels = -10;
    context.createMediaStreamSource(this.stream).connect(analyser);

    const gate = noiseFloorFor(classifyDevice(label));
    const spectrum = new Float32Array(analyser.frequencyBinCount);
    const wave = new Float32Array(analyser.fftSize);
    const stabilizer = new ChordStabilizer(4, 0.6);
    let smoothed: number[] = new Array<number>(12).fill(0);

    this.timer = setInterval(() => {
      analyser.getFloatTimeDomainData(wave);
      let sum = 0;
      for (const v of wave) sum += v * v;
      const level = Math.sqrt(sum / wave.length);
      const active = level > gate;

      let raw: ChordMatch | null = null;
      let notes: number[] = [];
      if (active) {
        analyser.getFloatFrequencyData(spectrum);
        const fresh = chromaFromSpectrum(spectrum, context.sampleRate, analyser.fftSize);
        smoothed = smoothed.map((old, i) => old * 0.5 + fresh[i]! * 0.5);
        raw = matchChord(smoothed, 1)[0] ?? null;
        notes = smoothed.flatMap((v, pc) => (v >= NOTE_THRESHOLD ? [pc] : []));
      } else {
        smoothed = smoothed.map((v) => v * 0.5);
      }

      // Low confidence or silence counts as "nothing", so the display clears
      // rather than showing a random chord name.
      const chord = stabilizer.push(active ? raw : null);
      onFrame({ level, active, chroma: smoothed, notes, raw, chord });
    }, FRAME_MS);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    const context = this.context;
    this.context = null;
    if (context && context.state !== "closed") await context.close();
  }
}
