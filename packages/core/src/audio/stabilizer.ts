import { frequencyToNote } from "../theory/pitch";
import type { PitchReading } from "../theory/types";
import type { PitchEstimate } from "./types";

export interface StabilizerOptions {
  /** Frames whose clarity falls below this are discarded outright. */
  readonly minClarity?: number;
  /** Consecutive agreeing frames required before a note is reported as confirmed. */
  readonly confirmFrames?: number;
  /** Frames of silence tolerated before the current note is released. */
  readonly releaseFrames?: number;
  /** Window length of the median filter applied to frequency. */
  readonly medianWindow?: number;
  readonly a4?: number;
}

export type StabilizerEvent =
  | { type: "candidate"; reading: PitchReading; clarity: number }
  | { type: "confirmed"; reading: PitchReading; clarity: number }
  | { type: "sustained"; reading: PitchReading; clarity: number }
  | { type: "released"; midi: number }
  | { type: "silent" };

/**
 * Turns a noisy stream of per-frame pitch estimates into stable musical events.
 *
 * Without this, a tuner needle jitters and the practice engine scores phantom
 * notes on every pick attack. Three mechanisms do the work: a median filter on
 * frequency, an N-frame agreement requirement before a note is confirmed, and a
 * release counter so brief dropouts during a sustain do not end the note.
 *
 * Deliberately frame-driven rather than time-driven: the caller owns the clock,
 * which keeps this testable without fake timers.
 */
export class NoteStabilizer {
  private readonly minClarity: number;
  private readonly confirmFrames: number;
  private readonly releaseFrames: number;
  private readonly medianWindow: number;
  private readonly a4: number;

  private history: number[] = [];
  private candidateMidi: number | null = null;
  private agreementCount = 0;
  private silenceCount = 0;
  private activeMidi: number | null = null;

  constructor(options: StabilizerOptions = {}) {
    this.minClarity = options.minClarity ?? 0.75;
    this.confirmFrames = options.confirmFrames ?? 3;
    this.releaseFrames = options.releaseFrames ?? 6;
    this.medianWindow = options.medianWindow ?? 5;
    this.a4 = options.a4 ?? 440;
  }

  push(estimate: PitchEstimate): StabilizerEvent {
    const usable =
      estimate.frequency !== null && !estimate.silent && estimate.clarity >= this.minClarity;

    if (!usable) {
      this.silenceCount++;
      if (this.activeMidi !== null && this.silenceCount >= this.releaseFrames) {
        const released = this.activeMidi;
        this.reset();
        return { type: "released", midi: released };
      }
      return { type: "silent" };
    }

    this.silenceCount = 0;
    this.history.push(estimate.frequency!);
    if (this.history.length > this.medianWindow) this.history.shift();

    const smoothed = median(this.history);
    const reading = frequencyToNote(smoothed, { a4: this.a4 });
    const midi = reading.note.midi;

    if (midi === this.candidateMidi) {
      this.agreementCount++;
    } else {
      this.candidateMidi = midi;
      this.agreementCount = 1;
    }

    if (this.activeMidi === midi) {
      return { type: "sustained", reading, clarity: estimate.clarity };
    }

    if (this.agreementCount >= this.confirmFrames) {
      this.activeMidi = midi;
      return { type: "confirmed", reading, clarity: estimate.clarity };
    }

    return { type: "candidate", reading, clarity: estimate.clarity };
  }

  get currentMidi(): number | null {
    return this.activeMidi;
  }

  reset(): void {
    this.history = [];
    this.candidateMidi = null;
    this.agreementCount = 0;
    this.silenceCount = 0;
    this.activeMidi = null;
  }
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}
