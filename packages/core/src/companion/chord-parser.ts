import { CHORDS } from "../theory/chords";
import { parseNoteName } from "../theory/pitch";
import { qualityInfo } from "../song-analysis/chord-templates";
import type { ChordQuality } from "../song-analysis/types";

export interface ParsedChord {
  readonly root: number;
  readonly quality: ChordQuality;
  /** Root spelling as typed ("Bb", "F#"). */
  readonly rootName: string;
  /** What was typed, trimmed. */
  readonly text: string;
}

/** Quality suffixes people actually write, longest first so "maj7" is not read as "m" + "aj7". */
const SUFFIXES: readonly [string, ChordQuality][] = [
  ["maj7", "maj7"], ["major7", "maj7"], ["Maj7", "maj7"], ["M7", "maj7"], ["Δ7", "maj7"], ["Δ", "maj7"],
  ["min7", "m7"], ["m7", "m7"], ["-7", "m7"],
  ["sus2", "sus2"], ["sus4", "sus4"], ["sus", "sus4"],
  ["add9", "add9"], ["add2", "add9"],
  ["dim", "dim"], ["°", "dim"], ["o", "dim"],
  ["aug", "aug"], ["+", "aug"],
  ["major", "maj"], ["Maj", "maj"], ["maj", "maj"], ["M", "maj"],
  ["minor", "min"], ["min", "min"], ["mi", "min"], ["m", "min"], ["-", "min"],
  ["7", "7"], ["dom7", "7"], ["9", "7"], ["13", "7"],
  // Close relatives this engine has no separate template for: read as the chord they are built on.
  ["maj9", "maj7"], ["m9", "m7"], ["m7b5", "dim"], ["ø", "dim"], ["ø7", "dim"], ["dim7", "dim"], ["°7", "dim"],
  ["m6", "min"], ["mMaj7", "min"], ["mmaj7", "min"], ["7sus4", "sus4"],
  ["5", "maj"], ["6", "maj"],
  ["", "maj"],
];

/** Read one chord symbol: "C", "Am", "F#m7", "Bbmaj7", "Gsus4", "C/E" (the bass note is ignored). */
export function parseChordSymbol(input: string): ParsedChord | null {
  const text = input.trim().replace(/^\(|\)$/g, "");
  const slash = text.indexOf("/");
  const body = slash > 0 ? text.slice(0, slash) : text;
  const match = /^([A-Ga-g])([#b♯♭]?)(.*)$/.exec(body);
  if (!match) return null;

  const letter = match[1]!.toUpperCase();
  const accidental = (match[2] ?? "").replace("♯", "#").replace("♭", "b");
  const rootName = `${letter}${accidental}`;
  const parsed = parseNoteName(rootName);
  if (!parsed) return null;

  const rest = match[3] ?? "";
  for (const [suffix, quality] of SUFFIXES) {
    if (rest === suffix) return { root: parsed.pitchClass, quality, rootName, text };
  }
  return null;
}

export interface ParsedProgressionText {
  readonly chords: readonly ParsedChord[];
  /** Tokens that were not understood. */
  readonly errors: readonly string[];
}

/**
 * Read a progression typed in any common style: "C G Am F", "C | G | Am | F",
 * "C → G → Am → F", "C, G, Am, F". Bar lines and arrows only separate chords.
 */
export function parseProgressionText(text: string): ParsedProgressionText {
  const tokens = text
    .replace(/→|->|=>|\||,|;|\//g, (m) => (m === "/" ? "/" : " "))
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const chords: ParsedChord[] = [];
  const errors: string[] = [];
  for (const token of tokens) {
    const chord = parseChordSymbol(token);
    if (chord) chords.push(chord);
    else errors.push(token);
  }
  return { chords, errors };
}

/** Intervals of a quality, for callers that need the formula. */
export function qualityDegrees(quality: ChordQuality): readonly string[] {
  return CHORDS[qualityInfo(quality).chordId].degrees;
}
