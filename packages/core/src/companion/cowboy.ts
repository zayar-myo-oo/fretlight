import type { Fretboard } from "../instrument/fretboard";
import { mod, parseNoteName } from "../theory/pitch";
import { chordPitchClasses, chordSymbol, qualityInfo } from "../song-analysis/chord-templates";
import type { ChordQuality } from "../song-analysis/types";
import { type TriadQuality, coreTriad, triadOrder } from "./triads";

/**
 * "Cowboy chords" is a guitar-teaching term, not music theory: the common
 * open-position shapes every beginner learns first. This is fingering data, so
 * it is the one hand-entered table in the engine; the tests check every shape
 * against the tuning, so a typo cannot produce the wrong notes.
 */
export interface CowboyChord {
  readonly symbol: string;
  readonly root: number;
  readonly quality: ChordQuality;
  /** Fret per string, lowest string first; null = do not play that string. */
  readonly frets: readonly (number | null)[];
  /** Finger per string (1 index .. 4 pinky, 0 open or muted). */
  readonly fingers: readonly number[];
  readonly group: "major" | "minor" | "seventh" | "suspended";
}

const rootOf = (name: string) => parseNoteName(name)!.pitchClass;
const shape = (
  root: string,
  quality: ChordQuality,
  frets: readonly (number | null)[],
  fingers: readonly number[],
  group: CowboyChord["group"],
): CowboyChord => ({ symbol: chordSymbol(rootOf(root), quality, root), root: rootOf(root), quality, frets, fingers, group });

const x = null;

export const COWBOY_CHORDS: readonly CowboyChord[] = [
  shape("C", "maj", [x, 3, 2, 0, 1, 0], [0, 3, 2, 0, 1, 0], "major"),
  shape("G", "maj", [3, 2, 0, 0, 0, 3], [2, 1, 0, 0, 0, 3], "major"),
  shape("D", "maj", [x, x, 0, 2, 3, 2], [0, 0, 0, 1, 3, 2], "major"),
  shape("A", "maj", [x, 0, 2, 2, 2, 0], [0, 0, 1, 2, 3, 0], "major"),
  shape("E", "maj", [0, 2, 2, 1, 0, 0], [0, 2, 3, 1, 0, 0], "major"),
  shape("A", "min", [x, 0, 2, 2, 1, 0], [0, 0, 2, 3, 1, 0], "minor"),
  shape("E", "min", [0, 2, 2, 0, 0, 0], [0, 2, 3, 0, 0, 0], "minor"),
  shape("D", "min", [x, x, 0, 2, 3, 1], [0, 0, 0, 2, 3, 1], "minor"),
  shape("C", "7", [x, 3, 2, 3, 1, 0], [0, 3, 2, 4, 1, 0], "seventh"),
  shape("G", "7", [3, 2, 0, 0, 0, 1], [3, 2, 0, 0, 0, 1], "seventh"),
  shape("D", "7", [x, x, 0, 2, 1, 2], [0, 0, 0, 2, 1, 3], "seventh"),
  shape("A", "7", [x, 0, 2, 0, 2, 0], [0, 0, 2, 0, 3, 0], "seventh"),
  shape("E", "7", [0, 2, 0, 1, 0, 0], [0, 2, 0, 1, 0, 0], "seventh"),
  shape("A", "m7", [x, 0, 2, 0, 1, 0], [0, 0, 2, 0, 1, 0], "seventh"),
  shape("E", "m7", [0, 2, 2, 0, 3, 0], [0, 1, 2, 0, 3, 0], "seventh"),
  shape("D", "m7", [x, x, 0, 2, 1, 1], [0, 0, 0, 2, 1, 1], "seventh"),
  shape("C", "maj7", [x, 3, 2, 0, 0, 0], [0, 3, 2, 0, 0, 0], "seventh"),
  shape("F", "maj7", [x, x, 3, 2, 1, 0], [0, 0, 3, 2, 1, 0], "seventh"),
  shape("A", "sus2", [x, 0, 2, 2, 0, 0], [0, 0, 1, 2, 0, 0], "suspended"),
  shape("D", "sus2", [x, x, 0, 2, 3, 0], [0, 0, 0, 1, 2, 0], "suspended"),
  shape("E", "sus4", [0, 2, 2, 2, 0, 0], [0, 2, 3, 4, 0, 0], "suspended"),
  shape("G", "sus4", [3, 3, 0, 0, 1, 3], [2, 3, 0, 0, 1, 4], "suspended"),
  shape("A", "sus4", [x, 0, 2, 2, 3, 0], [0, 0, 1, 2, 3, 0], "suspended"),
  shape("D", "sus4", [x, x, 0, 2, 3, 3], [0, 0, 0, 1, 2, 3], "suspended"),
  shape("C", "add9", [x, 3, 2, 0, 3, 0], [0, 2, 1, 0, 3, 0], "suspended"),
];

