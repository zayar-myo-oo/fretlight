import { CHORDS, type ChordId } from "./chords";
import { SCALES } from "./scales";
import { mod, parseNoteName } from "./pitch";
import type { PitchClass } from "./types";

/**
 * Key analysis for the Music Theory tab. Pure functions only.
 *
 * This is a heuristic ranking of the 24 major / natural-minor keys, not
 * musicological key finding: it scores how many of the given notes a key
 * contains and whether they outline that key's tonic triad.
 */

export type KeyMode = "major" | "minor";

export interface MusicKey {
  readonly root: PitchClass;
  readonly rootName: string;
  readonly mode: KeyMode;
  /** "C Major", "A Minor" */
  readonly name: string;
  /** Scale notes, correctly spelled (D major has F# and C#, never Gb). */
  readonly notes: readonly string[];
  readonly pitchClasses: readonly PitchClass[];
}

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"] as const;
const NATURAL_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Conventional spelling per root, so keys read as players expect (Db, not C#, major). */
export const MAJOR_KEY_ROOTS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] as const;
export const MINOR_KEY_ROOTS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"] as const;

/** Spell a scale with one letter per degree, so accidentals stay consistent. */
function spellScale(rootName: string, intervals: readonly number[]): string[] {
  const rootPc = parseNoteName(rootName)!.pitchClass;
  const start = LETTERS.indexOf(rootName[0] as (typeof LETTERS)[number]);
  return intervals.map((interval, i) => {
    const letter = LETTERS[(start + i) % 7]!;
    const diff = mod(mod(rootPc + interval, 12) - NATURAL_PC[letter]! + 6, 12) - 6;
    return letter + (diff > 0 ? "#".repeat(diff) : "b".repeat(-diff));
  });
}

function makeKey(rootName: string, mode: KeyMode): MusicKey {
  const intervals = SCALES[mode === "major" ? "major" : "natural_minor"].intervals;
  const notes = spellScale(rootName, intervals);
  const root = parseNoteName(rootName)!.pitchClass;
  return {
    root,
    rootName,
    mode,
    name: `${rootName} ${mode === "major" ? "Major" : "Minor"}`,
    notes,
    pitchClasses: intervals.map((i) => mod(root + i, 12)),
  };
}

export function getMajorScale(root: PitchClass | string): MusicKey {
  return getKey(root, "major");
}

export function getMinorScale(root: PitchClass | string): MusicKey {
  return getKey(root, "minor");
}

/** getKey(2, "major") -> D Major; strings like "Bb" are respected as written. */
export function getKey(root: PitchClass | string, mode: KeyMode): MusicKey {
  if (typeof root === "string") return makeKey(root, mode);
  const roots = mode === "major" ? MAJOR_KEY_ROOTS : MINOR_KEY_ROOTS;
  return makeKey(roots[mod(root, 12)]!, mode);
}

export function allKeys(): MusicKey[] {
  return [
    ...MAJOR_KEY_ROOTS.map((r) => makeKey(r, "major")),
    ...MINOR_KEY_ROOTS.map((r) => makeKey(r, "minor")),
  ];
}

// ---------------------------------------------------------------------------
// Diatonic chords

