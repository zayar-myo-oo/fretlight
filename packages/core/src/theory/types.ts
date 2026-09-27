/**
 * Core musical value types.
 *
 * Everything in this package is pure data + pure functions: no DOM, no Web Audio,
 * no React. That is what lets the same engine run in the browser, in a Web Worker,
 * in React Native, or under Node for tests and benchmarking.
 */

/** Pitch class names in sharp spelling, index === semitone from C. */
export const SHARP_NAMES = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
] as const;

/** Pitch class names in flat spelling, index === semitone from C. */
export const FLAT_NAMES = [
  "C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B",
] as const;

export type SharpName = (typeof SHARP_NAMES)[number];
export type FlatName = (typeof FLAT_NAMES)[number];

/** Any accepted note spelling, e.g. "A", "A#", "Bb", "Cb", "E##". */
export type NoteName = string;

/** 0..11, semitones above C. */
export type PitchClass = number;

/** Accidental preference used when rendering a pitch class as text. */
export type Spelling = "sharp" | "flat";

/** A concrete sounding pitch: pitch class + octave (scientific pitch notation). */
export interface Note {
  /** Rendered name including accidental, e.g. "A#". */
  readonly name: string;
  /** 0..11 */
  readonly pitchClass: PitchClass;
  /** Scientific pitch notation octave. Middle C = C4. */
  readonly octave: number;
  /** MIDI note number. A4 = 69. */
  readonly midi: number;
}

/** Result of converting a measured frequency into musical terms. */
export interface PitchReading {
  readonly frequency: number;
  /** Nearest equal-tempered note. */
  readonly note: Note;
  /** Signed deviation from that note in cents (-50..+50). */
  readonly cents: number;
  /** Exact fractional MIDI number the frequency corresponds to. */
  readonly midiFloat: number;
}
