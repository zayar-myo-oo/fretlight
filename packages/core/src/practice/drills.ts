import type { Fretboard } from "../instrument/fretboard";
import { noteAt } from "../instrument/fretboard";
import { intervalLabel } from "../theory/intervals";
import { formatPitchClass, midiToNote, mod } from "../theory/pitch";
import type { PitchClass } from "../theory/types";
import type { PracticeSequence, PracticeStep } from "./sequence";

/**
 * The three drills that teach the fretboard itself, in the order they build on
 * each other:
 *
 *  - **note** — "play an A anywhere". Learns the sound and the name.
 *  - **fret** — "play the A on the D string, 7th fret". Learns *where* notes
 *    live, which is the thing that actually unlocks the instrument. Knowing that
 *    a note is called A does not help you find it at speed.
 *  - **interval** — "from A, play the 5th". Learns the shapes that scales,
 *    arpeggios and bass lines are all made of.
 */
export type DrillKind = "note" | "fret" | "interval";

export interface DrillOptions {
  readonly kind: DrillKind;
  readonly board: Fretboard;
  /** Number of targets to generate. */
  readonly length?: number;
  /** Seed for repeatable drills — the same seed gives the same exercise. */
  readonly seed?: number;
  /** Pitch classes to draw from. Defaults to all twelve. */
  readonly pool?: readonly PitchClass[];
  /** Restrict fret drills to part of the neck. */
  readonly fretRange?: readonly [number, number];
  /** Restrict fret drills to certain strings (0 = lowest). */
  readonly strings?: readonly number[];
  /** Root for interval drills. */
  readonly root?: PitchClass;
  /** Semitone intervals to quiz. Defaults to the diatonic set plus the octave. */
  readonly intervals?: readonly number[];
  /** Never ask for the same target twice in a row. */
  readonly avoidRepeats?: boolean;
  /**
   * Only target positions whose pitch exists nowhere else on the neck.
   *
   * This matters more than it sounds. Audio alone cannot tell which of several
   * equivalent positions was played — an A2 is the same waveform whether it came
   * from the low E at fret 5 or the open A. So without camera assistance, a fret
   * drill on an ambiguous position cannot actually be marked, and grading it
   * would be theatre.
   *
   * Restricting to unique positions — the low strings' first few frets, the top
   * string's high register — gives a drill that is genuinely verifiable by ear.
   * Turn it off when hand tracking is supplying the position.
   */
  readonly uniquePositionsOnly?: boolean;
}

export interface Drill {
  readonly kind: DrillKind;
  readonly sequence: PracticeSequence;
  /** True when the exact string and fret must match, not just the pitch. */
  readonly requirePosition: boolean;
  /** One-line instruction for the UI. */
  readonly instruction: string;
}

/** Deterministic PRNG so a seeded drill is reproducible across sessions. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALL_PITCH_CLASSES: PitchClass[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const DEFAULT_INTERVALS = [2, 3, 4, 5, 7, 9, 10, 12];

/**
 * Build a drill. Pure and deterministic given a seed, so the same exercise can
 * be replayed, shared, or asserted on in a test.
 */
export function generateDrill(options: DrillOptions): Drill {
  switch (options.kind) {
    case "note":
      return noteDrill(options);
    case "fret":
      return fretDrill(options);
    case "interval":
      return intervalDrill(options);
  }
}

/** "Play an A — anywhere on the neck." */
function noteDrill(options: DrillOptions): Drill {
  const random = mulberry32(options.seed ?? 1);
  const length = options.length ?? 8;
  const pool = options.pool ?? ALL_PITCH_CLASSES;
  const avoidRepeats = options.avoidRepeats ?? true;

  const steps: PracticeStep[] = [];
  let previous: PitchClass | null = null;

  for (let i = 0; i < length; i++) {
    const pitchClass: PitchClass = pick(pool, random, avoidRepeats ? previous : null);
    previous = pitchClass;
    // A representative octave so the step has a concrete midi value; the engine
    // matches on pitch class unless the drill demands otherwise.
    const midi = lowestOccurrence(options.board, pitchClass);
    steps.push({
      id: `note-${i}`,
      midi,
      pitchClass,
      label: formatPitchClass(pitchClass),
    });
  }

  return {
    kind: "note",
    requirePosition: false,
    instruction: "Play the target note anywhere on the neck",
    sequence: { id: `drill-note-${options.seed ?? 1}`, name: "Note practice", steps, bpm: 60, mode: "free" },
  };
}

