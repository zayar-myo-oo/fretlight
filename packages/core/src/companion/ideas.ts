import type { Fretboard } from "../instrument/fretboard";
import { generateBass } from "./bass";
import { type GenContext, generateCounter, generateFills, generateLead, profileOf } from "./melody-engine";
import { placeMelody, pitchRange } from "./placement";
import type { Progression } from "./progression";
import { generateRhythm } from "./rhythm";
import { type TabEvent, renderTab } from "./tab";
import type { CompanionStyle, Difficulty, FretSpot, Idea, IdeaCategory, IdeaNote, Technique } from "./types";

export interface IdeaRequest {
  readonly board: Fretboard;
  readonly progression: Progression;
  readonly instrument: "guitar" | "bass";
  readonly style: CompanionStyle;
  readonly difficulty: Difficulty;
  readonly category: IdeaCategory;
  /** 0 = best; increase to get another valid alternative. */
  readonly variant?: number;
  /** Beats a fill takes (1, 2, 4 or 8). */
  readonly fillBeats?: number;
}

/** Where on the neck each note is played, and the technique that links notes on one string. */
function placeIdea(ctx: GenContext, idea: Idea): Idea | null {
  if (idea.notes.every((n) => n.position)) return idea;

  // Out of range for this instrument? Try the same idea an octave lower, then higher.
  for (const shift of [0, -12, 12, -24]) {
    const midis = idea.notes.map((n) => n.midi + shift);
    const spots = placeMelody(ctx.board, midis);
    if (!spots) continue;
    const notes = idea.notes.map<IdeaNote>((n, i) => ({ ...n, midi: n.midi + shift, position: spots[i]! }));
    const target = idea.target ? { ...idea.target, midi: idea.target.midi + shift } : undefined;
    return { ...idea, notes: addTechniques(ctx, notes), ...(target ? { target } : {}) };
  }
  return null;
}

function addTechniques(ctx: GenContext, notes: IdeaNote[]): IdeaNote[] {
  const allowed = new Set<Technique>(profileOf(ctx).techniques);
  if (ctx.difficulty === "beginner") return notes;
  return notes.map((note, i) => {
    const prev = notes[i - 1];
    if (!prev || !prev.position || !note.position || prev.position.string !== note.position.string) return note;
    const delta = note.position.fret - prev.position.fret;
    const quick = note.startBeat - prev.startBeat <= 0.5;
    let technique: Technique | undefined;
    if (note.role === "target" && Math.abs(delta) >= 1 && Math.abs(delta) <= 2 && allowed.has("slide")) technique = "slide";
    else if (quick && delta > 0 && delta <= 3 && allowed.has("hammer")) technique = "hammer";
    else if (quick && delta < 0 && delta >= -3 && allowed.has("pull")) technique = "pull";
    return technique ? { ...note, technique } : note;
  });
}

/** Generate ideas for one category, placed on the board and ready to show, tab and play. */
export function generateIdeas(request: IdeaRequest): Idea[] {
  const ctx: GenContext = {
    board: request.board,
    progression: request.progression,
    style: request.style,
    difficulty: request.difficulty,
    variant: request.variant ?? 0,
    instrument: request.instrument,
  };
  if (request.progression.chords.length === 0) return [];

  let raw: Idea[];
  switch (request.category) {
    case "lead":
      raw = generateLead(ctx);
      break;
    case "fills":
      raw = generateFills(ctx, request.fillBeats ?? 2);
      break;
    case "counter":
      raw = generateCounter(ctx);
      break;
    case "rhythm":
      raw = generateRhythm(ctx);
      break;
    default:
      raw = generateBass({ ...ctx, instrument: "bass" }, request.category);
  }
  return raw.map((idea) => placeIdea(ctx, idea)).filter((idea): idea is Idea => idea !== null);
}

/** Spots grouped into tab columns: notes that start together share a column. */
export function tabEvents(idea: Idea): TabEvent[] {
  const events: TabEvent[] = [];
  for (const note of idea.notes) {
    if (!note.position) continue;
    const last = events[events.length - 1];
    if (last && Math.abs(last.startBeat - note.startBeat) < 1e-6) (last.spots as FretSpot[]).push(note.position);
    else events.push({ startBeat: note.startBeat, spots: [note.position] });
  }
  return events;
}

export function ideaTab(board: Fretboard, idea: Idea): string[] {
  return renderTab(board, tabEvents(idea));
}

/** True when every note of the idea can be played on this instrument's tuning and fret range. */
export function isPlayable(board: Fretboard, idea: Idea): boolean {
  const { low, high } = pitchRange(board);
  return idea.notes.every((n) => {
    if (n.midi < low || n.midi > high) return false;
    if (!n.position) return false;
    const open = board.openMidi[n.position.string];
    return open !== undefined && n.position.fret >= 0 && n.position.fret <= board.fretCount && open + n.position.fret === n.midi;
  });
}

export const GUITAR_CATEGORIES: readonly IdeaCategory[] = ["lead", "fills", "counter", "rhythm"];
export const BASS_CATEGORIES: readonly IdeaCategory[] = [
  "bass-root", "bass-rootfifth", "bass-octave", "bass-passing", "bass-approach", "bass-walking", "bass-melodic", "bass-style", "bass-fills",
];

export const CATEGORY_LABELS: Record<IdeaCategory, string> = {
  lead: "Lead melody",
  fills: "Fills",
  counter: "Counter melody",
  rhythm: "Rhythm",
  "bass-root": "Root notes",
  "bass-rootfifth": "Root + 5th",
  "bass-octave": "Octaves",
  "bass-passing": "Passing notes",
  "bass-approach": "Approach notes",
  "bass-walking": "Walking bass",
  "bass-melodic": "Melodic bass",
  "bass-style": "Style bass",
  "bass-fills": "Bass fills",
};
