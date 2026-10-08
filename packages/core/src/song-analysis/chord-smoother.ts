import { getDiatonicChords, getDiatonicSevenths, type MusicKey } from "../theory/key-detection";
import { CHORD_CONFIG } from "./config";
import { QUALITIES, TEMPLATES, chordSymbol, scoreChroma, similarityToConfidence } from "./chord-templates";
import type { ChordDetection, ChordQuality } from "./types";

export interface SmoothOptions {
  readonly key?: MusicKey | null;
  readonly minChordDuration?: number;
  readonly chordChangeThreshold?: number;
  readonly confidenceThreshold?: number;
}

const QUALITY_BY_CHORD_ID = new Map<string, ChordQuality>(QUALITIES.map((q) => [q.chordId, q.quality]));

/** Template indexes that belong to `key` (its diatonic triads and sevenths). */
function diatonicTemplates(key: MusicKey): Set<number> {
  const wanted = new Set<string>();
  for (const chord of [...getDiatonicChords(key), ...getDiatonicSevenths(key)]) {
    const quality = QUALITY_BY_CHORD_ID.get(chord.chordId);
    if (quality) wanted.add(`${chord.root}:${quality}`);
  }
  const indexes = new Set<number>();
  TEMPLATES.forEach((t, i) => {
    if (wanted.has(`${t.root}:${t.quality}`)) indexes.add(i);
  });
  return indexes;
}

/**
 * Turn per-frame chroma into a short list of stable chord segments.
 *
 * A Viterbi search finds the single best chord path through the whole song:
 * each frame prefers the template it resembles, but changing chord costs a fixed
 * penalty, so a one-frame wobble (C, Cmaj7, C) is cheaper to ignore than to
 * follow. "No chord" is a state too, so unclear stretches stay unnamed rather
 * than being forced into the least-bad guess. Passing the song's key adds a small
 * bonus to its own chords, which settles near-ties toward the likely harmony.
 */
export function smoothChords(
  chroma: readonly Float32Array[],
  times: Float32Array,
  hopSeconds: number,
  duration: number,
  options: SmoothOptions = {},
): ChordDetection[] {
  const minDuration = options.minChordDuration ?? CHORD_CONFIG.minChordDuration;
  const switchCost = options.chordChangeThreshold ?? CHORD_CONFIG.chordChangeThreshold;
  const states = TEMPLATES.length + 1; // last state = no chord
  const none = TEMPLATES.length;
  const frames = chroma.length;
  if (frames === 0) return [{ chord: null, root: null, quality: null, start: 0, end: duration, confidence: 0 }];

  const bonus = options.key ? diatonicTemplates(options.key) : null;
  const scores = new Float32Array(TEMPLATES.length);
  const similarity = new Float32Array(frames * TEMPLATES.length);

  const emission = new Float32Array(states);
  const path = new Uint8Array(frames * states);
  let previous = new Float32Array(states);
  let current = new Float32Array(states);

  for (let f = 0; f < frames; f++) {
    const loud = scoreChroma(chroma[f]!, scores);
    similarity.set(scores, f * TEMPLATES.length);
    for (let t = 0; t < TEMPLATES.length; t++) {
      const adjusted = scores[t]! + (bonus?.has(t) ? CHORD_CONFIG.keyBonus : 0);
      emission[t] = loud ? (adjusted - CHORD_CONFIG.unknownBaseline) * CHORD_CONFIG.emissionGain : -1e3;
    }
    emission[none] = 0;

    if (f === 0) {
      for (let s = 0; s < states; s++) current[s] = emission[s]!;
    } else {
      let bestPrev = 0;
      for (let s = 1; s < states; s++) if (previous[s]! > previous[bestPrev]!) bestPrev = s;
      const jump = previous[bestPrev]! - switchCost * CHORD_CONFIG.emissionGain * 0.2;
      for (let s = 0; s < states; s++) {
        const stay = previous[s]!;
        if (stay >= jump) {
          current[s] = stay + emission[s]!;
          path[f * states + s] = s;
        } else {
          current[s] = jump + emission[s]!;
          path[f * states + s] = bestPrev;
        }
      }
    }
    [previous, current] = [current, previous];
  }

  // Backtrack from the best final state.
  const sequence = new Uint8Array(frames);
  let state = 0;
  for (let s = 1; s < states; s++) if (previous[s]! > previous[state]!) state = s;
  for (let f = frames - 1; f >= 0; f--) {
    sequence[f] = state;
    state = path[f * states + state]!;
  }

  // Group frames into segments.
  const half = hopSeconds / 2;
  let segments: ChordDetection[] = [];
  let runStart = 0;
  for (let f = 1; f <= frames; f++) {
    if (f < frames && sequence[f] === sequence[runStart]) continue;
    const id = sequence[runStart]!;
    const start = runStart === 0 ? 0 : Math.max(0, times[runStart]! - half);
    const end = f === frames ? duration : Math.min(duration, times[f - 1]! + half);
    segments.push(makeSegment(id, runStart, f, start, end, similarity));
    runStart = f;
  }

  segments = absorbShortSegments(segments, minDuration);
  return applyThreshold(segments, options.confidenceThreshold ?? CHORD_CONFIG.confidenceThreshold);
}

