import type { Chord } from "../theory/chords";
import { formatPitchClass, midiToFrequency, midiToNote, mod } from "../theory/pitch";
import type { Scale } from "../theory/scales";
import type { PitchClass, Spelling } from "../theory/types";
import { type TuningDefinition, tuningMidi } from "./tunings";

/** A single playable point on the neck. */
export interface FretPosition {
  /** 0 === lowest-pitched string. The UI decides which edge to draw it on. */
  readonly string: number;
  /** 0 === open string. */
  readonly fret: number;
  readonly midi: number;
  readonly pitchClass: PitchClass;
  /** Pitch-class name only, e.g. "A#". */
  readonly name: string;
  readonly octave: number;
  readonly frequency: number;
}

export interface Fretboard {
  readonly tuning: TuningDefinition;
  readonly openMidi: readonly number[];
  readonly stringCount: number;
  readonly fretCount: number;
}

/** Frets that traditionally carry inlay markers. Double dot at 12 and 24. */
export const INLAY_FRETS = [3, 5, 7, 9, 15, 17, 19, 21] as const;
export const DOUBLE_INLAY_FRETS = [12, 24] as const;

export function createFretboard(tuning: TuningDefinition, fretCount = 22): Fretboard {
  const openMidi = tuningMidi(tuning);
  return {
    tuning,
    openMidi,
    stringCount: openMidi.length,
    fretCount,
  };
}

/** The note sounding at a given string/fret. Returns null when out of range. */
export function noteAt(
  board: Fretboard,
  stringIndex: number,
  fret: number,
  spelling: Spelling = "sharp",
): FretPosition | null {
  const open = board.openMidi[stringIndex];
  if (open === undefined || fret < 0 || fret > board.fretCount) return null;

  const midi = open + fret;
  const note = midiToNote(midi, spelling);
  return {
    string: stringIndex,
    fret,
    midi,
    pitchClass: note.pitchClass,
    name: note.name,
    octave: note.octave,
    frequency: midiToFrequency(midi),
  };
}

/** Every position on the neck, useful for building overlays in one pass. */
export function allPositions(board: Fretboard, spelling: Spelling = "sharp"): FretPosition[] {
  const out: FretPosition[] = [];
  for (let s = 0; s < board.stringCount; s++) {
    for (let f = 0; f <= board.fretCount; f++) {
      const position = noteAt(board, s, f, spelling);
      if (position) out.push(position);
    }
  }
  return out;
}

/**
 * Every place a pitch class can be played.
 * Pass a MIDI number instead to restrict to that exact octave.
 *
 * getFretPositions(board, "E") -> open E, 12th fret E, 7th fret on A, ...
 */
export function getFretPositions(
  board: Fretboard,
  target: PitchClass | number,
  options: { exactOctave?: boolean; spelling?: Spelling } = {},
): FretPosition[] {
  const spelling = options.spelling ?? "sharp";
  const out: FretPosition[] = [];
  for (let s = 0; s < board.stringCount; s++) {
    for (let f = 0; f <= board.fretCount; f++) {
      const position = noteAt(board, s, f, spelling);
      if (!position) continue;
      const hit = options.exactOctave
        ? position.midi === target
        : position.pitchClass === mod(target, 12);
      if (hit) out.push(position);
    }
  }
  return out;
}

export interface ScaleFretPosition extends FretPosition {
  readonly degree: string;
  readonly interval: number;
  readonly isRoot: boolean;
  /** 1-based index within the scale, used for path ordering and colouring. */
  readonly scaleIndex: number;
}

/** Project a scale onto the whole neck. This is the data the 2D and 3D fretboards both render. */
export function getScalePositions(board: Fretboard, scale: Scale): ScaleFretPosition[] {
  const spelling = scale.definition.spelling;
  const byPitchClass = new Map(scale.notes.map((n) => [n.pitchClass, n]));
  const out: ScaleFretPosition[] = [];

  for (let s = 0; s < board.stringCount; s++) {
    for (let f = 0; f <= board.fretCount; f++) {
      const position = noteAt(board, s, f, spelling);
      if (!position) continue;
      const scaleNote = byPitchClass.get(position.pitchClass);
      if (!scaleNote) continue;
      out.push({
        ...position,
        name: formatPitchClass(position.pitchClass, spelling),
        degree: scaleNote.degree,
        interval: scaleNote.interval,
        isRoot: scaleNote.interval === 0,
        scaleIndex: scaleNote.index,
      });
    }
  }
  return out;
}

export interface ChordFretPosition extends FretPosition {
  readonly degree: string;
  readonly interval: number;
  readonly isRoot: boolean;
}

/** Every chord tone on the neck — the "where can I grab this chord" view. */
export function getChordPositions(board: Fretboard, chord: Chord): ChordFretPosition[] {
  const spelling = chord.definition.spelling;
  const byPitchClass = new Map(chord.tones.map((t) => [t.pitchClass, t]));
  const out: ChordFretPosition[] = [];

  for (let s = 0; s < board.stringCount; s++) {
    for (let f = 0; f <= board.fretCount; f++) {
      const position = noteAt(board, s, f, spelling);
      if (!position) continue;
      const tone = byPitchClass.get(position.pitchClass);
      if (!tone) continue;
      out.push({
        ...position,
        name: formatPitchClass(position.pitchClass, spelling),
        degree: tone.degree,
        interval: tone.interval,
        isRoot: tone.interval === 0,
      });
    }
  }
  return out;
}

