import type { ChordId } from "../theory/chords";
import type { ChordQuality } from "../song-analysis/types";

export type CompanionStyle =
  | "popPunk"
  | "rock"
  | "rockAndRoll"
  | "emo"
  | "mathRock"
  | "alternative"
  | "acoustic";

export type Difficulty = "beginner" | "intermediate" | "advanced";

export type IdeaCategory =
  | "lead"
  | "fills"
  | "counter"
  | "rhythm"
  | "bass-root"
  | "bass-rootfifth"
  | "bass-octave"
  | "bass-passing"
  | "bass-approach"
  | "bass-walking"
  | "bass-melodic"
  | "bass-style"
  | "bass-fills";

/** Why a note is in an idea. Drives the colour on the fretboard and the explanation. */
export type NoteRole = "root" | "chordTone" | "passing" | "approach" | "target" | "extension";

export type Technique = "slide" | "hammer" | "pull" | "bend" | "palmMute" | "mute";

export interface ProgressionChord {
  readonly index: number;
  /** Display symbol spelled for the key, e.g. "Bbmaj7". */
  readonly symbol: string;
  readonly root: number;
  readonly quality: ChordQuality;
  readonly chordId: ChordId;
  /** Chord tones, root first. */
  readonly pitchClasses: readonly number[];
  /** The same tones, spelled for the key. */
  readonly names: readonly string[];
  /** "ii7", "V", or null when the chord is outside the key. */
  readonly roman: string | null;
  readonly beats: number;
  readonly startBeat: number;
}

export interface FretSpot {
  readonly string: number;
  readonly fret: number;
}

export interface IdeaNote {
  readonly midi: number;
  readonly name: string;
  /** Beats from the start of the progression. Notes sharing a start sound together. */
  readonly startBeat: number;
  readonly durationBeats: number;
  readonly role: NoteRole;
  /** The chord that is sounding when the note starts. */
  readonly chordIndex: number;
  readonly position?: FretSpot;
  readonly technique?: Technique;
}

/** One suggestion: notes, plus the three answers a learner needs. */
export interface Idea {
  readonly id: string;
  readonly category: IdeaCategory;
  readonly title: string;
  readonly notes: readonly IdeaNote[];
  /** Chords this idea plays over, inclusive, for "play with progression". */
  readonly fromChord: number;
  readonly toChord: number;
  readonly target?: { readonly name: string; readonly midi: number; readonly chordIndex: number };
  readonly what: string;
  readonly why: string;
  readonly where: string;
  /** Strum / rhythm grid, one string per line, when the idea is about rhythm. */
  readonly pattern?: readonly string[];
  readonly tip?: string;
}