function makeSegment(
  id: number,
  from: number,
  to: number,
  start: number,
  end: number,
  similarity: Float32Array,
): ChordDetection {
  if (id >= TEMPLATES.length) return { chord: null, root: null, quality: null, start, end, confidence: 0 };
  const template = TEMPLATES[id]!;
  let sum = 0;
  for (let f = from; f < to; f++) sum += similarityToConfidence(similarity[f * TEMPLATES.length + id]!);
  return {
    chord: chordSymbol(template.root, template.quality),
    root: template.root,
    quality: template.quality,
    start,
    end,
    confidence: Math.round((sum / (to - from)) * 100) / 100,
  };
}

const sameChord = (a: ChordDetection, b: ChordDetection) => a.root === b.root && a.quality === b.quality;

function join(a: ChordDetection, b: ChordDetection): ChordDetection {
  const da = a.end - a.start;
  const db = b.end - b.start;
  const keep = da >= db ? a : b;
  return {
    ...keep,
    start: a.start,
    end: b.end,
    confidence: Math.round(((a.confidence * da + b.confidence * db) / (da + db || 1)) * 100) / 100,
  };
}

/** Repeatedly fold the shortest too-brief segment into its longer neighbour. */
function absorbShortSegments(input: ChordDetection[], minDuration: number): ChordDetection[] {
  const segments = [...input];
  for (;;) {
    let shortest = -1;
    for (let i = 0; i < segments.length; i++) {
      const length = segments[i]!.end - segments[i]!.start;
      if (length < minDuration && segments.length > 1 && (shortest < 0 || length < segments[shortest]!.end - segments[shortest]!.start)) {
        shortest = i;
      }
    }
    if (shortest < 0) break;

    const left = segments[shortest - 1];
    const right = segments[shortest + 1];
    const target = !left ? 1 : !right ? -1 : left.end - left.start >= right.end - right.start ? -1 : 1;
    const neighbour = segments[shortest + target]!;
    const short = segments[shortest]!;
    const merged: ChordDetection = {
      ...neighbour,
      start: Math.min(neighbour.start, short.start),
      end: Math.max(neighbour.end, short.end),
    };
    segments.splice(Math.min(shortest, shortest + target), 2, merged);

    // Neighbours that now match collapse into one.
    for (let i = segments.length - 1; i > 0; i--) {
      if (sameChord(segments[i - 1]!, segments[i]!)) segments.splice(i - 1, 2, join(segments[i - 1]!, segments[i]!));
    }
  }
  return segments;
}

/** Segments whose averaged confidence is too low are reported as "no clear chord". */
function applyThreshold(segments: ChordDetection[], threshold: number): ChordDetection[] {
  const out: ChordDetection[] = [];
  for (const segment of segments) {
    const weak = segment.chord !== null && segment.confidence < threshold;
    const next: ChordDetection = weak ? { ...segment, chord: null, root: null, quality: null } : segment;
    const last = out[out.length - 1];
    if (last && last.chord === null && next.chord === null) out[out.length - 1] = { ...last, end: next.end };
    else out.push(next);
  }
  return out;
}

/** Move chord boundaries onto a nearby beat so bars line up on the chart. */
export function snapToBeats(
  chords: readonly ChordDetection[],
  beats: readonly number[],
  tolerance: number = CHORD_CONFIG.beatSnapTolerance,
): ChordDetection[] {
  if (beats.length < 2 || chords.length < 2) return [...chords];
  const out = chords.map((c) => ({ ...c }));
  for (let i = 1; i < out.length; i++) {
    const boundary = out[i]!.start;
    let nearest = boundary;
    let distance = tolerance;
    for (const beat of beats) {
      const d = Math.abs(beat - boundary);
      if (d < distance) {
        distance = d;
        nearest = beat;
      }
    }
    if (nearest > out[i - 1]!.start + 0.2 && nearest < out[i]!.end - 0.2) {
      out[i - 1] = { ...out[i - 1]!, end: nearest };
      out[i] = { ...out[i]!, start: nearest };
    }
  }
  return out;
}
