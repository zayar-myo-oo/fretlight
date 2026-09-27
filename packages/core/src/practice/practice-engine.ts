import { mod } from "../theory/pitch";
import { type TimingResult, TimingTracker, evaluateTiming } from "../timing/rhythm";
import { type AccuracyBreakdown, scorePractice } from "./scoring";
import type { PracticeSequence, PracticeStep } from "./sequence";

export type StepVerdict =
  | "correct"
  /** Wrong pitch entirely. */
  | "wrong"
  /**
   * Right note, wrong place. Its own verdict because the correction is
   * completely different: the player knows the note, they just have not
   * internalised where it lives yet, and telling them "wrong" would be both
   * discouraging and untrue.
   */
  | "wrong_position"
  | "skipped";

export interface NoteInput {
  /** MIDI number of the note the detector confirmed. */
  readonly midi: number;
  /** Seconds since the session started. */
  readonly time: number;
  /** Where the position estimator believes it was played. */
  readonly position?: { readonly string: number; readonly fret: number };
}

export interface StepResult {
  readonly stepId: string;
  readonly index: number;
  readonly expected: PracticeStep;
  readonly playedMidi: number | null;
  readonly playedPosition?: { readonly string: number; readonly fret: number };
  readonly verdict: StepVerdict;
  readonly timing: TimingResult | null;
  /** Seconds between the step being presented and the player answering. */
  readonly reactionSeconds: number | null;
}

export interface EvaluationEvent {
  readonly verdict: StepVerdict;
  readonly step: PracticeStep;
  readonly playedMidi: number;
  readonly timing: TimingResult | null;
  /** The step the player should aim at now. Null once the sequence is complete. */
  readonly nextStep: PracticeStep | null;
  readonly completed: boolean;
  readonly reactionSeconds: number | null;
  /** Where it was played, when the caller supplied a position. */
  readonly playedPosition?: { readonly string: number; readonly fret: number };
}

export interface PracticeEngineOptions {
  /**
   * When true, the played note must match the exact octave. Off by default:
   * beginners should get credit for the right note anywhere on the neck, and
   * bass players routinely play an octave up or down from the written part.
   */
  readonly matchOctave?: boolean;
  /**
   * Allow the player to jump ahead. If the note matches the *next* expected
   * step, the current one is recorded as skipped instead of wrong.
   */
  readonly allowSkipAhead?: boolean;
  /** In timed mode, move on when the step's window has passed even if nothing was played. */
  readonly advanceOnTimeout?: boolean;
  readonly tolerances?: { onTimeBeats?: number; missedBeats?: number };
  /**
   * Require the exact string and fret, not just the pitch. This is what turns
   * "play an A" into "play *this* A", which is the point of fret practice.
   */
  readonly requirePosition?: boolean;
}

/**
 * Compares what the player actually produced against what the exercise asked for.
 *
 * This is the piece the whole product's feedback loop hangs on, and it is
 * entirely local: given a detected MIDI note and a timestamp, it decides correct
 * / wrong / skipped, grades the timing, and reports the next target. No network,
 * no model inference, no per-note round trip.
 */
export class PracticeEngine {
  private index = 0;
  private startTime = 0;
  private running = false;
  /** When the current step was presented, for reaction-time measurement. */
  private stepShownAt = 0;
  private readonly results: StepResult[] = [];
  private readonly timingSamples: number[] = [];
  private readonly timingTracker = new TimingTracker();

  constructor(
    private readonly sequence: PracticeSequence,
    private readonly options: PracticeEngineOptions = {},
  ) {}

  start(time = 0): void {
    this.startTime = time;
    this.stepShownAt = time;
    this.index = 0;
    this.running = true;
    this.results.length = 0;
    this.timingSamples.length = 0;
    this.timingTracker.reset();
  }

