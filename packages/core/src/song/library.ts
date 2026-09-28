import type { BackingTrack } from "./types";

/**
 * A small built-in library of original practice pieces.
 *
 * There is no licensed recording to attach to these — `BackingTrack.audio` is
 * left unset rather than pointed at a fake URL, which is the honest
 * representation of "notes to learn, no backing playback yet" (see the
 * `licence` field's own doc comment on `BackingTrack`). Every note here is an
 * original teaching pattern (a pentatonic call-and-response, a root/3rd/5th
 * walking line) written for this app, not transcribed from any existing
 * recording.
 */
export const SONGS: readonly BackingTrack[] = [
  {
    id: "open-position-groove",
    title: "Open Position Groove",
    bpm: 90,
    timeSignature: { beats: 4, value: 4 },
    key: { root: 9, scale: "minor_pentatonic" }, // A minor pentatonic
    instrumentId: "guitar-6",
    tuningId: "guitar-6-standard",
    sections: [
      { id: "a", name: "Call", startBeat: 0, lengthBeats: 8 },
      { id: "b", name: "Response", startBeat: 9, lengthBeats: 8 },
    ],
    part: [
      { midi: 45, startBeat: 0, durationBeats: 1 },
      { midi: 48, startBeat: 1, durationBeats: 1 },
      { midi: 50, startBeat: 2, durationBeats: 1 },
      { midi: 52, startBeat: 3, durationBeats: 1 },
      { midi: 55, startBeat: 4, durationBeats: 1 },
      { midi: 52, startBeat: 5, durationBeats: 1 },
      { midi: 50, startBeat: 6, durationBeats: 1 },
      { midi: 48, startBeat: 7, durationBeats: 1 },
      // A beat's rest here is what splits this into two phrases.
      { midi: 45, startBeat: 9, durationBeats: 1 },
      { midi: 57, startBeat: 10, durationBeats: 1 },
      { midi: 55, startBeat: 11, durationBeats: 1 },
      { midi: 52, startBeat: 12, durationBeats: 1 },
      { midi: 50, startBeat: 13, durationBeats: 1 },
      { midi: 48, startBeat: 14, durationBeats: 1 },
      { midi: 45, startBeat: 15, durationBeats: 1 },
      { midi: 45, startBeat: 16, durationBeats: 2 },
    ],
  },
  {
    id: "root-walk-in-e",
    title: "Root Walk in E",
    bpm: 100,
    timeSignature: { beats: 4, value: 4 },
    key: { root: 4, scale: "minor_pentatonic" }, // E minor pentatonic
    instrumentId: "bass-4",
    tuningId: "bass-4-standard",
    sections: [
      { id: "a", name: "Walk up", startBeat: 0, lengthBeats: 8 },
      { id: "b", name: "Walk down", startBeat: 9, lengthBeats: 8 },
    ],
    part: [
      { midi: 40, startBeat: 0, durationBeats: 1 },
      { midi: 43, startBeat: 1, durationBeats: 1 },
      { midi: 45, startBeat: 2, durationBeats: 1 },
      { midi: 47, startBeat: 3, durationBeats: 1 },
      { midi: 40, startBeat: 4, durationBeats: 1 },
      { midi: 43, startBeat: 5, durationBeats: 1 },
      { midi: 45, startBeat: 6, durationBeats: 1 },
      { midi: 50, startBeat: 7, durationBeats: 1 },
      { midi: 40, startBeat: 9, durationBeats: 1 },
      { midi: 50, startBeat: 10, durationBeats: 1 },
      { midi: 47, startBeat: 11, durationBeats: 1 },
      { midi: 45, startBeat: 12, durationBeats: 1 },
      { midi: 43, startBeat: 13, durationBeats: 1 },
      { midi: 40, startBeat: 14, durationBeats: 1 },
      { midi: 47, startBeat: 15, durationBeats: 1 },
      { midi: 40, startBeat: 16, durationBeats: 2 },
    ],
  },
];

export function getSong(id: string): BackingTrack | null {
  return SONGS.find((track) => track.id === id) ?? null;
}