/** Open-chord shapes only make sense on a six-string guitar in standard tuning. */
export function supportsCowboyChords(board: Fretboard): boolean {
  const standard = [40, 45, 50, 55, 59, 64];
  return board.stringCount === 6 && board.openMidi.every((m, i) => m === standard[i]);
}

export function findCowboyChord(root: number, quality: ChordQuality): CowboyChord | null {
  return COWBOY_CHORDS.find((c) => c.root === mod(root, 12) && c.quality === quality) ?? null;
}

export interface CowboyNote {
  readonly string: number;
  readonly fret: number;
  readonly midi: number;
  readonly pitchClass: number;
  /** "R", "3", "5", or the colour tone's degree. */
  readonly role: string;
  readonly open: boolean;
}

/** Every sounding note of a shape, with the chord degree each plays. */
export function cowboyNotes(board: Fretboard, chord: CowboyChord): CowboyNote[] {
  const pcs = chordPitchClasses(chord.root, chord.quality);
  const degrees = qualityDegreesOf(chord.quality);
  const out: CowboyNote[] = [];
  chord.frets.forEach((fret, string) => {
    if (fret === null) return;
    const midi = board.openMidi[string]! + fret;
    const index = pcs.indexOf(mod(midi, 12));
    out.push({
      string,
      fret,
      midi,
      pitchClass: mod(midi, 12),
      role: index >= 0 ? simplifyDegree(degrees[index]!) : "?",
      open: fret === 0,
    });
  });
  return out;
}

function qualityDegreesOf(quality: ChordQuality): readonly string[] {
  return qualityDegreeTable[quality];
}

const qualityDegreeTable: Record<ChordQuality, readonly string[]> = {
  maj: ["1", "3", "5"],
  min: ["1", "b3", "5"],
  dim: ["1", "b3", "b5"],
  aug: ["1", "3", "#5"],
  maj7: ["1", "3", "5", "7"],
  m7: ["1", "b3", "5", "b7"],
  "7": ["1", "3", "5", "b7"],
  sus2: ["1", "2", "5"],
  sus4: ["1", "4", "5"],
  add9: ["1", "3", "5", "9"],
};

/** Label a degree the way a learner reads it: 1 -> R, others unchanged. */
function simplifyDegree(degree: string): string {
  return degree === "1" ? "R" : degree;
}

/** The triad hiding inside an open chord: its root, 3rd and 5th as notes, or null for a suspended chord. */
export function extractTriad(chord: CowboyChord): { quality: TriadQuality; notes: number[] } | null {
  const quality = coreTriad(chord.quality);
  if (!quality) return null;
  return { quality, notes: triadOrder(chord.root, quality, 0).map((n) => n.pitchClass) };
}

export function cowboyLabel(chord: CowboyChord): string {
  return `${chord.symbol} · ${qualityInfo(chord.quality).name}`;
}

/** "x 3 2 0 1 0" */
export function shapeText(chord: CowboyChord): string {
  return chord.frets.map((f) => (f === null ? "x" : String(f))).join(" ");
}
