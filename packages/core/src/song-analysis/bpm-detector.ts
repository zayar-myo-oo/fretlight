import { SpectrumAnalyzer } from "../audio/fft";
import { BPM_CONFIG } from "./config";
import { decimate } from "./chroma-analyzer";

export interface TempoEstimate {
  /** Rounded beats per minute, or null when no steady pulse was found. */
  readonly bpm: number | null;
  /** 0..1. Below `BPM_CONFIG.confidentAbove` the UI should say "~". */
  readonly confidence: number;
  /** Beat times in seconds. */
  readonly beats: number[];
}

/**
 * Onset strength over time: how much new energy appears in each frame
 * (half-wave rectified spectral flux), with the slow trend removed so only
 * the pulses remain.
 */
export function onsetEnvelope(
  samples: Float32Array,
  sampleRate: number,
): { envelope: Float32Array; frameSeconds: number } {
  const factor = Math.max(1, Math.round(sampleRate / BPM_CONFIG.analysisRate));
  const signal = decimate(samples, factor);
  const rate = sampleRate / factor;
  const { fftSize, hop } = BPM_CONFIG;

  const frames = signal.length >= fftSize ? Math.floor((signal.length - fftSize) / hop) + 1 : 0;
  const analyzer = new SpectrumAnalyzer(fftSize);
  const frame = new Float32Array(fftSize);
  const flux = new Float32Array(frames);
  let previous: Float32Array | null = null;
  const topBin = Math.min(fftSize / 2, Math.floor((4000 * fftSize) / rate));

  for (let f = 0; f < frames; f++) {
    frame.set(signal.subarray(f * hop, f * hop + fftSize));
    const magnitudes = analyzer.analyze(frame);
    const compressed = new Float32Array(topBin);
    for (let k = 0; k < topBin; k++) compressed[k] = Math.log1p(magnitudes[k]! * 10);
    if (previous) {
      let sum = 0;
      for (let k = 0; k < topBin; k++) sum += Math.max(0, compressed[k]! - previous[k]!);
      flux[f] = sum;
    }
    previous = compressed;
  }

  // Subtract a ~0.5 s moving average so loud passages don't read as constant onsets.
  const frameSeconds = hop / rate;
  const half = Math.max(1, Math.round(0.25 / frameSeconds));
  const envelope = new Float32Array(frames);
  let running = 0;
  const prefix = new Float64Array(frames + 1);
  for (let i = 0; i < frames; i++) {
    running += flux[i]!;
    prefix[i + 1] = running;
  }
  for (let i = 0; i < frames; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(frames, i + half + 1);
    const mean = (prefix[hi]! - prefix[lo]!) / (hi - lo);
    envelope[i] = Math.max(0, flux[i]! - mean);
  }
  return { envelope, frameSeconds };
}

/**
 * Estimate tempo by autocorrelating the onset envelope, favouring a musically
 * common range so a 60 vs 120 BPM ambiguity resolves sensibly, then lay a beat
 * grid on the phase that lines up with the most onset energy.
 * This is an estimate: half- and double-time readings are possible.
 */
export function detectBpm(samples: Float32Array, sampleRate: number): TempoEstimate {
  const { envelope, frameSeconds } = onsetEnvelope(samples, sampleRate);
  const n = envelope.length;
  const none: TempoEstimate = { bpm: null, confidence: 0, beats: [] };
  const minLag = Math.floor(60 / BPM_CONFIG.maxBpm / frameSeconds);
  const maxLag = Math.ceil(60 / BPM_CONFIG.minBpm / frameSeconds);
  if (n < maxLag * 3) return none;

  let zero = 0;
  for (const v of envelope) zero += v * v;
  if (zero <= 0) return none;

  const acf = new Float32Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < n; i++) sum += envelope[i]! * envelope[i + lag]!;
    acf[lag] = (sum / zero) * (n / (n - lag));
  }

  // Weight by a log-normal prior around the preferred tempo.
  let bestLag = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = 60 / (lag * frameSeconds);
    const prior = Math.exp(-0.5 * (Math.log2(bpm / BPM_CONFIG.preferredBpm) / 0.9) ** 2);
    const isPeak = acf[lag]! >= acf[lag - 1]! && acf[lag]! >= acf[lag + 1]!;
    const score = isPeak ? acf[lag]! * prior : -Infinity;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (!Number.isFinite(bestScore)) return none;

  // Parabolic refinement between lag samples.
  const a = acf[bestLag - 1]!;
  const b = acf[bestLag]!;
  const c = acf[bestLag + 1]!;
  const denominator = a - 2 * b + c;
  const offset = denominator === 0 ? 0 : Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denominator));
  const period = bestLag + offset;
  const bpm = 60 / (period * frameSeconds);
  const confidence = Math.round(Math.min(1, Math.max(0, (acf[bestLag]! - 0.1) / 0.5)) * 100) / 100;

  // Beat phase: the offset whose grid collects the most onset energy.
  let bestPhase = 0;
  let bestSum = -1;
  for (let phase = 0; phase < period; phase += 0.5) {
    let sum = 0;
    for (let t = phase; t < n; t += period) sum += envelope[Math.round(t)] ?? 0;
    if (sum > bestSum) {
      bestSum = sum;
      bestPhase = phase;
    }
  }
  const beats: number[] = [];
  for (let t = bestPhase; t < n; t += period) beats.push(Math.round(t * frameSeconds * 1000) / 1000);

  return { bpm: Math.round(bpm), confidence, beats };
}