  stop(): void {
    this.running = false;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get currentStep(): PracticeStep | null {
    return this.sequence.steps[this.index] ?? null;
  }

  get nextStep(): PracticeStep | null {
    return this.sequence.steps[this.index + 1] ?? null;
  }

  get currentIndex(): number {
    return this.index;
  }

  get isComplete(): boolean {
    return this.index >= this.sequence.steps.length;
  }

  get history(): readonly StepResult[] {
    return this.results;
  }

  get timing(): TimingTracker {
    return this.timingTracker;
  }

  /**
   * Feed a confirmed note in. Returns what it meant for the exercise, or null
   * when the engine is not running.
   */
  submitNote(input: NoteInput): EvaluationEvent | null {
    if (!this.running || this.isComplete) return null;
    const step = this.currentStep;
    if (!step) return null;

    const reaction = Math.max(0, input.time - this.stepShownAt);

    if (this.matches(step, input.midi)) {
      // Right pitch. In a position drill it still has to be in the right place.
      if (this.options.requirePosition && step.position) {
        const played = input.position;
        const samePlace =
          played !== undefined &&
          played.string === step.position.string &&
          played.fret === step.position.fret;

        if (!samePlace) {
          // Hold position so the player can find the right spot themselves.
          this.record(step, input.midi, "wrong_position", null, reaction, input.position);
          return this.event("wrong_position", step, input.midi, null, reaction, input.position);
        }
      }

      const timing = this.gradeTiming(step, input.time);
      this.record(step, input.midi, "correct", timing, reaction, input.position);
      this.advance(input.time);
      return this.event("correct", step, input.midi, timing, reaction, input.position);
    }

    if (this.options.allowSkipAhead ?? true) {
      const next = this.nextStep;
      if (next && this.matches(next, input.midi)) {
        this.record(step, null, "skipped", null, null);
        this.index++;
        const timing = this.gradeTiming(next, input.time);
        this.record(next, input.midi, "correct", timing, reaction, input.position);
        this.advance(input.time);
        return this.event("skipped", step, input.midi, timing, reaction, input.position);
      }
    }

    // Wrong note: stay on the same step so the player can correct themselves.
    // The wrong attempt is still recorded against the step for scoring.
    this.record(step, input.midi, "wrong", null, reaction, input.position);
    return this.event("wrong", step, input.midi, null, reaction, input.position);
  }

  /** Explicitly give up on the current step. */
  skip(): EvaluationEvent | null {
    const step = this.currentStep;
    if (!step || !this.running) return null;
    this.record(step, null, "skipped", null, null);
    this.advance(0);
    return this.event("skipped", step, -1, null, null);
  }

  /**
   * In timed mode, call this from the render loop so steps whose window has
   * closed are marked missed instead of blocking the exercise forever.
   */
  tick(time: number): EvaluationEvent | null {
    if (!this.running || this.sequence.mode !== "timed") return null;
    if (!(this.options.advanceOnTimeout ?? true)) return null;
    const step = this.currentStep;
    if (!step || step.expectedTime === undefined) return null;

    const beatSeconds = 60 / this.sequence.bpm;
    const missedBeats = this.options.tolerances?.missedBeats ?? 0.5;
    if (time - this.startTime > step.expectedTime + missedBeats * beatSeconds) {
      this.record(step, null, "skipped", null, null);
      this.advance(time);
      return this.event("skipped", step, -1, null, null);
    }
    return null;
  }

  /** Move to the next step and reset the reaction-time clock. */
  private advance(time: number): void {
    this.index++;
    this.stepShownAt = time;
  }

  get summary(): AccuracyBreakdown {
    const correct = this.results.filter((r) => r.verdict === "correct").length;
    const wrong = this.results.filter(
      (r) => r.verdict === "wrong" || r.verdict === "wrong_position",
    ).length;
    const skipped = this.results.filter((r) => r.verdict === "skipped").length;
    return scorePractice({
      correct,
      wrong,
      skipped,
      total: this.sequence.steps.length,
      timingSamples: this.timingSamples,
    });
  }

  private matches(step: PracticeStep, midi: number): boolean {
    return this.options.matchOctave
      ? step.midi === midi
      : mod(step.pitchClass, 12) === mod(midi, 12);
  }

  private gradeTiming(step: PracticeStep, time: number): TimingResult | null {
    if (this.sequence.mode !== "timed" || step.expectedTime === undefined) return null;
    const result = evaluateTiming(
      this.startTime + step.expectedTime,
      time,
      this.sequence.bpm,
      this.options.tolerances ?? {},
    );
    this.timingSamples.push(result.accuracy);
    this.timingTracker.push(result);
    return result;
  }

  private record(
    step: PracticeStep,
    playedMidi: number | null,
    verdict: StepVerdict,
    timing: TimingResult | null,
    reactionSeconds: number | null,
    playedPosition?: { string: number; fret: number },
  ): void {
    this.results.push({
      stepId: step.id,
      index: this.index,
      expected: step,
      playedMidi,
      verdict,
      timing,
      reactionSeconds,
      ...(playedPosition ? { playedPosition } : {}),
    });
  }

  private event(
    verdict: StepVerdict,
    step: PracticeStep,
    playedMidi: number,
    timing: TimingResult | null,
    reactionSeconds: number | null,
    playedPosition?: { string: number; fret: number },
  ): EvaluationEvent {
    return {
      verdict,
      step,
      playedMidi,
      timing,
      nextStep: this.currentStep,
      completed: this.isComplete,
      reactionSeconds,
      ...(playedPosition ? { playedPosition } : {}),
    };
  }
}