/** "Play the A on the D string, 7th fret." */
function fretDrill(options: DrillOptions): Drill {
  const random = mulberry32(options.seed ?? 1);
  const length = options.length ?? 8;
  const board = options.board;
  const [fromFret, toFret] = options.fretRange ?? [0, Math.min(12, board.fretCount)];
  const strings =
    options.strings ?? Array.from({ length: board.stringCount }, (_, index) => index);
  const avoidRepeats = options.avoidRepeats ?? true;
  const uniqueOnly = options.uniquePositionsOnly ?? true;

  /** How many places on this neck produce the same pitch. */
  const occurrences = (midi: number): number => {
    let count = 0;
    for (let string = 0; string < board.stringCount; string++) {
      const fret = midi - board.openMidi[string]!;
      if (fret >= 0 && fret <= board.fretCount) count++;
    }
    return count;
  };

  // Build the pool up front so an impossible request fails loudly rather than
  // silently producing a short drill.
  const build = (requireUnique: boolean) => {
    const out: { string: number; fret: number; midi: number; name: string }[] = [];
    for (const string of strings) {
      for (let fret = fromFret; fret <= Math.min(toFret, board.fretCount); fret++) {
        const note = noteAt(board, string, fret);
        if (!note) continue;
        if (requireUnique && occurrences(note.midi) > 1) continue;
        out.push({ string, fret, midi: note.midi, name: note.name });
      }
    }
    return out;
  };

  let pool = build(uniqueOnly);
  // A narrow range can contain no uniquely-identifiable position at all. An
  // empty drill is worse than an unverifiable one, so widen rather than return
  // nothing — and say so in the instruction.
  const relaxed = uniqueOnly && pool.length === 0;
  if (relaxed) pool = build(false);

  const steps: PracticeStep[] = [];
  let previousKey: string | null = null;

  for (let i = 0; i < length && pool.length > 0; i++) {
    let chosen = pool[0]!;
    // Reject a repeat by resampling; with a reasonable pool the chance of
    // exhausting these attempts is negligible.
    for (let attempt = 0; attempt < 24; attempt++) {
      const candidate = pool[Math.floor(random() * pool.length)]!;
      const key = `${candidate.string}:${candidate.fret}`;
      if (avoidRepeats && key === previousKey && pool.length > 1) continue;
      chosen = candidate;
      previousKey = key;
      break;
    }

    steps.push({
      id: `fret-${i}`,
      midi: chosen.midi,
      pitchClass: mod(chosen.midi, 12),
      label: chosen.name,
      position: { string: chosen.string, fret: chosen.fret },
    });
  }

  return {
    kind: "fret",
    requirePosition: true,
    instruction:
      uniqueOnly && !relaxed
        ? "Play the target note at the exact string and fret shown"
        : "Play the target at the exact string and fret — these pitches also exist elsewhere, so position cannot be confirmed by audio alone",
    sequence: { id: `drill-fret-${options.seed ?? 1}`, name: "Fret practice", steps, bpm: 60, mode: "free" },
  };
}

/** "From A, play the 5th." */
function intervalDrill(options: DrillOptions): Drill {
  const random = mulberry32(options.seed ?? 1);
  const length = options.length ?? 8;
  const root = options.root ?? 9; // A
  const intervals = options.intervals ?? DEFAULT_INTERVALS;
  const avoidRepeats = options.avoidRepeats ?? true;

  const steps: PracticeStep[] = [];
  let previous: number | null = null;

  for (let i = 0; i < length; i++) {
    const interval: number = pick(intervals, random, avoidRepeats ? previous : null);
    previous = interval;
    const pitchClass = mod(root + interval, 12);
    const midi = lowestOccurrence(options.board, pitchClass);
    steps.push({
      id: `interval-${i}`,
      midi,
      pitchClass,
      label: formatPitchClass(pitchClass),
      degree: intervalLabel(interval),
    });
  }

  return {
    kind: "interval",
    requirePosition: false,
    instruction: `Play the requested interval from ${formatPitchClass(root)}`,
    sequence: {
      id: `drill-interval-${options.seed ?? 1}`,
      name: `Interval practice in ${formatPitchClass(root)}`,
      steps,
      bpm: 60,
      mode: "free",
    },
  };
}

function pick<T>(pool: readonly T[], random: () => number, avoid: T | null): T {
  if (pool.length === 0) throw new Error("Drill pool is empty");
  if (pool.length === 1) return pool[0]!;
  for (let attempt = 0; attempt < 16; attempt++) {
    const value = pool[Math.floor(random() * pool.length)]!;
    if (value !== avoid) return value;
  }
  return pool[0]!;
}

/** Lowest MIDI on the board with this pitch class, for a concrete step value. */
function lowestOccurrence(board: Fretboard, pitchClass: PitchClass): number {
  const open = board.openMidi[0] ?? 40;
  const offset = mod(pitchClass - mod(open, 12), 12);
  return open + offset;
}

/** Human-readable target line, e.g. "A · D string, fret 7". */
export function describeTarget(step: PracticeStep, board: Fretboard): string {
  if (!step.position) return step.label;
  const open = noteAt(board, step.position.string, 0);
  const stringName = open ? `${open.name}${open.octave}` : `string ${step.position.string + 1}`;
  return `${step.label} · ${stringName} string, fret ${step.position.fret}`;
}

/** Note name with octave for a step, e.g. "A2". */
export function describeNote(step: PracticeStep): string {
  const note = midiToNote(step.midi);
  return `${note.name}${note.octave}`;
}
