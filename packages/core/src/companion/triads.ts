import type { Fretboard } from "../instrument/fretboard";
import { mod } from "../theory/pitch";
import { chordPitchClasses } from "../song-analysis/chord-templates";
import type { ChordQuality } from "../song-analysis/types";

export type TriadQuality = Extract<ChordQuality, "maj" | "min" | "dim" | "aug">;
export type Inversion = 0 | 1 | 2;
export type TriadRole = "R" | "3" | "5";

export const INVERSION_LABELS: Record<Inversion, string> = {
  0: "Root position",
  1: "1st inversion",
  2: "2nd inversion",
};

export interface TriadSpot {
  readonly string: number;
  readonly fret: number;
  readonly pitchClass: number;
  readonly role: TriadRole;
}

export interface TriadShape {
  readonly inversion: Inversion;
  /** Lowest string first. */
  readonly spots: readonly TriadSpot[];
  readonly minFret: number;
  readonly maxFret: number;
}

/**
 * The triad inside a chord: its root, 3rd and 5th. Sevenths and added notes
 * reduce to the triad they are built on (Am7 -> A minor). A suspended chord has
 * no 3rd, so it has no triad.
 */
export function coreTriad(quality: ChordQuality): TriadQuality | null {
  switch (quality) {
    case "maj":
    case "maj7":
    case "7":
    case "add9":
      return "maj";
    case "min":
    case "m7":
      return "min";
    case "dim":
      return "dim";
    case "aug":
      return "aug";
    default:
      return null;
  }
}

/** Notes of a triad, bass first, for an inversion: C major 1st inversion = E G C. */
export function triadOrder(root: number, quality: TriadQuality, inversion: Inversion): { pitchClass: number; role: TriadRole }[] {
  const [r, t, f] = chordPitchClasses(root, quality) as [number, number, number];
  const stack: { pitchClass: number; role: TriadRole }[] = [
    { pitchClass: r, role: "R" },
    { pitchClass: t, role: "3" },
    { pitchClass: f, role: "5" },
  ];
  return [...stack.slice(inversion), ...stack.slice(0, inversion)];
}

/**
 * Playable triad shapes on three adjacent strings, from the board itself, so the
 * tuning, string count and fret range are always the instrument's own. Each
 * shape fits inside a four-fret reach and is listed from the nut upward.
 */
export function triadShapes(
  board: Fretboard,
  root: number,
  quality: TriadQuality,
  inversion: Inversion | "all" = "all",
  maxSpan = 4,
): TriadShape[] {
  const inversions: Inversion[] = inversion === "all" ? [0, 1, 2] : [inversion];
  const shapes: TriadShape[] = [];

  for (const inv of inversions) {
    const order = triadOrder(root, quality, inv);
    for (let low = 0; low + 2 < board.stringCount; low++) {
      const frets = order.map((note, i) => {
        const open = board.openMidi[low + i]!;
        const found: number[] = [];
        for (let fret = 0; fret <= board.fretCount; fret++) if (mod(open + fret, 12) === note.pitchClass) found.push(fret);
        return found;
      });
      for (const a of frets[0]!) {
        for (const b of frets[1]!) {
          for (const c of frets[2]!) {
            const fretted = [a, b, c].filter((f) => f > 0);
            const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0;
            if (span > maxSpan) continue;
            // A close voicing rises from bass to top; a shape that folds back is not the inversion asked for.
            const midis = [board.openMidi[low]! + a, board.openMidi[low + 1]! + b, board.openMidi[low + 2]! + c];
            if (!(midis[0]! < midis[1]! && midis[1]! < midis[2]!) || midis[2]! - midis[0]! > 12) continue;
            shapes.push({
              inversion: inv,
              spots: [a, b, c].map((fret, i) => ({
                string: low + i,
                fret,
                pitchClass: order[i]!.pitchClass,
                role: order[i]!.role,
              })),
              minFret: Math.min(a, b, c),
              maxFret: Math.max(a, b, c),
            });
          }
        }
      }
    }
  }
  return shapes.sort((x, y) => x.minFret - y.minFret || x.inversion - y.inversion || x.spots[0]!.string - y.spots[0]!.string);
}
