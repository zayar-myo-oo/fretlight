import { allPositions, getChord, type Fretboard } from "@fretlight/core";
import type { FretMarker } from "@/components/fretboard/Fretboard";
import type { DetectionValue } from "./session-recording";

/** Exact MIDI for notes; pitch-class locations for chords. Neither claims a fingering. */
export function detectionMarkers(board: Fretboard, value: DetectionValue | null): FretMarker[] {
  if (!value) return [];
  const chord = value.kind === "chord" && value.chord ? getChord(value.chord.root, value.chord.chordId) : null;
  return allPositions(board).filter((p) => p.fret <= 12 && (value.kind === "note" ? p.midi === value.midi : chord?.pitchClasses.has(p.pitchClass))).map((p) => ({
    string: p.string, fret: p.fret, label: `${p.name}${value.kind === "note" ? p.octave : ""}`,
    tone: value.kind === "note" ? "live" : p.pitchClass === chord?.root ? "root" : "chord",
  }));
}
