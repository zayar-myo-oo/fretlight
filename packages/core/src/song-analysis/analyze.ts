import { type MusicKey, getDiatonicChords } from "../theory/key-detection";
import { detectBpm } from "./bpm-detector";
import { CHROMA_CONFIG, CHORD_CONFIG, KEY_CONFIG } from "./config";
import { type ChromaFrames, extractChroma } from "./chroma-analyzer";
import { smoothChords, snapToBeats } from "./chord-smoother";
import { chordSymbol } from "./chord-templates";
import { analyzeKey, analyzeKeyFromRoots, type SongKey } from "./key-analyzer";
import { detectSections } from "./section-detector";
import type {
  AnalysisInstrument,
  AnalysisProgress,
  ChordDetection,
  ChordQuality,
  SongAnalysis,
} from "./types";

export interface AnalyzeOptions {
  readonly instrument?: AnalysisInstrument;
  readonly onProgress?: (progress: AnalysisProgress) => void;
}

const QUALITY_FOR_TRIAD: Record<string, ChordQuality> = { major: "maj", minor: "min", dim: "dim" };

/**
 * Bass mode: trust only the lowest note. Roots are found with the same smoothing
 * idea (a path through 12 root states), the key is inferred from root usage, and
 * each root then gets the quality its key gives it, so C G A F in C major reads
 * C G Am F. Qualities here are inferred, not heard, and confidence is lowered
 * to say so.
 */
function bassChords(
  frames: ChromaFrames,
  duration: number,
): { chords: ChordDetection[]; key: SongKey } {
  const roots = frames.chroma.map((vector) => {
    let best = 0;
    for (let i = 1; i < 12; i++) if (vector[i]! > vector[best]!) best = i;
    return vector[best]! > 0.5 ? best : -1;
  });

  // Majority vote over a short window removes single-frame flicker.
  const radius = 2;
  const voted = roots.map((_, f) => {
    const counts = new Map<number, number>();
    for (let j = Math.max(0, f - radius); j <= Math.min(roots.length - 1, f + radius); j++) {
      counts.set(roots[j]!, (counts.get(roots[j]!) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  });

  const weights = new Array<number>(12).fill(0);
  voted.forEach((r, f) => {
    if (r >= 0) weights[r]! += frames.hopSeconds * Math.min(1, frames.energy[f]! * 20);
  });
  const key = analyzeKeyFromRoots(weights);
  const triads = key.key ? getDiatonicChords(key.key) : [];

  const hop = frames.hopSeconds;
  const out: ChordDetection[] = [];
  let runStart = 0;
  for (let f = 1; f <= voted.length; f++) {
    if (f < voted.length && voted[f] === voted[runStart]) continue;
    const root = voted[runStart]!;
    const start = runStart === 0 ? 0 : Math.max(0, frames.times[runStart]! - hop / 2);
    const end = f === voted.length ? duration : Math.min(duration, frames.times[f - 1]! + hop / 2);
    if (root < 0) out.push({ chord: null, root: null, quality: null, start, end, confidence: 0 });
    else {
      const diatonic = triads.find((t) => t.root === root);
      const quality = (diatonic && QUALITY_FOR_TRIAD[diatonic.chordId]) || "maj";
      out.push({
        chord: chordSymbol(root, quality),
        root,
        quality,
        start,
        end,
        confidence: diatonic ? 0.6 : 0.4,
      });
    }
    runStart = f;
  }

  // Fold chords shorter than the minimum into their neighbours, as the guitar path does.
  const merged: ChordDetection[] = [];
  for (const chord of out) {
    const last = merged[merged.length - 1];
    const short = chord.end - chord.start < CHORD_CONFIG.minChordDuration;
    if (last && (short || (last.root === chord.root && last.quality === chord.quality))) {
      merged[merged.length - 1] = { ...last, end: chord.end };
    } else merged.push(chord);
  }
  return { chords: merged, key };
}

/**
 * Analyse a decoded mono recording. Pure and synchronous; run it in a Worker.
 * Nothing is kept: the samples are only read, never stored or sent anywhere.
 */
export function analyzeSong(samples: Float32Array, sampleRate: number, options: AnalyzeOptions = {}): SongAnalysis {
  const instrument = options.instrument ?? "guitar";
  const report = (stage: AnalysisProgress["stage"], fraction: number) => options.onProgress?.({ stage, fraction });
  const duration = samples.length / sampleRate;

  report("rhythm", 0);
  const tempo = detectBpm(samples, sampleRate);
  report("rhythm", 0.12);

  const chroma = extractChroma(samples, sampleRate, CHROMA_CONFIG[instrument], (p) => report("chords", 0.12 + p * 0.5));

  let chords: ChordDetection[];
  let songKey: SongKey;
  if (instrument === "bass") {
    ({ chords, key: songKey } = bassChords(chroma, duration));
  } else {
    // First pass without a key, then again with the key's chords favoured.
    const firstPass = smoothChords(chroma.chroma, chroma.times, chroma.hopSeconds, duration);
    const provisional = analyzeKey(firstPass);
    chords = provisional.key
      ? smoothChords(chroma.chroma, chroma.times, chroma.hopSeconds, duration, { key: provisional.key })
      : firstPass;
    songKey = analyzeKey(chords);
  }
  if (tempo.beats.length >= 4 && tempo.confidence >= 0.2) chords = snapToBeats(chords, tempo.beats);
  report("chords", 0.7);

  report("sections", 0.7);
  const sections = detectSections(chroma, duration, tempo.confidence >= 0.2 ? tempo.bpm : null);
  report("sections", 0.92);

  report("finalizing", 0.95);
  const key: MusicKey | null = songKey.confidence >= KEY_CONFIG.uncertainBelow ? songKey.key : null;
  const result: SongAnalysis = {
    duration,
    instrument,
    bpm: tempo.bpm,
    bpmConfidence: tempo.confidence,
    beats: tempo.beats,
    key: key?.name ?? null,
    keyInfo: key,
    keyConfidence: songKey.confidence,
    keyLevel: songKey.level,
    chords,
    sections,
  };
  report("finalizing", 1);
  return result;
}

