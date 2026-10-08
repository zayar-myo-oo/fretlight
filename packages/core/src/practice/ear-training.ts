import { CHORDS, type ChordId } from "../theory/chords";
import { INTERVAL_FULL_NAMES } from "../theory/intervals";

/**
 * Ear-training questions: hear something, name it. Deterministic given the
 * random source, so tests (and "replay") get the same question back.
 */
export type EarModule = "interval" | "chord";
export type EarLevel = "beginner" | "intermediate" | "advanced";

export interface EarQuestion {
  readonly module: EarModule;
  /** Notes to play, as midi; `harmonic` plays them together. */
  readonly midi: readonly number[];
  readonly harmonic: boolean;
  /** The id of the right answer among `choices`. */
  readonly answer: string;
  readonly choices: readonly { readonly id: string; readonly label: string }[];
}

/** Semitone sizes on offer at each level: the easy-to-tell-apart ones first. */
export const INTERVAL_LEVELS: Record<EarLevel, readonly number[]> = {
  beginner: [3, 4, 7, 12],
  intermediate: [2, 3, 4, 5, 7, 9, 12],
  advanced: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
};

export const CHORD_LEVELS: Record<EarLevel, readonly ChordId[]> = {
  beginner: ["major", "minor"],
  intermediate: ["major", "minor", "dim", "aug", "sus4"],
  advanced: ["major", "minor", "dim", "aug", "sus2", "sus4", "dom7", "maj7", "min7"],
};

export const earIntervalName = (semitones: number): string => (semitones === 12 ? "Octave" : INTERVAL_FULL_NAMES[semitones] ?? `${semitones}`);

export function earQuestion(module: EarModule, level: EarLevel, random: () => number = Math.random): EarQuestion {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
  // A comfortable guitar range: the root sits between E2 and E4 so both notes stay playable.
  const root = 45 + Math.floor(random() * 12);

  if (module === "interval") {
    const options = INTERVAL_LEVELS[level];
    const size = pick(options);
    // Beginners hear the notes one after the other, rising; later levels may hear them together.
    const harmonic = level === "advanced" && random() < 0.4;
    return {
      module,
      midi: [root, root + size],
      harmonic,
      answer: String(size),
      choices: options.map((s) => ({ id: String(s), label: earIntervalName(s) })),
    };
  }

  const options = CHORD_LEVELS[level];
  const id = pick(options);
  return {
    module,
    midi: CHORDS[id].intervals.map((i) => root + i),
    harmonic: true,
    answer: id,
    choices: options.map((c) => ({ id: c, label: CHORDS[c].name })),
  };
}

export interface EarTally {
  readonly attempts: number;
  readonly correct: number;
}

/** Items answered at least `min` times, weakest first: what to drill next. */
export function weakestEarItems(tallies: Readonly<Record<string, EarTally>>, min = 4): { key: string; accuracy: number }[] {
  return Object.entries(tallies)
    .filter(([, t]) => t.attempts >= min)
    .map(([key, t]) => ({ key, accuracy: t.correct / t.attempts }))
    .filter((item) => item.accuracy < 0.8)
    .sort((a, b) => a.accuracy - b.accuracy);
}
