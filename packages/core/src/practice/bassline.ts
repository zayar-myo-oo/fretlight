import { getChord, type ChordId, type ChordTone } from "../theory/chords";
import { mod } from "../theory/pitch";
import type { PitchClass } from "../theory/types";
import type { SongNote } from "../song/types";

export type BasslineDifficulty = "beginner" | "intermediate" | "advanced";

/** One chord in a progression the player specifies — a key input, not a random seed. */
export interface ChordSlot {
  readonly root: PitchClass | string;
  readonly chord: ChordId;
  /** How many beats this chord holds before the next one. */
  readonly beats: number;
}

export type BasslineNoteRole = "root" | "color" | "fifth" | "octave" | "approach";

export interface BasslineNote extends SongNote {
  /** Why this note is here — root, the chord's third/second/fourth, the fifth,
   *  an octave repeat, or a chromatic lead-in to the next chord. */
  readonly role: BasslineNoteRole;
}

const midiFor = (pitchClass: PitchClass, octave: number): number => (octave + 1) * 12 + pitchClass;

function fifthOf(tones: readonly ChordTone[]): ChordTone {
  return tones.find((tone) => tone.degree.replace(/[#b]/g, "") === "5") ?? tones[tones.length - 1]!;
}

/**
 * Turns a chord progression into a bassline. Every note comes from the
 * chord actually playing at that point — nothing here is generated at
 * random, and nothing crosses into a pitch the harmony does not support.
 *
 * - **beginner**: the root, held for the chord's full duration. The line a
 *   bass genuinely has to play under a progression before anything else.
 * - **intermediate**: root / chord-tone / fifth as a simple root-led cell —
 *   half the bar on the root, the rest split between the chord's own
 *   colour tone (3rd, or 2nd/4th for a sus chord) and the 5th.
 * - **advanced**: the intermediate cell, plus a chromatic approach note on
 *   the last beat that leads directly into the *next* chord's root — the
 *   standard "target the next chord" bass technique, aimed at a real pitch
 *   class rather than picked freely.
 */
export function generateBassline(
  progression: readonly ChordSlot[],
  difficulty: BasslineDifficulty,
  options: { readonly octave?: number } = {},
): BasslineNote[] {
  const octave = options.octave ?? 2;
  const notes: BasslineNote[] = [];
  let beat = 0;

  progression.forEach((slot, slotIndex) => {
    const chord = getChord(slot.root, slot.chord);
    if (!chord) {
      beat += slot.beats;
      return;
    }

    const root = chord.tones[0]!;
    const colorTone = chord.tones[1] ?? root;
    const fifth = fifthOf(chord.tones);

    if (difficulty === "beginner") {
      notes.push({ midi: midiFor(root.pitchClass, octave), startBeat: beat, durationBeats: slot.beats, role: "root" });
      beat += slot.beats;
      return;
    }

    const advanced = difficulty === "advanced";
    const approachBeats = advanced ? Math.min(1, slot.beats / 4) : 0;
    const bodyBeats = slot.beats - approachBeats;

    const cell: { tone: ChordTone; role: BasslineNoteRole }[] = [
      { tone: root, role: "root" },
      { tone: colorTone, role: "color" },
      { tone: fifth, role: "fifth" },
    ];
    const weights = [0.5, 0.25, 0.25];

    let cursor = beat;
    cell.forEach((step, i) => {
      const length = bodyBeats * weights[i]!;
      if (length <= 0) return;
      notes.push({ midi: midiFor(step.tone.pitchClass, octave), startBeat: cursor, durationBeats: length, role: step.role });
      cursor += length;
    });

    if (approachBeats > 0) {
      // Wraps to the top of the progression after the last chord — a bassline
      // is a vamp meant to repeat, and the turnaround leading back to chord
      // one is the same technique as leading into any other next chord.
      const next = progression[slotIndex + 1] ?? progression[0]!;
      const nextRootPitchClass = getChord(next.root, next.chord)?.tones[0]?.pitchClass ?? root.pitchClass;
      // Approach from a semitone below — the common direction; the target
      // chord's own root decides *which* pitch that is, never chosen freely.
      const approachPitchClass = mod(nextRootPitchClass - 1, 12);
      notes.push({
        midi: midiFor(approachPitchClass, octave),
        startBeat: cursor,
        durationBeats: approachBeats,
        role: "approach",
      });
    }

    beat += slot.beats;
  });

  return notes;
}

/** Total length of a progression in beats — useful for building the containing Phrase/section. */
export function progressionLengthBeats(progression: readonly ChordSlot[]): number {
  return progression.reduce((sum, slot) => sum + slot.beats, 0);
}