export interface DiatonicChord {
  /** 0-based scale degree. */
  readonly degree: number;
  readonly chordId: ChordId;
  readonly rootName: string;
  readonly root: PitchClass;
  /** "Dm", "G7", "Bm7b5", "Bdim" */
  readonly symbol: string;
  /** "Imaj7", "ii", "vii°", "viiø7" */
  readonly roman: string;
  /** Spelled chord notes. */
  readonly notes: readonly string[];
  readonly pitchClasses: readonly PitchClass[];
  /** "1 b3 5 b7" */
  readonly formula: string;
  /** "D Minor", "B Diminished" */
  readonly longName: string;
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"] as const;
const ROMAN_SUFFIX: Partial<Record<ChordId, string>> = {
  dim: "°",
  maj7: "maj7",
  min7: "7",
  dom7: "7",
  min7b5: "ø7",
};
const LOWERCASE_QUALITY = new Set<ChordId>(["minor", "dim", "min7", "min7b5"]);

/** The chord template whose interval set equals `intervals` (relative to its root). */
function chordIdFromIntervals(intervals: readonly number[]): ChordId | null {
  for (const id of Object.keys(CHORDS) as ChordId[]) {
    const have = CHORDS[id].intervals;
    if (have.length === intervals.length && have.every((v, i) => v === intervals[i])) return id;
  }
  return null;
}

function buildDiatonic(key: MusicKey, degree: number, size: 3 | 4): DiatonicChord {
  const steps = size === 3 ? [0, 2, 4] : [0, 2, 4, 6];
  const notes = steps.map((s) => key.notes[(degree + s) % 7]!);
  const pcs = steps.map((s) => key.pitchClasses[(degree + s) % 7]!);
  const root = pcs[0]!;
  const intervals = pcs.map((pc) => mod(pc - root, 12));
  const chordId = chordIdFromIntervals(intervals)!;
  const def = CHORDS[chordId];
  const numeral = LOWERCASE_QUALITY.has(chordId) ? ROMAN[degree]!.toLowerCase() : ROMAN[degree]!;
  return {
    degree,
    chordId,
    root,
    rootName: notes[0]!,
    symbol: `${notes[0]}${def.symbol}`,
    roman: `${numeral}${ROMAN_SUFFIX[chordId] ?? ""}`,
    notes,
    pitchClasses: pcs,
    formula: def.degrees.join(" "),
    longName: `${notes[0]} ${def.name}`,
  };
}

/** The seven triads of a key: I ii iii IV V vi vii° (major) / i ii° III iv v VI VII (minor). */
export function getDiatonicChords(key: MusicKey): DiatonicChord[] {
  return Array.from({ length: 7 }, (_, d) => buildDiatonic(key, d, 3));
}

/** The seven seventh chords of a key: Imaj7 ii7 iii7 IVmaj7 V7 vi7 viiø7 (major). */
export function getDiatonicSevenths(key: MusicKey): DiatonicChord[] {
  return Array.from({ length: 7 }, (_, d) => buildDiatonic(key, d, 4));
}

/** Find the diatonic chord (triad or seventh) in `key` with exactly these pitch classes. */
export function findDiatonicChord(key: MusicKey, pitchClasses: readonly PitchClass[]): DiatonicChord | null {
  const want = [...new Set(pitchClasses.map((p) => mod(p, 12)))].sort((a, b) => a - b).join(",");
  const all = [...getDiatonicChords(key), ...getDiatonicSevenths(key)];
  return all.find((c) => [...c.pitchClasses].sort((a, b) => a - b).join(",") === want) ?? null;
}

// ---------------------------------------------------------------------------
// Key detection

export type Confidence = "High" | "Medium" | "Low";

export interface KeyCandidate {
  readonly key: MusicKey;
  /** 0..1 */
  readonly confidence: number;
  /** How many of the selected pitch classes the key contains. */
  readonly matched: number;
  /** Selected pitch classes that fall outside the key. */
  readonly outside: readonly PitchClass[];
}

export interface KeyDetection {
  readonly selected: readonly PitchClass[];
  /**
   * False with fewer than two distinct notes: one note belongs to many keys, so
   * `candidates` then lists every key containing it, unranked.
   */
  readonly determined: boolean;
  readonly candidates: readonly KeyCandidate[];
  readonly best: KeyCandidate | null;
  readonly level: Confidence | null;
  readonly message: string | null;
}

export function confidenceLevel(confidence: number): Confidence {
  return confidence >= 0.8 ? "High" : confidence >= 0.55 ? "Medium" : "Low";
}

function triadPcs(key: MusicKey, degree: number): PitchClass[] {
  return [0, 2, 4].map((s) => key.pitchClasses[(degree + s) % 7]!);
}

/**
 * Rank keys for a set of notes. Score = coverage (notes inside the key), plus
 * credit for the tonic being present and for the notes spelling out the tonic,
 * dominant or subdominant triad. Confidence is capped by how few notes there
 * are: three notes can suggest a key, never prove it.
 */
export function detectKey(selectedNotes: readonly PitchClass[]): KeyDetection {
  const selected = [...new Set(selectedNotes.map((p) => mod(p, 12)))].sort((a, b) => a - b);
  const keys = allKeys();

  if (selected.length === 0) {
    return { selected, determined: false, candidates: [], best: null, level: null, message: "Select notes on the fretboard." };
  }

  if (selected.length === 1) {
    const candidates = keys
      .filter((k) => k.pitchClasses.includes(selected[0]!))
      .map((key) => ({ key, confidence: 0, matched: 1, outside: [] }));
    return {
      selected,
      determined: false,
      candidates,
      best: null,
      level: null,
      message: "One note fits many keys. Select more notes to determine the key.",
    };
  }

  const n = selected.length;
  const contained = (needles: readonly PitchClass[]) =>
    needles.filter((p) => selected.includes(p)).length / needles.length;

  const scored = keys.map((key) => {
    const matched = selected.filter((p) => key.pitchClasses.includes(p)).length;
    const outside = selected.filter((p) => !key.pitchClasses.includes(p));
    const coverage = matched / n;
    const tonic = selected.includes(key.root) ? 1 : 0;
    const tonicTriad = contained(triadPcs(key, 0));
    const others = Math.max(contained(triadPcs(key, 3)), contained(triadPcs(key, 4)));
    const raw = 0.5 * coverage + 0.15 * tonic + 0.25 * tonicTriad + 0.1 * others;
    // Notes outside the key hurt twice: lower coverage and a cap on the score.
    const score = outside.length ? raw * 0.8 : raw;
    return { key, score, matched, outside };
  });

  scored.sort((a, b) => b.score - a.score);
  const margin = scored[0]!.score - scored[1]!.score;
  // Few notes can't be decisive; a near-tie (relative major/minor) isn't either.
  const evidence = n >= 4 ? 1 : n === 3 ? 0.97 : 0.55;
  const tieFactor = margin < 0.05 ? 0.85 : 1;

  const candidates = scored
    .filter((s) => s.matched / n >= 0.6)
    .slice(0, 5)
    .map((s, i) => ({
      key: s.key,
      matched: s.matched,
      outside: s.outside,
      confidence: Math.round(Math.min(1, s.score * evidence * (i === 0 ? tieFactor : 1)) * 100) / 100,
    }));

  const best = candidates[0] ?? null;
  return {
    selected,
    determined: best !== null,
    candidates,
    best,
    level: best ? confidenceLevel(best.confidence) : null,
    message: best ? null : "These notes don't fit one major or minor key cleanly.",
  };
}

// ---------------------------------------------------------------------------
// Chord detection (also the basis for future live detection)

const DETECTABLE: readonly ChordId[] = [
  "major", "minor", "dom7", "maj7", "min7", "dim", "aug", "min7b5", "dim7",
  "sus2", "sus4", "six", "min6", "power",
];

export interface ChordMatch {
  readonly root: PitchClass;
  readonly chordId: ChordId;
  /** Sharp spelling; callers re-spell against a key if needed. */
  readonly rootName: string;
  readonly symbol: string;
  /** 0..1 */
  readonly confidence: number;
}

const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/**
 * Match a 12-bin pitch-class weight vector (a chroma frame, or 0/1 flags for
 * selected notes) against chord templates, best match first. Needs no audio:
 * a future microphone module only has to produce the vector.
 */
export function matchChord(chroma: readonly number[], limit = 3): ChordMatch[] {
  const peak = Math.max(0, ...chroma);
  const total = chroma.reduce((a, b) => a + Math.max(0, b), 0);
  if (peak <= 0 || total <= 0) return [];
  const results: ChordMatch[] = [];
  for (let root = 0; root < 12; root++) {
    for (const chordId of DETECTABLE) {
      const tones = CHORDS[chordId].intervals.map((i) => mod(root + i, 12));
      // Share of the energy the chord explains, times how many of its tones are present.
      const inside = tones.reduce((s, pc) => s + Math.max(0, chroma[pc] ?? 0), 0) / total;
      const present = tones.filter((pc) => (chroma[pc] ?? 0) > 0.15 * peak).length / tones.length;
      // Root being the strongest tone breaks 6th / minor-7th ties (C6 vs Am7).
      const rootBonus = (chroma[root] ?? 0) >= peak ? 1.05 : 1;
      results.push({
        root,
        chordId,
        rootName: SHARP[root]!,
        symbol: `${SHARP[root]}${CHORDS[chordId].symbol}`,
        confidence: Math.round(Math.min(1, inside * present * rootBonus) * 100) / 100,
      });
    }
  }
  return results.sort((a, b) => b.confidence - a.confidence).slice(0, limit);
}

/** Detect a chord from a set of selected pitch classes. */
export function detectChord(pitchClasses: readonly PitchClass[], limit = 3): ChordMatch[] {
  const chroma = new Array<number>(12).fill(0);
  for (const pc of pitchClasses) chroma[mod(pc, 12)] = 1;
  return matchChord(chroma, limit);
}

/**
 * Debounces chord readings so a display doesn't flicker: a chord is only
 * reported after it wins `frames` consecutive frames above `threshold`, and the
 * last stable answer is held until a different one earns the same.
 */
export class ChordStabilizer {
  private candidate: string | null = null;
  private count = 0;
  private stable: ChordMatch | null = null;

  constructor(
    private readonly frames = 5,
    private readonly threshold = 0.7,
  ) {}

  push(match: ChordMatch | null): ChordMatch | null {
    const id = match && match.confidence >= this.threshold ? match.symbol : null;
    if (id === this.candidate) this.count++;
    else {
      this.candidate = id;
      this.count = 1;
    }
    if (this.count >= this.frames) this.stable = id ? match : null;
    return this.stable;
  }
}
