/**
 * Metronome maths. No audio, no timers — the browser adapter owns the
 * AudioContext clock and asks this module *what* to schedule and *when*.
 * Keeping it pure is what lets the same tempo logic drive a React Native
 * metronome later, and lets us unit-test beat grids without fake timers.
 */

export type Subdivision = "quarter" | "eighth" | "triplet" | "sixteenth";

export interface TimeSignature {
  /** Beats per bar. */
  readonly beats: number;
  /** Note value that gets the beat: 4 = quarter, 8 = eighth. */
  readonly value: number;
}

export const SUBDIVISION_STEPS: Record<Subdivision, number> = {
  quarter: 1,
  eighth: 2,
  triplet: 3,
  sixteenth: 4,
};

export const SUBDIVISION_LABELS: Record<Subdivision, string> = {
  quarter: "1/4",
  eighth: "1/8",
  triplet: "Triplets",
  sixteenth: "1/16",
};

export interface MetronomeSettings {
  readonly bpm: number;
  readonly timeSignature: TimeSignature;
  readonly subdivision: Subdivision;
  /** Accent the first beat of each bar. */
  readonly accentFirstBeat: boolean;
}

export type ClickAccent = "downbeat" | "beat" | "subdivision";

export interface ClickEvent {
  /** Absolute time on the audio clock, in seconds. */
  readonly time: number;
  /** Index since transport start, counting subdivisions. */
  readonly tickIndex: number;
  /** 1-based beat within the bar. */
  readonly beat: number;
  /** 0-based bar number since transport start. */
  readonly bar: number;
  /** 0-based subdivision within the beat. */
  readonly step: number;
  readonly accent: ClickAccent;
}

export const MIN_BPM = 20;
export const MAX_BPM = 400;

export function clampBpm(bpm: number): number {
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));
}

export function secondsPerBeat(bpm: number): number {
  return 60 / bpm;
}

export function secondsPerTick(settings: MetronomeSettings): number {
  return secondsPerBeat(settings.bpm) / SUBDIVISION_STEPS[settings.subdivision];
}

/** Describe the tick at `tickIndex`, relative to a transport that started at `startTime`. */
export function tickAt(settings: MetronomeSettings, tickIndex: number, startTime = 0): ClickEvent {
  const steps = SUBDIVISION_STEPS[settings.subdivision];
  const step = tickIndex % steps;
  const beatIndex = Math.floor(tickIndex / steps);
  const beat = (beatIndex % settings.timeSignature.beats) + 1;
  const bar = Math.floor(beatIndex / settings.timeSignature.beats);

  let accent: ClickAccent = "subdivision";
  if (step === 0) {
    accent = beat === 1 && settings.accentFirstBeat ? "downbeat" : "beat";
  }

  return {
    time: startTime + tickIndex * secondsPerTick(settings),
    tickIndex,
    beat,
    bar,
    step,
    accent,
  };
}

/**
 * All ticks falling inside [from, until). The browser adapter calls this on a
 * ~25 ms interval with a ~120 ms lookahead window — the standard Web Audio
 * scheduling pattern that keeps timing sample-accurate despite a jittery
 * setInterval.
 */
export function ticksInWindow(
  settings: MetronomeSettings,
  startTime: number,
  from: number,
  until: number,
): ClickEvent[] {
  const period = secondsPerTick(settings);
  if (period <= 0) return [];
  const firstIndex = Math.max(0, Math.ceil((from - startTime) / period));
  const out: ClickEvent[] = [];
  for (let index = firstIndex; ; index++) {
    const event = tickAt(settings, index, startTime);
    if (event.time >= until) break;
    out.push(event);
    if (out.length > 512) break; // guard against absurd tempos
  }
  return out;
}

/**
 * Tap tempo. Keeps a window of recent intervals, throws away outliers caused by
 * a missed tap, and averages the rest.
 */
export class TapTempo {
  private taps: number[] = [];

  constructor(
    private readonly maxTaps = 6,
    /** A gap longer than this restarts the measurement. */
    private readonly resetAfterSeconds = 2,
  ) {}

  /** Register a tap at `time` (seconds). Returns the current BPM estimate, if any. */
  tap(time: number): number | null {
    const last = this.taps[this.taps.length - 1];
    if (last !== undefined && time - last > this.resetAfterSeconds) {
      this.taps = [];
    }
    this.taps.push(time);
    if (this.taps.length > this.maxTaps) this.taps.shift();
    if (this.taps.length < 2) return null;

    const intervals: number[] = [];
    for (let i = 1; i < this.taps.length; i++) {
      intervals.push(this.taps[i]! - this.taps[i - 1]!);
    }

    // Drop intervals more than 40% away from the median — a fumbled tap should
    // not drag the tempo with it.
    const sorted = [...intervals].sort((a, b) => a - b);
    const mid = sorted[sorted.length >> 1]!;
    const kept = intervals.filter((i) => Math.abs(i - mid) <= mid * 0.4);
    const pool = kept.length > 0 ? kept : intervals;
    const average = pool.reduce((sum, i) => sum + i, 0) / pool.length;
    if (average <= 0) return null;
    return clampBpm(60 / average);
  }

  reset(): void {
    this.taps = [];
  }
}
