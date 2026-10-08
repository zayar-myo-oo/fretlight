import {
  type Confidence,
  type MusicKey,
  allKeys,
  getDiatonicChords,
  getDiatonicSevenths,
} from "../theory/key-detection";
import { mod } from "../theory/pitch";
import { KEY_CONFIG } from "./config";
import { QUALITIES, chordPitchClasses } from "./chord-templates";
import type { ChordDetection } from "./types";

export interface SongKey {
  readonly key: MusicKey | null;
  /** 0..1 */
  readonly confidence: number;
  readonly level: Confidence | null;
  /** The relative major/minor, which shares every note and is the usual runner-up. */
  readonly relative: MusicKey | null;
}

const NO_KEY: SongKey = { key: null, confidence: 0, level: null, relative: null };

const QUALITY_BY_CHORD_ID = new Map(QUALITIES.map((q) => [q.chordId, q.quality]));

/** Pitch-class sets of every chord that belongs to `key`, keyed "root:quality". */
function diatonicSet(key: MusicKey): Set<string> {
  const out = new Set<string>();
  for (const chord of [...getDiatonicChords(key), ...getDiatonicSevenths(key)]) {
    const quality = QUALITY_BY_CHORD_ID.get(chord.chordId);
    if (quality) out.add(`${chord.root}:${quality}`);
  }
  return out;
}

function level(confidence: number): Confidence {
  return confidence >= KEY_CONFIG.highAbove ? "High" : confidence >= KEY_CONFIG.mediumAbove ? "Medium" : "Low";
}

interface Scored {
  readonly key: MusicKey;
  readonly score: number;
}

function settle(scored: Scored[]): SongKey {
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]!;
  const relativeRoot = best.key.mode === "major" ? mod(best.key.root - 3, 12) : mod(best.key.root + 3, 12);
  const relative = scored.find((s) => s.key.root === relativeRoot && s.key.mode !== best.key.mode) ?? null;
  // The relative key shares every note, so it should not count as a "rival" for margin;
  // being close to it only caps how sure we can be which of the two is the home key.
  const rival = scored.find((s) => s !== relative && s !== best)!;
  const margin = best.score - rival.score;
  const ambiguity = relative && best.score - relative.score < 0.1 ? 0.85 : 1;
  const confidence = Math.round(Math.min(1, Math.max(0, Math.min(1, best.score) * 0.6 + margin * 2.5)) * ambiguity * 100) / 100;

  if (confidence < KEY_CONFIG.uncertainBelow) return { ...NO_KEY, confidence };
  return { key: best.key, confidence, level: level(confidence), relative: relative?.key ?? null };
}

/**
 * Estimate the key from the detected chords, reusing the Music Theory key tables.
 *
 * A key scores for each chord that is diatonic to it (and partly for chords that
 * merely share its notes), weighted by how long and how surely the chord was
 * heard, with extra credit for the tonic chord, for opening and closing on it,
 * and for a dominant that resolves to it. One repeated chord is never enough.
 */
export function analyzeKey(chords: readonly ChordDetection[]): SongKey {
  const named = chords.filter((c) => c.root !== null && c.quality !== null);
  const distinct = new Set(named.map((c) => `${c.root}:${c.quality}`));
  if (distinct.size < KEY_CONFIG.minDistinctChords) return NO_KEY;

  const weights = named.map((c) => (c.end - c.start) * Math.max(0.2, c.confidence));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return NO_KEY;

  const first = named[0]!;
  const last = named[named.length - 1]!;

  const scored: Scored[] = allKeys().map((key) => {
    const diatonic = diatonicSet(key);
    let fit = 0;
    let tonic = 0;
    let dominant = 0;
    named.forEach((chord, i) => {
      const w = weights[i]! / total;
      const pcs = chordPitchClasses(chord.root!, chord.quality!);
      const inKey = pcs.filter((pc) => key.pitchClasses.includes(pc)).length / pcs.length;
      const isDiatonic = diatonic.has(`${chord.root}:${chord.quality}`) ? 1 : 0;
      fit += w * (0.55 * inKey + 0.45 * isDiatonic);
      if (chord.root === key.root) tonic += w;
      if (chord.root === mod(key.root + 7, 12)) dominant += w;
    });
    const opensOnTonic = first.root === key.root ? 1 : 0;
    const closesOnTonic = last.root === key.root ? 1 : 0;
    return { key, score: fit + 0.3 * tonic + 0.08 * opensOnTonic + 0.1 * closesOnTonic + 0.05 * dominant };
  });

  return settle(scored);
}

/**
 * Key from root notes alone, for bass analysis where only the lowest note is
 * trusted: favours keys that contain the roots, weighted by duration, with the
 * most common root as tonic.
 */
export function analyzeKeyFromRoots(rootWeights: readonly number[]): SongKey {
  const total = rootWeights.reduce((a, b) => a + b, 0);
  const present = rootWeights.filter((w) => w > total * 0.03).length;
  if (total <= 0 || present < KEY_CONFIG.minDistinctChords) return NO_KEY;

  const top = rootWeights.indexOf(Math.max(...rootWeights));
  const scored: Scored[] = allKeys().map((key) => {
    let fit = 0;
    rootWeights.forEach((w, pc) => {
      if (key.pitchClasses.includes(pc)) fit += w / total;
    });
    const tonic = rootWeights[key.root]! / total;
    const dominant = rootWeights[mod(key.root + 7, 12)]! / total;
    // A slight lean toward major, the more common mode, settles roots-only ties.
    return { key, score: fit * 0.8 + tonic * 0.4 + dominant * 0.1 + (key.root === top ? 0.05 : 0) + (key.mode === "major" ? 0.03 : 0) };
  });
  const result = settle(scored);
  // Roots alone are weaker evidence than whole chords.
  return result.key
    ? { ...result, confidence: Math.round(result.confidence * 0.85 * 100) / 100, level: level(result.confidence * 0.85) }
    : result;
}
