import { intervalLabel } from "./intervals";
import { formatPitchClass, mod, parseNoteName } from "./pitch";
import type { PitchClass, Spelling } from "./types";

export type ScaleId =
  | "major"
  | "natural_minor"
  | "major_pentatonic"
  | "minor_pentatonic"
  | "blues"
  | "dorian"
  | "phrygian"
  | "lydian"
  | "mixolydian"
  | "locrian"
  | "harmonic_minor"
  | "melodic_minor"
  | "phrygian_dominant";

export interface ScaleDefinition {
  readonly id: ScaleId;
  readonly name: string;
  /** Ordered semitone offsets from the root, ascending, starting at 0. */
  readonly intervals: readonly number[];
  /** Degree labels aligned 1:1 with `intervals`. */
  readonly degrees: readonly string[];
  /** Preferred accidental spelling when rendering this scale's notes. */
  readonly spelling: Spelling;
  /** Short description surfaced in the UI — no LLM needed for the basics. */
  readonly description: string;
  /** Grouping used by the scale picker. */
  readonly family: "pentatonic" | "diatonic" | "blues" | "modal" | "minor";
}

/**
 * The scale library. Adding a scale is a data change only: every consumer
 * (fretboard overlay, scale finder, practice sequencer, 3D renderer) derives
 * from these intervals.
 */
export const SCALES: Record<ScaleId, ScaleDefinition> = {
  major: {
    id: "major",
    name: "Major",
    intervals: [0, 2, 4, 5, 7, 9, 11],
    degrees: ["1", "2", "3", "4", "5", "6", "7"],
    spelling: "sharp",
    family: "diatonic",
    description: "The reference scale. Bright and resolved; every other mode is a rotation of it.",
  },
  natural_minor: {
    id: "natural_minor",
    name: "Natural Minor",
    intervals: [0, 2, 3, 5, 7, 8, 10],
    degrees: ["1", "2", "b3", "4", "5", "b6", "b7"],
    spelling: "flat",
    family: "minor",
    description: "The Aeolian mode. Flat 3rd, 6th and 7th give it its darker colour.",
  },
  major_pentatonic: {
    id: "major_pentatonic",
    name: "Major Pentatonic",
    intervals: [0, 2, 4, 7, 9],
    degrees: ["1", "2", "3", "5", "6"],
    spelling: "sharp",
    family: "pentatonic",
    description: "Major scale without the 4th and 7th — no semitone clashes, so nothing sounds wrong.",
  },
  minor_pentatonic: {
    id: "minor_pentatonic",
    name: "Minor Pentatonic",
    intervals: [0, 3, 5, 7, 10],
    degrees: ["1", "b3", "4", "5", "b7"],
    spelling: "flat",
    family: "pentatonic",
    description: "Five notes that carry rock, blues and most guitar solos. Start here.",
  },
  blues: {
    id: "blues",
    name: "Blues",
    intervals: [0, 3, 5, 6, 7, 10],
    degrees: ["1", "b3", "4", "b5", "5", "b7"],
    spelling: "flat",
    family: "blues",
    description: "Minor pentatonic with the b5 passing note — the 'blue note'.",
  },
  dorian: {
    id: "dorian",
    name: "Dorian",
    intervals: [0, 2, 3, 5, 7, 9, 10],
    degrees: ["1", "2", "b3", "4", "5", "6", "b7"],
    spelling: "flat",
    family: "modal",
    description: "Minor with a natural 6th. Funk, jazz and Santana live here.",
  },
  phrygian: {
    id: "phrygian",
    name: "Phrygian",
    intervals: [0, 1, 3, 5, 7, 8, 10],
    degrees: ["1", "b2", "b3", "4", "5", "b6", "b7"],
    spelling: "flat",
    family: "modal",
    description: "Minor with a b2. Spanish and metal flavour.",
  },
  lydian: {
    id: "lydian",
    name: "Lydian",
    intervals: [0, 2, 4, 6, 7, 9, 11],
    degrees: ["1", "2", "3", "#4", "5", "6", "7"],
    spelling: "sharp",
    family: "modal",
    description: "Major with a #4. Floating, cinematic.",
  },
  mixolydian: {
    id: "mixolydian",
    name: "Mixolydian",
    intervals: [0, 2, 4, 5, 7, 9, 10],
    degrees: ["1", "2", "3", "4", "5", "6", "b7"],
    spelling: "flat",
    family: "modal",
    description: "Major with a b7. The dominant-7th sound of blues and rock.",
  },
  locrian: {
    id: "locrian",
    name: "Locrian",
    intervals: [0, 1, 3, 5, 6, 8, 10],
    degrees: ["1", "b2", "b3", "4", "b5", "b6", "b7"],
    spelling: "flat",
    family: "modal",
    description: "Diminished 5th makes the root unstable. Rare, useful over m7b5.",
  },
  harmonic_minor: {
    id: "harmonic_minor",
    name: "Harmonic Minor",
    intervals: [0, 2, 3, 5, 7, 8, 11],
    degrees: ["1", "2", "b3", "4", "5", "b6", "7"],
    spelling: "flat",
    family: "minor",
    description: "Natural minor with a raised 7th — creates the leading tone back to the root.",
  },
  melodic_minor: {
    id: "melodic_minor",
    name: "Melodic Minor",
    intervals: [0, 2, 3, 5, 7, 9, 11],
    degrees: ["1", "2", "b3", "4", "5", "6", "7"],
    spelling: "flat",
    family: "minor",
    description: "Major scale with a b3. Jazz minor.",
  },
  phrygian_dominant: {
    id: "phrygian_dominant",
    name: "Phrygian Dominant",
    intervals: [0, 1, 4, 5, 7, 8, 10],
    degrees: ["1", "b2", "3", "4", "5", "b6", "b7"],
    spelling: "flat",
    family: "modal",
    description: "5th mode of harmonic minor. Flamenco and Middle-Eastern colour.",
  },
};

