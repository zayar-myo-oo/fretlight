import { SpectrumAnalyzer } from "../audio/fft";
import { mod } from "../theory/pitch";
import type { ChromaConfig } from "./config";

export interface ChromaFrames {
  /** One 12-bin vector per frame, scaled so its largest bin is 1 (all zeros when silent). */
  readonly chroma: readonly Float32Array[];
  /** Centre time of each frame, in seconds. */
  readonly times: Float32Array;
  /** Frame loudness (RMS), used for silence gating and section energy. */
  readonly energy: Float32Array;
  readonly hopSeconds: number;
}

/** Average blocks of `factor` samples: a crude but adequate anti-alias lowpass + downsample. */
export function decimate(samples: Float32Array, factor: number): Float32Array {
  if (factor <= 1) return samples;
  const out = new Float32Array(Math.floor(samples.length / factor));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    const base = i * factor;
    for (let j = 0; j < factor; j++) sum += samples[base + j]!;
    out[i] = sum / factor;
  }
  return out;
}

/**
 * Pitch-class energy over time.
 *
 * Each frame is windowed and transformed; only spectral *peaks* in the useful
 * band are kept (leakage between notes would otherwise smear into neighbouring
 * pitch classes), each is credited to the nearest semitone, and magnitudes are
 * square-rooted so one loud harmonic can't drown out the rest of the chord.
 */
export function extractChroma(
  samples: Float32Array,
  sampleRate: number,
  config: ChromaConfig,
  onProgress?: (fraction: number) => void,
): ChromaFrames {
  const signal = decimate(samples, config.decimate);
  const rate = sampleRate / config.decimate;
  const { fftSize, hop, minHz, maxHz } = config;

  const frameCount = signal.length >= fftSize ? Math.floor((signal.length - fftSize) / hop) + 1 : 0;
  const analyzer = new SpectrumAnalyzer(fftSize);
  const frame = new Float32Array(fftSize);

  // Which pitch class each FFT bin feeds, and how closely it sits to that semitone.
  const binPc = new Int8Array(fftSize / 2).fill(-1);
  const binWeight = new Float32Array(fftSize / 2);
  for (let k = 1; k < fftSize / 2; k++) {
    const frequency = (k * rate) / fftSize;
    if (frequency < minHz || frequency > maxHz) continue;
    const midi = 69 + 12 * Math.log2(frequency / 440);
    const nearest = Math.round(midi);
    binPc[k] = mod(nearest, 12);
    binWeight[k] = 1 - Math.abs(midi - nearest);
  }

  const chroma: Float32Array[] = [];
  const times = new Float32Array(frameCount);
  const energy = new Float32Array(frameCount);

  for (let f = 0; f < frameCount; f++) {
    const start = f * hop;
    frame.set(signal.subarray(start, start + fftSize));

    let sumSquares = 0;
    for (const v of frame) sumSquares += v * v;
    energy[f] = Math.sqrt(sumSquares / fftSize);
    times[f] = (start + fftSize / 2) / rate;

    const vector = new Float32Array(12);
    if (energy[f]! > 1e-4) {
      const magnitudes = analyzer.analyze(frame);
      let strongest = 0;
      for (let k = 1; k < magnitudes.length; k++) if (binPc[k]! >= 0) strongest = Math.max(strongest, magnitudes[k]!);
      const floor = strongest * 0.05;
      for (let k = 2; k < magnitudes.length - 1; k++) {
        const pc = binPc[k]!;
        const m = magnitudes[k]!;
        if (pc < 0 || m < floor || m < magnitudes[k - 1]! || m < magnitudes[k + 1]!) continue;
        vector[pc]! += binWeight[k]! * Math.sqrt(m);
      }
      let peak = 0;
      for (const v of vector) peak = Math.max(peak, v);
      if (peak > 0) for (let i = 0; i < 12; i++) vector[i]! /= peak;
    }
    chroma.push(vector);

    if (onProgress && f % 64 === 0) onProgress(f / frameCount);
  }
  onProgress?.(1);

  return { chroma, times, energy, hopSeconds: hop / rate };
}
