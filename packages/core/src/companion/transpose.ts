/**
 * Move every chord in a typed progression up or down by semitones, keeping
 * each chord's quality and any slash bass. Separators ("|", "-", spaces) are
 * kept as typed. Spelling follows the usual lead-sheet habit: sharps for F#
 * and C#, flats for the other black keys (Bb, Eb, Ab, Db).
 */
const NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] as const;
const BASE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function shiftNote(letter: string, accidental: string, semitones: number): string {
  const pc = BASE[letter]! + (accidental === "#" ? 1 : accidental === "b" ? -1 : 0);
  return NAMES[(((pc + semitones) % 12) + 12) % 12]!;
}

export function transposeProgressionText(text: string, semitones: number): string {
  if (semitones % 12 === 0) return text;
  // A root starts a token (after a separator) and a slash bass follows "/". Both are capital
  // letters, so the "b" of "Bbmaj7" or the "d" of "add9" is never mistaken for a note.
  return text.replace(/(^|[\s|,\-/])([A-G])([#b]?)/g, (_m, lead: string, letter: string, accidental: string) =>
    lead + shiftNote(letter, accidental, semitones),
  );
}
