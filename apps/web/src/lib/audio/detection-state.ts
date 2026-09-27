"use client";

import type {
  PitchUiState,
  PositionState,
  RejectReason,
  SignalState,
} from "@fretlight/core";
import type { InputType } from "./audio-input";
import type { PitchSourceKind } from "./pitch-source";

/**
 * Detection state, split along the lines things actually change on.
 *
 * One combined object would mean every component re-renders whenever anything
 * moves — and cents moves on every frame while the selected device moves about
 * once a session. Each slice below is cached independently and only replaced
 * when its own fields change, so `useSyncExternalStore` can bail out of renders
 * that would have produced identical output.
 */

/** The input device and its health. Changes rarely. */
export interface AudioState {
  readonly listening: boolean;
  readonly starting: boolean;
  readonly sourceKind: PitchSourceKind;
  readonly inputType: InputType;
  readonly deviceId: string | null;
  readonly deviceLabel: string;
  /** 0..1 input level, for the meter. */
  readonly signalStrength: number;
  /** 0..1 peak level — how close the input is to clipping. */
  readonly peakLevel: number;
  readonly error: string | null;
}

/** What is sounding. Changes constantly. */
export interface PitchStateSlice {
  readonly frequency: number | null;
  readonly noteName: string | null;
  readonly octave: number | null;
  readonly midi: number | null;
  readonly cents: number | null;
  /** 0..1 confidence that this is the instrument. */
  readonly confidence: number;
  readonly display: PitchUiState;
  readonly held: boolean;
}

/** Where it was played. Changes per note, not per frame. */
export interface FretPositionStateSlice {
  readonly string: number | null;
  readonly fret: number | null;
  readonly noteName: string | null;
  /** 0..1 score of the chosen position. */
  readonly confidence: number;
  readonly state: PositionState;
  /** The alternatives, ranked, for the "other places" hint. */
  readonly candidates: readonly { string: number; fret: number; name: string; score: number }[];
}

/** One value the UI can switch on, plus a line it can show. */
export interface SignalStateSlice {
  readonly state: SignalState;
  readonly message: string;
  readonly rejectReason: RejectReason | null;
}

export const EMPTY_AUDIO_STATE: AudioState = {
  listening: false,
  starting: false,
  sourceKind: "mock",
  inputType: "microphone",
  deviceId: null,
  deviceLabel: "Virtual instrument",
  signalStrength: 0,
  peakLevel: 0,
  error: null,
};

export const EMPTY_PITCH_STATE: PitchStateSlice = {
  frequency: null,
  noteName: null,
  octave: null,
  midi: null,
  cents: null,
  confidence: 0,
  display: "no_signal",
  held: false,
};

export const EMPTY_POSITION_STATE: FretPositionStateSlice = {
  string: null,
  fret: null,
  noteName: null,
  confidence: 0,
  state: "position_unknown",
  candidates: [],
};

export const EMPTY_SIGNAL_STATE: SignalStateSlice = {
  state: "no_input",
  message: "No input selected",
  rejectReason: null,
};

/**
 * Replace `previous` only when a field actually differs.
 *
 * This is what makes the slicing worth anything: returning a fresh object every
 * frame would defeat `useSyncExternalStore`'s identity check and re-render
 * everything anyway.
 */
export function reuseIfEqual<T extends object>(previous: T, next: T): T {
  for (const key of Object.keys(next) as (keyof T)[]) {
    const a = previous[key];
    const b = next[key];
    if (a === b) continue;
    // Candidate lists are rebuilt per note; compare by length and identity of
    // the first entry rather than deep-equal on a hot path.
    if (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a[0] === b[0]) continue;
    return next;
  }
  return previous;
}
