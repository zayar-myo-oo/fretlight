import type { Confidence, MusicKey } from "../theory/key-detection";

export type ChordQuality =
  | "maj"
  | "min"
  | "dim"
  | "aug"
  | "maj7"
  | "m7"
  | "7"
  | "sus2"
  | "sus4"
  | "add9";

export type AnalysisInstrument = "guitar" | "bass";

/** One stretch of the song with a single chord, or none (`chord === null`). */
export interface ChordDetection {
  /** Display symbol like "Am7", or null when no clear chord was heard. */
  readonly chord: string | null;
  /** Pitch class 0..11, null when `chord` is null. */
  readonly root: number | null;
  readonly quality: ChordQuality | null;
  /** Seconds. */
  readonly start: number;
  readonly end: number;
  /** 0..1 */
  readonly confidence: number;
  /** True when the user changed this chord by hand. */
  readonly edited?: boolean;
}

export type SectionType =
  | "intro"
  | "verse"
  | "pre-chorus"
  | "chorus"
  | "bridge"
  | "outro"
  | "unknown";

export interface AnalysisSection {
  readonly type: SectionType;
  /** "Verse", "Chorus", or "Section A" when the role is uncertain. */
  readonly label: string;
  /** Sections sharing a cluster sound alike (same chords / texture). */
  readonly cluster: number;
  readonly start: number;
  readonly end: number;
  readonly confidence: number;
}

export interface SongAnalysis {
  readonly duration: number;
  readonly instrument: AnalysisInstrument;
  /** Rounded estimate, null when no steady pulse was found. */
  readonly bpm: number | null;
  readonly bpmConfidence: number;
  /** Beat positions in seconds. */
  readonly beats: readonly number[];
  /** "C Major", or null when the key is uncertain. */
  readonly key: string | null;
  readonly keyInfo: MusicKey | null;
  readonly keyConfidence: number;
  readonly keyLevel: Confidence | null;
  readonly chords: readonly ChordDetection[];
  readonly sections: readonly AnalysisSection[];
}

export type AnalysisStage = "rhythm" | "chords" | "sections" | "finalizing";

export interface AnalysisProgress {
  readonly stage: AnalysisStage;
  /** 0..1 over the whole analysis. */
  readonly fraction: number;
}
