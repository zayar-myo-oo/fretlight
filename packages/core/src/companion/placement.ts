import type { Fretboard } from "../instrument/fretboard";
import type { FretSpot } from "./types";

/** Every place on the neck that sounds `midi`, or none when it is out of the instrument's range. */
export function spotsFor(board: Fretboard, midi: number): FretSpot[] {
  const out: FretSpot[] = [];
  for (let string = 0; string < board.stringCount; string++) {
    const fret = midi - board.openMidi[string]!;
    if (fret >= 0 && fret <= board.fretCount) out.push({ string, fret });
  }
  return out;
}

/** Lowest and highest pitch the instrument can sound. */
export function pitchRange(board: Fretboard): { low: number; high: number } {
  const lows = board.openMidi;
  return { low: Math.min(...lows), high: Math.max(...lows) + board.fretCount };
}

/**
 * Choose where to play a run of notes so the hand moves as little as possible:
 * small fret jumps, few string changes, a mild pull toward the lower, easier
 * frets, and a bonus for open strings. Returns null when any note cannot be
 * played on this instrument, so callers can transpose by an octave and retry.
 */
export function placeMelody(board: Fretboard, midis: readonly number[], anchorFret?: number): FretSpot[] | null {
  if (midis.length === 0) return [];
  const options = midis.map((m) => spotsFor(board, m));
  if (options.some((o) => o.length === 0)) return null;

  const unary = (spot: FretSpot) =>
    spot.fret * 0.1 +
    Math.max(0, spot.fret - 12) * 0.25 +
    (spot.fret === 0 ? -0.3 : 0) +
    (anchorFret !== undefined && spot.fret > 0 ? Math.abs(spot.fret - anchorFret) * 0.15 : 0);
  const move = (a: FretSpot, b: FretSpot) =>
    Math.abs(a.fret - b.fret) * 0.8 + Math.abs(a.string - b.string) * 0.5 + (a.string === b.string ? 0 : 0.3);

  let costs = options[0]!.map(unary);
  const back: number[][] = [];
  for (let i = 1; i < options.length; i++) {
    const next: number[] = [];
    const from: number[] = [];
    for (const spot of options[i]!) {
      let best = Infinity;
      let bestFrom = 0;
      options[i - 1]!.forEach((previous, j) => {
        const cost = costs[j]! + move(previous, spot);
        if (cost < best) {
          best = cost;
          bestFrom = j;
        }
      });
      next.push(best + unary(spot));
      from.push(bestFrom);
    }
    costs = next;
    back.push(from);
  }

  let index = costs.indexOf(Math.min(...costs));
  const path: FretSpot[] = [];
  for (let i = options.length - 1; i >= 0; i--) {
    path.unshift(options[i]![index]!);
    if (i > 0) index = back[i - 1]![index]!;
  }
  return path;
}

/**
 * Fingering for notes sounded together: each on its own string, as tight on the
 * neck as possible (frets within a four-fret reach). Null when impossible.
 */
export function placeVoicing(board: Fretboard, midis: readonly number[], maxSpan = 4, openPenalty = 0): FretSpot[] | null {
  const sorted = [...midis].sort((a, b) => a - b);
  let best: { spots: FretSpot[]; cost: number } | null = null;

  const search = (index: number, minString: number, chosen: FretSpot[]) => {
    if (index === sorted.length) {
      const fretted = chosen.filter((s) => s.fret > 0).map((s) => s.fret);
      const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0;
      if (span > maxSpan) return;
      const cost = (fretted.length ? Math.min(...fretted) : 0) + span * 2 + chosen.filter((s) => s.fret === 0).length * openPenalty;
      if (!best || cost < best.cost) best = { spots: [...chosen], cost };
      return;
    }
    for (const spot of spotsFor(board, sorted[index]!)) {
      if (spot.string < minString) continue;
      search(index + 1, spot.string + 1, [...chosen, spot]);
    }
  };
  search(0, 0, []);
  return (best as { spots: FretSpot[] } | null)?.spots ?? null;
}
