import type { RejectReason } from "./quality";
import type { PitchUiState } from "./pitch-state";

/**
 * What the input is doing, as a single value the UI can switch on.
 *
 * The distinction that matters: "I hear nothing", "I hear something but it is
 * not an instrument" and "I hear a note but I am not sure which" are three very
 * different messages to a player, and collapsing them into a blank readout
 * leaves them guessing whether the app is broken, the cable is dead, or they
 * need to play louder.
 */
export type SignalState =
  /** No device open. */
  | "no_input"
  /** Device open, nothing above the noise floor. */
  | "no_signal"
  /** Something there, too quiet to analyse — turn up, or play harder. */
  | "low_signal"
  /** Input is hitting the ceiling — turn the gain down before it distorts detection. */
  | "clipping"
  /** Energy present, but it is not an instrument: speech, room noise, handling. */
  | "noise"
  /** Pitched, but not confidently enough to name. */
  | "pitch_uncertain"
  /** A note, named and stable. */
  | "note_detected";

/** How much to trust the string/fret the note was mapped to. */
export type PositionState = "position_unknown" | "position_uncertain" | "position_confirmed";

export interface SignalAssessment {
  readonly signal: SignalState;
  readonly position: PositionState;
  /** Short line the UI can show directly. */
  readonly message: string;
}

export interface SignalInputs {
  readonly listening: boolean;
  /** Frame level, 0..1. */
  readonly rms: number;
  /** Loudest sample in the frame, 0..1 — how close the input is to the ceiling. */
  readonly peak: number;
  /** Instrument-gate confidence, 0..1. */
  readonly instrumentConfidence: number;
  /** Why the gate rejected the frame, when it did. */
  readonly rejectReason: RejectReason | null;
  /** What the display state machine decided. */
  readonly display: PitchUiState;
  /** Score of the chosen fret position, 0..1. */
  readonly positionScore: number | null;
}

export interface SignalThresholds {
  /** Below this the input counts as silent. */
  readonly silence?: number;
  /** Between `silence` and this, the signal is present but too weak. */
  readonly weak?: number;
  /** Position score needed before the highlight is presented as confirmed. */
  readonly positionConfident?: number;
  /** Peak at or above this counts as clipping. */
  readonly clip?: number;
}

/**
 * Collapse the pipeline's several confidence signals into one state plus a
 * message. Pure, so the wording and the thresholds are testable rather than
 * scattered through components.
 */
export function assessSignal(
  inputs: SignalInputs,
  thresholds: SignalThresholds = {},
): SignalAssessment {
  const silence = thresholds.silence ?? 0.006;
  const weak = thresholds.weak ?? 0.02;
  const positionConfident = thresholds.positionConfident ?? 0.45;
  const clip = thresholds.clip ?? 0.97;

  const position: PositionState =
    inputs.positionScore === null
      ? "position_unknown"
      : inputs.positionScore >= positionConfident
        ? "position_confirmed"
        : "position_uncertain";

  if (!inputs.listening) {
    return { signal: "no_input", position: "position_unknown", message: "No input selected" };
  }

  // Checked ahead of everything else, including a held note: a clipped input
  // is actively producing bad data for every stage downstream, so the player
  // needs to know regardless of what is currently on screen.
  if (inputs.peak >= clip) {
    return {
      signal: "clipping",
      position,
      message: "Input is clipping — turn the gain down",
    };
  }

  // A note that is displayed stays displayed. It may be decaying below the
  // thresholds below, and reporting "no signal" over a note the player can still
  // hear ringing is exactly the contradiction that makes a readout feel broken.
  if (inputs.display === "stable" || inputs.display === "holding") {
    return { signal: "note_detected", position, message: "" };
  }

  if (inputs.rms < silence) {
    return { signal: "no_signal", position, message: "Waiting for input" };
  }

  if (inputs.rms < weak) {
    return {
      signal: "low_signal",
      position,
      message: "Signal is weak — play harder or raise the input gain",
    };
  }

  if (inputs.rejectReason && inputs.rejectReason !== "silent") {
    return {
      signal: "noise",
      position,
      message: rejectMessage(inputs.rejectReason),
    };
  }

  if (inputs.display === "detecting" || inputs.instrumentConfidence > 0) {
    return { signal: "pitch_uncertain", position, message: "Listening…" };
  }

  return { signal: "no_signal", position, message: "Waiting for input" };
}

function rejectMessage(reason: RejectReason): string {
  switch (reason) {
    case "unstable_pitch":
      return "Pitch is not steady — speech or background music?";
    case "noise_like":
      return "Signal is too noisy to read";
    case "aperiodic":
      return "No clear pitch in the signal";
    case "below_gate":
      return "Not confident this is the instrument";
    default:
      return "Waiting for input";
  }
}

/** True when the UI is entitled to show a note name. */
export function shouldShowNote(state: SignalState): boolean {
  return state === "note_detected";
}
