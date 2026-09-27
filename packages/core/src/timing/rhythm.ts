import { secondsPerBeat } from "./metronome";

export type TimingVerdict = "early" | "late" | "on_time" | "missed";

export interface TimingResult {
  readonly verdict: TimingVerdict;
  /** Signed seconds: negative = played early. */
  readonly deltaSeconds: number;
  /** The same offset expressed in beats, which is what players think in. */
  readonly deltaBeats: number;
  /** 0..1, where 1 is dead on the beat. */
  readonly accuracy: number;
}

export interface TimingTolerances {
  /** Within this fraction of a beat counts as on time. */
  readonly onTimeBeats?: number;
  /** Beyond this fraction of a beat the note counts as missed rather than late. */
  readonly missedBeats?: number;
}

/**
 * Compare when a note was actually played against when it was expected.
 * Deterministic, local, and cheap enough to run on every detected note.
 */
export function evaluateTiming(
  expectedTime: number,
  actualTime: number,
  bpm: number,
  tolerances: TimingTolerances = {},
): TimingResult {
  const beatSeconds = secondsPerBeat(bpm);
  const onTimeBeats = tolerances.onTimeBeats ?? 0.12;
  const missedBeats = tolerances.missedBeats ?? 0.5;

  const deltaSeconds = actualTime - expectedTime;
  const deltaBeats = deltaSeconds / beatSeconds;
  const magnitude = Math.abs(deltaBeats);

  const verdict: TimingVerdict =
    magnitude > missedBeats ? "missed" : magnitude <= onTimeBeats ? "on_time" : deltaBeats < 0 ? "early" : "late";

  // Linear falloff from perfect at 0 to zero at the miss boundary.
  const accuracy = Math.max(0, 1 - magnitude / missedBeats);

  return { verdict, deltaSeconds, deltaBeats, accuracy };
}

/** Rolling summary of a player's timing tendency — "you rush" is a real, measurable thing. */
export class TimingTracker {
  private deltas: number[] = [];

  constructor(private readonly window = 32) {}

  push(result: TimingResult): void {
    if (result.verdict === "missed") return;
    this.deltas.push(result.deltaBeats);
    if (this.deltas.length > this.window) this.deltas.shift();
  }

  /** Mean signed offset in beats. Negative means the player consistently rushes. */
  get bias(): number {
    if (this.deltas.length === 0) return 0;
    return this.deltas.reduce((sum, d) => sum + d, 0) / this.deltas.length;
  }

  /** Standard deviation in beats — how *consistent* the player is, regardless of bias. */
  get spread(): number {
    if (this.deltas.length < 2) return 0;
    const mean = this.bias;
    const variance =
      this.deltas.reduce((sum, d) => sum + (d - mean) ** 2, 0) / (this.deltas.length - 1);
    return Math.sqrt(variance);
  }

  get tendency(): "rushing" | "dragging" | "steady" {
    if (this.bias < -0.06) return "rushing";
    if (this.bias > 0.06) return "dragging";
    return "steady";
  }

  reset(): void {
    this.deltas = [];
  }
}
