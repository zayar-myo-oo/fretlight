import type { AnalysisInstrument, ChordQuality } from "./types";

/**
 * Every tunable number of the song analyser, in one place.
 * Change behaviour here; the algorithms contain no magic constants.
 */

export interface ChromaConfig {
  /** Keep every Nth sample (after averaging) before the FFT. */
  readonly decimate: number;
  readonly fftSize: number;
  /** Samples between frames at the decimated rate. */
  readonly hop: number;
  readonly minHz: number;
  readonly maxHz: number;
}

export const CHROMA_CONFIG: Record<AnalysisInstrument, ChromaConfig> = {
  // Full-band chords. Input arrives at 22.05 kHz, so bins are ~2.7 Hz wide.
  guitar: { decimate: 1, fftSize: 8192, hop: 2048, minHz: 90, maxHz: 2200 },
  // Bass sits below 400 Hz, so shrink the rate 4x to get ~1.3 Hz bins.
  bass: { decimate: 4, fftSize: 4096, hop: 512, minHz: 36, maxHz: 600 },
};

export const CHORD_CONFIG = {
  /** Below this the frame / segment is reported as "no clear chord". */
  confidenceThreshold: 0.5,
  /** A chord must last this long (seconds) or it is absorbed by a neighbour. */
  minChordDuration: 0.8,
  /** Cost, in similarity units, of switching chord between two frames. */
  chordChangeThreshold: 1.1,
  /** Similarity a chord must exceed to beat "no chord". */
  unknownBaseline: 0.7,
  /** How strongly similarity differences steer the path. */
  emissionGain: 5,
  /** Added to chords that belong to the detected key. */
  keyBonus: 0.04,
  /** Boundaries within this many seconds of a beat are moved onto it. */
  beatSnapTolerance: 0.2,
  /** Subtracted from a template's score; richer chords must earn their place. */
  complexityPenalty: {
    maj: 0, min: 0, dim: 0.03, aug: 0.06,
    maj7: 0.05, m7: 0.05, "7": 0.05, sus2: 0.05, sus4: 0.05, add9: 0.06,
  } satisfies Record<ChordQuality, number>,
  /** Relative weight of the root versus the other chord tones in a template. */
  rootWeight: 1,
  toneWeight: 0.8,
};

export const BPM_CONFIG = {
  minBpm: 60,
  maxBpm: 190,
  /** Prior centre; ambiguous half/double readings fall toward it. */
  preferredBpm: 112,
  /** Below this the BPM is shown as approximate. */
  confidentAbove: 0.35,
  analysisRate: 11025,
  fftSize: 1024,
  hop: 256,
};

export const KEY_CONFIG = {
  /** Fewer distinct chords than this and no key is claimed. */
  minDistinctChords: 2,
  highAbove: 0.75,
  mediumAbove: 0.5,
  /** Below this the UI says "Key uncertain". */
  uncertainBelow: 0.4,
};

export const SECTION_CONFIG = {
  /** Sections shorter than this are not created. */
  minSectionSeconds: 8,
  /** Seconds of music compared at a time, so a feature describes a progression, not one bar. */
  stackSeconds: 12,
  /** Half-width of the novelty kernel: how far each side of a boundary is compared. */
  kernelSeconds: 12,
  fallbackBlockSeconds: 2,
  /** Two sections this similar are treated as the same part. */
  sameSectionSimilarity: 0.85,
  /** A boundary peak must be this many standard deviations above the average novelty. */
  noveltyThreshold: 0.8,
  /** How much loudness counts next to chroma when comparing bars. */
  energyWeight: 1.5,
  /** Chroma counts for little in the texture view, so chord changes alone do not read as new sections. */
  textureChromaWeight: 0.3,
  /** Intros / outros / pre-choruses longer than this are not labelled so. */
  maxIntroOutroSeconds: 32,
  maxPreChorusSeconds: 20,
};

/** Longest file that will be analysed, in seconds. */
export const MAX_DURATION_SECONDS = 15 * 60;
