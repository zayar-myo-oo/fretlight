import { CHORD_CONFIG } from "./config";
import { TEMPLATES, chordSymbol, scoreChroma, similarityToConfidence } from "./chord-templates";
import type { ChordQuality } from "./types";

export interface ChordGuess {
  /** "Am7", or null when nothing is clear enough to name. */
  readonly chord: string | null;
  readonly root: number | null;
  readonly quality: ChordQuality | null;
  /** 0..1 */
  readonly confidence: number;
}

const UNKNOWN: ChordGuess = { chord: null, root: null, quality: null, confidence: 0 };

/**
 * Name the chord in one 12-bin chroma vector, or say there isn't one.
 *
 * Confidence combines how well the best template fits with how far ahead of
 * the runner-up it is, so an ambiguous frame (C vs Am7) scores lower than a
 * clear one even when both fit well.
 */
export function detectChordFromChroma(
  chroma: ArrayLike<number>,
  threshold: number = CHORD_CONFIG.confidenceThreshold,
): ChordGuess {
  const scores = new Float32Array(TEMPLATES.length);
  if (!scoreChroma(chroma, scores)) return UNKNOWN;

  let best = 0;
  for (let t = 1; t < scores.length; t++) if (scores[t]! > scores[best]!) best = t;
  const top = TEMPLATES[best]!;

  // Runner-up that is genuinely a different chord (not the same pitch set).
  let second = -Infinity;
  for (let t = 0; t < scores.length; t++) {
    if (TEMPLATES[t]!.mask === top.mask) continue;
    second = Math.max(second, scores[t]!);
  }

  const fit = similarityToConfidence(scores[best]!);
  const margin = Math.min(1, Math.max(0, (scores[best]! - second) / 0.15));
  const confidence = Math.round(fit * (0.75 + 0.25 * margin) * 100) / 100;
  if (confidence < threshold) return { ...UNKNOWN, confidence };

  return { chord: chordSymbol(top.root, top.quality), root: top.root, quality: top.quality, confidence };
}
