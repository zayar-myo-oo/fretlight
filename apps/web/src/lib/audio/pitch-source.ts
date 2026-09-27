import type { PitchEstimate } from "@fretlight/core";

/**
 * One analysis frame produced by a pitch source.
 * `time` is in seconds on a monotonic clock owned by the source — for the real
 * microphone source that is the AudioContext clock, which is what makes
 * sample-accurate timing comparisons against the metronome possible.
 */
export interface PitchFrame {
  readonly estimate: PitchEstimate;
  readonly time: number;
}

export type PitchSourceKind = "mock" | "microphone";

/**
 * The seam between the app and where pitch actually comes from.
 *
 * Phase 1 ships a mock source driven by the on-screen fretboard; Phase 2 adds a
 * microphone source backed by an AudioWorklet. Everything downstream — the
 * tuner, the note finder, the practice engine, the visualisers — is written
 * against this interface and does not change when the real detector lands.
 */
export interface PitchSource {
  readonly kind: PitchSourceKind;
  readonly label: string;
  readonly isRunning: boolean;
  /** Seconds on this source's clock. */
  now(): number;
  start(): Promise<void>;
  stop(): Promise<void>;
  onFrame(listener: (frame: PitchFrame) => void): () => void;
}

export const SILENT_ESTIMATE: PitchEstimate = {
  frequency: null,
  clarity: 0,
  rms: 0,
  silent: true,
};
