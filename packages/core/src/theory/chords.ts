import { formatPitchClass, mod, parseNoteName } from "./pitch";
import type { PitchClass, Spelling } from "./types";

export type ChordId =
  | "major"
  | "minor"
  | "power"
  | "dom7"
  | "maj7"
  | "min7"
  | "sus2"
  | "sus4"
  | "dim"
  | "aug"
  | "min7b5"
  | "dim7"
  | "six"
  | "min6"
  | "add9"
  | "min_maj7";

export interface ChordDefinition {
  readonly id: ChordId;
  readonly name: string;
  /** Suffix appended to the root, e.g. "m7" -> "Am7". */
  readonly symbol: string;
  /** Semitone offsets from the root. */
  readonly intervals: readonly number[];
  /** Degree labels aligned 1:1 with `intervals`. */
  readonly degrees: readonly string[];
  readonly spelling: Spelling;
  readonly family: "triad" | "seventh" | "suspended" | "power" | "extended";
}

export const CHORDS: Record<ChordId, ChordDefinition> = {
  major:     { id: "major",     name: "Major",          symbol: "",      intervals: [0, 4, 7],      degrees: ["1", "3", "5"],       spelling: "sharp", family: "triad" },
  minor:     { id: "minor",     name: "Minor",          symbol: "m",     intervals: [0, 3, 7],      degrees: ["1", "b3", "5"],      spelling: "flat",  family: "triad" },
  power:     { id: "power",     name: "Power Chord",    symbol: "5",     intervals: [0, 7],         degrees: ["1", "5"],            spelling: "sharp", family: "power" },
  dom7:      { id: "dom7",      name: "Dominant 7th",   symbol: "7",     intervals: [0, 4, 7, 10],  degrees: ["1", "3", "5", "b7"], spelling: "flat",  family: "seventh" },
  maj7:      { id: "maj7",      name: "Major 7th",      symbol: "maj7",  intervals: [0, 4, 7, 11],  degrees: ["1", "3", "5", "7"],  spelling: "sharp", family: "seventh" },
  min7:      { id: "min7",      name: "Minor 7th",      symbol: "m7",    intervals: [0, 3, 7, 10],  degrees: ["1", "b3", "5", "b7"],spelling: "flat",  family: "seventh" },
  sus2:      { id: "sus2",      name: "Suspended 2nd",  symbol: "sus2",  intervals: [0, 2, 7],      degrees: ["1", "2", "5"],       spelling: "sharp", family: "suspended" },
  sus4:      { id: "sus4",      name: "Suspended 4th",  symbol: "sus4",  intervals: [0, 5, 7],      degrees: ["1", "4", "5"],       spelling: "sharp", family: "suspended" },
  dim:       { id: "dim",       name: "Diminished",     symbol: "dim",   intervals: [0, 3, 6],      degrees: ["1", "b3", "b5"],     spelling: "flat",  family: "triad" },
  aug:       { id: "aug",       name: "Augmented",      symbol: "aug",   intervals: [0, 4, 8],      degrees: ["1", "3", "#5"],      spelling: "sharp", family: "triad" },
  min7b5:    { id: "min7b5",    name: "Half Diminished",symbol: "m7b5",  intervals: [0, 3, 6, 10],  degrees: ["1", "b3", "b5", "b7"], spelling: "flat", family: "seventh" },
  dim7:      { id: "dim7",      name: "Diminished 7th", symbol: "dim7",  intervals: [0, 3, 6, 9],   degrees: ["1", "b3", "b5", "bb7"], spelling: "flat", family: "seventh" },
  six:       { id: "six",       name: "Major 6th",      symbol: "6",     intervals: [0, 4, 7, 9],   degrees: ["1", "3", "5", "6"],  spelling: "sharp", family: "extended" },
  min6:      { id: "min6",      name: "Minor 6th",      symbol: "m6",    intervals: [0, 3, 7, 9],   degrees: ["1", "b3", "5", "6"], spelling: "flat",  family: "extended" },
  add9:      { id: "add9",      name: "Add 9",          symbol: "add9",  intervals: [0, 4, 7, 14],  degrees: ["1", "3", "5", "9"],  spelling: "sharp", family: "extended" },
  min_maj7:  { id: "min_maj7",  name: "Minor Major 7th",symbol: "mMaj7", intervals: [0, 3, 7, 11],  degrees: ["1", "b3", "5", "7"], spelling: "flat",  family: "seventh" },
};

export const CHORD_IDS = Object.keys(CHORDS) as ChordId[];

export interface ChordTone {
  readonly pitchClass: PitchClass;
  readonly name: string;
  readonly interval: number;
  readonly degree: string;
  readonly index: number;
}

export interface Chord {
  readonly root: PitchClass;
  readonly rootName: string;
  readonly definition: ChordDefinition;
  /** Full display symbol, e.g. "Am7". */
  readonly symbol: string;
  readonly tones: readonly ChordTone[];
  readonly pitchClasses: ReadonlySet<PitchClass>;
}

function resolveRoot(root: PitchClass | string): PitchClass | null {
  if (typeof root === "number") return mod(root, 12);
  const parsed = parseNoteName(root);
  return parsed ? parsed.pitchClass : null;
}

/** getChord("A", "minor") -> A C E, degrees 1 b3 5. */
export function getChord(root: PitchClass | string, chordId: ChordId): Chord | null {
  const rootPc = resolveRoot(root);
  if (rootPc === null) return null;

  const definition = CHORDS[chordId];
  const tones = definition.intervals.map((interval, index) => {
    const pitchClass = mod(rootPc + interval, 12);
    return {
      pitchClass,
      name: formatPitchClass(pitchClass, definition.spelling),
      interval,
      degree: definition.degrees[index] ?? String(index + 1),
      index: index + 1,
    } satisfies ChordTone;
  });

  const rootName = formatPitchClass(rootPc, definition.spelling);
  return {
    root: rootPc,
    rootName,
    definition,
    symbol: `${rootName}${definition.symbol}`,
    tones,
    pitchClasses: new Set(tones.map((t) => t.pitchClass)),
  };
}

/** getChordNotes("A", "minor") -> ["A", "C", "E"]. */
export function getChordNotes(root: PitchClass | string, chordId: ChordId): string[] {
  return getChord(root, chordId)?.tones.map((t) => t.name) ?? [];
}

export function getChordIntervals(chordId: ChordId): readonly number[] {
  return CHORDS[chordId].intervals;
}

/** Degree labels, e.g. ["1","b3","5","b7"]. */
export function getChordDegrees(chordId: ChordId): readonly string[] {
  return CHORDS[chordId].degrees;
}

/**
 * Which chords of the library fit entirely inside a set of pitch classes.
 * Used by the "chords in this scale" panel — deterministic, no AI.
 */
export function chordsWithin(
  pitchClasses: ReadonlySet<PitchClass>,
  chordIds: readonly ChordId[] = CHORD_IDS,
): Chord[] {
  const result: Chord[] = [];
  for (let root = 0; root < 12; root++) {
    for (const id of chordIds) {
      const chord = getChord(root, id);
      if (!chord) continue;
      const fits = [...chord.pitchClasses].every((pc) => pitchClasses.has(pc));
      if (fits) result.push(chord);
    }
  }
  return result;
}
