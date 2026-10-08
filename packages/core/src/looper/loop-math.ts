/**
 * Pure maths for the Companion looper: loop length, position, waveform peaks,
 * region edits, mixing and WAV encoding. No Web Audio here, so all of it is
 * testable under plain Node.
 */

export type LoopMode = "free" | "musical";

export const secondsPerBar = (bpm: number, beatsPerBar: number): number => (60 / bpm) * beatsPerBar;

export interface LoopLength {
  readonly seconds: number;
  /** Whole bars for a musical loop, or the fractional number of bars for a free one. */
  readonly bars: number;
}

/**
 * The first recording sets the loop length. A free loop keeps exactly what was
 * played; a musical loop rounds to the nearest whole bar (at least one), which
 * is forgiving: a take that is a little short or long still loops in time.
 */
export function snapLoopSeconds(recordedSeconds: number, bpm: number, beatsPerBar: number, mode: LoopMode): LoopLength {
  const bar = secondsPerBar(bpm, beatsPerBar);
  if (mode === "free") return { seconds: recordedSeconds, bars: recordedSeconds / bar };
  const bars = Math.max(1, Math.round(recordedSeconds / bar));
  return { seconds: bars * bar, bars };
}

export interface LoopPosition {
  /** 1-based bar and beat, as a player counts them. */
  readonly bar: number;
  readonly beat: number;
  readonly totalBars: number;
  /** Beats since the loop began. */
  readonly beats: number;
  /** 0..1 through the loop. */
  readonly fraction: number;
}

export function positionInfo(seconds: number, loopSeconds: number, bpm: number, beatsPerBar: number): LoopPosition {
  const wrapped = loopSeconds > 0 ? ((seconds % loopSeconds) + loopSeconds) % loopSeconds : 0;
  const beats = (wrapped * bpm) / 60;
  return {
    bar: Math.floor(beats / beatsPerBar) + 1,
    beat: Math.floor(beats % beatsPerBar) + 1,
    totalBars: Math.max(1, Math.round((loopSeconds * bpm) / 60 / beatsPerBar)),
    beats,
    fraction: loopSeconds > 0 ? wrapped / loopSeconds : 0,
  };
}

/** Largest absolute sample in each of `buckets` equal slices, for drawing a waveform. */
export function peaksOf(samples: Float32Array, buckets: number): Float32Array {
  const out = new Float32Array(buckets);
  if (samples.length === 0 || buckets <= 0) return out;
  const size = samples.length / buckets;
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor(b * size);
    const to = Math.max(from + 1, Math.floor((b + 1) * size));
    let peak = 0;
    for (let i = from; i < to && i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]!));
    out[b] = peak;
  }
  return out;
}

function sampleRange(length: number, sampleRate: number, start: number, end: number): [number, number] {
  const a = Math.max(0, Math.min(length, Math.round(start * sampleRate)));
  const b = Math.max(a, Math.min(length, Math.round(end * sampleRate)));
  return [a, b];
}

/** A copy of `target` with the seconds [start, end) taken from `source` (punch-in). */
export function replaceRegion(target: Float32Array, source: Float32Array, sampleRate: number, start: number, end: number): Float32Array {
  const out = Float32Array.from(target);
  const [a, b] = sampleRange(target.length, sampleRate, start, end);
  for (let i = a; i < b; i++) out[i] = source[i] ?? 0;
  return out;
}

/**
 * A copy of `samples` with the seconds [start, end) silenced. A few milliseconds
 * on each side taper toward the cut so the edit does not click.
 */
export function clearRegion(samples: Float32Array, sampleRate: number, start: number, end: number, fadeSeconds = 0.005): Float32Array {
  const out = Float32Array.from(samples);
  const [a, b] = sampleRange(samples.length, sampleRate, start, end);
  for (let i = a; i < b; i++) out[i] = 0;
  const fade = Math.round(fadeSeconds * sampleRate);
  for (let k = 0; k < fade; k++) {
    const gain = k / fade; // 0 right at the cut, rising away from it
    if (a - 1 - k >= 0 && b > a) out[a - 1 - k] = out[a - 1 - k]! * gain;
    if (b + k < out.length && b > a) out[b + k] = out[b + k]! * gain;
  }
  return out;
}

export interface MixInput {
  readonly samples: Float32Array;
  readonly volume: number;
}

/** Sum tracks (each already one loop long) into `length` samples; scaled down only if it would clip. */
export function mixTracks(tracks: readonly MixInput[], length: number): Float32Array {
  const out = new Float32Array(length);
  for (const { samples, volume } of tracks) {
    if (samples.length === 0) continue;
    for (let i = 0; i < length; i++) out[i]! += (samples[i % samples.length] ?? 0) * volume;
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 1) for (let i = 0; i < length; i++) out[i]! /= peak;
  return out;
}

/** Repeat one loop `times` times end to end. */
export function repeatLoop(samples: Float32Array, times: number): Float32Array {
  const out = new Float32Array(samples.length * times);
  for (let t = 0; t < times; t++) out.set(samples, t * samples.length);
  return out;
}

/** 16-bit mono PCM WAV file bytes. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return bytes;
}

/** Peak level 0..1 of a block, and whether it came close enough to full scale to clip. */
export function levelOf(block: Float32Array): { peak: number; clipping: boolean } {
  let peak = 0;
  for (const v of block) peak = Math.max(peak, Math.abs(v));
  return { peak, clipping: peak >= 0.98 };
}

/** Gate thresholds (RMS) for the OFF / LOW / MEDIUM / HIGH settings. */
export const GATE_THRESHOLDS = { off: 0, low: 0.006, medium: 0.015, high: 0.035 } as const;
export type GateLevel = keyof typeof GATE_THRESHOLDS;
