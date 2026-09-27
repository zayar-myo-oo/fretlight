import type { PitchReading } from "../theory/types";

/** What the tuner should be showing right now. */
export type PitchUiState =
  /** Nothing to show — "waiting for input". */
  | "no_signal"
  /** Something is coming in but has not settled enough to commit to. */
  | "detecting"
  /** A note is confirmed and being displayed. */
  | "stable"
  /** The signal stopped, but the last note is deliberately still on screen. */
  | "holding";

export interface PitchState {
  readonly state: PitchUiState;
  /** The reading to display. Kept during `holding`, null only at `no_signal`. */
  readonly reading: PitchReading | null;
  readonly midi: number | null;
  /** Confidence of the committed note, 0..1. */
  readonly confidence: number;
  /** When the current note became stable, in ms. */
  readonly stableSince: number;
  /** When the displayed note last changed — animations key off this. */
  readonly changedAt: number;
  /** True while the display is being held after signal loss. */
  readonly held: boolean;
}

export interface PitchStateOptions {
  /** How long a candidate must persist before it is committed to the display. */
  readonly minStableMs?: number;
  /** How long to keep showing a note after the signal stops. */
  readonly holdMs?: number;
  /** Confidence needed to commit a new note. */
  readonly activateConfidence?: number;
  /** Confidence below which a displayed note is given up. Lower than activate. */
  readonly releaseConfidence?: number;
  /** A different note must beat this for this long before the display switches. */
  readonly switchMs?: number;
}

export interface PitchStateInput {
  /** The stabilised reading, or null when there is nothing usable. */
  readonly reading: PitchReading | null;
  /** Whether the instrument gate accepted this frame. */
  readonly accepted: boolean;
  /** Combined instrument confidence, 0..1. */
  readonly confidence: number;
  readonly timeMs: number;
}

const EMPTY: PitchState = {
  state: "no_signal",
  reading: null,
  midi: null,
  confidence: 0,
  stableSince: 0,
  changedAt: 0,
  held: false,
};

/**
 * Decides what the tuner displays, separately from what the detector reports.
 *
 * The detector runs tens of times a second and its output is legitimately
 * twitchy — a pick attack is inharmonic, a hand mute drops the level, a finger
 * shift passes through a neighbouring pitch. Rendering that stream directly
 * produces the note-appears-disappears-appears flashing that makes a tuner feel
 * broken, even though every individual frame was a correct reading.
 *
 * So display state is a separate model with its own rules:
 *
 *  - **Commit slowly.** A candidate must hold for `minStableMs` before it is
 *    shown, so a transient never reaches the screen.
 *  - **Release slowly.** When the signal stops, the note is *held* for
 *    `holdMs` first. A player muting between notes should not watch the readout
 *    blank and refill.
 *  - **Switch reluctantly.** Replacing a displayed note demands more evidence
 *    than showing the first one did, because a wrong switch is more jarring
 *    than a slightly stale reading.
 *  - **Asymmetric thresholds.** Activation and release differ, so a signal
 *    sitting near the boundary settles instead of oscillating.
 *
 * Driven by explicit timestamps rather than wall-clock time, so it is testable
 * without fake timers and can be replayed against recorded sessions.
 */
export class PitchStateMachine {
  private current: PitchState = EMPTY;
  private candidateMidi: number | null = null;
  private candidateSince = 0;
  private lastGoodAt = 0;

  private readonly minStableMs: number;
  private readonly holdMs: number;
  private readonly activateConfidence: number;
  private readonly releaseConfidence: number;
  private readonly switchMs: number;

  constructor(options: PitchStateOptions = {}) {
    this.minStableMs = options.minStableMs ?? 70;
    this.holdMs = options.holdMs ?? 700;
    this.activateConfidence = options.activateConfidence ?? 0.55;
    this.releaseConfidence = options.releaseConfidence ?? 0.3;
    this.switchMs = options.switchMs ?? 110;
  }

  get state(): PitchState {
    return this.current;
  }

  update(input: PitchStateInput): PitchState {
    const { reading, accepted, confidence, timeMs } = input;

    const usable =
      reading !== null &&
      accepted &&
      confidence >= (this.current.midi !== null ? this.releaseConfidence : this.activateConfidence);

    if (!usable) {
      this.candidateMidi = null;
      return this.decay(timeMs);
    }

    this.lastGoodAt = timeMs;
    const midi = reading.note.midi;

    // Same note as displayed: refresh the reading in place. Cents keep updating
    // live — that is the whole point of a tuner — while the note itself is
    // anchored and does not re-trigger any transition.
    if (this.current.midi === midi) {
      this.candidateMidi = null;
      this.current = {
        ...this.current,
        state: "stable",
        reading,
        confidence,
        held: false,
      };
      return this.current;
    }

    // A different note: it has to hold before it takes over the display.
    if (this.candidateMidi !== midi) {
      this.candidateMidi = midi;
      this.candidateSince = timeMs;
    }

    const required = this.current.midi === null ? this.minStableMs : this.switchMs;
    if (timeMs - this.candidateSince < required) {
      // Show "detecting" only when there is nothing already on screen; otherwise
      // the previous note stays put rather than blinking out mid-decision.
      this.current =
        this.current.midi === null
          ? { ...this.current, state: "detecting", confidence, held: false }
          : this.current;
      return this.current;
    }

    this.candidateMidi = null;
    this.current = {
      state: "stable",
      reading,
      midi,
      confidence,
      stableSince: timeMs,
      changedAt: timeMs,
      held: false,
    };
    return this.current;
  }

  /** No usable signal: hold the last note briefly, then let it go. */
  private decay(timeMs: number): PitchState {
    if (this.current.midi === null) {
      if (this.current.state !== "no_signal") {
        this.current = { ...EMPTY, changedAt: timeMs };
      }
      return this.current;
    }

    if (timeMs - this.lastGoodAt < this.holdMs) {
      if (!this.current.held) {
        this.current = { ...this.current, state: "holding", held: true };
      }
      return this.current;
    }

    this.current = { ...EMPTY, changedAt: timeMs };
    return this.current;
  }

  reset(): void {
    this.current = EMPTY;
    this.candidateMidi = null;
    this.candidateSince = 0;
    this.lastGoodAt = 0;
  }
}