export interface ScaleShape {
  /** 1-based box number, e.g. pentatonic "box 2". */
  readonly index: number;
  /** The scale degree this shape is anchored on, e.g. "b3". */
  readonly anchorDegree: string;
  readonly minFret: number;
  readonly maxFret: number;
  /** Ordered low-to-high in pitch — this doubles as the practice path. */
  readonly positions: readonly ScaleFretPosition[];
}

/**
 * Generate the positional "boxes" for a scale.
 *
 * The shapes are not hard-coded tables: each box is an ascending run through the
 * scale taking `notesPerString` tones per string, anchored on successive scale
 * degrees of the lowest string. For a pentatonic with 2 notes per string this
 * reproduces the five familiar boxes; for a 7-note scale with 3 notes per string
 * it reproduces the standard three-note-per-string shapes — and it works for any
 * tuning, including 5-string bass, without new data.
 */
export function getScaleShapes(
  board: Fretboard,
  scale: Scale,
  options: { notesPerString?: number; startFret?: number } = {},
): ScaleShape[] {
  const scaleSize = scale.notes.length;
  const notesPerString = options.notesPerString ?? (scaleSize <= 5 ? 2 : 3);
  const startFret = options.startFret ?? 0;
  const spelling = scale.definition.spelling;
  const lowestOpen = board.openMidi[0];
  if (lowestOpen === undefined) return [];

  const degreeByPitchClass = new Map(scale.notes.map((n) => [n.pitchClass, n]));

  /** Lowest MIDI >= floor whose pitch class is in the scale, walking up chromatically. */
  const nextScaleMidi = (floor: number): number => {
    for (let midi = Math.ceil(floor); midi < floor + 24; midi++) {
      if (degreeByPitchClass.has(mod(midi, 12))) return midi;
    }
    return Math.ceil(floor);
  };

  const shapes: ScaleShape[] = [];

  for (let anchor = 0; anchor < scaleSize; anchor++) {
    const anchorNote = scale.notes[anchor]!;
    // First occurrence of the anchor degree on the lowest string at or above startFret.
    let fret = mod(anchorNote.pitchClass - mod(lowestOpen, 12), 12);
    while (fret < startFret) fret += 12;
    if (fret > board.fretCount) continue;

    let pointer = lowestOpen + fret;
    const positions: ScaleFretPosition[] = [];
    let ok = true;

    for (let s = 0; s < board.stringCount && ok; s++) {
      const open = board.openMidi[s]!;
      for (let n = 0; n < notesPerString; n++) {
        const midi = nextScaleMidi(pointer);
        const stringFret = midi - open;
        if (stringFret < 0 || stringFret > board.fretCount) {
          ok = false;
          break;
        }
        const note = midiToNote(midi, spelling);
        const scaleNote = degreeByPitchClass.get(note.pitchClass)!;
        positions.push({
          string: s,
          fret: stringFret,
          midi,
          pitchClass: note.pitchClass,
          name: formatPitchClass(note.pitchClass, spelling),
          octave: note.octave,
          frequency: midiToFrequency(midi),
          degree: scaleNote.degree,
          interval: scaleNote.interval,
          isRoot: scaleNote.interval === 0,
          scaleIndex: scaleNote.index,
        });
        pointer = midi + 1;
      }
    }

    if (!ok || positions.length === 0) continue;

    const frets = positions.map((p) => p.fret);
    shapes.push({
      index: shapes.length + 1,
      anchorDegree: anchorNote.degree,
      minFret: Math.min(...frets),
      maxFret: Math.max(...frets),
      positions,
    });
  }

  return shapes;
}

/**
 * Pentatonic boxes — the same generator, pinned to two notes per string.
 * Kept as a named export because it is the shape players ask for by name.
 */
export function getPentatonicPositions(
  board: Fretboard,
  scale: Scale,
  startFret = 0,
): ScaleShape[] {
  return getScaleShapes(board, scale, { notesPerString: 2, startFret });
}

/**
 * Pick the position closest to a reference fret — used to answer
 * "where should I actually play this next note?" during practice.
 */
export function nearestPosition(
  positions: readonly FretPosition[],
  referenceFret: number,
  referenceString?: number,
): FretPosition | null {
  let best: FretPosition | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const position of positions) {
    const fretCost = Math.abs(position.fret - referenceFret);
    const stringCost = referenceString === undefined ? 0 : Math.abs(position.string - referenceString) * 0.5;
    const openBonus = position.fret === 0 ? -0.25 : 0;
    const cost = fretCost + stringCost + openBonus;
    if (cost < bestCost) {
      bestCost = cost;
      best = position;
    }
  }
  return best;
}
