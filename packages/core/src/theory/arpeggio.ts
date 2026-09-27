import { type ChordId, getChord } from "./chords";
import { mod } from "./pitch";
import type { PitchClass } from "./types";

export type ArpeggioDirection = "ascending" | "descending" | "up_down" | "down_up";

export interface ArpeggioStep {
  /** Absolute MIDI note to play. */
  readonly midi: number;
  readonly pitchClass: PitchClass;
  readonly name: string;
  readonly degree: string;
  readonly interval: number;
}

/**
 * Expand a chord into a playable sequence of absolute pitches.
 *
 * getArpeggio("A", "min7", { startOctave: 2 })
 *   -> A2 C3 E3 G3 (1 b3 5 b7)
 */
export function getArpeggio(
  root: PitchClass | string,
  chordId: ChordId,
  options: {
    startOctave?: number;
    octaves?: number;
    direction?: ArpeggioDirection;
    /** Repeat the root at the top, as most players actually practise it. */
    includeOctaveRoot?: boolean;
  } = {},
): ArpeggioStep[] {
  const chord = getChord(root, chordId);
  if (!chord) return [];

  const startOctave = options.startOctave ?? 2;
  const octaves = Math.max(1, options.octaves ?? 1);
  const direction = options.direction ?? "ascending";

  const baseMidi = chord.root + (startOctave + 1) * 12;
  const ascending: ArpeggioStep[] = [];

  for (let octave = 0; octave < octaves; octave++) {
    for (const tone of chord.tones) {
      ascending.push({
        midi: baseMidi + tone.interval + octave * 12,
        pitchClass: mod(tone.pitchClass, 12),
        name: tone.name,
        degree: tone.degree,
        interval: tone.interval,
      });
    }
  }

  if (options.includeOctaveRoot ?? true) {
    const first = chord.tones[0]!;
    ascending.push({
      midi: baseMidi + octaves * 12,
      pitchClass: first.pitchClass,
      name: first.name,
      degree: first.degree,
      interval: first.interval,
    });
  }

  switch (direction) {
    case "ascending":
      return ascending;
    case "descending":
      return [...ascending].reverse();
    case "up_down":
      return [...ascending, ...[...ascending].reverse().slice(1)];
    case "down_up": {
      const descending = [...ascending].reverse();
      return [...descending, ...ascending.slice(1)];
    }
  }
}

/** Convenience wrapper mirroring getScaleNotes: note names only. */
export function getArpeggioNotes(root: PitchClass | string, chordId: ChordId): string[] {
  return getChord(root, chordId)?.tones.map((t) => t.name) ?? [];
}