export const SCALE_IDS = Object.keys(SCALES) as ScaleId[];

export interface ScaleNote {
  readonly pitchClass: PitchClass;
  readonly name: string;
  /** Semitones above the root. */
  readonly interval: number;
  /** Degree label, e.g. "b3". */
  readonly degree: string;
  /** 1-based position in the scale. */
  readonly index: number;
}

export interface Scale {
  readonly root: PitchClass;
  readonly rootName: string;
  readonly definition: ScaleDefinition;
  readonly notes: readonly ScaleNote[];
  /** Convenience: the pitch classes as a Set for O(1) membership tests. */
  readonly pitchClasses: ReadonlySet<PitchClass>;
}

function resolveRoot(root: PitchClass | string): PitchClass | null {
  if (typeof root === "number") return mod(root, 12);
  const parsed = parseNoteName(root);
  return parsed ? parsed.pitchClass : null;
}

/**
 * Build a scale. Returns null only when the root cannot be parsed, so callers
 * can surface bad user input without a try/catch.
 *
 * getScale("A", "minor_pentatonic") -> A C D E G / 1 b3 4 5 b7
 */
export function getScale(root: PitchClass | string, scaleId: ScaleId): Scale | null {
  const rootPc = resolveRoot(root);
  if (rootPc === null) return null;

  const definition = SCALES[scaleId];
  const notes = definition.intervals.map((interval, index) => {
    const pitchClass = mod(rootPc + interval, 12);
    return {
      pitchClass,
      name: formatPitchClass(pitchClass, definition.spelling),
      interval,
      degree: definition.degrees[index] ?? intervalLabel(interval),
      index: index + 1,
    } satisfies ScaleNote;
  });

  return {
    root: rootPc,
    rootName: formatPitchClass(rootPc, definition.spelling),
    definition,
    notes,
    pitchClasses: new Set(notes.map((n) => n.pitchClass)),
  };
}

/** Just the note names: getScaleNotes("A", "minor_pentatonic") -> ["A","C","D","E","G"]. */
export function getScaleNotes(root: PitchClass | string, scaleId: ScaleId): string[] {
  return getScale(root, scaleId)?.notes.map((n) => n.name) ?? [];
}

/** Semitone offsets from the root. */
export function getScaleIntervals(scaleId: ScaleId): readonly number[] {
  return SCALES[scaleId].intervals;
}

/** Degree labels, e.g. ["1","b3","4","5","b7"]. */
export function getScaleDegrees(scaleId: ScaleId): readonly string[] {
  return SCALES[scaleId].degrees;
}

/** Which degree (if any) a pitch class occupies in a scale. */
export function degreeOf(scale: Scale, pitchClass: PitchClass): ScaleNote | null {
  return scale.notes.find((n) => n.pitchClass === mod(pitchClass, 12)) ?? null;
}
