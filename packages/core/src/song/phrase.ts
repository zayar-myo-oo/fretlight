import { createFretboard, nearestPosition, getFretPositions, type Fretboard } from "../instrument/fretboard";
import { midiToNote } from "../theory/pitch";
import type { PracticeSequence, PracticeStep } from "../practice/sequence";
import type { BackingTrack, Phrase, SongNote } from "./types";

export interface PhraseOptions {
  /** A gap at least this long (in beats) ends a phrase. */
  readonly restBeats?: number;
  /** Hard ceiling on phrase length — anything longer is not learnable in one go. */
  readonly maxNotes?: number;
  /** Phrases shorter than this are merged into their neighbour. */
  readonly minNotes?: number;
  /** Beats per bar, so phrases can prefer to break on bar lines. */
  readonly beatsPerBar?: number;
}

/**
 * Split a part into phrases a player can actually learn.
 *
 * The naive approach — fixed chunks of N notes — cuts through the middle of
 * musical ideas and produces fragments that are harder to learn than the whole
 * line. This breaks where the music already breathes: at rests first, then at
 * bar lines once a phrase is long enough to stand alone, and only falls back to
 * a length limit when the part gives it nothing else to work with.
 */
export function decomposeIntoPhrases(
  part: readonly SongNote[],
  options: PhraseOptions = {},
): Phrase[] {
  const restBeats = options.restBeats ?? 1;
  const maxNotes = options.maxNotes ?? 8;
  const minNotes = options.minNotes ?? 3;
  const beatsPerBar = options.beatsPerBar ?? 4;

  if (part.length === 0) return [];

  const notes = [...part].sort((a, b) => a.startBeat - b.startBeat);
  const groups: SongNote[][] = [];
  let current: SongNote[] = [];

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i]!;

    if (current.length > 0) {
      const previous = current[current.length - 1]!;
      const gap = note.startBeat - (previous.startBeat + previous.durationBeats);
      const crossesBar =
        Math.floor(note.startBeat / beatsPerBar) >
        Math.floor(previous.startBeat / beatsPerBar);

      const breakHere =
        gap >= restBeats ||
        current.length >= maxNotes ||
        (crossesBar && current.length >= minNotes);

      if (breakHere) {
        groups.push(current);
        current = [];
      }
    }
    current.push(note);
  }
  if (current.length > 0) groups.push(current);

  // A one- or two-note tail is not a phrase, it is an orphan. Fold it back.
  for (let i = groups.length - 1; i > 0; i--) {
    if (groups[i]!.length < minNotes && groups[i - 1]!.length + groups[i]!.length <= maxNotes + 2) {
      groups[i - 1] = [...groups[i - 1]!, ...groups[i]!];
      groups.splice(i, 1);
    }
  }

  return groups.map((group, index) => {
    const first = group[0]!;
    const last = group[group.length - 1]!;
    const startBeat = first.startBeat;
    const lengthBeats = last.startBeat + last.durationBeats - startBeat;
    return {
      id: `phrase-${index + 1}`,
      label: `Phrase ${index + 1}`,
      notes: group,
      startBeat,
      lengthBeats,
      difficulty: estimateDifficulty(group),
    } satisfies Phrase;
  });
}

/**
 * Rough difficulty, 0..1, from the three things that actually make a line hard:
 * how far apart the notes are, how fast they come, and how much the hand has to
 * move between them.
 */
export function estimateDifficulty(notes: readonly SongNote[]): number {
  if (notes.length < 2) return 0.1;

  const midis = notes.map((n) => n.midi);
  const span = Math.max(...midis) - Math.min(...midis);

  const first = notes[0]!;
  const last = notes[notes.length - 1]!;
  const beats = Math.max(0.25, last.startBeat + last.durationBeats - first.startBeat);
  const density = notes.length / beats;

  let shift = 0;
  for (let i = 1; i < notes.length; i++) {
    const a = notes[i - 1]!.position;
    const b = notes[i]!.position;
    if (a && b) shift += Math.abs(a.fret - b.fret);
  }
  const averageShift = shift / Math.max(1, notes.length - 1);

  const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
  return clamp01(
    clamp01(span / 24) * 0.35 + clamp01(density / 4) * 0.4 + clamp01(averageShift / 6) * 0.25,
  );
}

/**
 * Turn a phrase into something the existing practice engine can grade.
 * The engine does not need to know a backing track exists.
 */
export function phraseToSequence(
  phrase: Phrase,
  board: Fretboard,
  options: { bpm?: number; timed?: boolean } = {},
): PracticeSequence {
  const bpm = options.bpm ?? 80;
  const timed = options.timed ?? false;
  const secondsPerBeat = 60 / bpm;

  let lastPosition: { string: number; fret: number } | undefined;

  const steps: PracticeStep[] = phrase.notes.map((note, index) => {
    const position =
      note.position ??
      (() => {
        // No fingering in the transcription: pick one near the previous note,
        // the same greedy walk a teacher would suggest.
        const candidates = getFretPositions(board, note.midi, { exactOctave: true });
        const pick = nearestPosition(candidates, lastPosition?.fret ?? 5, lastPosition?.string);
        return pick ? { string: pick.string, fret: pick.fret } : undefined;
      })();

    if (position) lastPosition = position;
    const pitch = midiToNote(note.midi);

    return {
      id: `${phrase.id}-${index}`,
      midi: note.midi,
      pitchClass: pitch.pitchClass,
      label: pitch.name,
      ...(position ? { position } : {}),
      ...(timed ? { expectedTime: (note.startBeat - phrase.startBeat) * secondsPerBeat } : {}),
    } satisfies PracticeStep;
  });

  return {
    id: phrase.id,
    name: phrase.label,
    steps,
    bpm,
    mode: timed ? "timed" : "free",
  };
}

/** Practice speeds, slowest first. Pitch must not change with them. */
export const PRACTICE_SPEEDS = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0] as const;
export type PracticeSpeed = (typeof PRACTICE_SPEEDS)[number];

export interface SlowPracticeStep {
  readonly speed: PracticeSpeed;
  readonly bpm: number;
  readonly repetitions: number;
}

/**
 * The ladder from "cannot play it" to "can play it at tempo".
 *
 * Harder phrases start slower and repeat more. This encodes the one piece of
 * practice advice that is almost universally agreed on and almost universally
 * ignored: get it right slowly before getting it fast.
 */
export function buildSlowPracticePlan(
  targetBpm: number,
  difficulty: number,
): SlowPracticeStep[] {
  const startIndex = difficulty > 0.66 ? 0 : difficulty > 0.33 ? 1 : 2;
  return PRACTICE_SPEEDS.slice(startIndex).map((speed) => ({
    speed,
    bpm: Math.round(targetBpm * speed),
    repetitions: speed < 0.8 ? 3 : 2,
  }));
}

/** Convenience: every phrase of a track, in order. */
export function phrasesForTrack(track: BackingTrack, options: PhraseOptions = {}): Phrase[] {
  return decomposeIntoPhrases(track.part, {
    beatsPerBar: track.timeSignature.beats,
    ...options,
  });
}

/** Build a board from a track's declared tuning, for fingering suggestions. */
export function boardForTrack(track: BackingTrack, tuningLookup: (id: string) => { strings: readonly string[] } | null): Fretboard | null {
  const tuning = tuningLookup(track.tuningId);
  if (!tuning) return null;
  return createFretboard(tuning as Parameters<typeof createFretboard>[0]);
}
