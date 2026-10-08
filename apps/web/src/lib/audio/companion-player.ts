import {
  type Idea,
  type IdeaNote,
  type Progression,
  type ProgressionChord,
  cowboyNotes,
  findCowboyChord,
  supportsCowboyChords,
  type Fretboard,
} from "@fretlight/core";
import { SOUND_PRESETS, type SoundPreset, fretSynth } from "./fret-synth";
import { voice } from "./theory-player";

/**
 * Plays Companion ideas over their chords. Everything is scheduled up front on
 * the audio clock (`when`), so timing stays tight however busy the page is, and
 * `stopCompanion()` silences it instantly. Sound only starts from a click.
 */
const CHORD_PRESET: SoundPreset = SOUND_PRESETS.find((p) => p.id === "acoustic")!;

export interface PlayEvent {
  readonly at: number;
  readonly midi: number;
  readonly preset?: SoundPreset;
  readonly gain?: number;
  readonly mute?: boolean;
}

/** How a chord is voiced when it plays: the open shape when there is one, a stacked triad otherwise. */
export function chordVoicing(chord: ProgressionChord, board?: Fretboard): number[] {
  if (board && supportsCowboyChords(board)) {
    const open = findCowboyChord(chord.root, chord.quality);
    if (open) return cowboyNotes(board, open).map((n) => n.midi);
  }
  return voice(chord.pitchClasses.map((pc) => pc % 12));
}

/** A strummed chord: low string first, a few milliseconds apart. */
function strum(chord: ProgressionChord, at: number, board: Fretboard | undefined, gain: number): PlayEvent[] {
  return chordVoicing(chord, board).map((midi, i) => ({ at: at + i * 0.018, midi, preset: CHORD_PRESET, gain }));
}

export function beatsToSeconds(beats: number, bpm: number): number {
  return (beats * 60) / bpm;
}

/** Idea notes as events; muted notes are choked short. */
export function ideaEvents(idea: Idea, bpm: number, offsetBeats: number, preset?: SoundPreset): PlayEvent[] {
  return idea.notes.map((n: IdeaNote) => ({
    at: beatsToSeconds(n.startBeat - offsetBeats, bpm),
    midi: n.midi,
    preset,
    mute: n.technique === "mute" || n.technique === "palmMute",
    gain: n.technique === "mute" || n.technique === "palmMute" ? 0.9 : 1,
  }));
}

/** The idea alone, or with the chords it plays over (the fill sits between its two chords). */
export function buildIdeaEvents(
  idea: Idea,
  progression: Progression,
  bpm: number,
  withProgression: boolean,
  board?: Fretboard,
  preset?: SoundPreset,
): { events: PlayEvent[]; seconds: number } {
  const from = progression.chords[idea.fromChord]!;
  const to = progression.chords[idea.toChord]!;
  const offset = from.startBeat;
  const lengthBeats = to.startBeat + to.beats - offset;
  const events: PlayEvent[] = [];

  if (withProgression && idea.category !== "rhythm") {
    for (let i = idea.fromChord; i <= idea.toChord; i++) {
      const chord = progression.chords[i]!;
      events.push(...strum(chord, beatsToSeconds(chord.startBeat - offset, bpm), board, 0.55));
    }
  }
  events.push(...ideaEvents(idea, bpm, offset, preset));
  const last = Math.max(...events.map((e) => e.at), 0);
  return { events, seconds: Math.max(beatsToSeconds(lengthBeats, bpm), last) + 1.2 };
}

let doneTimer: ReturnType<typeof setTimeout> | undefined;

export function stopCompanion(): void {
  clearTimeout(doneTimer);
  fretSynth.stopAll();
}

/** Schedule events from now. Resolves `onDone` when the last one has had time to sound. */
export async function playEvents(events: readonly PlayEvent[], seconds: number, onDone?: () => void): Promise<void> {
  stopCompanion();
  const start = (await fretSynth.warm(events)) + 0.08;
  await Promise.all(
    events.map((e) =>
      fretSynth.pluck(e.midi, e.preset, {
        at: start + Math.max(0, e.at),
        ...(e.gain !== undefined ? { gain: e.gain } : {}),
        ...(e.mute ? { mute: true } : {}),
      }),
    ),
  );
  doneTimer = setTimeout(() => onDone?.(), seconds * 1000);
}

/** A strummed chord on its own. */
export function playProgressionChord(chord: ProgressionChord, board?: Fretboard): void {
  const events = strum(chord, 0, board, 0.8);
  void playEvents(events, 1.5);
}
