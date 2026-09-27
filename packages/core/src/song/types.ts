import type { ChordId } from "../theory/chords";
import type { ScaleId } from "../theory/scales";
import type { TimeSignature } from "../timing/metronome";
import type { PitchClass } from "../theory/types";

/**
 * Backing-track data model.
 *
 * Types only at this stage, deliberately. The product decision that matters here
 * is that a backing track is not an audio file the player is left to improvise
 * over — it is *material to be taught*, broken into phrases small enough to
 * learn one at a time. Fixing that shape now means the practice engine, the
 * fretboard and the drill system already speak the right language when the
 * playback and analysis layers arrive.
 *
 * Note that nothing here references an audio decoder, a stretching algorithm or
 * a file format. Those are implementation details of a later phase; this is the
 * contract they will have to satisfy.
 */

/** One note in a transcribed part. Beats, not seconds — tempo is separate. */
export interface SongNote {
  readonly midi: number;
  /** Position in beats from the start of the track. */
  readonly startBeat: number;
  readonly durationBeats: number;
  /** Where to play it, when the transcription specifies a fingering. */
  readonly position?: { readonly string: number; readonly fret: number };
}

export interface SongSection {
  readonly id: string;
  /** "Intro", "Verse", "Chorus"… */
  readonly name: string;
  readonly startBeat: number;
  readonly lengthBeats: number;
  readonly key?: { readonly root: PitchClass; readonly scale: ScaleId };
  readonly chords?: readonly { readonly root: PitchClass; readonly chord: ChordId; readonly beat: number }[];
}

export interface BackingTrack {
  readonly id: string;
  readonly title: string;
  readonly artist?: string;
  readonly bpm: number;
  readonly timeSignature: TimeSignature;
  readonly key: { readonly root: PitchClass; readonly scale: ScaleId };
  readonly instrumentId: string;
  readonly tuningId: string;
  readonly sections: readonly SongSection[];
  /** The part the player is learning. */
  readonly part: readonly SongNote[];
  /**
   * Where the audio lives, and under what terms.
   *
   * Licensing is a product problem, not a technical one, and it is kept out of
   * the engine entirely: the practice system works identically on a licensed
   * recording, a public-domain piece, or an exercise the player wrote.
   */
  readonly audio?: {
    readonly url: string;
    readonly licence: "licensed" | "public_domain" | "user_created" | "educational";
    readonly attribution?: string;
  };
}

/** A chunk small enough to learn in one sitting. */
export interface Phrase {
  readonly id: string;
  readonly label: string;
  readonly notes: readonly SongNote[];
  readonly startBeat: number;
  readonly lengthBeats: number;
  /** 0..1, from span, density and how far the hand has to move. */
  readonly difficulty: number;
  /** Section this phrase came from, when known. */
  readonly sectionId?: string;
}
