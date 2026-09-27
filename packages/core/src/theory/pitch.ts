import {
  FLAT_NAMES,
  SHARP_NAMES,
  type Note,
  type PitchClass,
  type PitchReading,
  type Spelling,
} from "./types";

/** Reference tuning in Hz for A4. Configurable for ensembles that tune to 442 etc. */
export const DEFAULT_A4 = 440;

/** MIDI number of A4. */
const A4_MIDI = 69;

const LETTER_SEMITONES: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

/** Positive modulo — JS `%` keeps the sign of the dividend, which we never want here. */
export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/**
 * Parse a note name such as "A", "Bb", "F#", "Eb3", "C#-1" into a MIDI number.
 * Octave is optional; when omitted, octave 4 is assumed.
 * Returns null for anything unparseable rather than throwing — callers are
 * frequently handling user input.
 */
export function parseNoteName(input: string): { pitchClass: PitchClass; octave: number | null } | null {
  const match = /^([A-Ga-g])([#b♯♭x]*)(-?\d+)?$/.exec(input.trim());
  if (!match) return null;

  const [, letter, accidentals = "", octaveText] = match;
  const base = LETTER_SEMITONES[letter!.toUpperCase()];
  if (base === undefined) return null;

  let offset = 0;
  for (const ch of accidentals) {
    if (ch === "#" || ch === "♯") offset += 1;
    else if (ch === "b" || ch === "♭") offset -= 1;
    else if (ch === "x") offset += 2;
  }

  return {
    pitchClass: mod(base + offset, 12),
    octave: octaveText === undefined ? null : Number.parseInt(octaveText, 10),
  };
}

/** "A4" -> 69. Returns null when the name cannot be parsed. */
export function noteToMidi(name: string): number | null {
  const parsed = parseNoteName(name);
  if (!parsed) return null;
  const octave = parsed.octave ?? 4;
  return parsed.pitchClass + (octave + 1) * 12;
}

/** 69 -> { name: "A", octave: 4, midi: 69 }. */
export function midiToNote(midi: number, spelling: Spelling = "sharp"): Note {
  const rounded = Math.round(midi);
  const pitchClass = mod(rounded, 12);
  const octave = Math.floor(rounded / 12) - 1;
  const names = spelling === "flat" ? FLAT_NAMES : SHARP_NAMES;
  return {
    name: names[pitchClass]!,
    pitchClass,
    octave,
    midi: rounded,
  };
}

/** 69 -> 440 Hz. Accepts fractional MIDI values. */
export function midiToFrequency(midi: number, a4 = DEFAULT_A4): number {
  return a4 * Math.pow(2, (midi - A4_MIDI) / 12);
}

/** 440 Hz -> 69. Returns a fractional MIDI number; do not round before measuring cents. */
export function frequencyToMidi(frequency: number, a4 = DEFAULT_A4): number {
  return A4_MIDI + 12 * Math.log2(frequency / a4);
}

/** "A4" -> 440 Hz. Returns null when the name cannot be parsed. */
export function noteToFrequency(name: string, a4 = DEFAULT_A4): number | null {
  const midi = noteToMidi(name);
  return midi === null ? null : midiToFrequency(midi, a4);
}

/** Signed cents from `reference` to `frequency`. 100 cents === one semitone. */
export function calculateCents(frequency: number, reference: number): number {
  return 1200 * Math.log2(frequency / reference);
}

/**
 * The headline conversion: a measured frequency becomes a note plus a signed
 * cents deviation. This is the only place the tuner, note finder and practice
 * engine need to agree on.
 */
export function frequencyToNote(
  frequency: number,
  options: { a4?: number; spelling?: Spelling } = {},
): PitchReading {
  const a4 = options.a4 ?? DEFAULT_A4;
  const midiFloat = frequencyToMidi(frequency, a4);
  const note = midiToNote(midiFloat, options.spelling ?? "sharp");
  return {
    frequency,
    note,
    cents: Math.round((midiFloat - note.midi) * 100 * 10) / 10,
    midiFloat,
  };
}

/** Render a MIDI number as scientific pitch notation, e.g. 40 -> "E2". */
export function formatNote(midi: number, spelling: Spelling = "sharp"): string {
  const note = midiToNote(midi, spelling);
  return `${note.name}${note.octave}`;
}

/** Render a pitch class only, without octave. */
export function formatPitchClass(pitchClass: PitchClass, spelling: Spelling = "sharp"): string {
  const names = spelling === "flat" ? FLAT_NAMES : SHARP_NAMES;
  return names[mod(pitchClass, 12)]!;
}
