/**
 * Interval vocabulary. Scales and chords are both defined as ordered semitone
 * offsets from a root, so one label table serves both.
 */

/** Default label for each semitone distance within an octave. */
export const INTERVAL_LABELS = [
  "1", "b2", "2", "b3", "3", "4", "b5", "5", "b6", "6", "b7", "7",
] as const;

/** Alternative sharp-side spelling, used when a chord formula calls for it. */
export const INTERVAL_LABELS_SHARP = [
  "1", "#1", "2", "#2", "3", "4", "#4", "5", "#5", "6", "#6", "7",
] as const;

/** Human readable names, used in tooltips and the theory panel. */
export const INTERVAL_FULL_NAMES = [
  "Unison",
  "Minor 2nd",
  "Major 2nd",
  "Minor 3rd",
  "Major 3rd",
  "Perfect 4th",
  "Tritone",
  "Perfect 5th",
  "Minor 6th",
  "Major 6th",
  "Minor 7th",
  "Major 7th",
] as const;

/** Semitones (0..11) -> "b3". */
export function intervalLabel(semitones: number, preferSharp = false): string {
  const index = ((semitones % 12) + 12) % 12;
  return (preferSharp ? INTERVAL_LABELS_SHARP : INTERVAL_LABELS)[index]!;
}

/** Semitones (0..11) -> "Minor 3rd". */
export function intervalName(semitones: number): string {
  const index = ((semitones % 12) + 12) % 12;
  return INTERVAL_FULL_NAMES[index]!;
}
