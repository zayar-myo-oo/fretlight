import { CHORDS, type ChordId } from "../theory/chords";
import { mod } from "../theory/pitch";
import { CHORD_CONFIG } from "./config";
import type { ChordQuality } from "./types";

/**
 * Chord templates built from the theory package's own interval tables
 * (`CHORDS`), so the analyser and the Music Theory tab can never disagree about
 * what a chord is made of.
 */

export interface QualityInfo {
  readonly quality: ChordQuality;
  readonly suffix: string;
  readonly chordId: ChordId;
  readonly name: string;
}

export const QUALITIES: readonly QualityInfo[] = [
  { quality: "maj", suffix: "", chordId: "major", name: "Major" },
  { quality: "min", suffix: "m", chordId: "minor", name: "Minor" },
  { quality: "dim", suffix: "dim", chordId: "dim", name: "Diminished" },
  { quality: "aug", suffix: "aug", chordId: "aug", name: "Augmented" },
  { quality: "maj7", suffix: "maj7", chordId: "maj7", name: "Major 7th" },
  { quality: "m7", suffix: "m7", chordId: "min7", name: "Minor 7th" },
  { quality: "7", suffix: "7", chordId: "dom7", name: "Dominant 7th" },
  { quality: "sus2", suffix: "sus2", chordId: "sus2", name: "Suspended 2nd" },
  { quality: "sus4", suffix: "sus4", chordId: "sus4", name: "Suspended 4th" },
  { quality: "add9", suffix: "add9", chordId: "add9", name: "Add 9" },
];

const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function qualityInfo(quality: ChordQuality): QualityInfo {
  return QUALITIES.find((q) => q.quality === quality)!;
}

/** Pitch classes of a chord (add9's 14 is folded into the octave). */
export function chordPitchClasses(root: number, quality: ChordQuality): number[] {
  return CHORDS[qualityInfo(quality).chordId].intervals.map((i) => mod(root + i, 12));
}

export function chordSymbol(root: number, quality: ChordQuality, spelledRoot?: string): string {
  return `${spelledRoot ?? SHARP[mod(root, 12)]}${qualityInfo(quality).suffix}`;
}

export interface ChordTemplate {
  readonly root: number;
  readonly quality: ChordQuality;
  /** Unit-length 12-bin vector. */
  readonly vector: Float32Array;
  readonly penalty: number;
  /** Bitmask of the pitch classes, to spot chords that are the same notes (Csus2 = Gsus4). */
  readonly mask: number;
}

/** Index of a template: quality-major, then root. */
export const templateIndex = (qualityIndex: number, root: number) => qualityIndex * 12 + root;

function buildTemplates(): ChordTemplate[] {
  const templates: ChordTemplate[] = [];
  QUALITIES.forEach(({ quality }) => {
    for (let root = 0; root < 12; root++) {
      const vector = new Float32Array(12);
      chordPitchClasses(root, quality).forEach((pc, i) => {
        vector[pc] = i === 0 ? CHORD_CONFIG.rootWeight : CHORD_CONFIG.toneWeight;
      });
      let norm = 0;
      for (const v of vector) norm += v * v;
      norm = Math.sqrt(norm);
      for (let i = 0; i < 12; i++) vector[i]! /= norm;
      const mask = chordPitchClasses(root, quality).reduce((m, pc) => m | (1 << pc), 0);
      templates.push({ root, quality, vector, penalty: CHORD_CONFIG.complexityPenalty[quality], mask });
    }
  });
  return templates;
}

export const TEMPLATES: readonly ChordTemplate[] = buildTemplates();

/**
 * Cosine similarity between a chroma frame and every template, minus the
 * complexity penalty. Writes into `out` (length `TEMPLATES.length`) and returns
 * false when the frame carries no energy.
 */
export function scoreChroma(chroma: ArrayLike<number>, out: Float32Array): boolean {
  let norm = 0;
  for (let i = 0; i < 12; i++) norm += (chroma[i] ?? 0) ** 2;
  if (norm < 1e-12) {
    out.fill(0);
    return false;
  }
  norm = Math.sqrt(norm);
  for (let t = 0; t < TEMPLATES.length; t++) {
    const template = TEMPLATES[t]!;
    let dot = 0;
    for (let i = 0; i < 12; i++) dot += (chroma[i] ?? 0) * template.vector[i]!;
    out[t] = dot / norm - template.penalty;
  }
  return true;
}

/** Map a similarity score onto a 0..1 confidence. */
export function similarityToConfidence(similarity: number): number {
  return Math.min(1, Math.max(0, (similarity - 0.55) / 0.4));
}
