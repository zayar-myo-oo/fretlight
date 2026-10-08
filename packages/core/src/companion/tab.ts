import type { Fretboard } from "../instrument/fretboard";
import { midiToNote } from "../theory/pitch";
import type { FretSpot } from "./types";

export interface TabEvent {
  readonly startBeat: number;
  /** Everything sounded at this moment (one spot = a note, several = a chord). */
  readonly spots: readonly FretSpot[];
}

/** Row labels, highest string first. The top string is written lowercase when it matches the lowest ("e" / "E"). */
export function tabLabels(board: Fretboard): string[] {
  const names = board.openMidi.map((midi) => midiToNote(midi).name);
  const labels = names.map((n, i) => (i === names.length - 1 && n === names[0] ? n.toLowerCase() : n));
  return labels.reverse();
}

/**
 * ASCII tab for a run of events, drawn from the same string and fret numbers
 * the fretboard shows. Bar lines fall every four beats.
 */
export function renderTab(board: Fretboard, events: readonly TabEvent[], beatsPerBar = 4): string[] {
  const labels = tabLabels(board);
  const width = Math.max(...labels.map((l) => l.length));
  // Row 0 is the highest string.
  const rows = labels.map((label) => [label.padEnd(width, " "), "|"]);
  const push = (cell: (row: number) => string) => rows.forEach((row, i) => row.push(cell(i)));

  push(() => "-");
  let nextBar = beatsPerBar;
  const first = events[0]?.startBeat ?? 0;
  nextBar = (Math.floor(first / beatsPerBar) + 1) * beatsPerBar;

  for (const event of events) {
    while (event.startBeat >= nextBar) {
      push(() => "-|-");
      nextBar += beatsPerBar;
    }
    const byRow = new Map<number, number>();
    for (const spot of event.spots) byRow.set(board.stringCount - 1 - spot.string, spot.fret);
    push((row) => {
      const fret = byRow.get(row);
      return fret === undefined ? "---" : `${String(fret).padStart(2, "-")}-`;
    });
  }
  push(() => "|");
  return rows.map((row) => row.join(""));
}
