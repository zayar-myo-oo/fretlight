import type { ScaleNote } from "./scales";

/**
 * Classical functional-harmony labels for a scale degree.
 *
 * This is standard tonal theory (a first-year-harmony table), not something
 * invented for this app — and it only means anything against a 7-note
 * diatonic-family scale. A pentatonic or blues scale skips degrees, so
 * "the subdominant" does not pick out a single unambiguous note the way it
 * does in a 7-note scale; `harmonicFunctionOf` returns null there rather
 * than asserting a label that would not hold up.
 */
export type HarmonicFunction =
  | "Tonic"
  | "Supertonic"
  | "Mediant"
  | "Subdominant"
  | "Dominant"
  | "Submediant"
  | "Leading Tone"
  | "Subtonic";

const DEGREE_FUNCTIONS: Readonly<Record<number, HarmonicFunction>> = {
  1: "Tonic",
  2: "Supertonic",
  3: "Mediant",
  4: "Subdominant",
  5: "Dominant",
  6: "Submediant",
};

export function harmonicFunctionOf(note: ScaleNote, scaleLength: number): HarmonicFunction | null {
  if (scaleLength !== 7) return null;
  if (note.index === 7) {
    // A major 7th a half-step under the root is a leading tone (pulls up to
    // it); a minor 7th a whole step under is a subtonic (does not pull the
    // same way) — the distinction is the whole reason harmonic minor exists.
    return note.interval === 11 ? "Leading Tone" : "Subtonic";
  }
  return DEGREE_FUNCTIONS[note.index] ?? null;
}
