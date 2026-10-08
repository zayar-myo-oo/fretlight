import { type Fretboard, type Idea, type NoteRole, mod } from "@fretlight/core";
import type { FretMarker } from "@/components/fretboard/Fretboard";
import type { MarkerTone } from "@/lib/ui/tone";

/** Colour for each reason a note is in an idea. */
export const ROLE_TONE: Record<NoteRole, MarkerTone> = {
  root: "root",
  chordTone: "chord",
  target: "target",
  passing: "scale",
  approach: "played",
  extension: "scale",
};

export const ROLE_LABEL: Record<NoteRole, string> = {
  root: "Root",
  chordTone: "Chord tone",
  target: "Target note",
  passing: "Passing note",
  approach: "Approach note",
  extension: "Colour tone",
};

/** The notes of an idea as fretboard markers, numbered in playing order for melodic ideas. */
export function ideaMarkers(idea: Idea, options: { numbered: boolean; chordIndex?: number }): FretMarker[] {
  const out = new Map<string, FretMarker>();
  let order = 0;
  for (const note of idea.notes) {
    if (!note.position) continue;
    if (options.chordIndex !== undefined && note.chordIndex !== options.chordIndex) continue;
    const key = `${note.position.string}:${note.position.fret}`;
    order++;
    const existing = out.get(key);
    const tone = ROLE_TONE[note.role];
    if (existing) {
      // The same spot played again: the target colour wins so the landing note stays visible.
      if (note.role === "target") out.set(key, { ...existing, tone });
      continue;
    }
    out.set(key, {
      string: note.position.string,
      fret: note.position.fret,
      label: note.name,
      tone,
      ...(options.numbered ? { order } : {}),
    });
  }
  return [...out.values()];
}

/** Every place on the neck that sounds one of `pitchClasses`. */
export function pitchClassMarkers(
  board: Fretboard,
  pitchClasses: readonly number[],
  names: ReadonlyMap<number, string>,
  toneFor: (pc: number) => MarkerTone,
): FretMarker[] {
  const wanted = new Set(pitchClasses.map((p) => mod(p, 12)));
  const out: FretMarker[] = [];
  for (let string = 0; string < board.stringCount; string++) {
    for (let fret = 0; fret <= board.fretCount; fret++) {
      const pc = mod(board.openMidi[string]! + fret, 12);
      if (wanted.has(pc)) out.push({ string, fret, label: names.get(pc) ?? String(pc), tone: toneFor(pc) });
    }
  }
  return out;
}
